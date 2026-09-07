// The time spiral: where a scan lands, and — the half that can actually be wrong — which
// scans never land at all.
//
// TWO FAILURE KINDS, NAMED (CLAUDE.md's rule). A failure of PRESENCE here is a scan that
// should be on the chart and is missing. A failure of ABSENCE is an undated scan that gets
// PLACED anyway: `Number(null)` is `0`, `0` is finite, and epoch 0 is a real position on this
// chart — 1970-Q1, at the top of the innermost turn, with every later ring pushed outwards to
// reach it. That row does not read as missing, it reads as the oldest measurement this
// register ever took, which is the more expensive of the two.
//
// THE PERTURBATION IS IN THIS FILE, not in a comment: the two tempting cast-first rewrites are
// reproduced inline and each is shown failing on the values it actually bites — and they bite
// on DIFFERENT values, which is the whole reason the refusal is an allowlist rather than one
// cast plus a `Number.isFinite`.
//
// MEASURED, by editing `spiralLayout.js` itself and running this file, both ways:
//   `const t = Number(ts)` first      -> 6 of 14 fail. Every ISO string is refused
//                                        (`Number("2026-07-01T…")` is NaN) AND null / "" /
//                                        "   " / [] / false are all placed at epoch 0.
//   `const t = Date.parse(ts)` first  -> 1 of 14 fails, and NOT the undated one: `Date.parse`
//                                        answers NaN for all seven undated values, so a file
//                                        that only checked those would call this rewrite a
//                                        pass. What it breaks is the epoch-milliseconds row —
//                                        a real timestamp refused. A guard that fires on
//                                        nothing is a finding, so that row is here on purpose.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { spiralLayout } from "../src/client/js/pages/spiralLayout.js";

const R0 = 24;
const DR = 14;
const TAU = Math.PI * 2;

/** A scan row, only the fields this layout reads. */
function scan(ts, over = {}) {
  return { scan_id: "s1", ts, scope: "sca", total: 10, ...over };
}

describe("spiralLayout — where a scan lands", () => {
  it("puts the first instant of a quarter at the top of the turn", () => {
    const { points } = spiralLayout([scan("2026-07-01T00:00:00.000Z")], { r0: R0, dr: DR });
    expect(points).toHaveLength(1);
    const p = points[0];
    expect(p.theta).toBe(0);
    expect(p.r).toBeCloseTo(R0, 10);
    // 12 o'clock in SVG's y-down frame: straight up, nothing sideways.
    expect(p.y).toBeCloseTo(-R0, 10);
    expect(Math.abs(p.x)).toBeLessThan(1e-9);
    expect(p.quarter).toBe("2026-Q3");
  });

  it("advances a full turn across one quarter", () => {
    // The last millisecond of 2026-Q3, and the first of 2026-Q4.
    const lastOfQ3 = new Date(Date.UTC(2026, 9, 1) - 1).toISOString();
    const { points, turns, quarters } = spiralLayout(
      [scan(lastOfQ3), scan("2026-10-01T00:00:00.000Z")], { r0: R0, dr: DR },
    );
    const [end, next] = points;
    expect(end.theta).toBeCloseTo(TAU, 4);
    expect(end.r).toBeCloseTo(R0 + DR, 4);

    // One dr further out, and back at the top: the radius is continuous across the boundary
    // and the two turns cannot overlap.
    expect(next.theta).toBe(0);
    expect(next.r).toBeCloseTo(R0 + DR, 10);
    expect(next.y).toBeCloseTo(-(R0 + DR), 10);
    expect(Math.abs(next.x)).toBeLessThan(1e-9);

    expect(turns).toBe(2);
    expect(quarters).toEqual([
      { key: "2026-Q3", r: R0 },
      { key: "2026-Q4", r: R0 + DR },
    ]);
  });

  it("keeps the radius monotone in time", () => {
    // Deliberately out of order on the way in, and with a quarter nobody scanned in the
    // middle: the radius is elapsed time, so the empty quarter still costs a turn.
    const rows = [
      scan("2027-02-14T06:00:00.000Z"),
      scan("2026-05-02T00:00:00.000Z"),
      scan("2026-08-20T12:00:00.000Z"),
      scan("2026-06-30T23:59:00.000Z"),
    ];
    const { points, turns } = spiralLayout(rows, { r0: R0, dr: DR });
    expect(points.map((p) => p.ts)).toEqual([
      "2026-05-02T00:00:00.000Z",
      "2026-06-30T23:59:00.000Z",
      "2026-08-20T12:00:00.000Z",
      "2027-02-14T06:00:00.000Z",
    ]);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i].r).toBeGreaterThan(points[i - 1].r);
    }
    // Q2 2026 through Q1 2027 — four turns, one of them (Q4 2026) with no scan on it.
    expect(turns).toBe(4);
  });

  it("returns no points for an empty scans list, and says so", () => {
    expect(spiralLayout([])).toEqual({ points: [], turns: 0, skipped: 0, quarters: [] });
    expect(spiralLayout(null)).toEqual({ points: [], turns: 0, skipped: 0, quarters: [] });
  });
});

