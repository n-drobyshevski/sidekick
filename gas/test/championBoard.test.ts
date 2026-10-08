// The champion board — a team's open findings sorted into five clocks.
//
// `src/domain/championBoard.ts` is pure over its arguments, so everything here runs over
// hand-built rows. What is under test is the PLACEMENT RULE (which column a finding lands in),
// the ACCOUNTING (every open row lands exactly once, on the board or in `offBoard`), and the
// progress lists (what counts as a confirmed fix, what counts as a regression).

import { describe, expect, it } from "vitest";

import { championBoard, championProgress, type ChampionColumnId, type ChampionRow } from "../src/domain/championBoard";
import { DEFAULT_RISK_RULE } from "../src/domain/program";

const NOW = Date.parse("2026-10-08T00:00:00Z");
const DAY = 86_400_000;
const RULE = DEFAULT_RISK_RULE;

interface Spec {
  cve?: string | null;
  severity?: string;
  status?: string;
  kev?: boolean | null;
  exploit?: boolean | null;
  /** A vendor fix exists. Defaults true. */
  fix?: boolean;
  awaiting?: boolean;
  /** The actionable clock (days). */
  age?: number | null;
  observed?: boolean;
  seenAge?: number | null;
  sg?: string | null;
  sub?: string | null;
  asset?: string;
  exposed?: boolean;
  reopened?: number;
  resolvedDaysAgo?: number;
  src?: string | null;
}

let seq = 0;
const exposedKeys = new Set<string>();

function row(spec: Spec): ChampionRow {
  seq += 1;
  const key = `vk-${seq}`;
  if (spec.exposed) exposedKeys.add(key);
  const resolved = spec.resolvedDaysAgo !== undefined;
  return {
    vuln_key: key,
    cve: spec.cve === undefined ? "CVE-2026-0001" : spec.cve,
    severity: spec.severity ?? "HIGH",
    status: spec.status ?? (resolved ? "RESOLVED" : "OPEN"),
    has_kev: spec.kev === undefined ? null : spec.kev,
    has_exploit: spec.exploit === undefined ? null : spec.exploit,
    epss: null,
    fix_available_at: spec.fix === false || spec.awaiting ? null : "2026-09-01T00:00:00Z",
    awaiting_vendor_fix: spec.awaiting === true,
    actionable_age_days: spec.age === undefined ? 1 : spec.age,
    age_days: spec.age === undefined ? 1 : spec.age,
    observed: spec.observed === undefined ? true : spec.observed,
    seen_age_days: spec.seenAge === undefined ? null : spec.seenAge,
    asset_name: spec.asset ?? `host-${seq}`,
    subscription_name: spec.sub === undefined ? "sub-a" : spec.sub,
    _supportGroup: spec.sg === undefined ? "SG-A" : spec.sg,
    reopened_count: spec.reopened ?? 0,
    resolution_src: resolved ? (spec.src === undefined ? "api" : spec.src) : null,
    resolved_at: resolved ? new Date(NOW - spec.resolvedDaysAgo! * DAY).toISOString() : null,
  } as unknown as ChampionRow;
}

function board(rows: ChampionRow[], opts: { exposureKnown?: boolean; cardRows?: number } = {}) {
  return championBoard(rows, { rule: RULE, exposedKeys, exposureKnown: opts.exposureKnown ?? true, now: NOW, cardRows: opts.cardRows });
}

function column(b: ReturnType<typeof board>, id: ChampionColumnId) {
  return b.columns.find((c) => c.id === id)!;
}

/** Which column each row's vuln_key landed in (or "off"). */
function placement(b: ReturnType<typeof board>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of b.columns) for (const card of c.cards) for (const r of card.rows) out[String(r["vuln_key"])] = c.id;
  return out;
}

