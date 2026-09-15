// The seeding entry point — closes the gap between `dev/sampleData.dev.ts`'s generated
// battery and a ledger a dev-harness page can actually render against.
//
// THE GAP THIS CLOSES. Two things stood between the sample data and the browser:
//
//   1. Nothing under `src/server` imported the specifier `./sampleData`, so `dev/serve.mjs`'s
//      esbuild alias (which rewrites that exact specifier to `dev/sampleData.dev.ts` on every
//      dev build) never fired. THIS file is that import site — see `./sampleData`, below.
//   2. `ledgerStore` was not exported onto the GAS global `Server`, so `persistSync` was
//      unreachable from `dev/boot.js`. `src/server/index.ts` now re-exports THIS module
//      (`devSeed`) instead of `ledgerStore` directly, because the dev harness needs "seed the
//      sample battery", not raw access to the ledger's persistence internals.
//
// WHY THIS IS SAFE IN A DEPLOYED BUILD. `./sampleData` resolves to `src/server/sampleData.ts`
// in every build except the dev one — and that file ships with `SAMPLE_SYNCS: []` on
// principle (see its own header). `seedSampleLedger` checks that FIRST, before touching
// `scanJobs` or `ledgerStore` at all, so a deployed build's `Server.devSeed.seedSampleLedger()`
// is a documented no-op rather than a code path that merely happens not to run today.
//
// THE PIPELINE, IN ORDER — the same one `scanJobs.step` runs in production, never hand-rolled:
//
//   for each entry in SAMPLE_SYNCS:
//     for each scope battery in entry.scopes:
//       records = battery.rawRecords.map(node => scanJobs.slimRecord(battery.scope, node))
//     ledgerStore.persistSync(jobId, entry.syncId, perScope)
//
// `dev/sampleData.dev.ts` generates RAW Wiz-shaped nodes on purpose (see that file's header):
// hand-writing ledger rows would bypass `domain/reconcile.ts`'s twin fold and resolve-by-
// disappearance, and the whole point of the sample battery is to exercise those for real.
// `test/sampleData.test.ts` already proves this exact sequence reconciles to the counts it
// claims; `test/devSeed.test.ts` proves this function is the thing that runs it.

import * as scanJobs from "./scanJobs";
import * as ledgerStore from "./ledgerStore";
import type { ScopePersist } from "./ledgerStore";
import * as repoDomains from "./repoDomains";
import { SAMPLE_SYNCS } from "./sampleData";
import type { Scope } from "../domain/config";

export interface SeedResult {
  /** Ledger rows the store holds for these scopes after seeding — not merely rows added. */
  seeded: number;
  /** SAMPLE_SYNCS entries processed (attempted, including idempotent replays). */
  syncs: number;
  /** Raw nodes fed through slimRecord across every scope of every sync. */
  rows: number;
  /** Set only when nothing was seeded — e.g. a production build, where SAMPLE_SYNCS is empty. */
  reason?: string;
}

export function seedSampleLedger(): SeedResult {
  // First thing this function checks, deliberately: a production build's ./sampleData ships
  // SAMPLE_SYNCS empty, and that must be the whole story — no partial work, no side effect.
  if (SAMPLE_SYNCS.length === 0) {
    return { seeded: 0, syncs: 0, rows: 0, reason: "no sample data in this build" };
  }

  let rows = 0;
  // Every scope the battery ever mentions — tracked up front, not from `committed_scopes`,
  // because a replay against an already-seeded store (persistSync's per-(scan_id, scope)
  // idempotency) commits nothing on its second run but the ledger rows from the first run
  // are still genuinely there; `seeded` below has to keep counting them either way.
  const scopesTouched = new Set<Scope>();

  for (let i = 0; i < SAMPLE_SYNCS.length; i++) {
    const sync = SAMPLE_SYNCS[i]!;
    const perScope: ScopePersist[] = sync.scopes.map((battery) => {
      rows += battery.rawRecords.length;
      scopesTouched.add(battery.scope);
      return {
        scope: battery.scope,
        records: battery.rawRecords.map((node) => scanJobs.slimRecord(battery.scope, node)),
        mode: battery.mode,
        scannedSeverities: battery.scannedSeverities,
        rawRef: null,
      };
    });
    const jobId = `dev-seed-${i + 1}`;
    ledgerStore.persistSync(jobId, sync.syncId, perScope);
  }

  const seeded = Object.values(ledgerStore.loadState().ledger).filter((row) =>
    scopesTouched.has(row.scope),
  ).length;

  return { seeded, syncs: SAMPLE_SYNCS.length, rows };
}

