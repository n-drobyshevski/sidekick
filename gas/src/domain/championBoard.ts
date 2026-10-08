// The champion board — a team's open findings sorted into five clocks.
//
// WHO IT IS FOR. A security champion is the person inside a team who pushes that team's fixes.
// In this register they are a scoped viewer (Settings → Access), or a full user with the header
// scope set to one domain or support group. They cannot fix anything themselves; they act by
// putting a short list in front of their team. Executive's Fix first answers "which group
// earns a leader's attention"; this answers "what do I push this week, and by when".
//
// THE COLUMNS ARE CLOCKS, NOT SCORES. Every open row lands in exactly one place:
//
//   now      Fix next tier 1 — known exploited AND reachable from the internet. No SLA gate,
//            no fix gate, exactly as `fixNext.classify` decides it.
//   late     Past its severity's SLA on the clock `fixNext.pastSla` reads (actionable while
//            observed, from-detection once not). Tiers 2 and 3 land here wearing their tier;
//            a late row below every tier bar lands here wearing its severity — late is late.
//   due7     Observed, a fix exists, not late, and the window closes within 7 days.
//   due14    The same, within 8–14 days. These two are the breaches a champion can still
//            PREVENT, which is the one thing no other page in the register shows.
//   vendor   `awaiting_vendor_fix` — no fix published yet. Counted on the board, never late:
//            waiting on a vendor is not a slow team.
//
// and everything else is OFF THE BOARD AND COUNTED, never dropped (`offBoard`):
//
//   insideSlaLater  observed, inside SLA, more than 14 days left — nothing to push yet.
//   unobserved      not in the newest scan and not yet late at its last sighting. Calling it
//                   "due in N days" would be a deadline nobody is measuring.
//   noClock         no readable age, or a severity with no SLA target.
//
// so `now + late + due7 + due14 + vendor + insideSlaLater + unobserved + noClock === open`
// holds by construction, and the page can say what it left out.
//
// ONE RULE, NOT TWO. Tiering, lateness and ownership are `fixNext`'s own exported helpers, so
// the board and Executive's Fix first can never disagree about which finding is tier 1.
//
// CARDS ARE (CVE × OWNER), NEVER SINGLE FINDINGS. "OpenSSH on 4 hosts in CS-core-batch" is one
// conversation with one team; four rows saying so is noise. The vendor column groups by CVE
// alone, because a missing vendor patch is the same wait for every owner.
//
// PURE. No Sheets, no settings read, no clock beyond `now`. Ages are read off each row's own
// `actionable_age_days` / `seen_age_days`, which `baseRows` computed against one clock.

import { isOpenStatus, SEVERITY_ORDER, SLA_TARGETS } from "./config";
import { classify, ownerOf, pastSla, type FixNextRow, type FixNextTier } from "./fixNext";
import type { BaseRow } from "./ledgerCore";
import { registerRowsSlice } from "./pagePayload";
import type { RiskRule } from "./program";
import { normalizeSeverity } from "./severity";
import { parseTs, type Rec } from "./util";

const DAY_MS = 86_400_000;
/** The one `resolution_src` that is a measurement — `program.movementDecomposition`'s "observed". */
const RESOLVED_BY_API = "api";

/** How many findings a card ships for its sheet. The card still says how many it holds. */
export const CHAMPION_CARD_ROWS = 25;
/** How far back "what we fixed" looks, and the shorter window the headline counts. */
export const FIXED_WINDOW_DAYS = 30;
export const FIXED_WEEK_DAYS = 7;

export type ChampionColumnId = "now" | "late" | "due7" | "due14" | "vendor";
export const CHAMPION_COLUMNS: readonly ChampionColumnId[] = ["now", "late", "due7", "due14", "vendor"];

/**
 * What the board reads: Fix next's row, plus the lifecycle columns progress needs. Extra keys
 * the register row slice wants (risk_tier, internet_exposed, …) ride along untyped.
 */
