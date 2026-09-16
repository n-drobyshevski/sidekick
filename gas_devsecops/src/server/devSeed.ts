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
import * as repoTags from "./repoTags";
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
 * A repository → tags map over the repositories THIS SEED actually produced, so the domain
 * scope, the "By business domain" breakdowns, the Lifecycle column and the cold zone's
 * end-of-life exclusion are all exercisable without a tenant.
 *
 * WHY THE HARNESS NEEDS THIS AT ALL, when it needs nothing equivalent for projects. A project
 * rides in on the finding — `projects[]` is in all three query documents, so the generated
 * sample nodes carry it and the project switcher fills itself. A DOMAIN does not: it is
 * fetched separately by `repoTags.refreshRepoTags`, which needs Wiz. Without a seeded
 * map the domain half of the switcher is permanently empty on the dev harness, and a feature
 * nobody can look at locally is one nobody verifies before it ships.
 *
 * DERIVED FROM THE SEEDED REPOSITORIES, NOT A FIXED FIXTURE LIST. A hardcoded map would drift
 * the moment `dev/sampleData.dev.ts` renamed a repository, and would then demonstrate the
 * failure mode (a map whose tokens match nothing) while looking like the feature. Reading the
 * repositories back out of the ledger is also the honest exercise: it is exactly the overlap
 * the real join depends on.
 *
 * THE NAMES ARE SYNTHETIC AND THE ASSIGNMENT IS ARBITRARY — a stable hash of the
 * repository name, so a reload does not reshuffle the picture. They are not a claim about any
 * tenant's vocabulary. NOT EVERY REPOSITORY GETS ONE, deliberately: one in four is left out so
 * the harness shows the state that actually matters on screen — the `noDomain` clause in the
 * caption, and the `(none)` bucket in a breakdown — rather than a tidy fiction in which
 * everything is attributed.
 *
 * Guarded by the same `SAMPLE_SYNCS` check `seedSampleLedger` opens with, so a deployed build
 * cannot write a fake map over a real one.
 */
export interface RepoTagSeedResult {
  repos: number;
  domains: number;
  unmapped: number;
  /** Distinct lifecycle values seeded. */
  lifecycles: number;
  /** Repositories seeded END_OF_LIFE — the population the cold-zone exclusion acts on. */
  endOfLife: number;
  /** Repositories deliberately left with no lifecycle at all. */
  noLifecycle: number;
  reason?: string;
}

const DEV_DOMAINS = ["CROSS", "SAP", "VALUE-CHAIN", "RETAIL"];

/**
 * The lifecycle each tenth of the estate gets, indexed by a second hash.
 *
 * WEIGHTED, AND THE WEIGHTS ARE THE POINT. A uniform draw over three words would retire a
 * third of the estate, which is not a shape any tenant has and would make the cold zone look
 * broken with the exclusion on. Four tenths in production, two in development, two finished
 * and two never tagged is a plausible estate AND reaches every state the page can draw: a
 * lifecycle column with values, the same column empty, and an exclusion that removes a visible
 * minority rather than a rounding error.
 *
 * `null` IS A REAL SLOT, not a gap. A repository nobody tagged is the state
 * `lifecycleTag.isEndOfLife` refuses to read as anything, and the harness has to show it or
 * the refusal is never looked at locally.
 */
const DEV_LIFECYCLE_SLOTS: (string | null)[] = [
  "IN_PRODUCTION", "IN_PRODUCTION", "IN_PRODUCTION", "IN_PRODUCTION",
  "IN_DEVELOPMENT", "IN_DEVELOPMENT",
  "END_OF_LIFE", "END_OF_LIFE",
  null, null,
];