describe("placement — the columns are clocks", () => {
  it("puts a known-exploited reachable finding in 'now' even inside SLA and with no fix", () => {
    const inside = row({ kev: true, exposed: true, age: 1 });
    const noFix = row({ kev: true, exposed: true, awaiting: true });
    const b = board([inside, noFix]);
    const p = placement(b);
    expect(p[inside.vuln_key as string]).toBe("now");
    expect(p[noFix.vuln_key as string]).toBe("now");
    expect(column(b, "now").cards[0]!.tier).toBe(1);
  });

  it("leaves tier 1 empty — not the rows unranked — when exposure was never measured", () => {
    const r = row({ kev: true, exposed: true, age: 1 });
    expect(placement(board([r], { exposureKnown: false }))[r.vuln_key as string]).toBe("due14");
  });

  it("sends awaiting-vendor findings to 'vendor', never 'late', however old", () => {
    const r = row({ awaiting: true, age: null, severity: "CRITICAL" });
    const b = board([r]);
    expect(placement(b)[r.vuln_key as string]).toBe("vendor");
    expect(column(b, "late").findings).toBe(0);
  });

  it("puts a late finding in 'late' with its tier, and a late untiered one with its severity", () => {
    const tiered = row({ exploit: true, age: 44, severity: "HIGH", cve: "CVE-A" });
    const plain = row({ exploit: false, kev: false, age: 40, severity: "MEDIUM", cve: "CVE-B" });
    const b = board([tiered, plain]);
    const late = column(b, "late").cards;
    expect(late.map((c) => [c.cve, c.tier, c.lateDays])).toEqual([["CVE-A", 2, 30], ["CVE-B", null, 10]]);
  });

  it("buckets the deadline at 7 and 14 days left, and keeps a later one off the board", () => {
    // HIGH: 14-day target. age 14 → 0 left (on the due date is in SLA); age 7 → 7 left;
    // age 6 → 8 left; age 0 → 14 left; MEDIUM age 15 → 15 left.
    const due0 = row({ age: 14 });
    const due7 = row({ age: 7 });
    const due8 = row({ age: 6 });
    const due14 = row({ age: 0 });
    const later = row({ age: 15, severity: "MEDIUM" });
    const b = board([due0, due7, due8, due14, later]);
    const p = placement(b);
    expect(p[due0.vuln_key as string]).toBe("due7");
    expect(p[due7.vuln_key as string]).toBe("due7");
    expect(p[due8.vuln_key as string]).toBe("due14");
    expect(p[due14.vuln_key as string]).toBe("due14");
    expect(p[later.vuln_key as string]).toBeUndefined();
    expect(b.offBoard.insideSlaLater).toBe(1);
  });

  it("never gives an unobserved row a deadline; it is late only on what was seen", () => {
    const quiet = row({ observed: false, seenAge: 3, age: 3 });
    const wasLate = row({ observed: false, seenAge: 20, age: 5, cve: "CVE-SEEN" });
    const b = board([quiet, wasLate]);
    const p = placement(b);
    expect(p[quiet.vuln_key as string]).toBeUndefined();
    expect(b.offBoard.unobserved).toBe(1);
    expect(p[wasLate.vuln_key as string]).toBe("late");
    expect(column(b, "late").cards[0]!.lateDays).toBe(6);
  });

  it("counts a row with no readable clock off the board rather than dropping it", () => {
    const b = board([row({ age: null })]);
    expect(b.offBoard.noClock).toBe(1);
  });

  it("accounts for every open row exactly once, and ignores resolved ones", () => {
    const rows = [
      row({ kev: true, exposed: true }), row({ awaiting: true }), row({ age: 30, exploit: true }),
      row({ age: 10 }), row({ age: 2 }), row({ age: 1, severity: "LOW" }), row({ observed: false, seenAge: 1 }),
      row({ age: null }), row({ resolvedDaysAgo: 3 }),
    ];
    const b = board(rows);
    const onBoard = b.columns.reduce((n, c) => n + c.findings, 0);
    const off = b.offBoard.insideSlaLater + b.offBoard.unobserved + b.offBoard.noClock;
    expect(b.open).toBe(8);
    expect(onBoard + off).toBe(b.open);
  });
});

