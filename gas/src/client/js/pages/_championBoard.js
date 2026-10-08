// The champion board's view model: words and counts, no DOM.
//
// Lifted out of pages/champion.js for the reason _splitSheet.js and coldZoneModel.js are: every
// case worth pinning is a payload shape — an empty column, a vendor card spanning owners, a
// lower-bound MTTR, an off-board count of zero — and those are enumerable in node, while the
// page is not. The server decides which column a finding lands in (src/domain/championBoard.ts);
// this module only decides how a card SAYS it.

/** Cards drawn per column before "+ N more". Four reads at a glance on a standup screen. */
export const VISIBLE_CARDS = 4;

/** The five columns, in board order, with the one-line definition each head's tip carries. */
export const COLUMN_META = {
  now: {
    title: "Act now",
    help: ["Known exploited and reachable from the internet. No SLA or fix gate: isolate or patch."],
    empty: "Nothing known-exploited is reachable.",
  },
  late: {
    title: "Past SLA",
    help: ["Past its severity's SLA on the actionable clock, which starts once a fix exists."],
    empty: "Nothing is past SLA.",
  },
  due7: {
    title: "Due in 7 days",
    help: ["Not late yet: the SLA window closes within 7 days. Still preventable."],
    empty: "Nothing comes due this week.",
  },
  due14: {
    title: "Due in 8–14 days",
    help: ["Not late yet: the SLA window closes in 8 to 14 days."],
    empty: "Nothing comes due next week.",
  },
  vendor: {
    title: "Waiting on vendor",
    help: ["No fix is published yet. Never counted as late: the wait is the vendor's."],
    empty: "Nothing is waiting on a vendor.",
  },
};

/** The Fix next tier names — the words Executive's Fix first prints (src/domain/fixNext.ts). */
export const TIER_WORDS = {
  1: "Known exploited, reachable",
  2: "Exploitable and late",
  3: "Critical and late",
};

const count = (n) => Number(n || 0).toLocaleString("en-US");
const plural = (n, one, many) => `${count(n)} ${Number(n) === 1 ? one : (many || one + "s")}`;

/** "due today" / "due tomorrow" / "due in 5 days" — a whole-day count of days left. */
export function dueText(days) {
  const d = Number(days);
  if (!Number.isFinite(d)) return "due date unknown";
  if (d <= 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}

/**
 * How one card reads. `mark` is a tier (square on the rank ramp) or a severity; the WORD for
 * it always travels too (`markWord`), so colour never carries the meaning alone.
 */
export function cardView(card, columnId) {
  const c = card || {};
  const title = c.cve || "No CVE recorded";
  const owners = Array.isArray(c.owners) ? c.owners : [];
  const owner = columnId === "vendor"
    ? (owners.length ? owners.join(", ") : "No owner attributed")
    : (c.owner || "No owner attributed");
  const where = plural(c.assets, "host");
  const findings = plural(c.count, "finding");
  let clock;
  let clockTone = "neutral";
  if (columnId === "late") {
    clock = `${plural(c.lateDays, "day")} late`;
    clockTone = "bad";
  } else if (columnId === "due7" || columnId === "due14") {
    clock = dueText(c.dueInDays);
    if (Number(c.dueInDays) <= 2) clockTone = "bad";
  } else if (columnId === "vendor") {
    clock = "no fix yet";
  } else {
    clock = findings;
  }
  const mark = columnId === "vendor"
    ? { vendor: true }
    : c.tier ? { tier: c.tier } : { severity: c.severity || "UNKNOWN" };
  const markWord = mark.vendor ? "Waiting on vendor" : mark.tier ? TIER_WORDS[mark.tier] : null;
  const columnTitle = (COLUMN_META[columnId] || {}).title || "";
  return {
    title,
    owner,
    where,
    findings,
    clock,
    clockTone,
    mark,
    markWord,
    aria: [title, markWord || c.severity, owner, where, clock].filter(Boolean).join(", ") + ", open findings",
    subtitle: `${columnTitle} · ${owner} · ${findings} on ${where}`,
    more: c.rowsTotal > (Array.isArray(c.rows) ? c.rows.length : 0)
      ? `Showing ${count(c.rows.length)} of ${count(c.rowsTotal)} findings.`
      : null,
  };
}

/**
 * The honesty line under the board: what it left out, and why. Null when it left out nothing,
 * so a page never prints "0 open findings are not on the board".
 */
export function offBoardLine(offBoard) {
  const o = offBoard || {};
  const parts = [];
  if (o.insideSlaLater) parts.push(`${count(o.insideSlaLater)} inside SLA with more than 14 days left`);
  if (o.unobserved) parts.push(`${count(o.unobserved)} not seen in the latest scan`);
  if (o.noClock) parts.push(`${count(o.noClock)} with no readable SLA clock`);
  if (!parts.length) return null;
  const total = (o.insideSlaLater || 0) + (o.unobserved || 0) + (o.noClock || 0);
  return `${plural(total, "open finding")} ${total === 1 ? "is" : "are"} not on the board: ${parts.join(" · ")}.`;
}

/** The two progress lists, as text rows: what we fixed (30 days), and what came back. */
export function progressLists(progress) {
  const p = progress || {};
  const ago = (d) => (d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
  return {
    fixed: (p.fixedGroups || []).map((g) => ({
      name: g.cve || "No CVE recorded",
      detail: `${plural(g.count, "finding")} on ${plural(g.assets, "host")}`,
      when: ago(g.lastDays),
    })),
    regressions: (p.regressions || []).map((g) => ({
      name: g.cve || "No CVE recorded",
      detail: `on ${(g.assets || []).join(", ") || "an unnamed host"}`,
      when: g.times > 1 ? `back ${g.times}×` : "back once",
      repeat: g.times > 1,
    })),
  };
}

/**
 * The weekly digest, as Markdown a champion pastes into a standup, a chat or a ticket. Built
 * from the same payload the page draws, so what is copied is what is on the screen.
 * `mttr` / `orgMttr` are kmHalfLifeView-shaped strings, already worded by the page.
 */
export function digestMarkdown({ data, team, mttr, orgMttr, asOf }) {
  const d = data || {};
  const cols = Object.fromEntries((d.columns || []).map((c) => [c.id, c]));
  const p = d.progress || {};
  const L = [];
  L.push(`**${team}: OS vulnerabilities${asOf ? `, as of ${asOf}` : ""}**`);
  L.push(Object.keys(COLUMN_META)
    .map((id) => `${COLUMN_META[id].title} ${count((cols[id] || {}).findings)}`)
    .join(" · "));
  for (const id of ["now", "late", "due7"]) {
    const col = cols[id];
    if (!col || !col.cards.length) continue;
    L.push("");
    L.push(`**${COLUMN_META[id].title}**`);
    for (const card of col.cards.slice(0, 5)) {
      const v = cardView(card, id);
      L.push(`- ${v.title} · ${v.owner} · ${v.where} · ${v.clock}`);
    }
    if (col.cards.length > 5) L.push(`- and ${plural(col.cards.length - 5, "more group")}`);
  }
  L.push("");
  L.push("**Progress**");
  L.push(`- Fixed this week: ${count(p.fixedWeek)} (confirmed by Wiz); ${count(p.fixed30)} in the last 30 days`);
  L.push(`- Came back: ${count(p.reopened)}`);
  L.push(`- MTTR: ${mttr}${orgMttr ? ` (whole register: ${orgMttr})` : ""}`);
  return L.join("\n");
}
