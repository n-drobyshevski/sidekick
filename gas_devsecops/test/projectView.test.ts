// The view-project scope (P4): a folder slug reaches its whole subtree, a leaf narrows to
// itself, the project catalogue stays register-wide no matter what is currently selected, and
// — the actual point of this file — the header COUNT and the PAGE'S OWN ROW LIST narrow
// together rather than one of them silently staying wide.
//
// THE TRAP THIS FILE IS BUILT AROUND: `registerRowsModel` and `secretsModel` each build their
// own `visibleRows(...)` params object by hand instead of spreading the normalized `n` the way
// every other model does. A literal missing `project` narrows the header's own counts (which
// go through `scopedRows`/`visibleRows` with the real `n`) while leaving the row list beside
// it unscoped — the sibling project's exact bug ("6 of 87 assets" over a 38-row table). The
// "counts and rows move together" block below is written to CATCH that: it is run once with
// both fixes in place (must pass) and, per this package's own instructions, once more by hand
// with one fix reverted (must fail) — see the PR notes for that manual run's result.
//
// Runs over a REAL booted server (test/gasEnv.ts), not a hand-mocked readModels harness —
// `norm()` reads the scope from `settingsStore.loadSettings()`, and the point of this suite is
// that the setting genuinely reaches every endpoint that is supposed to obey it, through the
// real `api.ts` surface a client actually calls.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootServer, resetServerMemos, teardownServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type ServerModule = Awaited<ReturnType<typeof bootServer>>;

let server: ServerModule;

afterEach(() => {
  teardownServer();
});

// --------------------------------------------------------------------------------------- //
//  A ledger: one folder, two leaves with NO ROW IN COMMON, one row with no project at all.
// --------------------------------------------------------------------------------------- //

const FOLDER = { slug: "value-chain", name: "Value Chain", isFolder: true };
const LEAF_A = { slug: "leaf-a", name: "Leaf A", isFolder: false };
const LEAF_B = { slug: "leaf-b", name: "Leaf B", isFolder: false };

/** Wiz flattens the whole ancestor chain onto a finding — see projectScope.ts's header. */
function inFolderAnd(leaf: typeof LEAF_A | typeof LEAF_B): string {
  return JSON.stringify([FOLDER, leaf]);
}

function ledgerRow(over: Partial<Rec> & { finding_key: string; scope: string }): Rec {
  return {
    identifier: null,
    component: null,
    severity: "HIGH",
    repo_id: "r1",
    repo_name: "repo-one",
    branch: "main",
    platform: "github",
    first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-08-01T00:00:00Z",
    status: "OPEN",
    resolved_at: null,
    resolution_src: null,
    reopened_count: 0,
    first_scan_id: "sync-1",
    last_scan_id: "sync-1",
    fix_date: null,
    fix_observed_at: null,
    fixed_version: null,
    has_kev: null,
    has_exploit: null,
    epss: null,
    cwe: null,
    ai_verdict: null,
    language: null,
    file_path: null,
    start_line: null,
    origin: null,
    secret_kind: null,
    rotated_at: null,
    removed_at: null,
    validation_state: null,
    validated_at: null,
    confidence: null,
    owner_project: null,
    owner_path: null,
    tags_json: null,
    projects_json: null,
    ...over,
  };
}

/** Two rows per scope (one per leaf) plus one project-less SCA row — 7 rows, 1 unattributed. */
const LEDGER_ROWS: Rec[] = [
  ledgerRow({ finding_key: "sca#a", scope: "sca", projects_json: inFolderAnd(LEAF_A) }),
  ledgerRow({ finding_key: "sca#b", scope: "sca", projects_json: inFolderAnd(LEAF_B) }),
  ledgerRow({ finding_key: "sast#a", scope: "sast", projects_json: inFolderAnd(LEAF_A) }),
  ledgerRow({ finding_key: "sast#b", scope: "sast", projects_json: inFolderAnd(LEAF_B) }),
  ledgerRow({ finding_key: "secrets#a", scope: "secrets", projects_json: inFolderAnd(LEAF_A) }),
  ledgerRow({ finding_key: "secrets#b", scope: "secrets", projects_json: inFolderAnd(LEAF_B) }),
  ledgerRow({ finding_key: "sca#none", scope: "sca", projects_json: null }),
];

async function seedLedger(): Promise<void> {
  const { overwrite, TABS } = await import("../src/server/sheetsDb");
  overwrite(TABS.ledger, LEDGER_ROWS);
}

beforeEach(async () => {
  server = await bootServer();
  server.setup(); // creates the ledger spreadsheet + tabs against the fake SpreadsheetApp
  await seedLedger();
});

function ok(result: unknown): Rec {
  const r = result as Rec;
  expect(r["ok"], `expected ok:true, got ${JSON.stringify(r)}`).toBe(true);
  return r["data"] as Rec;
}

function setProjectView(slug: string): void {
  ok(server.api.setProjectView({ projectView: slug }));
}

