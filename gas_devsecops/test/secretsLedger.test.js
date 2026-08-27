// The secrets twin fold, and the key that two earlier revisions got wrong.
//
// Every case here carries the measurement that justifies it. PROBE_FINDINGS.md §10.6 and
// §10.7 are the source; the fixtures are built in the shape those sections printed, since
// the record elides the real strings.
//
// The fixtures are deliberately SMALL and hand-built rather than sampled from
// probe-report.json — that file is git-ignored and holds live-tenant rows, so a test that
// depended on it would pass on one machine and vanish on every other.

import { describe, expect, it } from "vitest";
import {
  collapseTwins, normalizeValidation, secretsFindingKey,
} from "../src/domain/secretsLedger";

const REPO = "dktunited/prodcom-jdbc-kafka-connect";
const PATH = "resources/connect/kconnect-updated.txt";

/** One `secretInstances` node, in the shape Q_SECRETS selects. */
function node(over = {}) {
  return {
    id: "11111111-2222-5333-8444-555555555555",
    externalId: `github.com##${REPO}##${PATH}##abc123##41`,
    secretDataId: "aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee",
    name: "kconnect password",
    type: "PASSWORD",
    confidence: "HIGH",
    severity: "MEDIUM",
    path: PATH,
    lineNumber: 41,
    status: "OPEN",
    resolvedAt: null,
    validationStatus: "UNKNOWN",
    lastValidatedAt: null,
    firstSeenAt: "2026-01-10T00:00:00Z",
    lastSeenAt: "2026-08-23T00:00:00Z",
    lastUpdatedAt: "2026-08-27T00:19:00Z",
    codeToCloudPipelineStage: "CODE",
    vcsDetails: { initialCommitHash: "deadbeef" },
    resource: {
      id: "res-repo", name: REPO, type: "REPOSITORY",
      externalId: REPO, nativeType: "repository", cloudPlatform: "GitHub",
    },
    projects: [{ id: "p1", name: "VALUE-CHAIN", isFolder: false, slug: "value-chain" }],
    ...over,
  };
}

/**
 * The branch-indexed half of a twin. Same credential, same file, same line — a DIFFERENT
 * externalId, because Wiz splices the branch segment in. §10.6: 187 twins, 0 with an
 * identical externalId.
 */
function branchTwin(over = {}) {
  return node({
    id: "99999999-2222-5333-8444-555555555555",
    externalId: `github.com##${REPO}##main##/${PATH}##abc123##41`,
    resource: {
      id: "res-branch", name: `${REPO}/main`, type: "REPOSITORY_BRANCH",
      externalId: `${REPO}/main`, nativeType: "branch", cloudPlatform: "GitHub",
    },
    ...over,
  });
}

describe("the ledger key", () => {
  it("folds the repo/branch twin into one finding", () => {
    // §10.6, over the whole 1,958-row CODE population: 187 (secretDataId, path, lineNumber)
    // keys span both REPOSITORY and REPOSITORY_BRANCH. They are one finding.
    const r = collapseTwins([node(), branchTwin()]);
    expect(r.nodes).toBe(2);
    expect(r.findings).toBe(1);
    expect(r.twinned).toBe(1);
    expect(r.observations[0].twin_count).toBe(2);
  });

  it("does NOT key on externalId, which is unique because it preserves the duplicate", () => {
    // This is the defect §9.5 shipped and §10.6 falsified, pinned so it cannot return
    // quietly. externalId is unique across all 1,958 rows — and for the wrong reason: all
    // 187 twins carry two different ones, so a ledger keyed on it doubles those findings.
    const rows = [node(), branchTwin()];
    const byExternalId = new Set(rows.map((n) => n.externalId));
    expect(byExternalId.size).toBe(2); // unique, and wrong

    const byLedgerKey = new Set(rows.map(secretsFindingKey));
    expect(byLedgerKey.size).toBe(1); // one secret, one file, one line, one finding
  });

  it("separates two findings that differ only by line", () => {
    // The line is load-bearing: without it the key is (secretDataId, path), which §9.5
    // measured colliding 2.27:1 with one pair covering 49 rows.
    const r = collapseTwins([node({ lineNumber: 41 }), node({ lineNumber: 42 })]);
    expect(r.findings).toBe(2);
  });

  it("keys an unlined row distinctly from line 0, and counts it", () => {
    // Degrading a missing line to the colliding pair would let one unlined row absorb every
    // other finding in its file.
    const r = collapseTwins([node({ lineNumber: null }), node({ lineNumber: 0 })]);
    expect(r.findings).toBe(2);
    expect(r.keyed_without_line).toBe(1);
  });
});