describe("cards — (CVE × owner), never single findings", () => {
  it("groups by CVE and owner, counting distinct assets", () => {
    const rows = [
      row({ cve: "CVE-X", sg: "SG-A", asset: "h1", age: 30, exploit: true }),
      row({ cve: "CVE-X", sg: "SG-A", asset: "h1", age: 31, exploit: true }),
      row({ cve: "CVE-X", sg: "SG-A", asset: "h2", age: 20, exploit: true }),
      row({ cve: "CVE-X", sg: "SG-B", asset: "h3", age: 20, exploit: true }),
    ];
    const late = column(board(rows), "late").cards;
    expect(late.map((c) => [c.owner, c.count, c.assets, c.lateDays])).toEqual([
      ["SG-A", 3, 2, 17],
      ["SG-B", 1, 1, 6],
    ]);
  });

  it("falls back to the subscription when no support group is attributed", () => {
    const card = column(board([row({ sg: null, sub: "prod-acct", age: 30, exploit: true })]), "late").cards[0]!;
    expect([card.owner, card.ownerKind]).toEqual(["prod-acct", "subscription"]);
  });

  it("groups the vendor column by CVE alone and lists every owner", () => {
    const rows = [
      row({ cve: "CVE-V", sg: "SG-A", awaiting: true }),
      row({ cve: "CVE-V", sg: "SG-B", awaiting: true }),
    ];
    const card = column(board(rows), "vendor").cards[0]!;
    expect(card.owner).toBeNull();
    expect(card.owners).toEqual(["SG-A", "SG-B"]);
    expect(card.count).toBe(2);
  });

  it("caps the rows a card ships, and says how many it holds", () => {
    const rows = Array.from({ length: 5 }, () => row({ cve: "CVE-M", age: 30, exploit: true }));
    const card = column(board(rows, { cardRows: 2 }), "late").cards[0]!;
    expect(card.rows).toHaveLength(2);
    expect(card.rowsTotal).toBe(5);
    expect(card.count).toBe(5);
  });

  it("ships register-row slices the finding sheet can open", () => {
    const card = column(board([row({ cve: "CVE-S", age: 30, exploit: true })]), "late").cards[0]!;
    expect(card.rows[0]).toHaveProperty("vuln_key");
    expect(card.rows[0]).toHaveProperty("support_group", "SG-A");
    expect(card.rows[0]).not.toHaveProperty("_supportGroup");
  });

  it("orders 'late' by days late and the due columns by days left", () => {
    const rows = [
      row({ cve: "L1", age: 20, exploit: true }), row({ cve: "L2", age: 50, exploit: true }),
      row({ cve: "D1", age: 9 }), row({ cve: "D2", age: 13 }),
    ];
    const b = board(rows);
    expect(column(b, "late").cards.map((c) => c.cve)).toEqual(["L2", "L1"]);
    expect(column(b, "due7").cards.map((c) => [c.cve, c.dueInDays])).toEqual([["D2", 1], ["D1", 5]]);
  });
});

describe("progress — what we fixed, and what came back", () => {
  it("counts only confirmed (API) fixes inside 30 days, and the week inside that", () => {
    const rows = [
      row({ cve: "F1", resolvedDaysAgo: 2 }),
      row({ cve: "F1", resolvedDaysAgo: 5 }),
      row({ cve: "F2", resolvedDaysAgo: 20 }),
      row({ cve: "F3", resolvedDaysAgo: 40 }),
      row({ cve: "F4", resolvedDaysAgo: 3, src: "disappeared" }),
      row({ cve: "F5", resolvedDaysAgo: 3, src: null }),
    ];
    const p = championProgress(rows, NOW);
    expect(p.fixed30).toBe(3);
    expect(p.fixedWeek).toBe(2);
    expect(p.fixedGroups.map((g) => [g.cve, g.count, g.lastDays])).toEqual([["F1", 2, 2], ["F2", 1, 20]]);
  });

  it("lists open rows that came back, worst repeat first", () => {
    const rows = [
      row({ cve: "R1", reopened: 1, asset: "a" }),
      row({ cve: "R2", reopened: 3, asset: "b" }),
      row({ cve: "R2", reopened: 1, asset: "c" }),
      row({ cve: "R3", reopened: 2, resolvedDaysAgo: 1 }), // resolved again: not a live regression
    ];
    const p = championProgress(rows, NOW);
    expect(p.reopened).toBe(3);
    expect(p.regressions.map((g) => [g.cve, g.times, g.count, g.assets])).toEqual([
      ["R2", 3, 2, ["b", "c"]],
      ["R1", 1, 1, ["a"]],
    ]);
  });
});