// --------------------------------------------------------------------------------------- //
//  1. bootstrap's scope block
// --------------------------------------------------------------------------------------- //

describe("bootstrap — the scope block", () => {
  it("unset scope reports the whole register", () => {
    const data = ok(server.api.bootstrap({}));
    expect(data["scope"]).toMatchObject({
      projectView: "",
      shown: 7,
      register: 7,
      unattributed: 1,
      syncProjectId: null,
    });
  });

  it("a folder slug selects its whole subtree — both leaves' rows", () => {
    setProjectView("value-chain");
    const data = ok(server.api.bootstrap({}));
    expect(data["scope"]).toMatchObject({ projectView: "value-chain", shown: 6, register: 7 });
  });

  it("picking a leaf narrows to just that leaf", () => {
    setProjectView("leaf-a");
    const data = ok(server.api.bootstrap({}));
    expect(data["scope"]).toMatchObject({ projectView: "leaf-a", shown: 3, register: 7 });
  });

  it("a slug the register does not hold yields 0 rows and is NOT an error", () => {
    setProjectView("no-such-project");
    const boot = server.api.bootstrap({}) as unknown as Rec;
    expect(boot["ok"]).toBe(true);
    const data = boot["data"] as Rec;
    expect(data["scope"]).toMatchObject({ projectView: "no-such-project", shown: 0, register: 7 });
  });

  it("projectList does NOT collapse after picking — register-wide counts, unchanged", () => {
    const before = (ok(server.api.bootstrap({}))["filterOptions"] as Rec)["projectList"] as Rec[];
    setProjectView("leaf-a");
    const after = (ok(server.api.bootstrap({}))["filterOptions"] as Rec)["projectList"] as Rec[];

    // Both listings offer all three projects — a leaf selection must not make its sibling
    // (leaf-b) or the folder unreachable.
    for (const list of [before, after]) {
      expect(new Set(list.map((p) => p["slug"])), JSON.stringify(list))
        .toEqual(new Set(["value-chain", "leaf-a", "leaf-b"]));
    }
    // And the counts themselves are register-wide, so they must be byte-identical before and
    // after — the vacuous-pass trap this test is written against (CLAUDE.md's own note):
    // a fixture where every project's rows overlap would pass even if `projectCatalogue` were
    // fed the SCOPED rows by mistake, because "the whole register" and "the current scope"
    // would happen to agree. leaf-a and leaf-b share no row, so they cannot agree by accident.
    expect(after).toEqual(before);
    const bySlug = Object.fromEntries(after.map((p) => [p["slug"], p["findings"]]));
    expect(bySlug).toEqual({ "value-chain": 6, "leaf-a": 3, "leaf-b": 3 });
  });

  it("unattributed is reported and stable regardless of the current scope", () => {
    setProjectView("value-chain");
    const data = ok(server.api.bootstrap({}));
    // The no-project row is not IN value-chain's subtree either — "no project" is a fourth,
    // separate population, not folded into whichever scope happens to be selected.
    expect(data["scope"]).toMatchObject({ unattributed: 1 });
  });
});

// --------------------------------------------------------------------------------------- //
//  2. Counts and rows move together — the two-literal trap
// --------------------------------------------------------------------------------------- //

describe("counts and rows move together", () => {
  it("getRegisterPage's rowCount and getRegisterRows' total agree once a project is selected", () => {
    setProjectView("leaf-a");
    const page = ok(server.api.getRegisterPage({ scope: "sca" }));
    expect(page["rowCount"]).toBe(1); // only sca#a is in leaf-a

    const rows = ok(server.api.getRegisterRows({ scope: "sca" }));
    expect(rows["total"]).toBe(1);
    expect((rows["rows"] as Rec[]).map((r) => r["finding_key"])).toEqual(["sca#a"]);
  });

  it("getSecretsPage's two models (register + secrets) narrow together", () => {
    setProjectView("leaf-b");
    const data = ok(server.api.getSecretsPage({}));
    const register = data["register"] as Rec;
    const secrets = data["secrets"] as Rec;
    expect(register["rowCount"]).toBe(1); // only secrets#b is in leaf-b
    expect(secrets["rowCount"]).toBe(1);

    const rows = ok(server.api.getRegisterRows({ scope: "secrets" }));
    expect(rows["total"]).toBe(1);
    expect((rows["rows"] as Rec[]).map((r) => r["finding_key"])).toEqual(["secrets#b"]);
  });

  it("getExportCsv narrows with the selected project, across every scope", () => {
    setProjectView("leaf-a");
    const csv = ok(server.api.getExportCsv({}));
    expect(csv["rowCount"]).toBe(3); // sca#a, sast#a, secrets#a
    expect(csv["projectView"]).toBe("leaf-a");
  });

  it("getExportCsv narrows with the selected project AND an explicit scope", () => {
    setProjectView("leaf-b");
    const csv = ok(server.api.getExportCsv({ scope: "sast" }));
    expect(csv["rowCount"]).toBe(1); // sast#b only
  });

  it("a project-less row never appears once any project is selected", () => {
    setProjectView("value-chain");
    const rows = ok(server.api.getRegisterRows({ scope: "sca" }));
    expect((rows["rows"] as Rec[]).map((r) => r["finding_key"]).sort())
      .toEqual(["sca#a", "sca#b"]); // sca#none excluded even from the folder's whole subtree
  });
});