export type ChampionRow = FixNextRow
  & Partial<Pick<BaseRow, "reopened_count" | "resolution_src" | "resolved_at">>
  & Rec;

export interface ChampionCard {
  key: string;
  cve: string | null;
  /** Null on vendor cards, which group across owners — see `owners`. */
  owner: string | null;
  ownerKind: "supportGroup" | "subscription" | null;
  /** Every owner the card's findings belong to (one entry outside the vendor column). */
  owners: string[];
  /** Fix next tier when the card earned one; null for an untiered late row and the rest. */
  tier: FixNextTier | null;
  /** The worst severity among the card's findings. */
  severity: string;
  count: number;
  /** Distinct assets — four findings on one host is one patch window. */
  assets: number;
  /** Late cards: the most days past target (whole days, rounded up). */
  lateDays: number | null;
  /** Due cards: the fewest days left before the window closes (whole days, rounded up). */
  dueInDays: number | null;
  /** Register-row slices for the card's sheet, capped at `CHAMPION_CARD_ROWS`. */
  rows: Rec[];
  rowsTotal: number;
}

export interface ChampionColumn {
  id: ChampionColumnId;
  cards: ChampionCard[];
  /** Findings in the column — what its header counts, since cards differ in size. */
  findings: number;
}

export interface ChampionOffBoard {
  insideSlaLater: number;
  unobserved: number;
  noClock: number;
}

export interface ChampionFixedGroup {
  cve: string | null;
  count: number;
  assets: number;
  /** Days since the most recent confirmed fix in the group. */
  lastDays: number;
}

export interface ChampionRegression {
  cve: string | null;
  /** The most times any of these findings has come back. */
  times: number;
  count: number;
  assets: string[];
}

export interface ChampionProgress {
  /** Confirmed fixes (`resolution_src === "api"`) in the last 7 days. */
  fixedWeek: number;
  fixed30: number;
  fixedGroups: ChampionFixedGroup[];
  /** Open findings that have been resolved before and came back. */
  reopened: number;
  regressions: ChampionRegression[];
}

export interface ChampionBoard {
  columns: ChampionColumn[];
  open: number;
  offBoard: ChampionOffBoard;
  progress: ChampionProgress;
  /** False when the frame carries no exposure keys: "now" is then undecidable, not empty. */
  exposureKnown: boolean;
  asOf: number;
}

export interface ChampionBoardOptions {
  exposedKeys?: Set<string>;
  exposureKnown?: boolean;
  rule: RiskRule;
  slaTargets?: Record<string, number>;
  now?: number;
  cardRows?: number;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function sevRank(sev: string): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(sev);
  return i < 0 ? SEVERITY_ORDER.length : i;
}

/** The consumed time `pastSla` reads, so "N days late" is measured on the clock that judged it. */
function consumedDays(row: FixNextRow): number | null {
  return finite(row.observed ? row.actionable_age_days : row.seen_age_days);
}

interface Pending {
  cve: string | null;
  owner: string | null;
  ownerKind: ChampionCard["ownerKind"];
  tier: FixNextTier | null;
  rows: ChampionRow[];
  late: number | null;
  due: number | null;
}

function cardOf(p: Pending, key: string, cap: number): ChampionCard {
  const assets = new Set<string>();
  const owners = new Set<string>();
  let severity = "UNKNOWN";
  for (const r of p.rows) {
    const a = text(r.asset_name);
    if (a !== null) assets.add(a);
    const o = ownerOf(r).owner;
    if (o !== null) owners.add(o);
    const s = normalizeSeverity(r.severity);
    if (sevRank(s) < sevRank(severity)) severity = s;
  }
  return {
    key,
    cve: p.cve,
    owner: p.owner,
    ownerKind: p.ownerKind,
    owners: [...owners].sort(),
    tier: p.tier,
    severity,
    count: p.rows.length,
    assets: assets.size,
    lateDays: p.late,
    dueInDays: p.due,
    rows: registerRowsSlice(p.rows.slice(0, cap)),
    rowsTotal: p.rows.length,
  };
}

