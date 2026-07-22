// Sync progress: a persistent card in the sidebar sync zone + a details drawer,
// bound to the JobRow the poller already fetches. `syncProgressView` is pure (no
// DOM) so it is unit-testable; the renderers wrap it in design-system primitives.

import { clear, el, openSheet, progressBar } from "./ui.js";

const STEPS = [
  { key: "FETCHING", label: "Fetch" },
  { key: "RECONCILING", label: "Reconcile" },
  { key: "PERSISTING", label: "Persist" },
];
const PHASE_LABEL = {
  FETCHING: "Fetching assets",
  RECONCILING: "Building graph",
  PERSISTING: "Saving",
  DONE: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};
const STALL_MS = 15000; // between trigger hops (30s delay) this flags "waiting…"
const STUCK_MS = 5 * 60 * 1000; // no progress this long → likely dead

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

/** JobRow + current epoch ms → a pure view model for the card/drawer. */
export function syncProgressView(job, nowMs) {
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

  const nodes = Number(job.nodes_so_far || 0);
  const total = Number(job.total_count || 0);
  const page = Number(job.page || 0);
  const stepIndex = Number(job.step_index || 0);

  let pct = null;
  if (state === "done") pct = 100;
  else if (phase === "FETCHING" && total > 0) {
    pct = Math.min(99, Math.round((nodes / total) * 100));
  }

  const startedMs = parseMs(job.started_at);
  const updatedMs = parseMs(job.updated_at);
  const stalled =
    state === "running" &&
    phase === "FETCHING" &&
    updatedMs !== null &&
    nowMs - updatedMs > STALL_MS;
  const stuck =
    state === "running" && updatedMs !== null && nowMs - updatedMs > STUCK_MS;

  let phaseLabel = PHASE_LABEL[phase] || phase || "Working";
  if (stalled) phaseLabel = "Waiting for next step…";

  const countsParts = [];
  if (nodes > 0 || state !== "running") {
    countsParts.push(`${nodes.toLocaleString()} rows`);
    if (total > 0) countsParts.push(`of ${total.toLocaleString()}`);
  }
  if (state === "running") countsParts.push(`query ${stepIndex + 1}`);
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
    error: cleanError(job.error),
  };
}

/**
 * Compact card for the sync zone. `onStop`/`onDetails` are click handlers.
 *
 * The card is a polite live region so assistive tech hears phase transitions, completion,
 * and failure — but only the phase line is announced: the volatile elapsed / counts / bar
 * are aria-hidden and the structure is updated in place (phase text mutated only on a real
 * change) so a 3s poll doesn't chatter. A stuck run (no progress for minutes) is surfaced on
 * the always-visible card, not only inside the details drawer.
 */
export function renderSyncCard(host, job, { onStop, onDetails, nowMs, stopping } = {}) {
  const v = syncProgressView(job, nowMs || Date.now());
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
    );
  }
  const phaseEl = host.querySelector(".scan-progress-phase");
  const elapsedEl = host.querySelector(".scan-progress-elapsed");
  const barSlot = host.querySelector(".scan-progress-bar-slot");
  const countsEl = host.querySelector(".scan-progress-counts");
  const actionsEl = host.querySelector(".scan-progress-actions");

  const phaseText = stopping ? "Stopping…" : v.stuck ? "Sync may have stopped" : v.phaseLabel;
  if (phaseEl.textContent !== phaseText) phaseEl.textContent = phaseText; // announce real transitions only

  elapsedEl.textContent = v.elapsedText || "";
  elapsedEl.style.display = v.elapsedText ? "" : "none";

  clear(barSlot).append(progressBar(v.pct, v.state === "running" ? "" : v.state));

  countsEl.textContent =
    v.state === "failed" ? (v.error || "Sync failed.")
    : v.state === "cancelled" ? "Sync stopped."
    : v.stuck ? "No progress for a while — it may have stopped. Stop it, then run a new sync."
    : v.countsText || "Starting…";

  // Rebuild the actions only when their composition changes, so stable buttons don't
  // re-announce under the live region and their handlers survive between polls.
  const canStopNow = v.canStop && !!onStop;
  const running = v.state === "running";
  const sig = `${onDetails ? "d" : ""}|${canStopNow ? "s" : running && onStop ? "x" : ""}`;
  if (actionsEl.dataset.sig !== sig) {
    actionsEl.dataset.sig = sig;
    clear(actionsEl);
    if (onDetails) actionsEl.append(el("button", { class: "linklike", onclick: onDetails }, "Details"));
    if (canStopNow) {
      actionsEl.append(el("button", { class: "linklike danger", onclick: onStop }, "Stop"));
    } else if (running && onStop) {
      // Past FETCHING the run can't be cancelled — explain rather than silently drop Stop.
      actionsEl.append(el("button", {
        class: "linklike", disabled: true,
        title: "Saving can't be interrupted — let it finish.",
        "aria-label": "Stop unavailable while saving",
      }, "Stop"));
    }
  }

  return v;
}