/**
 * The repositories the battery already made special, given the lifecycle their role implies.
 *
 * PINNED, NOT HASHED, and the three of them are the difference between a harness that shows
 * the feature and one that only shows the column. `dev/sampleData.dev.ts` builds these three
 * on purpose — one cold under the fixed window, one idle enough to be ranked in relative mode,
 * one the scanner has stopped returning — so which lifecycle each carries decides what turning
 * the exclusion on actually DOES on screen, and a hash would decide it differently every time
 * a repository was renamed.
 *
 *   retired-mobile    END_OF_LIFE. It is the repository the scanner lost, and its name says
 *                     what happened; leaving it IN_PRODUCTION was the harness contradicting
 *                     its own fixture.
 *   warehouse-sync    END_OF_LIFE. Idle enough to be ranked but not cold under the default
 *                     window, so excluding it MOVES THE RELATIVE LINE without removing
 *                     anything from the fixed-mode table — the interaction worth being able
 *                     to look at.
 *   legacy-batch      IN_PRODUCTION, pinned rather than left to chance. It is the one cold
 *                     repository under the default window, and a harness where the exclusion
 *                     empties the cold zone would show the feature deleting the section
 *                     instead of narrowing it. A real estate has many cold repositories and
 *                     few retired ones; this keeps that proportion.
 */
const DEV_PINNED_LIFECYCLES: Record<string, string> = {
  "dktunited/retired-mobile": "END_OF_LIFE",
  "dktunited/warehouse-sync": "END_OF_LIFE",
  "dktunited/legacy-batch": "IN_PRODUCTION",
};

/** A stable, boring hash — the same repository must land in the same bucket across reloads. */
function hashOf(identity: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) >>> 0;
  return h;
}

export function seedRepoTagMap(): RepoTagSeedResult {
  const empty = { repos: 0, domains: 0, unmapped: 0, lifecycles: 0, endOfLife: 0, noLifecycle: 0 };
  if (SAMPLE_SYNCS.length === 0) {
    return { ...empty, reason: "no sample data in this build" };
  }
  // ONE ENTRY PER REPOSITORY, KEYED ON ITS IDENTITY, WITH ALL ITS TOKENS — not one entry per
  // token. A repository is indexed under both its id and its name, and `resolveRepoTags` returns
  // on the FIRST token that hits, so deciding tagged-or-not per token would leave a repository
  // "untagged by name, tagged by id" — which resolves, and would make the untagged population
  // below a number with nothing behind it. A real repository entity contributes all of its
  // tokens or none of them; the seed has to do the same or it is not exercising the join.
  const repos = new Map<string, string[]>();
  const nameOf = new Map<string, string>();
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
    if (name) nameOf.set(identity, name);
  }

  const map: repoTags.RepoTagMap = {};
  const domains = new Set<string>();
  const lifecycles = new Set<string>();
  let unmapped = 0;
  let endOfLife = 0;
  let noLifecycle = 0;
  for (const [identity, tokens] of [...repos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const h = hashOf(identity, 0);
    // A SECOND, INDEPENDENT DRAW FOR THE LIFECYCLE, off a different seed — so the two tags do
    // not line up and the harness produces all four combinations, including the two the
    // two-pass fetch exists for: a repository with a domain and no lifecycle, and one with a
    // lifecycle and no domain. A single hash reused for both would make "tagged" one decision
    // and hide exactly the case where one pass reaches a repository the other does not.
    const lifecycle = DEV_PINNED_LIFECYCLES[nameOf.get(identity) ?? ""]
      ?? DEV_LIFECYCLE_SLOTS[hashOf(identity, 7) % DEV_LIFECYCLE_SLOTS.length]!;
    const domain = h % 4 === 3 ? null : DEV_DOMAINS[h % DEV_DOMAINS.length]!;
    if (domain === null) unmapped += 1; // the untagged quarter — see the note above
    if (lifecycle === null) noLifecycle += 1;
    else if (lifecycle === "END_OF_LIFE") endOfLife += 1;
    if (domain === null && lifecycle === null) continue; // carries neither: not in the map
    for (const t of tokens) map[repoTags.foldToken(t)] = { domain, lifecycle };
    if (domain) domains.add(domain);
    if (lifecycle) lifecycles.add(lifecycle);
  }

  repoTags.setRepoTagMap(map);
  return {
    repos: repos.size - unmapped,
    domains: domains.size,
    unmapped,
    lifecycles: lifecycles.size,
    endOfLife,
    noLifecycle,
  };
}
