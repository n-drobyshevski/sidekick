// Scan progress: a persistent card in the sidebar scan zone + a details dialog, bound
// to the JobRow the poller already fetches. `scanProgressView` is pure (no DOM) so it
// is unit-tested; the renderers wrap it in the design-system primitives.

import { absent, clear, el, num, openSheet, progressBar, tip, tipAnchor } from "./ui.js";

const STEPS = [
  { key: "FETCHING", label: "Fetch" },
  { key: "RECONCILING", label: "Reconcile" },
  { key: "PERSISTING", label: "Persist" },
];
const PHASE_LABEL = {
  FETCHING: "Fetching findings",
  RECONCILING: "Reconciling",
  PERSISTING: "Saving",
  REPLAYING: "Saving",
  // Maintenance job phases. Jobs are single-flight across kinds, so the sidebar card paints
  // whichever job is active — without these two it falls back to printing the raw phase
  // constant ("BACKFILLING") at the operator.
  BACKFILLING: "Recovering exploit signals",
  PURGING: "Purging findings",
  DONE: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};
const RUNNING_PHASES = ["FETCHING", "RECONCILING", "PERSISTING", "REPLAYING"];
const STALL_MS = 15000; // between trigger hops (30s delay) this flags "waiting…"
const STUCK_MS = 5 * 60 * 1000; // no progress this long → likely dead, surface a recovery path

/** Empty, or the literal strings "null"/"undefined" that a bad round-trip can leave. */
function cleanError(err) {
  const raw = err == null ? "" : String(err).trim();
  return raw === "" || raw === "null" || raw === "undefined" ? "" : raw;
}

function parseMs(iso) {
  const t = Date.parse(iso || "");
  return Number.isNaN(t) ? null : t;
}

