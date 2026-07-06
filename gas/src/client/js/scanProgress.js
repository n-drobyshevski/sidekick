// Scan progress: a persistent card in the sidebar scan zone + a details dialog, bound
// to the JobRow the poller already fetches. `scanProgressView` is pure (no DOM) so it
// is unit-tested; the renderers wrap it in the design-system primitives.

import { clear, el, openSheet, progressBar } from "./ui.js";

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
  DONE: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};
const RUNNING_PHASES = ["FETCHING", "RECONCILING", "PERSISTING", "REPLAYING"];
const STALL_MS = 15000; // between trigger hops (30s delay) this flags "waiting…"

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

  const findings = Number(job.findings_so_far || 0);
  const total = Number(job.total_count || 0);
  const page = Number(job.page || 0);

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
    canStop: state === "running" && phase === "FETCHING",
    error: job.error || "",
  };
}

function scanMode(job) {
  try {
    const p = JSON.parse(job.params_json || "{}");
    return p.incremental ? "Quick refresh" : "Full scan";
  } catch {
    return "Scan";
  }
}

/** Compact card for the scan zone. `onStop`/`onDetails` are click handlers. */
export function renderScanCard(host, job, { onStop, onDetails, nowMs, stopping } = {}) {
  const v = scanProgressView(job, nowMs || Date.now());
  clear(host);
  host.className = `scan-progress ${v.state}`;

  const head = el("div", { class: "scan-progress-head" },
    el("span", { class: "scan-progress-phase" }, stopping ? "Stopping…" : v.phaseLabel),
    v.elapsedText ? el("span", { class: "scan-progress-elapsed" }, v.elapsedText) : null,
  );

  const bar = progressBar(v.pct, v.state === "running" ? "" : v.state);

  const counts = el("div", { class: "scan-progress-counts" },
    v.state === "failed" ? (v.error || "Scan failed.")
    : v.state === "cancelled" ? "Scan stopped."
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

/** Detailed drawer: phase stepper + counts + elapsed + mode (+ error). */
export function openScanDetails(job, nowMs) {
  const v = scanProgressView(job, nowMs || Date.now());
  return openSheet((sheet, close) => {
    const stepper = el("div", { class: "scan-steps" });
    for (const s of v.steps) {
      const glyph = s.status === "done" ? "✓" : s.status === "active" ? "●" : "○";
      stepper.append(
        el("div", { class: `scan-step ${s.status}` },
          el("span", { class: "scan-step-dot", "aria-hidden": "true" }, glyph),
          el("span", {}, s.label)),
      );
    }
    sheet.append(
      el("h2", {}, "Scan progress"),
      el("div", { class: "muted small", style: "margin-bottom:12px" }, scanMode(job)),
      stepper,
      progressBar(v.pct, v.state === "running" ? "" : v.state),
      el("dl", { class: "scan-detail-grid" },
        el("dt", {}, "Status"), el("dd", {}, v.phaseLabel),
        el("dt", {}, "Findings"),
        el("dd", {}, `${Number(job.findings_so_far || 0).toLocaleString()}` +
          (Number(job.total_count || 0) > 0 ? ` of ${Number(job.total_count).toLocaleString()}` : "")),
        el("dt", {}, "Pages"), el("dd", {}, String(job.page || 0)),
        el("dt", {}, "Elapsed"), el("dd", {}, v.elapsedText || "—"),
      ),
      v.error ? el("div", { class: "scan-detail-error" }, v.error) : null,
      el("div", { class: "sheet-actions", style: "margin-top:16px" },
        el("button", { class: "primary", onclick: close }, "Close")),
    );
  });
}
