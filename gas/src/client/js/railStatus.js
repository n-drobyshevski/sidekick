// What the dot at the foot of the rail means.
//
// It used to mean nothing but "does a credential exist": `hasCredentials ? "ok" : "neutral"`,
// drawn as `el("span", {class: "rail-status-dot ok|neutral"})` beside a matching
// `statusPill`. That single binary fact never noticed a register that ran once, months ago,
// and has been silent ever since — it read "ok" the whole time, agreeing with nothing.
//
// Above 800px the caption beside the dot is visually hidden (`.sidebar .scan-caption`,
// gas_shared/styles/base.css — hidden from SIGHT, not from the accessibility tree), so on the
// default layout THE DOT IS THE WHOLE STATUS READOUT. That is why this file is bigger than a
// colour lookup: every state carries a sentence, the sentence is what goes in the
// accessibility tree via the dot's own `aria-label`, and the colour is only the glance
// version of it.
//
// PORTED FROM gas_devsecops/src/client/js/railStatus.js and collapsed to gas's ONE register.
// This app has no per-register on/off switch the way the code register does — `scopes` is
// always `["os"]` in production — but the shape mirrors the sibling's `railStatus()` exactly
// rather than hand-rolling a single-scope special case, so a second scope (or a second job
// kind) is a data change here, not a rewrite. DOM-free, so the precedence below is testable
// in node — the same split settingsModel.js and scanProgressView (scanProgress.js) use.

/** Older than this and the register is described by its age rather than by a tick. */
export const STALE_AFTER_DAYS = 2;

const DAY_MS = 86_400_000;

// Every phase that means "a job is actively doing something" — not only the scan hops
// (jobsStore.ts's JobPhase: FETCHING/RECONCILING/PERSISTING/REPLAYING) but every maintenance
// phase that shares the SAME single-flight job row: STAGING/APPLYING/FINALIZING for a
// sharded import, BACKFILLING for the risk-signal recovery, PURGING for a severity purge.
// scanProgress.js's own header says why one row covers all of them: "Jobs are single-flight
// across kinds, so the sidebar card paints whichever job is active" — the rail dot has to
// agree with that card rather than recognising only scan hops and reading a live backfill as
// idle.
const RUNNING = [
  "FETCHING", "RECONCILING", "PERSISTING", "REPLAYING",
  "STAGING", "APPLYING", "FINALIZING",
  "BACKFILLING", "PURGING",
];

// What a running/failed job calls itself, keyed by jobsStore.ts's JobKind — "scan" for the
// thing this register is actually named for (MANIFEST's `sync: { noun: "scan" }` in app.js),
// a plain noun for the four maintenance kinds so a live backfill never misreports itself as a
// scan in progress. An unknown or missing kind (an old job row, or a payload this module does
// not recognise) falls back to "job" rather than throwing or printing "undefined".
const KIND_NOUN = {
  scan: "scan",
  backfill: "backfill",
  purge: "purge",
  delete: "ledger cleanup",
  compact: "ledger compaction",
  import: "ledger import",
};

