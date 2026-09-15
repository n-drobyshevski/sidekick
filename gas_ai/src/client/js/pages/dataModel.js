// The Data page's DOM-free half.
//
// Separate from `data.js` for the reason `problemView.js` and `settingsModel.js` are separate
// from their pages: this module imports nothing, so a test can read it under plain Node without
// dragging the SPA's `document` reads in behind it.

/** The five per-sync transition counts, exactly as `persistSync` writes `ledger_json`. */
export const LEDGER_DELTA_KEYS = [
  "new", "resolved", "reopened", "carried", "skippedNarrowedScope",
];

/**
 * One sync row's lifecycle deltas, or NULL when the row does not carry them.
 *
 * NULL IS THE POINT. A sync recorded before the lifecycle ledger existed has no `ledger_json`
 * cell, a failed sync never wrote one, and a cell that will not parse says nothing either — and
 * every one of those is "nobody counted", not "nothing moved". The three columns this feeds
 * print `absent()` on null, so a pre-ledger row reads in muted ink beside a real zero rather
 * than claiming a quiet week.
 *
 * REFUSE BEFORE THE CAST, on every value: `Number(null)` is 0 and it is finite, `Number("")`
 * and `Number([])` are 0 too, so a cell written as `{"new": null}` would otherwise print a
 * confident zero for a count Wiz never reported. The absent KEY is refused first, because
 * `{}` — an object with none of the five — is a row that named no transition at all.
 *
 * Stricter than the server's own `parseCounts`, deliberately: that one reads an unparseable
 * value as 0 because its callers are plotting a series and need a number. This one is drawing
 * a cell, where "absent" is a thing the page can say.
 */
export function ledgerDeltasOf(row) {
  if (!row || typeof row !== "object") return null;
  const raw = row.ledger_json;
  if (typeof raw !== "string" || !raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out = {};
  for (const key of LEDGER_DELTA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) return null;
    const v = parsed[key];
    // Only the two kinds a count can honestly arrive as. `[]`, `false` and `null` all cast to
    // a finite 0, so naming what IS allowed is the only form that cannot be widened by
    // accident — the "simplify this to a Number.isFinite check" rewrite reads every one of
    // them as a real zero.
    if (typeof v !== "number" && typeof v !== "string") return null;
    if (typeof v === "string" && !v.trim()) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    out[key] = Math.floor(n);
  }
  return out;
}