/**
 * A repository → domain map over the repositories THIS SEED actually produced, so the domain
 * scope and the "By business domain" breakdowns are exercisable without a tenant.
 *
 * WHY THE HARNESS NEEDS THIS AT ALL, when it needs nothing equivalent for projects. A project
 * rides in on the finding — `projects[]` is in all three query documents, so the generated
 * sample nodes carry it and the project switcher fills itself. A DOMAIN does not: it is
 * fetched separately by `repoDomains.refreshRepoDomains`, which needs Wiz. Without a seeded
 * map the domain half of the switcher is permanently empty on the dev harness, and a feature
 * nobody can look at locally is one nobody verifies before it ships.
 *
 * DERIVED FROM THE SEEDED REPOSITORIES, NOT A FIXED FIXTURE LIST. A hardcoded map would drift
 * the moment `dev/sampleData.dev.ts` renamed a repository, and would then demonstrate the
 * failure mode (a map whose tokens match nothing) while looking like the feature. Reading the
 * repositories back out of the ledger is also the honest exercise: it is exactly the overlap
 * the real join depends on.
 *
 * THE DOMAIN NAMES ARE SYNTHETIC AND THE ASSIGNMENT IS ARBITRARY — a stable hash of the
 * repository name, so a reload does not reshuffle the picture. They are not a claim about any
 * tenant's vocabulary. NOT EVERY REPOSITORY GETS ONE, deliberately: one in four is left out so
 * the harness shows the state that actually matters on screen — the `noDomain` clause in the
 * caption, and the `(none)` bucket in a breakdown — rather than a tidy fiction in which
 * everything is attributed.
 *
 * Guarded by the same `SAMPLE_SYNCS` check `seedSampleLedger` opens with, so a deployed build
 * cannot write a fake map over a real one.
 */
export interface DomainSeedResult {
  repos: number;
  domains: number;
  unmapped: number;
  reason?: string;
}

const DEV_DOMAINS = ["CROSS", "SAP", "VALUE-CHAIN", "RETAIL"];

export function seedDomainMap(): DomainSeedResult {
  if (SAMPLE_SYNCS.length === 0) {
    return { repos: 0, domains: 0, unmapped: 0, reason: "no sample data in this build" };
  }
  // ONE ENTRY PER REPOSITORY, KEYED ON ITS IDENTITY, WITH ALL ITS TOKENS — not one entry per
  // token. A repository is indexed under both its id and its name, and `resolveDomain` returns
  // on the FIRST token that hits, so deciding tagged-or-not per token would leave a repository
  // "untagged by name, tagged by id" — which resolves, and would make the untagged population
  // below a number with nothing behind it. A real repository entity contributes all of its
  // tokens or none of them; the seed has to do the same or it is not exercising the join.
  const repos = new Map<string, string[]>();
  for (const row of Object.values(ledgerStore.loadState().ledger)) {
    const id = String(row.repo_id ?? "").trim();
    const name = String(row.repo_name ?? "").trim();
    const identity = id || name;
    if (!identity) continue;
    const tokens = repos.get(identity) ?? [];
    for (const t of [id, name]) {
      if (t && tokens.indexOf(t) < 0) tokens.push(t);
    }
    repos.set(identity, tokens);
  }

  const map: Record<string, string> = {};
  const domains = new Set<string>();
  let unmapped = 0;
  for (const [identity, tokens] of [...repos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // A stable, boring hash — the point is only that the same repository lands in the same
    // bucket across reloads, not that the distribution is good.
    let h = 0;
    for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) >>> 0;
    if (h % 4 === 3) {
      unmapped += 1; // the untagged quarter — see the note above
      continue;
    }
    const domain = DEV_DOMAINS[h % DEV_DOMAINS.length]!;
    for (const t of tokens) map[repoDomains.foldToken(t)] = domain;
    domains.add(domain);
  }

  repoDomains.setDomainMap(map);
  return { repos: repos.size - unmapped, domains: domains.size, unmapped };
}
