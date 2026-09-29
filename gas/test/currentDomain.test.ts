// Which domain a finding counts under — today's repartition (src/domain/currentDomain.ts).
// The server end (every read path agreeing) is pinned by mttrGroupSheet.test.ts; this is the
// two rules themselves.
import { describe, expect, it } from "vitest";

import { assetKeyOf, assignedDomain, buildDomainAssignment } from "../src/domain/currentDomain";
import type { ResolvedDomain } from "../src/domain/resolveDomain";
import type { Rec } from "../src/domain/util";

// A resolver that reads a fixture-only `tag` field: tag → that domain, none → Unassigned.
const resolve = (r: Rec): ResolvedDomain =>
  r["tag"] ? { name: String(r["tag"]), source: "tag" } : { name: "Unassigned", source: "none" };
// Each row's own group, off a fixture-only `sg` field — the server's supportGroupResolver.
const groupOf = (r: Rec) => String(r["sg"] ?? "");
// The support-group join, reading a fixture-only `sg` field onto the heads.
const annotate = (heads: Rec[]) => { for (const h of heads) if (h["sg"]) h["_supportGroup"] = h["sg"]; };

let n = 0;
function f(asset: string, over: Rec = {}): Rec {
  n += 1;
  return { vuln_key: "k" + n, asset_id: asset, last_seen: "2026-09-01T00:00:00Z", resolved_at: null, ...over };
}
const closed = { resolved_at: "2026-06-01T00:00:00Z" };

describe("assetKeyOf", () => {
  it("prefers the id, falls back to the name, and knows no compacted asset", () => {
    expect(assetKeyOf({ asset_id: "a1", asset_name: "web" })).toBe("id:a1");
    expect(assetKeyOf({ "vulnerableAsset.id": "a2" })).toBe("id:a2");
    expect(assetKeyOf({ asset_name: " web " })).toBe("name:web");
    expect(assetKeyOf({ asset_name: "(compacted)" })).toBe("");
    expect(assetKeyOf({})).toBe("");
  });
});

describe("rule 1 — an asset has one current domain, from its newest sighting", () => {
  it("moves a retagged asset's resolved history to where it sits today", () => {
    const rows = [
      f("a1", { tag: "RETAIL", last_seen: "2026-05-01T00:00:00Z", ...closed }),
      f("a1", { tag: "CROSS" }),
    ];
    const a = buildDomainAssignment(rows, groupOf, annotate, resolve);
    expect(rows.map((r) => assignedDomain(r, a, resolve))).toEqual([
      { name: "CROSS", source: "asset" }, { name: "CROSS", source: "asset" },
    ]);
  });

  it("leaves a row with no asset identity to its own resolution", () => {
    const a = buildDomainAssignment([], groupOf, annotate, resolve);
    expect(assignedDomain({ asset_name: "(compacted)", tag: "OLD" }, a, resolve))
      .toEqual({ name: "OLD", source: "row" });
  });
});

describe("rule 2 — a support group is pinned to one domain", () => {
  it("takes the domain most of its current assets are in, for every finding it carries", () => {
    const rows = [
      f("a1", { sg: "SRE", tag: "CROSS", _supportGroup: "SRE" }),
      f("a2", { sg: "SRE", tag: "CROSS", _supportGroup: "SRE" }),
      f("a3", { sg: "SRE", tag: "RETAIL", _supportGroup: "SRE" }),
    ];
    const a = buildDomainAssignment(rows, groupOf, annotate, resolve);
    expect(a.groupDomain.get("SRE")).toBe("CROSS");
    expect(assignedDomain(rows[2]!, a, resolve)).toEqual({ name: "CROSS", source: "group" });
  });

  it("counts only assets still carrying something open, when any are", () => {
    const rows = [
      // Two retired RETAIL hosts, all closed; one live CROSS host.
      f("old1", { sg: "SRE", tag: "RETAIL", ...closed }),
      f("old2", { sg: "SRE", tag: "RETAIL", ...closed }),
      f("live", { sg: "SRE", tag: "CROSS" }),
    ];
    expect(buildDomainAssignment(rows, groupOf, annotate, resolve).groupDomain.get("SRE")).toBe("CROSS");
  });

  it("falls back to all its assets when nothing is open", () => {
    const rows = [
      f("a1", { sg: "SRE", tag: "RETAIL", ...closed }),
      f("a2", { sg: "SRE", tag: "RETAIL", ...closed }),
      f("a3", { sg: "SRE", tag: "CROSS", ...closed }),
    ];
    expect(buildDomainAssignment(rows, groupOf, annotate, resolve).groupDomain.get("SRE")).toBe("RETAIL");
  });

  it("prefers a named domain to Unassigned however few hosts carry it", () => {
    const rows = [
      f("a1", { sg: "SRE", tag: "CROSS" }),
      f("a2", { sg: "SRE" }), f("a3", { sg: "SRE" }), f("a4", { sg: "SRE" }),
    ];
    expect(buildDomainAssignment(rows, groupOf, annotate, resolve).groupDomain.get("SRE")).toBe("CROSS");
  });

  it("is Unassigned only when no host carries a domain", () => {
    const rows = [f("a1", { sg: "SRE" }), f("a2", { sg: "SRE" })];
    expect(buildDomainAssignment(rows, groupOf, annotate, resolve).groupDomain.get("SRE")).toBe("Unassigned");
  });

  it("breaks an equal host vote by findings, then by name", () => {
    const byFindings = [
      f("a1", { sg: "SRE", tag: "RETAIL" }),
      f("a2", { sg: "SRE", tag: "CROSS" }), f("a2", { sg: "SRE", tag: "CROSS" }),
    ];
    expect(buildDomainAssignment(byFindings, groupOf, annotate, resolve).groupDomain.get("SRE")).toBe("CROSS");
    const byName = [f("b1", { sg: "SRE", tag: "RETAIL" }), f("b2", { sg: "SRE", tag: "CROSS" })];
    expect(buildDomainAssignment(byName, groupOf, annotate, resolve).groupDomain.get("SRE")).toBe("CROSS");
  });

  it("does not pin a finding with no support group", () => {
    const rows = [f("a1", { tag: "CROSS" })];
    const a = buildDomainAssignment(rows, groupOf, annotate, resolve);
    expect(a.groupDomain.size).toBe(0);
    expect(assignedDomain(rows[0]!, a, resolve)).toEqual({ name: "CROSS", source: "asset" });
  });

  it("runs the joins on one row per asset, not on the ledger", () => {
    const rows = [f("a1", { sg: "SRE", tag: "X" }), f("a1", { sg: "SRE", tag: "X" }), f("a2", { tag: "Y" })];
    let seen = 0;
    buildDomainAssignment(rows, groupOf, (heads) => { seen += heads.length; annotate(heads); }, resolve);
    expect(seen).toBe(2);
  });
});