describe("the clock, when the twins disagree", () => {
  // §10.7: median gap 19.9 days, max 285.3, 83 of 187 over 30 days — and neither resource
  // type is reliably older (REPOSITORY earlier 52, REPOSITORY_BRANCH earlier 135).

  it("takes the earliest when the BRANCH twin is older", () => {
    const r = collapseTwins([
      node({ firstSeenAt: "2026-01-10T00:00:00Z" }),
      branchTwin({ firstSeenAt: "2025-11-14T00:00:00Z" }),
    ]);
    expect(r.observations[0].first_seen).toBe("2025-11-14T00:00:00Z");
  });

  it("takes the earliest when the REPOSITORY twin is older", () => {
    // Both directions, because §10.7 measured 135 / 52 and a one-direction test passes on a
    // "prefer REPOSITORY" bug — which was a live option before the split was measured.
    const r = collapseTwins([
      node({ firstSeenAt: "2025-11-14T00:00:00Z" }),
      branchTwin({ firstSeenAt: "2026-01-10T00:00:00Z" }),
    ]);
    expect(r.observations[0].first_seen).toBe("2025-11-14T00:00:00Z");
  });

  it("writes down the gap it discarded", () => {
    // The fold is right and it throws a measurement away. 285.3 days was the maximum
    // observed; a disagreement that size must be visible in the row.
    const r = collapseTwins([
      node({ firstSeenAt: "2025-11-14T00:00:00Z" }),
      branchTwin({ firstSeenAt: "2026-08-26T07:00:00Z" }),
    ]);
    expect(r.observations[0].twin_first_seen_spread_days).toBeCloseTo(285.29, 1);
  });

  it("keeps both externalIds so the fold is auditable", () => {
    const r = collapseTwins([node(), branchTwin()]);
    expect(JSON.parse(r.observations[0].source_external_ids)).toHaveLength(2);
  });

  it("reports no spread for a finding with no twin", () => {
    const r = collapseTwins([node()]);
    expect(r.observations[0].twin_count).toBe(1);
    expect(r.observations[0].twin_first_seen_spread_days).toBe(0);
    expect(r.twinned).toBe(0);
  });

  it("does not carry the API's own lastSeenAt at all", () => {
    // This test pinned "the fold takes the LATEST last_seen", and the claim was true. It is
    // now unreachable, for a reason rather than for convenience: the ledger's `last_seen`
    // column means "the last SCAN that observed this row", which only reconcile can know.
    // A Wiz sighting date is a different measurement with no column to live in, and an
    // observation carrying one under that name would make every freshness caption a claim
    // about the wrong clock. The fold rule survives where it is testable — on first_seen.
    const o = collapseTwins([
      node({ lastSeenAt: "2026-08-01T00:00:00Z" }),
      branchTwin({ lastSeenAt: "2026-08-23T00:00:00Z" }),
    ]).observations[0];
    expect(o).not.toHaveProperty("last_seen");
  });
});

describe("status, when the twins disagree", () => {
  it("stays OPEN if either twin is open", () => {
    // brick/devsecops/ledger.py::observed, on the same problem: a duplicate must not be able
    // to assert a resolution its twin disagrees with. A secret still present on one indexed
    // entity is still in the repository.
    const r = collapseTwins([
      node({ status: "RESOLVED", resolvedAt: "2026-06-01T00:00:00Z" }),
      branchTwin({ status: "OPEN" }),
    ]);
    expect(r.observations[0].is_open).toBe(true);
    expect(r.observations[0].resolved_at).toBeNull();
  });

  it("resolves only when every twin agrees, at the latest date", () => {
    const r = collapseTwins([
      node({ status: "RESOLVED", resolvedAt: "2026-06-01T00:00:00Z" }),
      branchTwin({ status: "RESOLVED", resolvedAt: "2026-07-15T00:00:00Z" }),
    ]);
    expect(r.observations[0].is_open).toBe(false);
    expect(r.observations[0].resolved_at).toBe("2026-07-15T00:00:00Z");
  });

  it("takes the worse severity", () => {
    const r = collapseTwins([node({ severity: "LOW" }), branchTwin({ severity: "HIGH" })]);
    expect(r.observations[0].severity).toBe("HIGH");
  });
});

