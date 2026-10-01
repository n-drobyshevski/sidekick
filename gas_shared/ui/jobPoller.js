// The job poll both registers drive while a scan or sync runs: gas/'s scan card and
// gas_devsecops's sync card each hand it their own `fetchJob` and `onJob` (`applyJob`) and keep
// what a phase MEANS for their card, toast and rail to themselves. DOM-free apart from the
// `document` it reads `hidden` and `visibilitychange` off — and that is a seam, so the contract
// (`test/contracts/jobPoller.js`) runs it under fake timers with no browser.
//
// Reached by direct path, not through `ui/index.js`: it is not a component, and the two app.js
// files are its only callers.
//
// Lifted from gas_devsecops/src/client/js/syncProgress.js unchanged in behaviour; gas/ used to
// poll with a 3 s `setInterval`, the very shape the doc comment on `createJobPoller` below
// describes replacing.

/** A finished job: the poll has nothing left to wait for. Both registers' jobs tabs share these
 *  three terminal phases (`TERMINAL` in each app's src/server/jobsStore.ts). */
function isTerminalPhase(phase) {
  return phase === "DONE" || phase === "FAILED" || phase === "CANCELLED";
}

/**
 * Whether the job poll (`createJobPoller`) should keep running for this job (or its absence).
 *
 * A null job (no active job — the RPC returns null once nothing is running) and every
 * terminal phase both mean "stop"; this is the one predicate the poll loop consults, so
 * the rule that a poll must not outlive its job lives in exactly one place.
 */
export function shouldContinuePolling(job) {
  return !!job && !isTerminalPhase(String(job.phase || ""));
}

/** The poll's cadence: every 3 s while the tab is in view, every 15 s while it is hidden. */
export const POLL_VISIBLE_MS = 3000;
export const POLL_HIDDEN_MS = 15000;

/**
 * The job poll, as a SELF-SCHEDULING TIMEOUT rather than a 3 s interval — each app.js's
 * watchJob/stopWatch drive it, and `onJob` is its `applyJob`.
 *
 * THE INTERVAL IT REPLACES COULD OVERLAP ITSELF AND ANNOUNCE A FINISH TWICE. Each tick is a GAS
 * execution that can take longer than 3 s, so an interval stacked requests behind a slow one —
 * and two answers carrying DONE meant two "complete" toasts and two `refresh()`es. In
 * gas_devsecops it also went through `swrCall`, whose cached answer and revalidated answer BOTH
 * reached `applyJob`: a cached FETCHING arriving after the fresh DONE repainted the card the
 * DONE had just cleared. Here:
 *
 *   - ONE REQUEST AT A TIME. The next tick is scheduled only when the last one has answered.
 *   - A TERMINAL ANSWER STOPS THE POLL BEFORE `onJob` SEES IT, and nothing is scheduled after,
 *     so a finished job reaches `onJob` exactly once.
 *   - A `stop()` or a `watch()` of another job while a request is out DROPS that request's
 *     answer: it belongs to a poll that no longer exists.
 *   - 15 s WHILE THE TAB IS HIDDEN, because nobody is looking and every tick is a GAS execution
 *     against the quota; and an immediate tick when it comes back into view, so the card is
 *     current the moment someone is. A failed fetch is transient: the next tick tries again.
 *   - AN `onJob` THAT THROWS IS LOGGED, NOT FATAL. The next tick is scheduled after `onJob`
 *     returns, so a paint that threw on one answer used to end the poll for good while
 *     `isRunning()` still said true — a card frozen mid-run that no later answer could fix.
 *
 * `fetchJob(jobId)` returns a promise of the job summary (null once nothing is running) — a
 * plain `call()`, never a cached one. `doc` and `timers` are seams for the test; the apps pass
 * neither.
 */
export function createJobPoller({ fetchJob, onJob, doc = globalThis.document, timers = globalThis }) {
  let jobId = null;
  let timer = null;
  let generation = 0;
  let pending = null; // the generation whose request is in flight, or null
  const hidden = () => !!(doc && doc.hidden);

  function cancelTimer() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    cancelTimer();
    if (jobId === null) return;
    timer = timers.setTimeout(tick, hidden() ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
  }

  async function tick() {
    cancelTimer();
    if (jobId === null || pending === generation) return; // nothing watched, or already asking
    const gen = generation;
    pending = gen;
    let job;
    let answered = false;
    try {
      job = await fetchJob(jobId);
      answered = true;
    } catch {
      /* a transient poll failure is fine — the next tick tries again */
    }
    if (pending === gen) pending = null;
    if (gen !== generation) return; // stopped, or re-pointed at another job, meanwhile
    if (answered && !shouldContinuePolling(job)) {
      stop();
      deliver(job);
      return;
    }
    if (answered) deliver(job);
    if (gen === generation) schedule(); // unless `onJob` stopped or re-pointed the poll
  }

  function deliver(job) {
    try {
      onJob(job);
    } catch (e) {
      console.error("[jobPoller] applying a job poll answer failed:", e);
    }
  }

  function onVisibility() {
    if (jobId !== null && !hidden()) tick();
  }

  function watch(id) {
    stop();
    jobId = id;
    generation += 1;
    if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVisibility);
    tick(); // paint immediately rather than leaving the card blank for the first interval
  }

  function stop() {
    cancelTimer();
    if (jobId !== null && doc && doc.removeEventListener) {
      doc.removeEventListener("visibilitychange", onVisibility);
    }
    jobId = null;
    generation += 1;
  }

  return { watch, stop, isRunning: () => jobId !== null };
}
