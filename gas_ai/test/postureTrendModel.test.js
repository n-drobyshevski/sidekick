// "Posture over time", as pure logic — the half of the section that decides what may be
// drawn and what has to be said in words instead.
//
// Every case here is one of two rules, because those are the two the section can get wrong in
// a way nobody would notice: a series with no number is not a series with a zero, and a
// verdict nothing measured is not a verdict of "keeping up".

import { describe, expect, it } from "vitest";
import {
  ADJACENCY_SERIES,
  CAPACITY_WORDS,
  CATEGORY_COLORS,
  EXPLOITATION_SERIES,
  adjacencyPointNotes,
  capacityReadout,
  categorySeries,
  exploitationPointNotes,
  gappySeries,
  labelList,
  presentSeries,
  seriesData,
  valueAt,
} from "../src/client/js/postureTrendModel.js";

const pt = (counts, annotations) => ({ at: "2026-06-20T05:00:00Z", counts, annotations });

describe("what a window can draw", () => {
  it("drops a series no point in the window has a number for", () => {
    // An empty legend entry invites "why is that line zero" about a line that was never
    // drawn — the same rule the counts trend beside it follows.
    const points = [pt({ DIRECT: 1, ADJACENT: null, UNLINKED: 3 })];
    expect(presentSeries(points, ADJACENCY_SERIES).map((s) => s.key))
      .toEqual(["DIRECT", "UNLINKED"]);
  });

  it("names the series that BREAK, so a line beginning in mid-air is explained", () => {
    const points = [pt({ DIRECT: 1, UNLINKED: 3 }), pt({ DIRECT: 2, ADJACENT: 1, UNLINKED: 2 })];
    const present = presentSeries(points, ADJACENCY_SERIES);
    expect(gappySeries(points, present).map((s) => s.key)).toEqual(["ADJACENT"]);
  });

  it("passes nulls through to the chart rather than coercing them to zero", () => {
    // Chart.js breaks a line at a null, which is exactly the reading wanted. A `?? 0` here
    // would undo the whole nullable design one line before it reached the screen.
    const points = [pt({ kev: 2 }), pt({ kev: null }), pt({ kev: 0 })];
    const [series] = seriesData(points, [{ key: "kev", label: "KEV", color: "#000" }]);
    expect(series.data).toEqual([2, null, 0]);
    // A measured zero survives as a zero — it is a reading, not an absence.
    expect(valueAt(points[2], "kev")).toBe(0);
    expect(valueAt(points[1], "kev")).toBeNull();
    expect(valueAt(points[0], "nope")).toBeNull();
  });

  it("keeps the five exploitation tiers distinct and named", () => {
    expect(EXPLOITATION_SERIES.map((s) => s.key))
      .toEqual(["kev", "exploit", "epss", "none", "unknown"]);
    // Every series carries a LABEL: colour is never the only thing telling two lines apart.
    for (const s of [...EXPLOITATION_SERIES, ...ADJACENCY_SERIES]) expect(s.label).toBeTruthy();
  });
});

describe("the adjacency point label carries the denominator", () => {
  it("says how many edges the sync could traverse", () => {
    const notes = adjacencyPointNotes([pt({ DIRECT: 1 }, { edgesKnown: 68 })]);
    expect(notes[0]).toBe("68 adjacency edges known");
  });

  it("says the denominator was not recorded, rather than printing a zero", () => {
    // A sync predating `edgesKnown` has no denominator. "0 edges" would be a measurement.
    expect(adjacencyPointNotes([pt({ DIRECT: 1 }, { edgesKnown: null })])[0])
      .toBe("Edges traversed: not recorded");
    expect(adjacencyPointNotes([pt({ DIRECT: 1 })])[0]).toBe("Edges traversed: not recorded");
  });

  it("says what a MEASURED zero means, because it is the interesting case", () => {
    // The graph holds no adjacency edges at all: every row is unlinked by construction, and
    // reading that band as "unrelated to the AI estate" is the misreading the note exists for.
    expect(adjacencyPointNotes([pt({ DIRECT: 0 }, { edgesKnown: 0 })])[0])
      .toContain("nothing to traverse");
  });

  it("reports what the exploitation fold could not use, and only when there is some", () => {
    const [full] = exploitationPointNotes([
      pt({ kev: 1 }, { findings: 412, unjoined: 3, droppedNotInRegister: 11 }),
    ]);
    expect(full).toBe("412 findings read, 3 carried no issue, 11 outside the register");
    const [clean] = exploitationPointNotes([
      pt({ kev: 1 }, { findings: 5, unjoined: 0, droppedNotInRegister: 0 }),
    ]);
    expect(clean).toBe("5 findings read");
    expect(exploitationPointNotes([pt({ kev: 1 }, {})])[0]).toBe("Findings read: not recorded");
  });
});