/**
 * Detailed drawer: phase stepper + counts + elapsed (+ error).
 *
 * Returns `{ close, update }`. The poller feeds fresh JobRows through `update(job)` so the
 * open panel tracks the sync live — rows, query, elapsed, phase and progress all advance
 * without the user having to close and reopen it. Without this the body is a one-shot snapshot.
 */
export function openSyncDetails(job, opts = {}) {
  const { onStop } = opts;
  let currentJob = job;
  let bodyEl = null;
  let closeFn = null;

  function paint() {
    // A poll can arrive after the user dismissed the sheet (scrim / Esc / ✕ / Close — none of
    // which call back here); repainting a detached body would throw, so bail harmlessly.
    if (!bodyEl || !bodyEl.isConnected) return;
    // Recompute the whole view (elapsed included) against the current job and wall clock, so a
    // running sync's timer keeps ticking on every poll tick — not just when the panel is opened.
    const v = syncProgressView(currentJob, Date.now());
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
    // v.canStop is recomputed each paint, so the Stop button retires once the job leaves FETCHING.
    if (v.canStop && onStop) {
      actions.append(el("button", { class: "danger", onclick: () => { onStop(); closeFn(); } },
        "Stop sync"));
    } else if (v.state === "running" && onStop) {
      // Explain the vanished Stop instead of leaving it a mystery once saving starts.
      actions.append(el("button", { class: "danger", disabled: true,
        title: "Saving can't be interrupted — let it finish.",
        "aria-label": "Stop unavailable while saving" }, "Stop sync"));
    }
    actions.append(el("button", { class: "primary", onclick: closeFn }, "Close"));

    // Note: native Node.append() stringifies null into a literal "null" text node
    // (unlike el(), which drops it) — so conditional children are filtered out here.
    const children = [
      stepper,
      progressBar(v.pct, v.state === "running" ? "" : v.state),
      // A long silence almost always means the run died — say so and offer a way out.
      v.stuck
        ? el("div", { class: "scan-stall-note", role: "status" },
            el("span", { "aria-hidden": "true" }, "⚠ "),
            "No progress for a while — the sync may have stopped. " +
              (v.canStop && onStop
                ? "Stop it, then run a new sync from the sidebar."
                : "Run a new sync from the sidebar."))
        : null,
      el("dl", { class: "scan-detail-grid" },
        el("dt", {}, "Status"), el("dd", {}, v.phaseLabel),
        el("dt", {}, "Rows"),
        el("dd", {}, `${Number(currentJob.nodes_so_far || 0).toLocaleString()}` +
          (Number(currentJob.total_count || 0) > 0
            ? ` of ${Number(currentJob.total_count).toLocaleString()}`
            : "")),
        el("dt", {}, "Query"), el("dd", {}, String(Number(currentJob.step_index || 0) + 1)),
        el("dt", {}, "Elapsed"), el("dd", {}, v.elapsedText || "—"),
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
    { title: "Sync progress", subtitle: "Wiz AI security sync", ariaLabel: "Sync progress" },
  );

  return {
    close: handle.close,
    update(nextJob) {
      currentJob = nextJob;
      paint();
    },
  };
}