function nounFor(kind) {
  return KIND_NOUN[kind] || "job";
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A number that is genuinely a count, never `null`/`undefined` read as zero. Refuses before
 *  casting — `Number.isFinite(null)` is already `false` with no coercion, which is the point:
 *  a job row missing this field (jobSummarySlice's `?? null`) must not read as "0 findings". */
function count(v) {
  return Number.isFinite(v) ? v : 0;
}

/** Parses an ISO date defensively: refuses null/undefined/blank BEFORE the cast, the same
 *  rule `ui/figures.js`'s `relativeAge()` states for the same reason (`Number(null)` is `0`
 *  and finite; `Date.parse(String(null))` is at least honestly `NaN`, but a bare `iso || ""`
 *  fallback that fell through to `Date.parse` would still coerce nullish values that are not
 *  strings, so refuse the coercion first rather than lean on Date.parse alone). */
function daysSince(iso, nowMs) {
  if (typeof iso !== "string" || iso === "") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / DAY_MS);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The sentence a dry-run register carries as DETAIL, never as a replacement for the state
 *  freshness already derived — see the function header for why the two do not compete here. */
const DRY_RUN_DETAIL = "Dry run — no Wiz credentials; scans are simulated";

/**
 * The dot's state, its accessible name, and the detail line beneath it.
 *
 * PRECEDENCE IS THE DESIGN, not an implementation detail. In order: something is happening
 * now; something failed; there is no register collected at all; the register has never been
 * looked at; its one scan date could not be read; it is old; it is current. Each one is more
 * actionable than the ones below it, and the last two are the only ones that mean "no action".
 *
 * `never` beating `stale` is the load-bearing pair, ported verbatim from the sibling: a
 * register nobody has ever scanned is not a STALE register, it is an UNMEASURED one, and
 * reporting an age for it would describe a population nobody has looked at — the same rule
 * the Executive page's own empty state already applies. See test/railStatus.test.js's
 * perturbation for what breaks when the order is not respected.
 *
 * `!hasCredentials` DOES NOT SHORT-CIRCUIT FRESHNESS HERE, and that is the one place this
 * copy genuinely differs from the sibling's ORDER, not just its scope count — measured, after
 * an earlier draft of this file put it ahead of `never`/stale/ok the way gas_devsecops does.
 * gas_devsecops's credentials gate really does mean "no register at all": that app disables
 * its sync button without a tenant (CLAUDE.md: "the dry-run fallback makes 'disabled with a
 * reason' a ONE-APP AFFORDANCE"), so ranking it first is ranking "there is nothing behind
 * this" above everything else. gas and gas_ai instead fall back to a SIMULATED dry-run scan
 * with no credentials at all, so a dry-run register can genuinely have real scan history with
 * a real, time-varying age — collapsing that to one constant "Dry run" sentence would erase a
 * fact (this register went stale three weeks ago) that stays true and stays worth knowing
 * regardless of the credential mode. Dry-run-or-not is itself already CONSTANT for the whole
 * session and already shown on the Settings System tab, so it rides here as `detail` —
 * decorating whichever freshness verdict fired, never replacing it — and only for the four
 * freshness-derived states (never / unreadable / stale / ok). `!collected.length` stays
 * undecorated: "no register is collected" is a configuration fact, not a freshness one, and
 * is unaffected by whether a tenant is connected.
 */
export function railStatus({
  hasCredentials, lastScanByScope, scopes, job, nowMs, staleAfterDays = STALE_AFTER_DAYS,
} = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const collected = (scopes && scopes.length ? scopes : []).slice();
  const byScope = lastScanByScope || {};

  if (job && RUNNING.indexOf(job.phase) >= 0) {
    const findings = count(job.findings_so_far);
    const total = count(job.total_count);
    return {
      state: "scanning",
      label: `${capitalize(nounFor(job.kind))} in progress`,
      detail: total > 0
        ? `${findings.toLocaleString()} of ${total.toLocaleString()}`
        : `${findings.toLocaleString()} so far`,
    };
  }

  if (job && job.phase === "FAILED") {
    return { state: "bad", label: `Last ${nounFor(job.kind)} failed`, detail: "" };
  }

  if (!collected.length) {
    return { state: "neutral", label: "No register is collected", detail: "" };
  }

  const dryRun = (result) => (hasCredentials ? result : { ...result, detail: DRY_RUN_DETAIL });

  const never = collected.filter((s) => !byScope[s]);
  if (never.length) {
    return dryRun({ state: "neutral", label: "No scan has run yet", detail: "" });
  }

  let worst = null;
  for (const s of collected) {
    const d = daysSince(byScope[s], now);
    if (d === null) continue;
    if (worst === null || d > worst) worst = d;
  }
  if (worst === null) {
    // Every scope has a value and none of them parses. Not "current".
    return dryRun({ state: "neutral", label: "Scan date could not be read", detail: "" });
  }

  if (worst >= staleAfterDays) {
    return dryRun({
      state: "warn",
      label: `Last scan ${plural(worst, "day", "days")} ago — stale`,
      detail: "",
    });
  }

  return dryRun({
    state: "ok",
    label: worst <= 0 ? "Scanned today" : "Scanned yesterday",
    detail: "",
  });
}