describe("spiralLayout — failure of absence: a row that must not be placed", () => {
  // Every value here is one the tempting rewrites read as a real instant or a real count.
  const UNDATED = [null, "", undefined, "not a date", "   ", [], false];

  it("does not place an undated scan at the origin", () => {
    const rows = UNDATED.map((ts) => scan(ts));
    const { points, skipped, turns, quarters } = spiralLayout(rows, { r0: R0, dr: DR });
    expect(points).toEqual([]);
    expect(skipped).toBe(rows.length);
    expect(turns).toBe(0);
    expect(quarters).toEqual([]);
  });

  it("still places a scan whose timestamp is epoch milliseconds", () => {
    // The other half of the refusal, and the reason it is an allowlist rather than a
    // `Date.parse` on everything: `Date.parse(1751328000000)` is NaN, so a cast-first rewrite
    // in THAT direction refuses a perfectly good timestamp instead of an absent one.
    const ms = Date.UTC(2026, 6, 1);
    const { points, skipped } = spiralLayout([scan(ms)], { r0: R0, dr: DR });
    expect(skipped).toBe(0);
    expect(points).toHaveLength(1);
    expect(points[0].quarter).toBe("2026-Q3");
    expect(points[0].theta).toBe(0);
  });

  it("does not place a scan whose total is not a number", () => {
    const rows = [null, "", [], false, undefined, "twelve"]
      .map((total) => scan("2026-07-15T00:00:00.000Z", { total }));
    const { points, skipped } = spiralLayout(rows, { r0: R0, dr: DR });
    expect(points).toEqual([]);
    expect(skipped).toBe(rows.length);
  });

  it("keeps a measured zero, which is not the same thing", () => {
    const { points, skipped } = spiralLayout(
      [scan("2026-07-15T00:00:00.000Z", { total: 0 })], { r0: R0, dr: DR },
    );
    expect(skipped).toBe(0);
    expect(points).toHaveLength(1);
    expect(points[0].open).toBe(0);
  });

  it("PERTURBATION: casting before refusing places the epoch, and the two casts differ", () => {
    // The rewrite the module refuses, reproduced rather than described. `Number()` first:
    const numberFirst = (ts) => {
      const t = Number(ts);
      return Number.isFinite(t) ? t : null;
    };
    // `Number(null)`, `Number("")`, `Number("   ")`, `Number([])` and `Number(false)` are all
    // 0 — FIVE of the seven undated values become a real instant, and it is the epoch. (The
    // whitespace string is the one this list gained by measurement: `Number("   ")` is 0 too.)
    const bitByNumber = UNDATED.filter((v) => numberFirst(v) !== null);
    expect(bitByNumber).toEqual([null, "", "   ", [], false]);
    expect(numberFirst(null)).toBe(0);
    expect(new Date(0).toISOString()).toBe("1970-01-01T00:00:00.000Z");

    // `Date.parse()` first refuses all seven — so THAT perturbation does not bite here at
    // all, and a test that only checked the undated set would call it a pass. What it breaks
    // instead is the epoch-milliseconds row above.
    const parseFirst = (ts) => {
      const t = Date.parse(ts);
      return Number.isFinite(t) ? t : null;
    };
    expect(UNDATED.filter((v) => parseFirst(v) !== null)).toEqual([]);
    expect(parseFirst(Date.UTC(2026, 6, 1))).toBe(null);

    // And the same shape for the count: only the module's allowlist refuses all four.
    const castCount = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    expect([null, "", [], false].every((v) => castCount(v) === 0)).toBe(true);
  });
});

describe("spiralLayout — scopes", () => {
  const ROWS = [
    scan("2026-07-02T00:00:00.000Z", { scan_id: "a", scope: "sca" }),
    scan("2026-07-03T00:00:00.000Z", { scan_id: "b", scope: "sast" }),
    scan("2026-07-04T00:00:00.000Z", { scan_id: "c", scope: "secrets" }),
    scan("2026-08-02T00:00:00.000Z", { scan_id: "d", scope: "sast", ts: null }),
  ];

  it("filters to one scope when asked and keeps all scopes otherwise", () => {
    const all = spiralLayout(ROWS, { r0: R0, dr: DR });
    expect(all.points.map((p) => p.scope)).toEqual(["sca", "sast", "secrets"]);
    expect(all.skipped).toBe(1);

    const sast = spiralLayout(ROWS, { r0: R0, dr: DR, scope: "sast" });
    expect(sast.points.map((p) => p.scanId)).toEqual(["b"]);
    // The other registers' rows were never in this population — filtering is not skipping, and
    // only the undated sast row counts against this call.
    expect(sast.skipped).toBe(1);

    const secrets = spiralLayout(ROWS, { r0: R0, dr: DR, scope: "secrets" });
    expect(secrets.points.map((p) => p.scanId)).toEqual(["c"]);
    expect(secrets.skipped).toBe(0);
  });
});

