// Which assets a prune keeps, and why each of the others goes.
//
// The decision is worth its own file because it is the whole feature: every other tab
// follows the asset id, so a wrong answer here deletes rows nothing will ever tell you about.
// Two rules carry it — ancestry match, and the one-hop reprieve for unattributed assets — and
// each has a failure mode that looks like success from the outside.

import { describe, expect, it } from "vitest";
import { inProject, planPrune } from "../src/domain/prunePlan";
import type { PrunableAsset, PrunableEdge } from "../src/domain/prunePlan";

const UNIT = { id: "proj-unit", name: "VALUE-CHAIN", isFolder: true };
const LEAF = { id: "proj-leaf", name: "PROVISIONING", isFolder: false };
const OTHER = { id: "proj-other", name: "CS-LOG-ZEN-ECOM", isFolder: true };

/** An asset carrying its whole ancestor chain, which is the shape the ledger holds. */
const asset = (id: string, ...projects: Array<{ id: string; name: string }>): PrunableAsset =>
  ({ id, projects });

const edge = (src: string, dst: string): PrunableEdge => ({ src, dst });

describe("inProject", () => {
  it("matches an ancestor, so a folder id reaches its whole subtree", () => {
    // The property the whole feature rests on: an asset lists its chain, so selecting the
    // business unit is one id comparison per row rather than a tree walk.
    expect(inProject([UNIT, LEAF], UNIT.id)).toBe(true);
    expect(inProject([UNIT, LEAF], LEAF.id)).toBe(true);
  });

  it("never matches on name, and never matches nothing", () => {
    // Names are not unique across a thousand-project tenant and carry no ancestry.
    expect(inProject([UNIT], "VALUE-CHAIN")).toBe(false);
    expect(inProject([UNIT], "")).toBe(false);
    expect(inProject(undefined, UNIT.id)).toBe(false);
  });
});

describe("planPrune", () => {
  it("refuses a blank project rather than keeping nothing", () => {
    // A prune with no scope keeps nothing, which is resetData under a label that does not
    // say so. The one shape of this call that must never quietly succeed.
    expect(() => planPrune([asset("a", UNIT)], [], "")).toThrow(/needs a project/);
    expect(() => planPrune([asset("a", UNIT)], [], "   ")).toThrow(/needs a project/);
  });

  it("keeps the subtree and drops what belongs to another project", () => {
    const assets = [asset("in-1", UNIT, LEAF), asset("in-2", UNIT), asset("out", OTHER)];
    const { keep, census } = planPrune(assets, [], UNIT.id);

    expect([...keep].sort()).toEqual(["in-1", "in-2"]);
    expect(census).toEqual({
      total: 3, direct: 2, attached: 0, droppedAttributed: 1, droppedOrphan: 0, keep: 2,
    });
  });

  it("keeps an unattributed asset one edge from a kept one", () => {
    // Wiz attributes inventory, not people: the identity traversal writes USER_ACCOUNT rows
    // belonging to no project. Dropping them for that severs the identity to AI-asset paths
    // this app exists to draw.
    const assets = [asset("agent", UNIT), asset("service-account")];
    const { keep, census } = planPrune(assets, [edge("agent", "service-account")], UNIT.id);

    expect(keep.has("service-account")).toBe(true);
    expect(census.attached).toBe(1);
    expect(census.droppedOrphan).toBe(0);
  });

  it("drops an unattributed asset nothing kept reaches", () => {
    const assets = [asset("agent", UNIT), asset("stranger")];
    const { keep, census } = planPrune(assets, [], UNIT.id);

    expect(keep.has("stranger")).toBe(false);
    expect(census.droppedOrphan).toBe(1);
    expect(census.attached).toBe(0);
  });

  it("gives the reprieve to the UNATTRIBUTED only, never to another project's asset", () => {
    // An asset Wiz placed in some other project is exactly the out-of-scope data being shed.
    // An edge reaching it does not make it in-scope; it makes it a neighbour.
    const assets = [asset("agent", UNIT), asset("neighbour", OTHER)];
    const { keep, census } = planPrune(assets, [edge("agent", "neighbour")], UNIT.id);

    expect(keep.has("neighbour")).toBe(false);
    expect(census.droppedAttributed).toBe(1);
  });

  it("reaches one hop and stops", () => {
    // Transitively, a connected graph keeps very nearly everything: the panel would run,
    // report a large number and change nothing an operator could feel. `far` is unattributed
    // and adjacent to `near`, which is itself only kept BY the reprieve — so keeping it would
    // mean the rule had started walking.
    const assets = [asset("agent", UNIT), asset("near"), asset("far")];
    const edges = [edge("agent", "near"), edge("near", "far")];
    const { keep, census } = planPrune(assets, edges, UNIT.id);

    expect(keep.has("near")).toBe(true);
    expect(keep.has("far")).toBe(false);
    expect(census.attached).toBe(1);
  });

  it("reaches in both directions, because an edge has no opinion about the prune", () => {
    const assets = [asset("agent", UNIT), asset("caller")];
    const { keep } = planPrune(assets, [edge("caller", "agent")], UNIT.id);
    expect(keep.has("caller")).toBe(true);
  });

  it("will not conjure an id off a dangling edge", () => {
    // A zero-edge sync erases the last one's edges wholesale, so half-written edge rows are a
    // real state. An id the asset tab has never held must not enter the keep-set, where it
    // would then keep finding rows alive around an asset that does not exist.
    const assets = [asset("agent", UNIT)];
    const { keep } = planPrune(assets, [edge("agent", "ghost")], UNIT.id);
    expect(keep.has("ghost")).toBe(false);
    expect(keep.size).toBe(1);
  });

  it("treats an empty project list as unattributed, not as a project of its own", () => {
    const assets = [asset("agent", UNIT), { id: "bare" }, { id: "empty", projects: [] }];
    const { census } = planPrune(assets, [], UNIT.id);
    expect(census.droppedOrphan).toBe(2);
    expect(census.droppedAttributed).toBe(0);
  });

  it("keeps nothing for a project the register does not hold, and says so in the census", () => {
    // Not thrown here: the caller refuses, because the refusal names a control (Reset synced
    // data) that this module has no business knowing about.
    const { keep, census } = planPrune([asset("a", OTHER)], [], UNIT.id);
    expect(keep.size).toBe(0);
    expect(census.keep).toBe(0);
    expect(census.total).toBe(1);
  });
});
