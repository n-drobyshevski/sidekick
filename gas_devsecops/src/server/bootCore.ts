// The cached half of `api.bootstrap`: everything the shell's first paint needs that is derived
// from the ledger, the settings, the `scans` tab and the repository tag map.
//
// WHY IT IS SAFE TO CACHE PER DATA VERSION. Every writer of those four bumps DATA_VERSION —
// `ledgerStore`'s commit (ledger + scans), `settingsStore.saveSettings` and
// `repoTags.setRepoTagMap` — and the one Script Property the core reads, WIZ_PROJECT_ID_V2
// (`scope.syncProjectId`), is folded into every key by `serverCache.configStamp`. What changes
// WITHOUT a bump, or differs per viewer, stays out of here and is read live by
// `api.withLiveBootFields`.
//
// THE HEADER VIEW IS ONE OF THOSE NOW. A view switch (`api.setProjectView` / `setDomainView`)
// saves the settings WITHOUT bumping the data version, so that it does not cold-start every
// cache for every user — which means nothing here may depend on the view: not the settings echo
// (it carries `projectView` / `domainView`), not `scope.projectView` / `domainView`, and not the
// `shown` count. All three are live fields; `shown` is read off this core's own register-wide
// catalogues (`viewShown` below), which already count every project and every domain.
//
// WHY IT EXISTS. The first production log (PERF_PLAN.md step 1) measured doGet computing all
// of this inline on every page load: 7.1 s cold, 6.4 s WARM — a ledger-snapshot read from Drive
// (~2.2 s), the `domain_map` tab (~1.6 s), opening the spreadsheet, and the derivations over
// ~28k rows. None of it was cached, so a warm page paid it as fully as a cold one.
//
// Its own module rather than a function in api.ts so `readModels.warmReadModels` can warm it
// without importing api.ts.

import { SCOPE_LABELS, SCOPES, SEVERITY_ORDER, SLA_TARGETS } from "../domain/config";
import { effectiveSlaTargets } from "../domain/settingsLogic";
import { attachProjectGrain, projectCatalogue, unattributedCount } from "../domain/projectScope";
import { domainCatalogue, noDomainCount } from "../domain/domainScope";
import type { Rec } from "../domain/util";
import type { Bootstrap } from "./api";
import * as ledgerStore from "./ledgerStore";
import { projectScope } from "./props";
import { durablyCached, durablyPeek } from "./readModelStore";
import * as repoTags from "./repoTags";
import { loadSettings } from "./settingsStore";
import { stageLaps } from "./stageLog";
import * as currentDomains from "./currentDomains";

/** The keys `api.withLiveBootFields` reads live on every call and this core never holds. */
type LiveKey =
  | "buildId" | "hasCredentials" | "wizVerifiedAt" | "activeJob" | "canEditAccess" | "hubUrl"
  | "settings" | "scope";
/** The view-dependent half of `Bootstrap.scope`, also live (see the header). */
type LiveScopeKey = "projectView" | "domainView" | "shown";
export type BootCore = Omit<Bootstrap, LiveKey> & { scope: Omit<Bootstrap["scope"], LiveScopeKey> };

// Shared by `bootCoreModel` and `peekBootCore`, so doGet's inline path can only ever peek at
// the entry the RPC reads and the warm writes. Params are empty because every input is covered
// by the version stamp (see the header); a param added to the compute must join them.
// "dsBootCore1" → "dsBootCore2": `settings` gained `supportGroupDomains` and `filterOptions`
// gained `supportGroups` / `assignableDomains` (the support-group domain overrides).
// "dsBootCore2" → "dsBootCore3": view-independent — `settings`, `scope.projectView`,
// `scope.domainView` and `scope.shown` left the core for `api.withLiveBootFields`. A warm "2"
// entry still carries them, frozen at whichever view was in force when it was computed.
const BOOT_CORE = "dsBootCore3";
const BOOT_CORE_PARAMS = {};

/** The core, cached — L1 CacheService, then the durable Drive copy, then computed. */
export function bootCoreModel(): BootCore {
  return durablyCached(BOOT_CORE, BOOT_CORE_PARAMS, buildBootCore);
}

/** The core if it is already stored (L1, then the durable file), never computed: null = cold. */
export function peekBootCore(): BootCore | null {
  const core = durablyPeek(BOOT_CORE, BOOT_CORE_PARAMS);
  return core && typeof core === "object" && !Array.isArray(core) ? (core as BootCore) : null;
}

/**
 * The compute. Its parts are timed to the execution log as one `{"stage":"bootCore",…}` line
 * (test/api.test.ts pins the lap names), which is what the first log attributed the inline
 * cost with.
 */