describe("the category lines", () => {
  it("labels by name, falls back to the id, and cycles the palette", () => {
    // The scope is a tenant setting and can hold an id this build has never seen; that line
    // still has to be findable, so the id itself is the label.
    const series = categorySeries([
      { id: "wct-id-1998", name: "AI Security" },
      { id: "8ee0e63e", name: "" },
      "bare-id",
    ]);
    expect(series.map((s) => s.label)).toEqual(["AI Security", "8ee0e63e", "bare-id"]);
    expect(series.map((s) => s.color))
      .toEqual([CATEGORY_COLORS[0], CATEGORY_COLORS[1], CATEGORY_COLORS[2]]);
    expect(categorySeries(null)).toEqual([]);
  });

  it("wraps the palette rather than running out of colours", () => {
    const many = categorySeries(Array.from({ length: CATEGORY_COLORS.length + 1 },
      (_, i) => ({ id: `c${i}`, name: `C${i}` })));
    expect(many[CATEGORY_COLORS.length].color).toBe(CATEGORY_COLORS[0]);
  });
});

describe("the capacity readout", () => {
  const point = (over) => ({
    syncId: "s1", at: "2026-06-20T05:00:00Z", opened: 2, closed: 3, net: 1,
    comparable: true, verdict: "gaining", ...over,
  });

  it("says NOT YET COMPARABLE rather than showing a verdict nothing measured", () => {
    // The whole reason the server publishes a null: one comparable sync is one observation of
    // a rate that varies with cadence, and "Keeping up" over nothing is a claim.
    const r = capacityReadout({
      points: [point({ comparable: false, verdict: null })],
      overall: { mmcr: null, verdict: null, syncs: 1, comparable: 0 },
    });
    expect(r.verdict).toBeNull();
    expect(r.word).toBe("Not yet comparable");
    expect(r.detail).toContain("can be compared with the one before it");
    expect(r.detail).toContain("the first has nothing behind it");
    expect(r.rows[0].verdict).toBe("Not comparable");
  });

  it("says nothing at all about a register that has never recorded a ledger", () => {
    const r = capacityReadout({ points: [], overall: { mmcr: null, verdict: null, syncs: 0, comparable: 0 } });
    expect(r.word).toBe("Not yet comparable");
    expect(r.detail).toContain("starts at the next one");
    expect(capacityReadout(null).rows).toEqual([]);
  });

  it("speaks the verdict as a WORD and reports how many syncs it could not use", () => {
    const r = capacityReadout({
      points: [point(), point({ syncId: "s2", comparable: false, verdict: null })],
      overall: { mmcr: 31.5, verdict: "gaining", syncs: 4, comparable: 2 },
    });
    expect(r.word).toBe(CAPACITY_WORDS.gaining);
    expect(r.detail).toContain("31.5%");
    expect(r.detail).toContain("2 comparable syncs of 4");
    // The exclusions are named, not silently dropped from a denominator.
    expect(r.detail).toContain("2 syncs left out");
    expect(r.rows.map((x) => x.verdict)).toEqual(["Gaining ground", "Not comparable"]);
  });

  it("has a word for every verdict the server can send", () => {
    expect(Object.keys(CAPACITY_WORDS).sort())
      .toEqual(["falling-behind", "gaining", "keeping-up"]);
  });
});

describe("labelList", () => {
  it("reads as a sentence, which is what separates it from listJoin", () => {
    // `listJoin` (store.js) joins with a bare comma because it builds URL parameters, and
    // "Adjacent,Unlinked have no figure" is what happens when that reaches prose.
    expect(labelList([])).toBe("");
    expect(labelList([{ label: "One hop away" }])).toBe("One hop away");
    expect(labelList([{ label: "A" }, { label: "B" }])).toBe("A and B");
    expect(labelList([{ label: "A" }, { label: "B" }, { label: "C" }])).toBe("A, B and C");
  });
});