/** The board. Resolved rows only feed `progress`; every open row lands once (header above). */
export function championBoard(rows: readonly ChampionRow[], opts: ChampionBoardOptions): ChampionBoard {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const targets = opts.slaTargets ?? SLA_TARGETS;
  const exposedKeys = opts.exposedKeys ?? new Set<string>();
  const exposureKnown = opts.exposureKnown === true;
  const cap = opts.cardRows === undefined ? CHAMPION_CARD_ROWS : Math.max(0, Math.trunc(opts.cardRows));

  const pending: Record<ChampionColumnId, Map<string, Pending>> = {
    now: new Map(), late: new Map(), due7: new Map(), due14: new Map(), vendor: new Map(),
  };
  const offBoard: ChampionOffBoard = { insideSlaLater: 0, unobserved: 0, noClock: 0 };
  let open = 0;

  const place = (col: ChampionColumnId, row: ChampionRow, tier: FixNextTier | null, clock: { late?: number; due?: number }) => {
    const cve = text(row.cve);
    const { owner, kind } = ownerOf(row);
    // Vendor cards span owners: the wait is the vendor's, and it is the same for everyone.
    const key = col === "vendor" ? `${cve ?? ""}` : `${cve ?? ""}\u0000${owner ?? ""}`;
    let p = pending[col].get(key);
    if (!p) {
      p = {
        cve,
        owner: col === "vendor" ? null : owner,
        ownerKind: col === "vendor" ? null : kind,
        tier,
        rows: [],
        late: null,
        due: null,
      };
      pending[col].set(key, p);
    }
    p.rows.push(row);
    // A card mixing tiered and untiered late rows wears the strongest tier among them.
    if (tier !== null && (p.tier === null || tier < p.tier)) p.tier = tier;
    if (clock.late !== undefined) p.late = p.late === null ? clock.late : Math.max(p.late, clock.late);
    if (clock.due !== undefined) p.due = p.due === null ? clock.due : Math.min(p.due, clock.due);
  };

  for (const row of rows) {
    if (!isOpenStatus(row.status)) continue;
    open += 1;
    const verdict = classify(row, opts.rule, targets, exposedKeys, exposureKnown);
    if ("tier" in verdict && verdict.tier === 1) {
      place("now", row, 1, {});
      continue;
    }
    if ("reason" in verdict && verdict.reason === "noFix") {
      place("vendor", row, null, {});
      continue;
    }
    const target = finite(targets[normalizeSeverity(row.severity)]);
    const age = consumedDays(row);
    const late = pastSla(row, targets);
    if (late === true && target !== null && age !== null) {
      place("late", row, "tier" in verdict ? verdict.tier : null, { late: Math.max(1, Math.ceil(age - target)) });
      continue;
    }
    if (late === null || target === null || age === null) {
      offBoard.noClock += 1;
      continue;
    }
    // Not late. Only an OBSERVED row has a deadline anyone is measuring.
    if (!row.observed) {
      offBoard.unobserved += 1;
      continue;
    }
    const left = Math.max(0, Math.ceil(target - age));
    if (left <= 7) place("due7", row, null, { due: left });
    else if (left <= 14) place("due14", row, null, { due: left });
    else offBoard.insideSlaLater += 1;
  }

  const order: Record<ChampionColumnId, (a: ChampionCard, b: ChampionCard) => number> = {
    now: (a, b) => b.count - a.count,
    late: (a, b) => (b.lateDays ?? 0) - (a.lateDays ?? 0) || b.count - a.count,
    due7: (a, b) => (a.dueInDays ?? 0) - (b.dueInDays ?? 0) || b.count - a.count,
    due14: (a, b) => (a.dueInDays ?? 0) - (b.dueInDays ?? 0) || b.count - a.count,
    vendor: (a, b) => b.count - a.count,
  };
  // Ties end on severity, then CVE and owner, so a re-run over the same ledger draws the same
  // board rather than whatever order the rows arrived in.
  const tail = (a: ChampionCard, b: ChampionCard) => (
    sevRank(a.severity) - sevRank(b.severity)
    || String(a.cve ?? "").localeCompare(String(b.cve ?? ""))
    || String(a.owner ?? "").localeCompare(String(b.owner ?? ""))
  );

  const columns: ChampionColumn[] = CHAMPION_COLUMNS.map((id) => {
    const cards = [...pending[id].entries()].map(([key, p]) => cardOf(p, `${id}:${key}`, cap));
    cards.sort((a, b) => order[id](a, b) || tail(a, b));
    return { id, cards, findings: cards.reduce((n, c) => n + c.count, 0) };
  });

  return { columns, open, offBoard, progress: championProgress(rows, now), exposureKnown, asOf: now };
}