function fmtElapsed(ms) {
  if (ms === null || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** JobRow + current epoch ms → a pure view model for the card/dialog. */
export function scanProgressView(job, nowMs) {
  const phase = String(job.phase || "");
  const state =
    phase === "DONE" ? "done"
    : phase === "FAILED" ? "failed"
    : phase === "CANCELLED" ? "cancelled"
    : "running";

  const activeIdx = STEPS.findIndex((s) => s.key === phase);
  const steps = STEPS.map((s, i) => {
    let status;
    if (state === "done") status = "done";
    else if (activeIdx === -1) status = state === "running" ? "todo" : "done";
    else if (i < activeIdx) status = "done";
    else if (i === activeIdx) status = "active";
    else status = "todo";
    return { key: s.key, label: s.label, status };
  });

  // `num(v, 0)` rather than `Number(v || 0)`. The zero is intended and stays: a job row that
  // has not reported a page yet has fetched nothing, and `total === 0` is this file's own
  // sentinel for "the count was never recorded" (see the `total > 0` guards below). What the
  // bare cast could not refuse is a field that was never a number — `Number("many")` is NaN,
  // and a NaN `findings` reaches `toLocaleString()` and prints "NaN findings" on the scan
  // card, which is worse than any of the states this view model exists to tell apart.
  const findings = num(job.findings_so_far, 0);
  const total = num(job.total_count, 0);
  const page = num(job.page, 0);

  let pct = null;
  if (state === "done") pct = 100;
  else if (phase === "FETCHING" && total > 0) {
    pct = Math.min(99, Math.round((findings / total) * 100));
  }

  const startedMs = parseMs(job.started_at);
  const updatedMs = parseMs(job.updated_at);
  const stalled =
    state === "running" &&
    phase === "FETCHING" &&
    updatedMs !== null &&
    nowMs - updatedMs > STALL_MS;
  // A far longer gap means the job almost certainly died mid-flight (killed execution,
  // no pending continuation) — worth an actionable "may have stopped" prompt. `job.stale` is
  // the server's own verdict (jobsStore.isStaleJob, 30 min) and wins when present: this
  // comparison is against the *browser's* clock, so a machine whose time is off would
  // otherwise mislabel a healthy job — or, worse, a wedged one.
  const stuck =
    state === "running" &&
    (job.stale === true ||
      (job.stale === undefined && updatedMs !== null && nowMs - updatedMs > STUCK_MS));

  let phaseLabel = PHASE_LABEL[phase] || phase || "Working";
  if (stalled) phaseLabel = "Waiting for next step…";

  const countsParts = [];
  if (findings > 0 || state !== "running") {
    countsParts.push(`${findings.toLocaleString()} findings`);
    if (total > 0) countsParts.push(`of ${total.toLocaleString()}`);
  }
  if (page > 0 && state === "running") countsParts.push(`page ${page}`);
  const countsText = countsParts.join(" · ");

  return {
    state,
    phase,
    phaseLabel,
    steps,
    pct,
    countsText,
    elapsedText: fmtElapsed(startedMs === null ? null : nowMs - startedMs),
    stalled,
    stuck,
    canStop: state === "running" && phase === "FETCHING",
    // Past FETCHING a *healthy* run is seconds from committing and must not be interrupted —
    // but a run that has gone quiet for half an hour is not going to commit anything, and
    // leaving it uninterruptible is what wedges the whole app (jobs are single-flight across
    // kinds, so one dead row blocks every scan and the daily trigger with it). The server
    // decides what to do with the request per phase: a killed mid-write is rolled back from
    // its journal, never cancelled outright.
    canForceStop: state === "running" && stuck,
    error: cleanError(job.error),
  };
}

// The server resolves this now (`jobSummarySlice`), so the raw params blob no longer rides the
// 3s poll. `incremental` is tri-state: null means absent or unparseable params, which keeps the
// generic label this used to reach through a JSON.parse catch.
function scanMode(job) {
  if (job.incremental === true) return "Quick refresh";
  if (job.incremental === false) return "Full scan";
  return "Scan";
}

/**
 * Compact card for the scan zone. `onStop`/`onDetails` are click handlers.
 *
 * The card is a polite live region so assistive tech hears phase transitions, completion,
 * and failure — but only the phase line is announced: the volatile elapsed / counts / bar
 * are aria-hidden and the structure is updated in place (phase text mutated only on a real
 * change) so a 3s poll doesn't chatter. A stuck run (no progress for minutes) is surfaced on
 * the always-visible card, not only inside the details drawer.
 */
export function renderScanCard(host, job, { onStop, onDetails, nowMs, stopping } = {}) {
  const v = scanProgressView(job, nowMs || Date.now());
  host.className = `scan-progress ${v.state}${v.stuck ? " stuck" : ""}`;
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");

  // Build the stable structure once; later polls update fields in place.
  if (!host.querySelector(".scan-progress-phase")) {
    clear(host).append(
      el("div", { class: "scan-progress-head" },
        el("span", { class: "scan-progress-phase" }),
        el("span", { class: "scan-progress-elapsed", "aria-hidden": "true" })),
      el("div", { class: "scan-progress-bar-slot", "aria-hidden": "true" }),
      el("div", { class: "scan-progress-counts", "aria-hidden": "true" }),
      el("div", { class: "scan-progress-actions" }),
      // Compact stand-in shown only while the sidebar is collapsed to icons (CSS-gated on
      // .sidebar.collapsed). A real button so the Details drawer — and through it Stop —
      // stays reachable in the 56px rail; the ring + centered glyph mirror the phase/bar
      // for a glanceable "still working / done / failed" cue where the full card can't fit.
      el("button", { class: "scan-progress-mini", type: "button" },
        el("span", { class: "scan-spinner", "aria-hidden": "true" }),
        el("span", { class: "scan-progress-mini-pct", "aria-hidden": "true" })),
    );
  }
  const phaseEl = host.querySelector(".scan-progress-phase");
  const elapsedEl = host.querySelector(".scan-progress-elapsed");
  const barSlot = host.querySelector(".scan-progress-bar-slot");
  const countsEl = host.querySelector(".scan-progress-counts");
  const actionsEl = host.querySelector(".scan-progress-actions");

  const phaseText = stopping ? "Stopping…" : v.stuck ? "Scan may have stopped" : v.phaseLabel;
  if (phaseEl.textContent !== phaseText) phaseEl.textContent = phaseText; // announce real transitions only

  elapsedEl.textContent = v.elapsedText || "";
  elapsedEl.style.display = v.elapsedText ? "" : "none";

  clear(barSlot).append(progressBar(v.pct, v.state === "running" ? "" : v.state));

  // Collapsed-rail mini indicator: a determinate arc while a percent is known, an
  // indeterminate spin otherwise, and a terminal glyph once the run settles. The card's
  // state class (.running/.done/.failed/.stuck) tints the ring in CSS; here we only feed
  // the percent and the centered glyph/number and keep the button pointed at Details.
  const miniBtn = host.querySelector(".scan-progress-mini");
  const miniSpinner = miniBtn.querySelector(".scan-spinner");
  const miniPct = miniBtn.querySelector(".scan-progress-mini-pct");
  const determinate = v.state === "running" && typeof v.pct === "number" && !Number.isNaN(v.pct);
  miniSpinner.classList.toggle("is-determinate", determinate);
  if (determinate) miniSpinner.style.setProperty("--scan-pct", String(v.pct));
  else miniSpinner.style.removeProperty("--scan-pct");
  const MINI_GLYPH = { done: "✓", failed: "✕", cancelled: "–" };
  miniPct.textContent =
    stopping ? "…"
    : v.stuck ? "!"
    : v.state === "running" ? (determinate ? `${v.pct}%` : "")
    : (MINI_GLYPH[v.state] || "");
  // The rail is too narrow for the phase words, so they live on the tooltip / accessible
  // name of the button instead — hover or focus surfaces the same status the card shows.
  const summary = [phaseText, v.countsText].filter(Boolean).join(" · ");
  miniBtn.setAttribute("aria-label", summary || "Scan progress");
  // This was a native `title`, which is why the comment above could only promise "hover".
  // A native tooltip is unreachable by keyboard, absent on touch and truncated by the OS,
  // so the phase words the rail is too narrow to draw were effectively pointer-only. The
  // hover card opens on focus as well, and the copy is read at reveal time so a card that
  // is already open during a 3s poll shows the phase the card now shows.
  tip(miniBtn, () => (summary ? [summary] : null));
  miniBtn.onclick = onDetails || null;
  miniBtn.disabled = !onDetails;

  countsEl.textContent =
    v.state === "failed" ? (v.error || "Scan failed.")
    : v.state === "cancelled" ? "Scan stopped."
    : v.stuck ? "No progress for a while — it may have stopped. Force stop to clear it."
    : v.countsText || "Starting…";

  // Rebuild the actions only when their composition changes, so stable buttons don't
  // re-announce under the live region and their handlers survive between polls.
  const canStopNow = v.canStop && !!onStop;
  const canForceNow = !canStopNow && v.canForceStop && !!onStop;
  const running = v.state === "running";
  const stopSig = canStopNow ? "s" : canForceNow ? "f" : running && onStop ? "x" : "";
  const sig = `${onDetails ? "d" : ""}|${stopSig}`;
  if (actionsEl.dataset.sig !== sig) {
    actionsEl.dataset.sig = sig;
    clear(actionsEl);
    if (onDetails) actionsEl.append(el("button", { class: "linklike", onclick: onDetails }, "Details"));
    if (canStopNow) {
      actionsEl.append(el("button", { class: "linklike danger", onclick: onStop }, "Stop"));
    } else if (canForceNow) {
      // The run has gone quiet long enough to be presumed dead, so Stop comes back at any
      // phase — the label says "Force" because the server may have to roll a half-written
      // ledger back from its journal rather than simply cancel.
      actionsEl.append(tip(
        el("button", { class: "linklike danger", onclick: onStop }, "Force stop"),
        ["The scan appears to have stopped — clear it so a new one can run."],
      ));
    } else if (running && onStop) {
      // Past FETCHING a healthy run can't be cancelled — explain rather than silently drop Stop.
      // `tipAnchor`, not `tip`: a `disabled` button is not focusable and receives no pointer
      // events in Chromium, so neither the old native title nor a hover card can open on it.
      // The explanation therefore rides on the aria-label, which assistive technology does
      // read; the card is the sighted-pointer half and is reachable wherever the browser
      // still dispatches over a disabled control. Making it reachable for everyone means
      // trading `disabled` for `aria-disabled` and keeping the button in the tab order,
      // which is a behaviour change this pass is not making.
      actionsEl.append(tipAnchor(
        el("button", {
          class: "linklike", disabled: true,
          "aria-label": "Stop unavailable while saving",
        }, "Stop"),
        () => ["Saving can't be interrupted — let it finish."],
      ));
    }
  }

  return v;
}

/**
 * Detailed drawer: phase stepper + counts + elapsed + mode (+ error).
 *
 * Returns `{ close, update }`. The poller feeds fresh JobRows through `update(job)` so the
 * open panel tracks the scan live — findings, pages, elapsed, phase and progress all advance
 * without the user having to close and reopen it. Without this the body is a one-shot snapshot.
 */
export function openScanDetails(job, opts = {}) {
  const { onStop } = opts;
  let currentJob = job;
  let bodyEl = null;
  let closeFn = null;

  function paint() {
    // A poll can arrive after the user dismissed the sheet (scrim / Esc / ✕ / Close — none of
    // which call back here); repainting a detached body would throw, so bail harmlessly.
    if (!bodyEl || !bodyEl.isConnected) return;
    // Recompute the whole view (elapsed included) against the current job and wall clock, so a
    // running scan's timer keeps ticking on every poll tick — not just when the panel is opened.
    const v = scanProgressView(currentJob, Date.now());
    clear(bodyEl);

    const stepper = el("div", { class: "scan-steps", role: "list" });
    for (const s of v.steps) {
      const glyph = s.status === "done" ? "✓" : s.status === "active" ? "●" : "○";
      const word = s.status === "done" ? "done" : s.status === "active" ? "in progress" : "pending";
      // The glyph/color/weight are visual only; the accessible name carries the state.
      stepper.append(
        el("div", { class: `scan-step ${s.status}`, role: "listitem",
          "aria-label": `${s.label} — ${word}`,
          "aria-current": s.status === "active" ? "step" : null },
          el("span", { class: "scan-step-dot", "aria-hidden": "true" }, glyph),
          el("span", { "aria-hidden": "true" }, s.label)),
      );
    }

    const actions = el("div", { class: "sheet-actions", style: "margin-top:16px" });
    // v.canStop / v.canForceStop are recomputed each paint, so the button retires once the job
    // leaves FETCHING and returns as "Force stop" if the run then goes quiet.
    if (v.canStop && onStop) {
      actions.append(el("button", { class: "danger", onclick: () => { onStop(); closeFn(); } },
        "Stop scan"));
    } else if (v.canForceStop && onStop) {
      actions.append(el("button", { class: "danger", onclick: () => { onStop(); closeFn(); } },
        "Force stop"));
    } else if (v.state === "running" && onStop) {
      // Explain the vanished Stop instead of leaving it a mystery once saving starts.
      // See the same conversion on the sidebar card above for why this is `tipAnchor` and
      // why a disabled button can still leave the card unreachable to a pointer.
      actions.append(tipAnchor(
        el("button", { class: "danger", disabled: true,
          "aria-label": "Stop unavailable while saving" }, "Stop scan"),
        () => ["Saving can't be interrupted — let it finish."],
      ));
    }
    actions.append(el("button", { class: "primary", onclick: closeFn }, "Close"));

    // Note: native Node.append() stringifies null into a literal "null" text node
    // (unlike el(), which drops it) — so conditional children are filtered out here.
    const children = [
      stepper,
      progressBar(v.pct, v.state === "running" ? "" : v.state),
      // A long silence almost always means the run died — say so and offer a way out. The old
      // copy pointed at "Run a new scan from the sidebar" in the one case where the sidebar
      // buttons were hidden behind this very card, which is advice the app made impossible.
      v.stuck
        ? el("div", { class: "scan-stall-note", role: "status" },
            el("span", { "aria-hidden": "true" }, "⚠ "),
            "No progress for a while — the scan may have stopped. " +
              ((v.canStop || v.canForceStop) && onStop
                ? "Stop it, then run a new scan from the sidebar."
                : "Run a new scan from the sidebar."))
        : null,
      el("dl", { class: "scan-detail-grid" },
        el("dt", {}, "Status"), el("dd", {}, v.phaseLabel),
        el("dt", {}, "Findings"),
        el("dd", {}, `${num(currentJob.findings_so_far, 0).toLocaleString()}` +
          (num(currentJob.total_count, 0) > 0
            ? ` of ${num(currentJob.total_count, 0).toLocaleString()}`
            : "")),
        el("dt", {}, "Pages"), el("dd", {}, String(currentJob.page || 0)),
        // `absent()`, not a bare em dash: elapsed is empty only when `started_at` did not
        // parse, and a black dash in the same ink as the figures beside it reads as a
        // measured value. The muted one says nobody is claiming there should be a number.
        el("dt", {}, "Elapsed"), el("dd", {}, v.elapsedText || absent()),
      ),
      v.error ? el("div", { class: "scan-detail-error" }, v.error) : null,
      actions,
    ];
    bodyEl.append(...children.filter(Boolean));
  }

  const handle = openSheet(
    (body, close) => {
      bodyEl = body;
      closeFn = close;
      paint();
    },
    { title: "Scan progress", subtitle: scanMode(job), ariaLabel: "Scan progress" },
  );

  return {
    close: handle.close,
    update(nextJob) {
      currentJob = nextJob;
      paint();
    },
  };
}
