// The cached half of `api.bootstrap`: everything the shell's first paint needs that is derived
// from the ledger, the settings, the `scans` tab and the repository tag map.
//
// WHY IT IS SAFE TO CACHE PER DATA VERSION. Every writer of those four bumps DATA_VERSION —
// `ledgerStore`'s commit (ledger + scans), `settingsStore.saveSettings` (which is also how the
// project/domain views persist) and `repoTags.setRepoTagMap` — and the one Script Property the
// core reads, WIZ_PROJECT_ID_V2 (`scope.syncProjectId`), is folded into every key by
// `serverCache.configStamp`. What changes WITHOUT a bump, or differs per viewer, stays out of
// here and is read live by `api.withLiveBootFields`.
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
import { inProject, parseProjects, projectCatalogue, unattributedCount } from "../domain/projectScope";
import { domainCatalogue, inDomain, noDomainCount } from "../domain/domainScope";
import type { Rec } from "../domain/util";
import type { Bootstrap } from "./api";
import * as ledgerStore from "./ledgerStore";
import { projectScope } from "./props";
import { durablyCached, durablyPeek } from "./readModelStore";
import * as repoTags from "./repoTags";
import { loadSettings } from "./settingsStore";
import { readAll, TABS } from "./sheetsDb";
import { stageLaps } from "./stageLog";

/** The keys `api.withLiveBootFields` reads live on every call and this core never holds. */
type LiveKey = "buildId" | "hasCredentials" | "wizVerifiedAt" | "activeJob" | "canEditAccess" | "hubUrl";
export type BootCore = Omit<Bootstrap, LiveKey>;

// Shared by `bootCoreModel` and `peekBootCore`, so doGet's inline path can only ever peek at
// the entry the RPC reads and the warm writes. Params are empty because every input is covered
// by the version stamp (see the header); a param added to the compute must join them.
const BOOT_CORE = "dsBootCore1";
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
  const scans = readAll(TABS.scans);
  // Pass 1: which sync is newest. Pass 2: every row of THAT sync. Two passes rather than one
  // because the winner is only known at the end, and a sync's rows are not adjacent on the tab.
  let newestTs = "";
  let newestSyncId = "";
  // The rail's OWN clock, one per scope — a max over the whole tab (above) reads "fresh" the
  // moment any one scope ran; this is the per-scope answer `railStatus.js` takes the worst of.
  const lastScanByScope: Record<string, string | null> = {};
  for (const scope of SCOPES) lastScanByScope[scope] = null;
  for (const row of scans) {
    const ts = String(row.ts ?? "");
    if (!ts || ts <= newestTs) continue;
    newestTs = ts;
    newestSyncId = String(row.scan_id ?? "");
  }
  for (const row of scans) {
    const ts = String(row.ts ?? "");
    const scope = String(row.scope ?? "");
    if (!ts || !(scope in lastScanByScope)) continue;
    if (lastScanByScope[scope] === null || ts > lastScanByScope[scope]!) {
      lastScanByScope[scope] = ts;
    }
  }
  let latestSync: Bootstrap["latestSync"] = null;
  if (newestSyncId) {
    const members = scans.filter((r) => String(r.scan_id ?? "") === newestSyncId);
    const order = new Map(SCOPES.map((sc, i) => [String(sc), i]));
    const rows = members
      .map((r) => ({
        scope: String(r.scope ?? ""),
        total: Number(r.total ?? 0),
        severities: r.severities == null ? null : String(r.severities),
        ts: String(r.ts ?? ""),
      }))
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
  // domain/domainTag.ts), so every figure below — the catalogue, `shown`, `noDomain` — has to
  // be taken from rows that have already been through the join. Doing it once here is also
  // what keeps the register-wide side of the header self-consistent: `filterOptions.domainList`
  // and `scope.noDomain` read the same array.
  repoTags.attachRepoTags(allRows as unknown as Rec[]);
  laps.lap("repoTags");
  const projectView = settings.projectView || null;
  const domainView = settings.domainView || null;
  // At most one of the two is ever set — `withProjectView`/`withDomainView` clear each other —
  // so this reads as a chain rather than an intersection. A stored pair carrying both would be
  // a defect upstream, and silently intersecting them here would hide it.
  const shown = projectView
    ? allRows.filter((r) => inProject(parseProjects(r.projects_json), projectView)).length
    : domainView
      ? allRows.filter((r) => inDomain(r, domainView)).length
      : allRows.length;
  const core: BootCore = {
    product: "Wiz Sidekick DevSecOps",
    scopes: SCOPES,
    scopeLabels: SCOPE_LABELS,
    severityOrder: SEVERITY_ORDER,
    slaTargets: SLA_TARGETS,
    effectiveSlaTargets: effectiveSlaTargets(settings),
    latestSync,
    lastScanByScope,
    settings,
    scope: {
      projectView: settings.projectView,
      domainView: settings.domainView,
      shown,
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
    },
  };
  laps.lap("catalogues");
  laps.log();
  return core;
}
