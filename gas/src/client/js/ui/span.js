// A duration at whatever scale reads best — hours, days, months, years.
//
// WHY THIS IS NOT `fmtDays`, AND WHY IT IS NOT THE SHARED ONE EITHER. This was called
// `fmtDays` in gas's own ui.js, which is the name the shared core (gas_shared/ui/figures.js)
// gives a DIFFERENT function, and the two disagree on every input above 30:
//
//     value      gas (this)   shared fmtDays   shared days1
//     0.5              12h          0.5 days       0.5 d
//     41            1.4mo            41 days      41.0 d
//     400            1.1y           400 days     400.0 d
//
// The shared pair are both DAY formatters: one prose ("41 days"), one a table cell
// ("41.0 d"). This one changes UNIT, because an OS-vulnerability register routinely carries
// remediation ages spanning three orders of magnitude in one column — a fleet's oldest
// CRITICAL is years old and its newest is hours old — and "912 days" beside "0.3 days" is
// arithmetic the reader has to do to compare them. Neither shared function can be given this
// behaviour without changing what "41 days" means in two sibling apps, and this one cannot
// keep the name `fmtDays` without shadowing the barrel export of the same name with
// different output.
//
// So it keeps its behaviour and takes a name that says what it does. Call sites that wanted
// the shared conventions were moved to `days1` / `fmtDays` per site, not wholesale.

/** A span in days, printed at the largest unit that keeps it a small number. */
export function fmtSpan(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (v < 1 / 24) return "<1h";
  if (v < 1) return `${Math.round(v * 24)}h`;
  if (v < 30) return `${v.toFixed(1)}d`;
  if (v < 365) return `${(v / 30).toFixed(1)}mo`;
  return `${(v / 365).toFixed(1)}y`;
}
