// Pins the two halves of the gap CLAUDE.md's `## gas_devsecops` entry describes:
//
//   1. `src/server/sampleData.ts` (the production stub `./sampleData` resolves to in every
//      build except the dev one) MUST stay empty — every array literal, literally, as text.
//      That is the guard against someone "helpfully" pasting sample data into the seam that
//      ships in a deployed build.
//   2. `devSeed.seedSampleLedger()` is the function that actually walks `SAMPLE_SYNCS`
//      through `scanJobs.slimRecord` -> `ledgerStore.persistSync` — the same pipeline
//      `scanJobs.step` runs in production, never a hand-rolled fold — and it does NOTHING
//      when `./sampleData` resolves to the empty production stub (checked FIRST, before
//      either module is even touched).
//
// The "empty stub" checks below import `../src/server/devSeed` and `../src/server/sampleData`
// with NO mocking at all — this file installs no top-level `vi.mock`, on purpose, so those
// imports resolve to the real, unmodified production files exactly as a deployed build would
// see them. The "real battery" describe block at the bottom is the one exception: it swaps
// `./sampleData` for `dev/sampleData.dev.ts`'s actual generated battery via `vi.doMock` +
// `vi.resetModules()` (scoped to its own test, not hoisted file-wide the way `vi.mock` is —
// hoisting it would mean EVERY import in this file, including the empty-stub checks above,
// resolved through the mock), plus the same in-memory `sheetsDb`/`archiveStore`/`props` fakes
// `test/sampleData.test.ts` uses, so `ledgerStore.persistSync` runs for real against a fake
// platform rather than a fake `persistSync`.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Scope } from "../src/domain/config";

const STUB_PATH = new URL("../src/server/sampleData.ts", import.meta.url);
const STUB_SRC = readFileSync(STUB_PATH, "utf8");

/* --------------------------------------------------------- 1: the production stub is empty */

describe("src/server/sampleData.ts — the production stub", () => {
  it("declares no non-empty array literal anywhere in the file", () => {
    // Every non-nested `[...]` span in the file, brackets included. A type annotation like
    // `Rec[]` or `readonly SampleSync[]` matches too — its span is `[]`, trimmed content is
    // empty — so this doesn't need to tell a type from a literal; it only needs every pair of
    // brackets in the file to have nothing but whitespace between them.
    const spans = STUB_SRC.match(/\[[^[\]]*\]/g) ?? [];
    expect(spans.length).toBeGreaterThan(0); // the file does declare array-shaped exports
    for (const span of spans) {
      expect(span.slice(1, -1).trim(), `non-empty array literal: ${span}`).toBe("");
    }
  });

  it("SAMPLE_SYNCS, SAMPLE_FINDINGS and every SAMPLE_RAW_NODES scope are empty at runtime", async () => {
    const mod = await import("../src/server/sampleData");
    expect(mod.SAMPLE_SYNCS).toHaveLength(0);
    expect(mod.SAMPLE_FINDINGS).toHaveLength(0);
    expect(mod.SAMPLE_RAW_NODES.sca).toHaveLength(0);
    expect(mod.SAMPLE_RAW_NODES.sast).toHaveLength(0);
    expect(mod.SAMPLE_RAW_NODES.secrets).toHaveLength(0);
  });

  it("SAMPLE_COUNTS is all zero", async () => {
    const mod = await import("../src/server/sampleData");
    expect(mod.SAMPLE_COUNTS).toEqual({
      sca: 0, sast: 0, secrets: 0, secretsSingles: 0, secretsTwinPairs: 0,
    });
  });

  it("mirrors dev/sampleData.dev.ts's export names exactly", async () => {
    const dev = await import("../dev/sampleData.dev");
    const prod = await import("../src/server/sampleData");
    expect(Object.keys(prod).sort()).toEqual(Object.keys(dev).sort());
  });
});

/* --------------------------------------------------- 2: seedSampleLedger, unmocked, empty */

describe("devSeed.seedSampleLedger — against the real, empty production stub", () => {
  it("is a documented no-op, checked BEFORE touching scanJobs or ledgerStore", async () => {
    // No GAS shims and no sheetsDb/archiveStore mocks in this describe block: if this
    // function got as far as `ledgerStore.persistSync`, it would throw reaching for
    // PropertiesService/SpreadsheetApp. A clean, exact-zero return IS the proof it didn't.
    const { seedSampleLedger } = await import("../src/server/devSeed");
    const result = seedSampleLedger();
    expect(result).toEqual({
      seeded: 0,
      syncs: 0,
      rows: 0,
      reason: "no sample data in this build",
    });
  });

  it("every scope named in the dev battery is a real Scope (sanity for case 3 below)", async () => {
    const dev = await import("../dev/sampleData.dev");
    const seen = new Set<Scope>();
    for (const sync of dev.SAMPLE_SYNCS) for (const b of sync.scopes) seen.add(b.scope);
    expect([...seen].sort()).toEqual(["sast", "sca", "secrets"]);
  });
});

