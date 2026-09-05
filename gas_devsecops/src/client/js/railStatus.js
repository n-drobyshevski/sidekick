// What the dot at the foot of the rail means.
//
// It used to mean nothing. `app.js` drew `class: "rail-status-dot neutral"` as a LITERAL,
// with the hover text "Collection not wired — Phase 2", reading no field of the bootstrap
// payload at all — while the Settings page, two clicks away, showed a green pill for the same
// deployment's credentials. Two surfaces telling different stories about one fact, and
// neither of them measuring it.
//
// Above 800px the captions beside the dot are hidden, so on the default layout THE DOT IS THE
// WHOLE STATUS READOUT. That is why this file is bigger than a colour lookup: every state
// carries a sentence, the sentence is what goes in the accessibility tree, and the colour is
// only the glance version of it.
//
// DOM-free, so the precedence below is testable in node — the same split registerModel.js and
// settingsModel.js use.

/** Older than this and a register is described by its age rather than by a tick. */
export const STALE_AFTER_DAYS = 2;

const DAY_MS = 86_400_000;

const RUNNING = ["FETCHING", "RECONCILING", "PERSISTING"];

function daysSince(iso, nowMs) {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / DAY_MS);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The dot's state, its accessible name, and the detail line beneath it.
 *
 * PRECEDENCE IS THE DESIGN, not an implementation detail. In order: something is happening
 * now; something failed; there is nothing to sync with; something has never been looked at;
 * something is old; everything is current. Each one is more actionable than the ones below
 * it, and the last two are the only ones that mean "no action".
 *
 * `never` beating `stale` is the load-bearing pair. A register nobody has ever synced is not
 * a stale register — it is an unmeasured one, and reporting the average freshness of the two
 * that DID run would describe a population nobody has looked at. Same rule the Executive page
 * already applies to its hero figure.
 */
export function railStatus({
  hasCredentials, lastScanByScope, scopes, job, nowMs, staleAfterDays = STALE_AFTER_DAYS,
} = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const collected = (scopes && scopes.length ? scopes : []).slice();
  const byScope = lastScanByScope || {};
  const label = (s) => (byScope.__labels && byScope.__labels[s]) || s;

  if (job && RUNNING.indexOf(job.phase) >= 0) {
    const where = job.scope ? ` — ${label(job.scope)}` : "";
    return {
      state: "scanning",
      label: `Sync in progress${where}`,
      detail: job.total_count > 0
        ? `${job.findings_so_far.toLocaleString()} of ${job.total_count.toLocaleString()}`
        : `${job.findings_so_far.toLocaleString()} so far`,
    };
  }

  if (job && job.phase === "FAILED") {
    return {
      state: "bad",
      label: "Last sync failed",
      // The error itself is on the card and in the diagnostic. Here it would not fit and
      // would not be readable at a glance anyway.
      detail: job.scope ? `while syncing ${label(job.scope)}` : "",
    };
  }

  if (!hasCredentials) {
    // Not a warning. Nothing is broken — the register simply has no tenant behind it, which
    // is the normal state of a fresh deployment and of the dev harness.
    return {
      state: "neutral",
      label: "No Wiz credentials — nothing is being collected",
      detail: "Set them in Script Properties, then Run sync.",
    };
  }

  if (!collected.length) {
    return { state: "neutral", label: "No register is collected", detail: "" };
  }

  const never = collected.filter((s) => !byScope[s]);
  if (never.length) {
    return {
      state: "neutral",
      label: never.length === collected.length
        ? "Never scanned"
        : `${plural(never.length, "register", "registers")} never scanned`,
      detail: never.map(label).join(", "),
    };
  }

  let worst = null;
  let worstScope = null;
  for (const s of collected) {
    const d = daysSince(byScope[s], now);
    if (d === null) continue;
    if (worst === null || d > worst) { worst = d; worstScope = s; }
  }
  if (worst === null) {
    // Every scope has a timestamp and none of them parses. Not "fresh".
    return { state: "neutral", label: "Scan dates could not be read", detail: "" };
  }

  if (worst >= staleAfterDays) {
    return {
      state: "warn",
      label: `Oldest register scanned ${plural(worst, "day", "days")} ago`,
      detail: label(worstScope),
    };
  }

  return {
    state: "ok",
    label: worst <= 0 ? "All registers scanned today" : "All registers scanned yesterday",
    detail: "",
  };
}

/**
 * Attach the scope labels the bootstrap ships, so this module names a register the way the
 * rest of the app does without importing a second copy of the mapping.
 */
export function withLabels(lastScanByScope, scopeLabels) {
  return Object.assign({}, lastScanByScope, { __labels: scopeLabels || {} });
}
