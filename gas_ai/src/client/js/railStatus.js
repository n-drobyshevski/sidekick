// What the dot at the foot of the rail means.
//
// It used to mean nothing but "does a credential exist": `hasCredentials ? "ok" : "neutral"`,
// drawn as `el("span", {class: `rail-status-dot ok|neutral`, "aria-hidden": "true"})` beside a
// matching `statusPill`. That single binary fact never noticed a register that ran once, weeks
// ago, and has been silent ever since — it read "ok" the whole time, agreeing with nothing.
//
// Above 800px the caption beside the dot is visually hidden (`.sidebar .scan-caption`,
// gas_shared/styles/base.css — hidden from SIGHT, not from the accessibility tree), so on the
// default layout THE DOT IS THE WHOLE STATUS READOUT. That is why this file is bigger than a
// colour lookup: every state carries a sentence, the sentence is what goes in the
// accessibility tree via the dot's own `aria-label`, and the colour is only the glance
// version of it.
//
// PORTED FROM gas/src/client/js/railStatus.js (itself the one-register collapse of
// gas_devsecops/src/client/js/railStatus.js), narrowed further to gas_ai's own facts: ONE
// register, one job kind ("sync"), running phases FETCHING/RECONCILING/PERSISTING
// (jobsStore.ts's JobPhase), progress from `nodes_so_far`/`total_count`. DOM-free, so the
// precedence below is testable in node — the same split settingsModel.js uses.

/** Older than this and the register is described by its age rather than by a tick. */
export const STALE_AFTER_DAYS = 2;

const DAY_MS = 86_400_000;

// jobsStore.ts's JobPhase: FETCHING/RECONCILING/PERSISTING are the running phases;
// DONE/FAILED/CANCELLED are terminal. There is only one JobKind here ("sync"), so — unlike the
// sibling registers, which juggle several maintenance job kinds sharing one job row — this
// module names no kind at all; every running job is a sync in progress.
const RUNNING = ["FETCHING", "RECONCILING", "PERSISTING"];

/** Parses an ISO date defensively: refuses null/undefined/blank BEFORE the cast — the same
 *  rule `ui/figures.js`'s `relativeAge()` states for the same reason (`Number(null)` is `0`
 *  and finite, and an absent timestamp folded into `Date.parse` the same way would read as
 *  "no sync ever ran" landing on the Unix epoch instead of being refused outright). */
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
export const DRY_RUN_DETAIL = "Dry run — no Wiz credentials; syncs load the sample dataset";

/**
 * The dot's state, its accessible name, and the detail line beneath it.
 *
 * PRECEDENCE IS THE DESIGN, not an implementation detail. In order: something is happening
 * now; something failed; the register has never been synced; its one sync date could not be
 * read; it is old; it is current. Each one is more actionable than the ones below it, and the
 * last two are the only ones that mean "no action".
 *
 * `never` beating `stale` is the load-bearing pair, ported verbatim from the siblings: a
 * register nobody has ever synced is not a STALE register, it is an UNMEASURED one, and
 * reporting an age for it would describe a population nobody has looked at. See
 * test/railStatus.test.js's perturbation for what breaks when the order is not respected.
 *
 * `!hasCredentials` DOES NOT SHORT-CIRCUIT FRESHNESS HERE — the one place this copy genuinely
 * differs from gas_devsecops's ORDER, not just its scope count. gas_devsecops's credentials
 * gate really does mean "no register at all": that app disables its sync button without a
 * tenant (CLAUDE.md: "the dry-run fallback makes 'disabled with a reason' a ONE-APP
 * AFFORDANCE"), so ranking it first is ranking "there is nothing behind this" above
 * everything else. gas_ai instead falls back to a SIMULATED dry-run sync with no credentials
 * at all (`dryRunSync`), so a dry-run register can genuinely have real sync history with a
 * real, time-varying age — collapsing that to one constant "Dry run" sentence would erase a
 * fact (this register went stale three weeks ago) that stays true and stays worth knowing
 * regardless of the credential mode. Dry-run-or-not is itself already CONSTANT for the whole
 * session and already shown on the Settings System tab, so it rides here as `detail` —
 * decorating whichever freshness verdict fired, never replacing it — and only for the four
 * freshness-derived states (never / unreadable / stale / ok). Running and failed stay
 * undecorated: what is happening right now, or what just broke, does not need a credentials
 * footnote appended to it.
 */
export function railStatus({
  hasCredentials, lastSyncAt, job, nowMs, staleAfterDays = STALE_AFTER_DAYS,
} = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  if (job && RUNNING.indexOf(job.phase) >= 0) {
    // Refuses before casting, same rule as daysSince() below: a job row missing
    // `nodes_so_far` is a row this module cannot read a count from, not a row reporting 0 —
    // `Number.isFinite(undefined)` is already `false` with no coercion, so there is nothing to
    // cast in the first place. The label alone ("Sync in progress") already says what matters;
    // the detail is additional information that must not fabricate a number nobody sent.
    const done = job.nodes_so_far;
    const total = job.total_count;
    let detail = "";
    if (Number.isFinite(done)) {
      detail = Number.isFinite(total) && total > 0
        ? `${done.toLocaleString()} of ${total.toLocaleString()} records`
        : `${done.toLocaleString()} records so far`;
    }
    return { state: "scanning", label: "Sync in progress", detail };
  }

  if (job && job.phase === "FAILED") {
    return { state: "bad", label: "Last sync failed", detail: "" };
  }

  const dryRun = (result) => (hasCredentials ? result : { ...result, detail: DRY_RUN_DETAIL });

  if (typeof lastSyncAt !== "string" || lastSyncAt === "") {
    return dryRun({ state: "neutral", label: "No sync has run yet", detail: "" });
  }

  const age = daysSince(lastSyncAt, now);
  if (age === null) {
    // The stored timestamp is present but does not parse. Not "never" (there IS a record) and
    // not "current" either — a broken clock must not read as a green tick.
    return dryRun({ state: "neutral", label: "Sync date could not be read", detail: "" });
  }

  if (age >= staleAfterDays) {
    return dryRun({
      state: "warn",
      label: `Last sync ${plural(age, "day", "days")} ago — stale`,
      detail: "",
    });
  }

  return dryRun({
    state: "ok",
    label: age <= 0 ? "Synced today" : age === 1 ? "Synced yesterday" : `Synced ${age} days ago`,
    detail: "",
  });
}
