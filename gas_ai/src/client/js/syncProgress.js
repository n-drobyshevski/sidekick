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

/** Compact card for the sync zone. `onStop`/`onDetails` are click handlers. */
export function renderSyncCard(host, job, { onStop, onDetails, nowMs, stopping } = {}) {
  const v = syncProgressView(job, nowMs || Date.now());
  clear(host);
  host.className = `scan-progress ${v.state}`;

  const head = el("div", { class: "scan-progress-head" },
    el("span", { class: "scan-progress-phase" }, stopping ? "Stopping…" : v.phaseLabel),
    v.elapsedText ? el("span", { class: "scan-progress-elapsed" }, v.elapsedText) : null,
  );

  const bar = progressBar(v.pct, v.state === "running" ? "" : v.state);

  const counts = el("div", { class: "scan-progress-counts" },
    v.state === "failed" ? (v.error || "Sync failed.")
    : v.state === "cancelled" ? "Sync stopped."
    : v.countsText || "Starting…");

  const actions = el("div", { class: "scan-progress-actions" });
  if (onDetails) {
    actions.append(el("button", { class: "linklike", onclick: onDetails }, "Details"));
  }
  if (v.canStop && onStop) {
    actions.append(el("button", { class: "linklike danger", onclick: onStop }, "Stop"));
  }

  host.append(head, bar, counts, actions);
  return v;
}

/** Detailed drawer: phase stepper + counts + elapsed (+ error). */
export function openSyncDetails(job, opts = {}) {
  const { nowMs, onStop } = opts;
  const v = syncProgressView(job, nowMs || Date.now());
  return openSheet(
    (body, close) => {
      const stepper = el("div", { class: "scan-steps" });
      for (const s of v.steps) {
        const glyph = s.status === "done" ? "✓" : s.status === "active" ? "●" : "○";
        stepper.append(
          el("div", { class: `scan-step ${s.status}` },
            el("span", { class: "scan-step-dot", "aria-hidden": "true" }, glyph),
            el("span", {}, s.label)),
        );
      }

      const actions = el("div", { class: "sheet-actions", style: "margin-top:16px" });
      if (v.canStop && onStop) {
        actions.append(el("button", { class: "danger", onclick: () => { onStop(); close(); } },
          "Stop sync"));
      }
      actions.append(el("button", { class: "primary", onclick: close }, "Close"));

      const children = [
        stepper,
        progressBar(v.pct, v.state === "running" ? "" : v.state),
        v.stuck
          ? el("div", { class: "scan-stall-note", role: "status" },
              el("span", { "aria-hidden": "true" }, "⚠ "),
              "No progress for a while — the sync may have stopped. " +
                (v.canStop && onStop ? "Stop it and run again." : "Try running it again."))
          : null,
        el("dl", { class: "scan-detail-grid" },
          el("dt", {}, "Status"), el("dd", {}, v.phaseLabel),
          el("dt", {}, "Rows"),
          el("dd", {}, `${Number(job.nodes_so_far || 0).toLocaleString()}` +
            (Number(job.total_count || 0) > 0 ? ` of ${Number(job.total_count).toLocaleString()}` : "")),
          el("dt", {}, "Query"), el("dd", {}, String(Number(job.step_index || 0) + 1)),
          el("dt", {}, "Elapsed"), el("dd", {}, v.elapsedText || "—"),
        ),
        v.error ? el("div", { class: "scan-detail-error" }, v.error) : null,
        actions,
      ];
      body.append(...children.filter(Boolean));
    },
    { title: "Sync progress", subtitle: "Wiz AI security sync", ariaLabel: "Sync progress" },
  );
}