// --------------------------------------------------------------------------------------- //
//  3. By-id lookups stay unscoped
// --------------------------------------------------------------------------------------- //

describe("by-id lookups are unscoped", () => {
  it("getJobStatus resolves a job by id regardless of the current project view", () => {
    setProjectView("leaf-a");
    // No sync ran in this test, so there is no job — the point here is only that the lookup
    // itself takes no project dimension: it is keyed by jobId, and jobs carry no
    // `projects_json` column for a scope to narrow by (unlike a ledger row). The call must not
    // refuse merely because a project view is set.
    const result = server.api.getJobStatus({ jobId: "no-such-job" }) as unknown as Rec;
    expect(result["ok"]).toBe(true);
    expect(result["data"]).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- //
//  4. The scope survives a tab reload
// --------------------------------------------------------------------------------------- //
//
// EVERY OTHER CASE IN THIS FILE SETS THE VIEW AND READS IT BACK INSIDE ONE EXECUTION, and
// that is precisely the arrangement in which a scope that is never persisted still passes:
// `settingsStore` holds a per-execution memo (`settingsMemo`), so `setProjectView` ->
// `bootstrap` in the same request is answered out of module state without the settings tab
// being consulted at all. A reload is the opposite arrangement — the memo dies with the
// request and the value has to come back off the tab — and nothing here covered it.
//
// `resetServerMemos()` IS a reload, for this purpose and exactly this one: it drops
// `settingsMemo` and every other per-execution memo while leaving the fake Spreadsheet — the
// durable store — standing. A full `bootServer()` would NOT be a reload; it resets the fake
// platform's Script Properties too, so the next call fails with "Missing Script Property
// LEDGER_SPREADSHEET_ID" (measured, 2026-09-07). That is a fresh install, which is a
// different question and would have made this suite look like it was testing persistence
// while testing provisioning.
//
// THE GAP THESE THREE CLOSE, MEASURED (2026-09-07). `saveSettings` was perturbed to drop
// `projectView` from the rows it writes to the settings tab while still assigning
// `settingsMemo` — a register that loses its scope on EVERY reload. Observed:
//
//   Tests  2 failed | 13 passed (15)
//     x bootstrap reports the same scope after every memo is dropped
//     x and the ROWS stay narrowed too, not just the header's own count
//
// Every one of this file's other thirteen cases stayed GREEN through it. So the coverage
// that existed before said nothing at all about whether the scope is stored; it said only
// that a memo answers within one request.
//
// The third case was perturbed separately: `setProjectView` was made to skip the write for
// an empty slug (the shape of "an empty view means no choice yet"). Observed, over this file
// and test/api.test.ts: `Tests 2 failed | 59 passed (61)` — this file's clearing case, plus
// api.test.ts's own "clears the scope back to \"\"" — and the two reload cases above stayed
// green, which is why clearing is a case of its own rather than a fourth expect above.
describe("failure of absence: the project view survives a new execution (a tab reload)", () => {
  it("bootstrap reports the same scope after every memo is dropped", async () => {
    setProjectView("leaf-a");
    const before = ok(server.api.bootstrap({}))["scope"];
    expect(before).toMatchObject({ projectView: "leaf-a", shown: 3, register: 7 });

    await resetServerMemos();

    const after = ok(server.api.bootstrap({}))["scope"];
    expect(after, "the scope did not survive a new execution").toEqual(before);
  });

  it("and the ROWS stay narrowed too, not just the header's own count", () => {
    // The two halves of this page can disagree — that is the trap section 2 of this file is
    // built around — so a reload has to be checked on both. A restored header count over an
    // unscoped row list would read as a working scope and serve the whole register.
    setProjectView("leaf-b");
    return resetServerMemos().then(() => {
      const data = ok(server.api.bootstrap({}));
      expect(data["scope"]).toMatchObject({ projectView: "leaf-b", shown: 3 });
      const rows = ok(server.api.getRegisterRows({ scope: "sast" }));
      expect((rows["rows"] as Rec[]).map((r) => r["finding_key"])).toEqual(["sast#b"]);
    });
  });

  it("clearing the scope survives a reload too — an empty view is a CHOICE, not a default", () => {
    // The direction that a naive "restore whatever is stored, falling back to the register"
    // fix gets wrong: if a cleared view were persisted as absent and absent meant "restore the
    // last one", unscoping would not stick. It has to come back as the empty string it was
    // saved as.
    setProjectView("leaf-a");
    setProjectView("");
    return resetServerMemos().then(() => {
      expect(ok(server.api.bootstrap({}))["scope"])
        .toMatchObject({ projectView: "", shown: 7, register: 7 });
    });
  });
});