describe("the rotation axis, which is not the removal axis", () => {
  // §3: removal is `status`/`resolvedAt`; rotation is `validationStatus`/`lastValidatedAt`.
  // 393,443 of 394,927 instances are UNKNOWN — 99.6% never checked.

  it("normalizes anything unrecognised to UNKNOWN", () => {
    expect(normalizeValidation("valid")).toBe("VALID");
    expect(normalizeValidation(null)).toBe("UNKNOWN");
    expect(normalizeValidation("SOMETHING_NEW")).toBe("UNKNOWN");
  });

  it("lets a live reading beat a dead one", () => {
    // VALID means the credential still works. A live secret losing to a dead reading is the
    // one direction of this rule that gets someone hurt.
    const r = collapseTwins([
      node({ validationStatus: "INVALID", lastValidatedAt: "2026-05-01T00:00:00Z" }),
      branchTwin({ validationStatus: "VALID", lastValidatedAt: "2026-08-01T00:00:00Z" }),
    ]);
    expect(r.observations[0].validation_state).toBe("VALID");
    expect(r.observations[0].validated_at).toBe("2026-08-01T00:00:00Z");
    expect(r.observations[0].rotated_at).toBeNull();
  });

  it("never lets UNKNOWN override a measured state", () => {
    // On a register that is 99.6% UNKNOWN, "unmeasured wins" would erase the 0.38% that is
    // measured. Absent is never zero.
    const r = collapseTwins([
      node({ validationStatus: "UNKNOWN", lastValidatedAt: "2026-08-20T00:00:00Z" }),
      branchTwin({ validationStatus: "INVALID", lastValidatedAt: "2026-05-01T00:00:00Z" }),
    ]);
    expect(r.observations[0].validation_state).toBe("INVALID");
    expect(r.observations[0].validated_at).toBe("2026-05-01T00:00:00Z");
  });

  it("sets rotated_at only on INVALID", () => {
    const dated = { lastValidatedAt: "2026-05-01T00:00:00Z" };
    const of = (s) => collapseTwins([node({ validationStatus: s, ...dated })]).observations[0];
    expect(of("INVALID").rotated_at).toBe("2026-05-01T00:00:00Z");
    expect(of("VALID").rotated_at).toBeNull();
    expect(of("UNKNOWN").rotated_at).toBeNull();
    expect(of("ERROR").rotated_at).toBeNull();
  });

  it("never sets removed_at — a disappearance needs two scans", () => {
    // The normalizer sees one scan. Removal from HEAD is visible only by comparison, so
    // this column is reconcile's to write and must stay null here.
    expect(collapseTwins([node()]).observations[0].removed_at).toBeNull();
  });
});

describe("the asset columns", () => {
  it("takes the repository entity and strips the branch name off the branch twin", () => {
    // §10.6: 173 of 187 branch names are `X/branch` on the repository's `X`.
    const r = collapseTwins([node(), branchTwin()]);
    const o = r.observations[0];
    expect(o.repo_name).toBe(REPO);
    expect(o.repo_id).toBe("res-repo");
    expect(o.branch).toBe("main");
  });

  it("leaves branch null when only the repository twin exists", () => {
    const o = collapseTwins([node()]).observations[0];
    expect(o.branch).toBeNull();
    expect(o.repo_name).toBe(REPO);
  });

  it("carries the location, the commit and the credential id", () => {
    const o = collapseTwins([node()]).observations[0];
    expect(o.component).toBe(`${PATH}:41`);
    expect(o.file_path).toBe(PATH);
    expect(o.start_line).toBe(41);
    expect(o.origin).toBe("deadbeef");
    // secretDataId names the CREDENTIAL — what rotation groups by, not the row key.
    expect(o.identifier).toBe("aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee");
    expect(o.scope).toBe("secrets");
  });

  it("never carries the credential itself", () => {
    // Q_SECRETS selects neither `snippet` nor `validationDetails`, and the observation must
    // not grow a field for them: the durable store is a Sheet plus Drive archives readable
    // by everyone on the allowlist. test/wizQueries.test.js holds the query side.
    const o = collapseTwins([node()]).observations[0];
    for (const k of ["snippet", "validationDetails", "secret", "value"]) {
      expect(o).not.toHaveProperty(k);
    }
  });
});

describe("every observation column has a home in the ledger tab", () => {
  it("names only headers the schema declares, plus the one lifecycle input", async () => {
    // A column the normalizer emits and the tab does not declare is dropped silently by the
    // header-mapped writer — the value would just never appear.
    //
    // `is_open` is the documented exception and the only one: it is what the API SAID, which
    // reconcile turns into the `status` column after comparing scans. An observation that
    // wrote `status` directly would be claiming a lifecycle from a single sighting.
    const { LEDGER_COLUMNS } = await import("../src/domain/observation");
    const allowed = new Set([...LEDGER_COLUMNS, "is_open"]);
    const o = collapseTwins([node(), branchTwin()]).observations[0];
    expect(Object.keys(o).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("keeps LEDGER_COLUMNS byte-identical to the tab it describes", async () => {
    // observation.ts cannot import sheetsDb — it must stay free of Apps Script, the same
    // rule wizQueries.ts follows — so the column list is written twice. This is what stops
    // the copies drifting.
    const { LEDGER_COLUMNS } = await import("../src/domain/observation");
    const { TABS, TAB_HEADERS } = await import("../src/server/sheetsDb");
    expect([...LEDGER_COLUMNS]).toEqual(TAB_HEADERS[TABS.ledger]);
  });
});