/**
 * What the team got done, and what did not stay done.
 *
 * FIXED MEANS CONFIRMED. Only resolutions the API declared count (`resolution_src === "api"`,
 * what `movementDecomposition` calls observed) — a finding that merely stopped being listed may
 * have been fixed, renamed or decommissioned, and a row with no recorded source is unattributed.
 * A standup should thank people for real work. The window test is
 * `movementDecomposition`'s: resolved strictly after the window opened and not after now.
 *
 * A REGRESSION IS AN OPEN ROW THAT HAS BEEN RESOLVED BEFORE (`reopened_count > 0`) — the same
 * row signal the cold zone reads. "Back 2×" is a fix that does not stick.
 */
export function championProgress(rows: readonly ChampionRow[], now: number): ChampionProgress {
  const since30 = now - FIXED_WINDOW_DAYS * DAY_MS;
  const since7 = now - FIXED_WEEK_DAYS * DAY_MS;
  const fixedByCve = new Map<string, { cve: string | null; count: number; assets: Set<string>; last: number }>();
  let fixed30 = 0;
  let fixedWeek = 0;
  const regressByCve = new Map<string, { cve: string | null; times: number; count: number; assets: Set<string> }>();
  let reopened = 0;

  for (const row of rows) {
    const cve = text(row.cve);
    const asset = text(row.asset_name);
    if (isOpenStatus(row.status)) {
      const times = finite(row.reopened_count) ?? 0;
      if (times > 0) {
        reopened += 1;
        const k = cve ?? "";
        let g = regressByCve.get(k);
        if (!g) { g = { cve, times: 0, count: 0, assets: new Set() }; regressByCve.set(k, g); }
        g.times = Math.max(g.times, times);
        g.count += 1;
        if (asset !== null) g.assets.add(asset);
      }
      continue;
    }
    if (text(row.resolution_src) !== RESOLVED_BY_API) continue;
    const t = parseTs(row.resolved_at);
    if (t === null || !(t > since30 && t <= now)) continue;
    fixed30 += 1;
    if (t > since7) fixedWeek += 1;
    const k = cve ?? "";
    let g = fixedByCve.get(k);
    if (!g) { g = { cve, count: 0, assets: new Set(), last: t }; fixedByCve.set(k, g); }
    g.count += 1;
    if (asset !== null) g.assets.add(asset);
    g.last = Math.max(g.last, t);
  }

  const fixedGroups = [...fixedByCve.values()]
    .map((g) => ({ cve: g.cve, count: g.count, assets: g.assets.size, lastDays: Math.floor((now - g.last) / DAY_MS) }))
    .sort((a, b) => a.lastDays - b.lastDays || b.count - a.count || String(a.cve ?? "").localeCompare(String(b.cve ?? "")));
  const regressions = [...regressByCve.values()]
    .map((g) => ({ cve: g.cve, times: g.times, count: g.count, assets: [...g.assets].sort() }))
    .sort((a, b) => b.times - a.times || b.count - a.count || String(a.cve ?? "").localeCompare(String(b.cve ?? "")));

  return { fixedWeek, fixed30, fixedGroups, reopened, regressions };
}