export function buildBootCore(): BootCore {
  const laps = stageLaps("bootCore");
  // `ledgerStore`'s per-execution memo of the tab, not a read of its own: a cold bootstrap
  // computes beside read models that load the same tab (`readModels.newestScanByScope`, the
  // history and register models), and the warm computes the core first in an execution that
  // goes on to need it again. Same cells — `rowToScan` stringifies exactly as this did — except
  // that a row with an unreadable scope reads as `sca`, as it does for every other reader.
  const scans = ledgerStore.loadScanRows();
  // Pass 1: which sync is newest. Pass 2: every row of THAT sync. Two passes rather than one
  // because the winner is only known at the end, and a sync's rows are not adjacent on the tab.
  let newestTs = "";
  let newestSyncId = "";
  // The rail's OWN clock, one per scope — a max over the whole tab (above) reads "fresh" the
  // moment any one scope ran; this is the per-scope answer `railStatus.js` takes the worst of.
  const lastScanByScope: Record<string, string | null> = {};
  for (const scope of SCOPES) lastScanByScope[scope] = null;
  for (const row of scans) {
    const ts = row.ts;
    if (!ts || ts <= newestTs) continue;
    newestTs = ts;
    newestSyncId = row.scan_id;
  }
  for (const row of scans) {
    const ts = row.ts;
    const scope = String(row.scope);
    if (!ts || !(scope in lastScanByScope)) continue;
    if (lastScanByScope[scope] === null || ts > lastScanByScope[scope]!) {
      lastScanByScope[scope] = ts;
    }
  }
  let latestSync: Bootstrap["latestSync"] = null;
  if (newestSyncId) {
    const members = scans.filter((r) => r.scan_id === newestSyncId);
    const order = new Map(SCOPES.map((sc, i) => [String(sc), i]));
    const rows = members
      .map((r) => ({ scope: String(r.scope), total: r.total, severities: r.severities, ts: r.ts }))
      // Battery order, not tab order, so the caption reads the same on every load.
      .sort((a, b) => (order.get(a.scope) ?? 99) - (order.get(b.scope) ?? 99));
    let total = 0;
    let ts = "";
    for (const r of rows) {
      total += r.total;
      if (r.ts > ts) ts = r.ts;
    }
    latestSync = {
      sync_id: newestSyncId,
      ts: ts || newestTs,
      total,
      scopes: rows.map((r) => ({ scope: r.scope, total: r.total, severities: r.severities })),
    };
  }
  laps.lap("scans");

  const settings = loadSettings();
  laps.lap("settings");
  // Unscoped by construction — `ledgerStore.loadBaseRows()` with no options is every scope,
  // every project. `scope.register` / `filterOptions.projectList` both read off this same
  // array so the register-wide side of the header can never disagree with itself.
  const allRows = ledgerStore.loadBaseRows();
  laps.lap("baseRows");
  // ATTACHED BEFORE ANYTHING COUNTS. `_domain` is resolved on read and never persisted (see
  // domain/domainTag.ts), so every figure below — the catalogues (and with them the live
  // `shown`), `noDomain` — has to be taken from rows that have already been through the join.
  // Doing it once here is also what keeps the register-wide side of the header self-consistent: `filterOptions.domainList`
  // and `scope.noDomain` read the same array.
  // Grain first (the domain assignment reads `_supportGroup`), the tag join for `_lifecycle`,
  // then `_domain` from the current-domain assignment — the same three steps, in the same
  // order, as `readModels.baseSnapshot`, so the header counts what every page counts.
  attachProjectGrain(allRows);
  repoTags.attachRepoTags(allRows as unknown as Rec[], { domain: false });
  currentDomains.attachCurrentDomains(allRows as unknown as Rec[]);
  laps.lap("repoTags");
  const core: BootCore = {
    product: "Wiz Sidekick DevSecOps",
    scopes: SCOPES,
    scopeLabels: SCOPE_LABELS,
    severityOrder: SEVERITY_ORDER,
    slaTargets: SLA_TARGETS,
    effectiveSlaTargets: effectiveSlaTargets(settings),
    latestSync,
    lastScanByScope,
    scope: {
      register: allRows.length,
      unattributed: unattributedCount(allRows),
      noDomain: noDomainCount(allRows),
      // The FETCH scope, reported only — see `settingsLogic.ts`'s "TWO PROJECT SCOPES, TWO
      // HOMES". `projectScope()` is `[id] | null`; only the first element is ever set today.
      syncProjectId: projectScope()?.[0] ?? null,
    },
    filterOptions: {
      projectList: projectCatalogue(allRows),
      domainList: domainCatalogue(allRows),
      // For the support-group domain overrides (Settings → System, the MTTR row sheet): every
      // primary support group the register holds, and every domain one may be set to.
      supportGroups: [...new Set((allRows as unknown as Rec[])
        .map((r) => String(r["_supportGroup"] ?? "")).filter(Boolean))].sort(),
      assignableDomains: currentDomains.assignableDomains(),
    },
  };
  laps.lap("catalogues");
  laps.log();
  return core;
}

/**
 * `scope.shown` — how many of the register's rows the header's view takes in — read off the
 * core's catalogues instead of a pass over the rows, so it can be live while the core stays
 * cached.
 *
 * THE SAME FIGURE THE ROW PASS GAVE, by construction rather than by luck: a catalogue entry's
 * `findings` counts the rows `inProject` / `inDomain` admit (`projectCatalogue` counts a slug
 * once per row; `domainCatalogue` counts a row under its one trimmed `_domain`, and `inDomain`
 * compares against that same trimmed value), over the same register-wide rows, attached the
 * same way. A view naming nothing the register holds has no entry and shows 0 — what the pass
 * gave it — and test/projectView.test.ts compares the two over the dev sample battery.
 *
 * At most one of the two views is ever set — `withProjectView`/`withDomainView` clear each
 * other — so this reads as a chain, the project first, exactly as the row pass did.
 */
export function viewShown(
  core: Pick<BootCore, "filterOptions" | "scope">,
  projectView: string,
  domainView: string,
): number {
  if (projectView) {
    return core.filterOptions.projectList.find((p) => p.slug === projectView)?.findings ?? 0;
  }
  if (domainView) {
    return core.filterOptions.domainList.find((d) => d.name === domainView)?.findings ?? 0;
  }
  return core.scope.register;
}