// ------------------------------------------------------------- the section, as source text
//
// No jsdom in this project's vitest run (see pagesLit.test.js), so the page half is read as
// source, the way every other page-structure claim here is.

const HISTORY_SRC = readFileSync(
  new URL("../src/client/js/pages/history.js", import.meta.url), "utf8",
);
const APP_SRC = readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8");

/** The file with its `//` comments removed, string-aware — mirrors `pagesLit.test.js`. */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    out += c;
    i++;
  }
  return out;
}
const HISTORY = code(HISTORY_SRC);

describe("history.js — the spiral is behind the toggle, and hands the slot back", () => {
  it("draws the section only under showExperimental()", () => {
    expect(HISTORY).toContain('import { showExperimental, subscribeExperimental } from "../experimental.js";');
    const fn = HISTORY.indexOf("function renderSpiral(");
    expect(fn).toBeGreaterThan(-1);
    const gate = HISTORY.indexOf("if (!showExperimental()) return;", fn);
    expect(gate).toBeGreaterThan(fn);
    // The heading and the lede are BUILT INSIDE the gated function — an off experiment leaves
    // no heading behind. Both strings appear exactly once, after the gate.
    //
    // THE SECOND LITERAL MOVED IN WAVE C, AND THE CLAIM DID NOT. The 24-word lede was one
    // `.section-note` opening "Experimental. Each turn is a calendar quarter…"; it is now a
    // `statusPill("neutral", "Experimental")` on the heading (the word is a STATE of the
    // picture and stays on the surface) over two tip lines holding the geometry (how to read
    // an unfamiliar shape is a definition, and goes one level down). Both pieces are still
    // built inside the gated function, which is the whole of what this case checks — so the
    // strings are re-pointed and a third is added, because the pill is now the only thing on
    // screen saying the section is unfinished and it must not be able to escape the gate.
    for (const literal of [
      "Open count, one turn per quarter",
      "Each turn is a calendar quarter",
      '"Experimental"',
    ]) {
      expect(HISTORY.split(literal)).toHaveLength(2);
      expect(HISTORY.indexOf(literal)).toBeGreaterThan(gate);
    }
    // And the first-run gate every other section on this page applies.
    expect(HISTORY.slice(fn, HISTORY.indexOf("const layout = spiralLayout")))
      .toContain("if (first) return;");
  });

  it("subscribes through the fan-out and tears the subscription down", () => {
    expect(HISTORY).toContain("onPageTeardown(subscribeExperimental(");
    // THE SLOT IS THE SHELL'S. A page calling the shared registrar directly would take the
    // rail's rebuild for the rest of the session.
    expect(HISTORY).not.toContain("onExperimentalChange(");
    // app.js claims it once, with the shell's own rebuild as the base listener.
    expect(code(APP_SRC))
      .toContain("installExperimentalFanout(() => shell.renderSidebar(bootstrapCached()));");
  });

  it("draws the marks in the ink accent and never in the fill accent", () => {
    expect(HISTORY).toContain("fill: var(--accent-text)");
    expect(HISTORY).toContain("stroke: var(--accent-text)");
    // `--accent` is 1.52:1 on white here — a fill token, never ink (CLAUDE.md, tokens.test.js).
    expect(/var\(--accent\)/.test(HISTORY)).toBe(false);
    // Shape, not colour, carries the register.
    expect(HISTORY).toContain("SPIRAL_SHAPES");
    expect(HISTORY).toContain("SPIRAL_GLYPHS");
  });

  it("builds the SVG in the SVG namespace, not with el()", () => {
    // `el()` is document.createElement: an HTML <svg> parses, appends and renders nothing.
    expect(HISTORY).toContain('import { svgEl } from "../../../../../gas_shared/icons.js";');
    expect(HISTORY).not.toMatch(/el\("svg"/);
    expect(HISTORY).not.toMatch(/el\("circle"/);
    // The long description every canvas on this page already carries, on the SVG too.
    expect(HISTORY.slice(HISTORY.indexOf("function renderSpiral("))).toContain("chartTable({");
  });
});