// THE REGRESSION: group membership used to be read off each asset's NEWEST row only, so a
// group that owned no asset's newest row was never pinned and its findings fell through to
// their assets' domains — listed under several domains.
describe("every group that owns a finding is pinned", () => {
  it("pins a group whose only findings sit on assets that have since moved subscription", () => {
    const old = { last_seen: "2026-05-01T00:00:00Z", ...closed };
    const rows = [
      // OLD's findings: on x (CROSS) and z (RETAIL), both since moved to NEW.
      f("x", { sg: "OLD", tag: "CROSS", ...old }),
      f("z", { sg: "OLD", tag: "RETAIL", ...old }),
      f("z", { sg: "OLD", tag: "RETAIL", ...old }),
      f("x", { sg: "NEW", tag: "CROSS" }),
      f("z", { sg: "NEW", tag: "RETAIL" }),
    ];
    const a = buildDomainAssignment(rows, groupOf, annotate, resolve);
    expect(a.groupDomain.has("OLD")).toBe(true);
    const oldDomains = new Set(rows.filter((r) => r["sg"] === "OLD")
      .map((r) => assignedDomain({ ...r, _supportGroup: "OLD" }, a, resolve).name));
    expect(oldDomains.size).toBe(1);
    // A tied host vote goes to the domain holding more of THIS group's findings.
    expect(a.groupDomain.get("OLD")).toBe("RETAIL");
  });

  it("pins a group per subscription when one asset id shows up under two", () => {
    const rows = [
      f("img", { sg: "A", tag: "CROSS" }),
      f("img", { sg: "B", tag: "CROSS" }),
      f("b2", { sg: "B", tag: "RETAIL" }),
    ];
    const a = buildDomainAssignment(rows, groupOf, annotate, resolve);
    expect(a.groupDomain.get("A")).toBe("CROSS");
    expect(a.groupDomain.has("B")).toBe(true);
  });

  it("pins a group with no identified asset by its rows' own resolution", () => {
    const rows = [{ asset_name: "(compacted)", sg: "G", tag: "SAP", resolved_at: "2026-01-01" }];
    expect(buildDomainAssignment(rows, groupOf, annotate, resolve).groupDomain.get("G")).toBe("SAP");
  });
});

// RULE 3 — an admin override (settings `supportGroupDomains`) wins over the host vote.
describe("an admin override of a group's domain", () => {
  const rows = () => [
    f("a1", { sg: "SRE", tag: "CROSS" }),
    f("a2", { sg: "SRE", tag: "CROSS" }),
    f("a3", { sg: "OPS", tag: "RETAIL" }),
  ];

  it("replaces the vote, for every finding of the group", () => {
    const a = buildDomainAssignment(rows(), groupOf, annotate, resolve, new Map([["SRE", "RETAIL"]]));
    expect(a.groupDomain.get("SRE")).toBe("RETAIL");
    expect(a.groupSource.get("SRE")).toBe("override");
    expect(assignedDomain({ asset_id: "a1", _supportGroup: "SRE" }, a, resolve))
      .toEqual({ name: "RETAIL", source: "group" });
  });

  it("marks a group confirmed in the domain the vote already chose as overridden too", () => {
    const a = buildDomainAssignment(rows(), groupOf, annotate, resolve, new Map([["SRE", "CROSS"]]));
    expect(a.groupDomain.get("SRE")).toBe("CROSS");
    expect(a.groupSource.get("SRE")).toBe("override");
  });

  it("holds for a group with no findings yet", () => {
    const a = buildDomainAssignment(rows(), groupOf, annotate, resolve, new Map([["NEW", "SAP"]]));
    expect(a.groupDomain.get("NEW")).toBe("SAP");
  });

  it("leaves every other group on its vote", () => {
    const a = buildDomainAssignment(rows(), groupOf, annotate, resolve, new Map([["SRE", "RETAIL"]]));
    expect(a.groupDomain.get("OPS")).toBe("RETAIL");
    expect(a.groupSource.get("OPS")).toBe("auto");
  });
});