/* -------------------------------------------------- 3: seedSampleLedger, the real battery */

interface Row { [k: string]: unknown }

describe("devSeed.seedSampleLedger — the real battery, through the real pipeline", () => {
  const tables: Record<string, Row[]> = {};
  const drive = { backups: {} as Record<string, unknown>, obs: {} as Record<string, string[]> };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  async function mockSeamsAndImportDevSeed() {
    vi.resetModules();

    // The esbuild alias's job, done here by the test instead of by a bundler resolve hook:
    // `./sampleData`, as devSeed.ts imports it, resolves to the dev harness's real generated
    // battery rather than the empty production stub.
    vi.doMock("../src/server/sampleData", async () => {
      const dev = await import("../dev/sampleData.dev");
      return { ...dev };
    });

    vi.doMock("../src/server/sheetsDb", async (importOriginal) => {
      const real = await importOriginal<typeof import("../src/server/sheetsDb")>();
      const project = (tab: string, row: Row): Row => {
        const out: Row = {};
        for (const h of real.TAB_HEADERS[tab] ?? []) out[h] = h in row ? row[h] : null;
        return out;
      };
      return {
        TABS: real.TABS,
        TAB_HEADERS: real.TAB_HEADERS,
        readAll: (tab: string) => tables[tab] ?? [],
        readTail: (tab: string, n: number) => (tables[tab] ?? []).slice(-n),
        overwrite: (tab: string, rows: Row[]) => {
          tables[tab] = rows.map((r) => project(tab, r));
        },
        appendRows: (tab: string, rows: Row[]) => {
          tables[tab] = [...(tables[tab] ?? []), ...rows.map((r) => project(tab, r))];
        },
        updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
          const row = (tables[tab] ?? []).find((r) => r[key] === value);
          if (!row) return false;
          for (const [k, v] of Object.entries(patch)) {
            if ((real.TAB_HEADERS[tab] ?? []).includes(k)) row[k] = v;
          }
          return true;
        },
        dataRowCount: (tab: string) => (tables[tab] ?? []).length,
        trimSurplusRows: () => 0,
        // The domain map's tab is created lazily in the real module; `tables` needs no creating.
        ensureTab: () => null,
      };
    });

    const props: Record<string, string> = {};
    vi.doMock("../src/server/props", async (importOriginal) => {
      const real = await importOriginal<typeof import("../src/server/props")>();
      return {
        ...real,
        getProp: (k: string) => props[k] ?? null,
        setProp: (k: string, v: string) => { props[k] = v; },
        deleteProp: (k: string) => { delete props[k]; },
        requireProp: (k: string) => props[k] ?? "",
        hasWizCredentials: () => false,
      };
    });

    vi.doMock("../src/server/archiveStore", () => ({
      writeBackup: (jobId: string, state: unknown) => {
        drive.backups[jobId] = clone(state);
        return `backup-${jobId}`;
      },
      readBackup: (jobId: string) => (jobId in drive.backups ? clone(drive.backups[jobId]) : null),
      trashBackup: (jobId: string) => { delete drive.backups[jobId]; },
      writeLedgerSnapshot: () => {},
      readLedgerSnapshot: () => null,
      writeObservations: (scanId: string, keys: string[]) => {
        drive.obs[scanId] = [...keys];
        return `obs-${scanId}`;
      },
      readObservations: (scanId: string) => drive.obs[scanId] ?? [],
      trashScan: () => {},
    }));

    const devSeed = await import("../src/server/devSeed");
    const ledgerStore = await import("../src/server/ledgerStore");
    const repoTags = await import("../src/server/repoTags");
    return { devSeed, ledgerStore, repoTags, tables };
  }

  it("walks all three SAMPLE_SYNCS through slimRecord -> persistSync and reports the counts", async () => {
    const { devSeed, ledgerStore } = await mockSeamsAndImportDevSeed();

    const result = devSeed.seedSampleLedger();

    // Measured independently against the real dev/sampleData.dev.ts battery (not hand-derived
    // arithmetic — see this describe block's header): 3 syncs, 1430 raw nodes fed through
    // slimRecord across them, folding to 400 sca + 40 sast + 114 secrets = 554 ledger rows
    // (secrets: 120 nodes / 6 twin-key collisions -> 114 keys, pinned separately by
    // test/sampleData.test.ts; no scope's key population grows after this seed's first scan).
    // The raw-node count moved from 1436 to 1430 (WP4, cold-zone dev seed): three sca specs
    // (dev/sampleData.dev.ts's UNOBSERVED_REPO_STAYS_IDX, repo-10 "retired-mobile") are now
    // flagged scan-A-only so the harness has an `unobserved` repo — each is emitted at scan A
    // but not at scan B or scan C, so the battery carries 3 fewer nodes at each of those two
    // syncs: 1436 - 3*2 = 1430. `seeded`/`rows` folds to the same 554 live ledger rows either
    // way, because these 3 findings are resolved by disappearance rather than counted twice.
    // A second cold-zone repo (SLOW_REPO_STAYS_IDX / SLOW_REPO_RESOLVED_IDX, repo-11
    // "warehouse-sync") was added later so relative mode has two repositories to rank instead
    // of one — it reassigns three ordinary STAYS indices and two ordinary API_RESOLVED indices
    // to a different repo, present at every scan exactly as the unmodified specs were, so it
    // moves no raw-node count and 1430/554 are unchanged.
    expect(result).toEqual({ seeded: 554, syncs: 3, rows: 1430 });

    const ledger = ledgerStore.loadState().ledger;
    const byScope: Record<string, number> = {};
    for (const row of Object.values(ledger)) byScope[row.scope] = (byScope[row.scope] ?? 0) + 1;
    expect(byScope).toEqual({ sca: 400, sast: 40, secrets: 114 });
  });

  // THE ORGANISATION-WIDE TAG, END TO END OVER THE REAL SEED. dev/sampleData.dev.ts puts
  // `GITHUB-DKTUNITED` on every node exactly as the tenant's connector does, so this is the
  // one place the rule is asked of the whole pipeline rather than of a hand-built row: the
  // observation keeps it, the two answers derived from it do not.
  it("the seeded connector tag is stored but never offered as a scope or an owner", async () => {
    const { devSeed, ledgerStore } = await mockSeamsAndImportDevSeed();
    const { projectCatalogue } = await import("../src/domain/projectScope");
    devSeed.seedSampleLedger();

    const rows = Object.values(ledgerStore.loadState().ledger);
    // THE OBSERVATION IS INTACT — this is an exclusion from the analysis, not from the ledger.
    expect(rows.every((r) => (r.projects_json ?? "").includes("GITHUB-DKTUNITED"))).toBe(true);

    const slugs = projectCatalogue(rows).map((c) => c.slug);
    expect(slugs.length).toBeGreaterThan(1); // or there is nothing to have excluded it from
    expect(slugs).not.toContain("github-dktunited");
    expect(rows.some((r) => r.owner_project === "GITHUB-DKTUNITED")).toBe(false);
    // And the seed still files every row under a real owner, so the exclusion cost nothing.
    expect(rows.every((r) => r.owner_project !== null)).toBe(true);
  });

  // THE TWO PROJECT GRAINS, END TO END OVER THE REAL SEED. dev/sampleData.dev.ts models the
  // tenant's shape — every repository under a CS/CE/LU support group, most under a
  // `product-…` product, one support group covering TWO products, one repository with no
  // product and one product filed under two groups. That last pair is why this is worth
  // asserting here rather than only against hand-built rows: those are the branches a seed
  // that modelled the happy path alone would leave permanently unexercised.
  it("the seed resolves both grains, and one support group covers several products", async () => {
    const { devSeed, ledgerStore } = await mockSeamsAndImportDevSeed();
    const { attachProjectGrain, projectCatalogue } = await import("../src/domain/projectScope");
    devSeed.seedSampleLedger();

    // The two grains are attached IN MEMORY, so a ledger row does not declare them — which is
    // the point of the design and the reason for this cast.
    const rows = Object.values(ledgerStore.loadState().ledger) as unknown as Array<{
      projects_json: string | null;
      owner_project: string | null;
      owner_path: string | null;
      _supportGroup?: string | null;
      _product?: string | null;
    }>;
    attachProjectGrain(rows);

    // EVERY repository names a support group — that is the tenant's claim, and the seed's.
    expect(rows.every((r) => typeof r._supportGroup === "string" && r._supportGroup)).toBe(true);

    // ONE GROUP, MANY PRODUCTS. Without this the support-group breakdown would be a second
    // spelling of the product breakdown and no test would notice.
    const byGroup = new Map<string, Set<string>>();
    for (const r of rows) {
      if (typeof r._supportGroup !== "string" || typeof r._product !== "string") continue;
      const set = byGroup.get(r._supportGroup) ?? new Set<string>();
      set.add(r._product);
      byGroup.set(r._supportGroup, set);
    }
    expect([...byGroup.values()].some((products) => products.size > 1)).toBe(true);

    // AND THE TWO REFUSALS ARE REACHABLE. A repository the tenant filed under no product
    // answers none rather than borrowing its support group's name…
    expect(rows.some((r) => r._product === undefined)).toBe(true);
    // …and a product two groups claim names neither, which the catalogue reports as a count.
    const cat = projectCatalogue(rows);
    expect(cat.some((c) => c.supportGroupCount > 1 && c.supportGroup === null)).toBe(true);
    // The org-wide connector tag is in none of it — parseProjects drops it first.
    expect(cat.every((c) => c.slug !== "github-dktunited")).toBe(true);
  });

  // THE DOMAIN AXIS, END TO END OVER THE REAL SEED. Everything else about the join is held in
  // test/repoTags.test.ts against hand-built rows; what those cannot prove is the thing the
  // join actually risks — that the tokens a map is built under OVERLAP the ones the ledger's
  // rows carry. Here the map is derived from the seeded repositories and then asked to place
  // those same rows, which is the one arrangement where a mismatch would show up as silence.
  it("seedRepoTagMap builds a map that actually places the seeded rows", async () => {
    const { devSeed, ledgerStore, repoTags } = await mockSeamsAndImportDevSeed();
    devSeed.seedSampleLedger();

    const result = devSeed.seedRepoTagMap();
    expect(result.reason).toBeUndefined();
    expect(result.domains).toBeGreaterThan(1); // or the switcher has no choice to offer
    expect(result.repos).toBeGreaterThan(0);
    // A QUARTER LEFT UNTAGGED ON PURPOSE — the harness has to show the `noDomain` caption and
    // the `(none)` breakdown bucket, not a fiction in which everything is attributed.
    expect(result.unmapped).toBeGreaterThan(0);
    // AND THE LIFECYCLE IS DRAWN SEPARATELY, so all four combinations exist. Without the
    // END_OF_LIFE slot the cold zone's exclusion has nothing to exclude on the harness and is
    // never looked at locally; without the untagged slot the column's absence mark never draws.
    expect(result.lifecycles).toBeGreaterThan(1);
    expect(result.endOfLife).toBeGreaterThan(0);
    expect(result.noLifecycle).toBeGreaterThan(0);

    const rows = Object.values(ledgerStore.loadState().ledger) as unknown as Record<string, unknown>[];
    repoTags.resetRepoTagMapMemo();
    repoTags.attachRepoTags(rows);

    const placed = rows.filter((r) => typeof r["_domain"] === "string" && r["_domain"]);
    // THE ASSERTION THAT MATTERS: the join placed rows at all. A token mismatch — the failure
    // mode the map's several-identities indexing exists to survive — reads as exactly zero.
    expect(placed.length).toBeGreaterThan(0);
    const names = new Set(placed.map((r) => r["_domain"]));
    expect(names.size).toBe(result.domains);
    // And it did NOT place everything, so both halves of the picture are exercised.
    expect(placed.length).toBeLessThan(rows.length);

    // ONE PASS ATTACHES BOTH TAGS. A row placed by the lifecycle half proves the second half
    // of the join is wired, and the end-of-life population proves the exclusion has a subject.
    const lifed = rows.filter((r) => typeof r["_lifecycle"] === "string" && r["_lifecycle"]);
    expect(lifed.length).toBeGreaterThan(0);
    expect(lifed.length).toBeLessThan(rows.length);
    expect(lifed.some((r) => r["_lifecycle"] === "END_OF_LIFE")).toBe(true);
  });

  it("a second call is idempotent — persistSync replays per (scan_id, scope), seeded stays 554", async () => {
    const { devSeed, ledgerStore } = await mockSeamsAndImportDevSeed();

    const first = devSeed.seedSampleLedger();
    const before = Object.values(ledgerStore.loadState().ledger).length;
    const second = devSeed.seedSampleLedger();
    const after = Object.values(ledgerStore.loadState().ledger).length;

    expect(first).toEqual({ seeded: 554, syncs: 3, rows: 1430 });
    expect(second).toEqual(first);
    expect(after).toBe(before);
  });
});
