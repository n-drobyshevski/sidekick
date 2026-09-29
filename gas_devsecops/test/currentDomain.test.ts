// Which domain a finding counts under in the code register (src/domain/currentDomain.ts) —
// the shared vote (gas_shared/domain/groupDomainVote.ts) read in repository words. The server
// end (every read path agreeing) is currentDomainsServer.test.ts.
import { describe, expect, it } from "vitest";

import { assignedDomainOf, buildRepoDomainAssignment, repoKeyOf } from "../src/domain/currentDomain";
import type { Rec } from "../src/domain/util";

// The tag join, read off a fixture-only `tag` field ("" for an untagged repository).
const resolve = (r: Rec) => String(r["tag"] ?? "");

let n = 0;
function row(repo: string, over: Rec = {}): Rec {
  n += 1;
  return { finding_key: "f" + n, repo_id: repo, repo_name: repo, status: "OPEN",
    last_seen: "2026-09-01T00:00:00Z", ...over };
}
const closed = { status: "RESOLVED" };

describe("repoKeyOf", () => {
  it("prefers the id, falls back to the name, and knows no sealed repository", () => {
    expect(repoKeyOf({ repo_id: "r1", repo_name: "one" })).toBe("id:r1");
    expect(repoKeyOf({ repo_id: "", repo_name: " one " })).toBe("name:one");
    expect(repoKeyOf({ repo_name: "(compacted)" })).toBe("");
    expect(repoKeyOf({})).toBe("");
  });
});

describe("every support group counts under one domain", () => {
  it("pins a group to the domain most of its current repositories are tagged in", () => {
    const rows = [
      row("a", { _supportGroup: "CS-A", tag: "CROSS" }),
      row("b", { _supportGroup: "CS-A", tag: "CROSS" }),
      row("c", { _supportGroup: "CS-A", tag: "SAP" }),
    ];
    const a = buildRepoDomainAssignment(rows, resolve);
    expect(a.groupDomain.get("CS-A")).toBe("CROSS");
    expect(rows.map((r) => assignedDomainOf(r, a))).toEqual(["CROSS", "CROSS", "CROSS"]);
  });

  it("never pins to 'no domain' while a named domain is in the vote", () => {
    const rows = [
      row("a", { _supportGroup: "CS-A", tag: "SAP" }),
      row("b", { _supportGroup: "CS-A" }), row("c", { _supportGroup: "CS-A" }),
    ];
    expect(buildRepoDomainAssignment(rows, resolve).groupDomain.get("CS-A")).toBe("SAP");
  });

  it("widens to all its repositories when none of the current ones is tagged", () => {
    const rows = [
      row("live", { _supportGroup: "CS-A" }),
      row("old", { _supportGroup: "CS-A", tag: "RETAIL", ...closed }),
    ];
    expect(buildRepoDomainAssignment(rows, resolve).groupDomain.get("CS-A")).toBe("RETAIL");
  });

  it("leaves a group with no tagged repository unpinned — each row keeps its (empty) domain", () => {
    const rows = [row("a", { _supportGroup: "CS-A" }), row("b", { _supportGroup: "CS-A" })];
    const a = buildRepoDomainAssignment(rows, resolve);
    expect(a.groupDomain.has("CS-A")).toBe(false);
    expect(assignedDomainOf(rows[0]!, a)).toBe("");
  });

  it("breaks an equal repository vote by findings, then by name", () => {
    const byFindings = [
      row("a", { _supportGroup: "G", tag: "SAP" }),
      row("b", { _supportGroup: "G", tag: "CROSS" }), row("b", { _supportGroup: "G", tag: "CROSS" }),
    ];
    expect(buildRepoDomainAssignment(byFindings, resolve).groupDomain.get("G")).toBe("CROSS");
    const byName = [row("x", { _supportGroup: "H", tag: "SAP" }), row("y", { _supportGroup: "H", tag: "CROSS" })];
    expect(buildRepoDomainAssignment(byName, resolve).groupDomain.get("H")).toBe("CROSS");
  });

  it("reads each repository's domain off its NEWEST row", () => {
    const rows = [
      row("a", { tag: "OLD", last_seen: "2026-01-01T00:00:00Z", ...closed }),
      row("a", { tag: "NEW" }),
    ];
    const a = buildRepoDomainAssignment(rows, resolve);
    expect(rows.map((r) => assignedDomainOf(r, a))).toEqual(["NEW", "NEW"]);
  });

  it("does not pin a row with no support group — it keeps its repository's domain", () => {
    const rows = [row("a", { tag: "SAP" })];
    const a = buildRepoDomainAssignment(rows, resolve);
    expect(a.groupDomain.size).toBe(0);
    expect(assignedDomainOf(rows[0]!, a)).toBe("SAP");
  });
});

describe("an admin override", () => {
  const rows = () => [
    row("a", { _supportGroup: "CS-A", tag: "CROSS" }),
    row("b", { _supportGroup: "CS-B", tag: "SAP" }),
  ];

  it("replaces the vote, and is marked as an override even when it names the same domain", () => {
    const a = buildRepoDomainAssignment(rows(), resolve, new Map([["CS-A", "RETAIL"], ["CS-B", "SAP"]]));
    expect(a.groupDomain.get("CS-A")).toBe("RETAIL");
    expect(a.groupSource.get("CS-A")).toBe("override");
    expect(a.groupSource.get("CS-B")).toBe("override");
  });

  it("pins a group nothing else could — an untagged team, or one with no rows yet", () => {
    const untagged = [row("a", { _supportGroup: "CS-U" })];
    const a = buildRepoDomainAssignment(untagged, resolve, new Map([["CS-U", "CROSS"], ["CS-NEW", "SAP"]]));
    expect(assignedDomainOf(untagged[0]!, a)).toBe("CROSS");
    expect(a.groupDomain.get("CS-NEW")).toBe("SAP");
  });
});
