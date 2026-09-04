// Value formatting: dates in the display zone, and the small numeric/plural helpers that
// were being re-derived at each call site.

// Timestamps are stored canonically as UTC; the UI shows them in Europe/Paris
// wall-clock. sv-SE renders a clean ISO-like "YYYY-MM-DD HH:MM"; en-GB gives the
// DST-aware zone abbreviation (CET in winter, CEST in summer).
export const DISPLAY_TZ = "Europe/Paris";

const _dateFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});
const _dateTimeFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const _zoneFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TZ, timeZoneName: "short",
});

function parisZone(date) {
  const part = _zoneFmt.formatToParts(date).find((p) => p.type === "timeZoneName");
  return part ? part.value : "CET";
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  return _dateFmt.format(new Date(t));
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  const d = new Date(t);
  return `${_dateTimeFmt.format(d)} ${parisZone(d)}`;
}

/** The noun alone, for callers that format the count themselves (a localised figure). */
export function pluralize(n, word) {
  return n === 1 ? word : `${word}s`;
}

/** "1 asset" / "2 assets" — the -s rule, written once instead of at each call site. */
export function plural(n, word) {
  return `${n} ${pluralize(n, word)}`;
}

/**
 * Position on a severity scale, LOWER = WORSE, with anything unrecognised sorting last.
 * `order` is a parameter, not a constant, so a future caller can rank against whichever
 * severity order it holds — a page's own fallback list, or the order a payload sends —
 * rather than a scale fixed here.
 */
export function sevRank(sev, order) {
  const i = (order || []).indexOf(String(sev || "").toUpperCase());
  return i === -1 ? (order || []).length : i;
}

/**
 * Deadline as a sortable number; a row with no readable date sorts last either way.
 *
 * `Number.MAX_SAFE_INTEGER`, not `Infinity` — two rows that both lack a deadline must
 * subtract to `0`, or the comparator returns `NaN` and the sort silently stops moving that
 * pair.
 *
 * Takes the ROW, not the date, so a comparator table adopting it changes by one word. It
 * lives here rather than in tableModel.js because this is the file that already owns
 * `sevRank`, the other "turn a column into a number" helper.
 */
export function dueRank(row) {
  const t = Date.parse((row && row.dueAt) || "");
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}
