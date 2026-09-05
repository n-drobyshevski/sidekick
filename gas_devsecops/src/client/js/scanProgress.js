// The scan card in the rail, and the drawer behind it.
//
// The view model is pure and lives at the top of this file, so what the card SAYS is testable
// without a DOM (`test/scanProgress.test.js`); only the drawing below it needs a browser.
//
// PER-SCOPE PROGRESS IS NET-NEW HERE. Both siblings render one flat counts string, because
// both walk one population — `gas/` counts pages of one query and `gas_ai/` counts through a
// fixed list of queries as "query 2 of 5". This register walks three named registers with
// three separate clocks and three separate commits, and "query 2" answers none of the
// questions a reader has: which register is being collected, which are already done, and
// which have not been touched yet. So the stepper is the scopes, by name.

import { clear, el, openSheet, progressBar, tipAnchor } from "./ui.js";

/** Phases the server can be in, in the words a reader wants. */
const PHASE_LABEL = {
  FETCHING: "Collecting",
  RECONCILING: "Reconciling",
  PERSISTING: "Saving",
  DONE: "Complete",
  FAILED: "Failed",
  CANCELLED: "Stopped",
};

const RUNNING = ["FETCHING", "RECONCILING", "PERSISTING"];

/**
 * Long enough between trigger hops that "nothing is moving" is expected rather than alarming.
 *
 * The continuation delay is 30s, so a gap of that order is the NORMAL shape of a resumed
 * scan. Anything under it would flash a warning at every hop boundary.
 */
const STALL_MS = 45_000;

/** Scrub what a bad round trip leaves behind: the strings "null" and "undefined". */
function cleanError(e) {
  const s = String(e ?? "").trim();
  return s === "" || s === "null" || s === "undefined" ? "" : s;
}

function elapsedText(startedAt, nowMs) {
  const t = Date.parse(String(startedAt ?? ""));
  if (!Number.isFinite(t)) return "";
  const secs = Math.max(0, Math.round((nowMs - t) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return mins < 60 ? `${mins}m ${secs % 60}s` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * What the card shows, as data.
 *
 * `stale` comes from the SERVER and is trusted over any local comparison — the browser's
 * clock can be minutes off, and the costly direction of that error is a wedged job that still
 * looks live, with its Stop button hidden behind "it is still working". `stalled` below is a
 * softer, local signal ("nothing has moved for a while"), and it only ever adds a note.
 */
export function scanProgressView(job, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const scopeLabels = opts.scopeLabels || {};
  if (!job) return null;

  const phase = String(job.phase || "");
  const running = RUNNING.indexOf(phase) >= 0;
  const state = running ? "running"
    : phase === "DONE" ? "done"
      : phase === "CANCELLED" ? "cancelled" : "failed";

  const step = Number(job.step ?? 0);
  const stepsTotal = Number(job.steps_total ?? 0);
  const found = Number(job.findings_so_far ?? 0);
  const total = Number(job.total_count ?? 0);

  // Determinate only while COLLECTING and only when the tenant said how many there are.
  // Reconciling and saving are one long opaque operation; a bar creeping through them would
  // be inventing a rate.
  const pct = state === "done" ? 100
    : phase === "FETCHING" && total > 0 ? Math.min(99, Math.round((found / total) * 100))
      : null;

  const updatedMs = Date.parse(String(job.updated_at ?? ""));
  const stalled = running && Number.isFinite(updatedMs) && nowMs - updatedMs > STALL_MS;
  const stale = job.stale === true;

  const counts = [];
  if (found > 0 || !running) counts.push(`${found.toLocaleString()} findings`);
  if (total > 0 && phase === "FETCHING") counts.push(`of ${total.toLocaleString()}`);
  if (running && job.page > 0) counts.push(`page ${job.page}`);

  // The stepper: every register this job covers, and where each one stands. A scope BEFORE
  // the one in flight is committed — its scan row is written and its findings are in the
  // ledger — which is the fact a reader most wants during a long scan, because it says what
  // is already safe if the rest fails.
  const names = Array.isArray(job.scopes) ? job.scopes : [];
  const scopes = [];
  for (let i = 0; i < Math.max(stepsTotal, names.length); i += 1) {
    const key = names[i] || (i === step ? String(job.scope ?? "") : "");
    scopes.push({
      index: i,
      key,
      label: key ? (scopeLabels[key] || key) : "",
      status: i < step ? "done" : i === step ? (running ? "active" : state) : "waiting",
    });
  }

  return {
    state,
    phase,
    phaseLabel: PHASE_LABEL[phase] || phase,
    scopeLabel: job.scope ? (scopeLabels[job.scope] || job.scope) : "",
    pct,
    countsText: counts.join(" · "),
    elapsedText: elapsedText(job.started_at, nowMs),
    scopes,
    stalled,
    stale,
    // Stop is offered only while COLLECTING. Once reconciling starts the work is in memory
    // and the commit is a single indivisible write — interrupting it is the one thing that
    // could leave the ledger half-written, which is what the journal exists to undo.
    canStop: running && phase === "FETCHING" && !stale,
    error: cleanError(job.error),
    jobId: String(job.job_id ?? ""),
  };
}

/* ------------------------------------------------------------------------ drawing */

/**
 * Render or update the card in place.
 *
 * Built once and mutated afterwards, because the card carries `aria-live="polite"`: rebuilding
 * its children every three seconds would re-announce the whole thing to a screen reader on
 * every poll. Only the phase line is allowed to speak, and only when it actually changes.
 */
export function renderScanCard(host, job, opts = {}) {
  const v = scanProgressView(job, opts);
  if (!v) { clear(host); host.className = ""; return null; }

  host.className = `scan-progress ${v.state}${v.stale ? " stuck" : ""}`;
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");

  if (!host.querySelector(".scan-progress-phase")) {
    clear(host).append(
      el("div", { class: "scan-progress-head" },
        el("span", { class: "scan-progress-phase" }),
        el("span", { class: "scan-progress-elapsed", "aria-hidden": "true" })),
      el("div", { class: "scan-progress-bar-slot", "aria-hidden": "true" }),
      el("div", { class: "scan-steps", role: "list" }),
      el("div", { class: "scan-progress-counts", "aria-hidden": "true" }),
      el("div", { class: "scan-progress-actions" }),
      el("button", { class: "scan-progress-mini", type: "button" },
        el("span", { class: "scan-spinner", "aria-hidden": "true" }),
        el("span", { class: "scan-progress-mini-pct", "aria-hidden": "true" })),
    );
  }

  const phaseEl = host.querySelector(".scan-progress-phase");
  const headline = v.stale ? "Scan may have stopped"
    : v.state === "running" ? `${v.phaseLabel}${v.scopeLabel ? ` ${v.scopeLabel}` : ""}`
      : v.phaseLabel;
  if (phaseEl.textContent !== headline) phaseEl.textContent = headline;
  host.querySelector(".scan-progress-elapsed").textContent = v.elapsedText;

  const slot = host.querySelector(".scan-progress-bar-slot");
  clear(slot).append(progressBar(v.pct, v.state === "running" ? "" : v.state));

  const steps = host.querySelector(".scan-steps");
  clear(steps);
  for (const s of v.scopes) {
    steps.append(el("div", {
      class: `scan-step ${s.status}`,
      role: "listitem",
      "aria-label": s.label ? `${s.label} — ${s.status}` : `Register ${s.index + 1} — ${s.status}`,
    }, el("span", { class: "scan-step-dot", "aria-hidden": "true" }), el("span", { class: "scan-step-label" }, s.label || "")));
  }

  host.querySelector(".scan-progress-counts").textContent =
    v.state === "failed" ? (v.error || "Scan failed.")
      : v.state === "cancelled" ? "Scan stopped."
        : v.stale ? "No progress for a while. Stop it, then run a new scan."
          : v.stalled ? `${v.countsText} — waiting for the next hop…`
            : v.countsText || "Starting…";

  // The action row is rebuilt only when its COMPOSITION changes. It sits inside the live
  // region, so replacing identical buttons every poll would announce them again each time.
  const actions = host.querySelector(".scan-progress-actions");
  const sig = `${opts.onDetails ? "d" : ""}|${v.canStop ? "s" : v.state === "running" ? "x" : ""}`;
  if (actions.dataset.sig !== sig) {
    actions.dataset.sig = sig;
    clear(actions);
    if (opts.onDetails) {
      actions.append(el("button", { class: "linklike", onclick: opts.onDetails }, "Details"));
    }
    if (v.canStop && opts.onStop) {
      actions.append(el("button", { class: "linklike danger", onclick: opts.onStop }, "Stop"));
    } else if (v.state === "running" && opts.onStop) {
      // A disabled button takes no pointer, so the explanation hangs on a wrapper. Without
      // it the control simply looks broken at the moment a reader most wants to use it.
      actions.append(tipAnchor(
        el("span", { class: "tip-disabled-wrap" },
          el("button", {
            class: "linklike", disabled: true,
            "aria-label": "Stop is unavailable while the scan is saving",
          }, "Stop")),
        "Saving cannot be interrupted — let it finish.",
      ));
    }
  }

  // The mini control is what the collapsed rail shows: a ring instead of a bar, and the whole
  // status as its accessible name, because at 76px the captions are hidden.
  const mini = host.querySelector(".scan-progress-mini");
  const spinner = mini.querySelector(".scan-spinner");
  const determinate = v.state === "running" && typeof v.pct === "number";
  spinner.classList.toggle("is-determinate", determinate);
  if (determinate) spinner.style.setProperty("--scan-pct", String(v.pct));
  else spinner.style.removeProperty("--scan-pct");
  const GLYPH = { done: "✓", failed: "✕", cancelled: "–" };
  mini.querySelector(".scan-progress-mini-pct").textContent =
    v.stale ? "!" : v.state === "running" ? (determinate ? `${v.pct}%` : "") : (GLYPH[v.state] || "");
  const summary = [headline, v.countsText].filter(Boolean).join(" · ");
  mini.setAttribute("aria-label", summary || "Scan progress");
  tipAnchor(mini, summary || null);
  mini.onclick = opts.onDetails || null;

  return v;
}

/** The drawer: the same facts with room to breathe, plus the error in full. */
export function openScanDetails(job, opts = {}) {
  let current = job;
  let body = null;

  const paint = () => {
    if (!body || !body.isConnected) return;
    const v = scanProgressView(current, { ...opts, nowMs: Date.now() });
    clear(body);
    if (!v) return;

    body.append(
      progressBar(v.pct, v.state === "running" ? "" : v.state),
      el("div", { class: "scan-steps", role: "list" }, ...v.scopes.map((s) => el("div", {
        class: `scan-step ${s.status}`,
        role: "listitem",
        "aria-label": `${s.label || `Register ${s.index + 1}`} — ${s.status}`,
      }, el("span", { class: "scan-step-dot", "aria-hidden": "true" }), el("span", { class: "scan-step-label" }, s.label || "")))),
      el("dl", { class: "scan-detail-grid" },
        el("dt", {}, "Status"), el("dd", {}, v.phaseLabel),
        el("dt", {}, "Register"), el("dd", {}, v.scopeLabel || "—"),
        el("dt", {}, "Findings"), el("dd", {}, v.countsText || "—"),
        el("dt", {}, "Elapsed"), el("dd", {}, v.elapsedText || "—")),
      ...(v.error ? [el("div", { class: "scan-detail-error" }, v.error)] : []),
      ...(v.stale
        ? [el("div", { class: "scan-stall-note" },
          "Nothing has moved for over half an hour. Stop this scan and start a new one.")]
        : []),
    );
    if (v.canStop && opts.onStop) {
      body.append(el("div", { class: "sheet-actions" },
        el("button", {
          class: "linklike danger",
          onclick: () => { opts.onStop(); handle.close(); },
        }, "Stop scan")));
    }
  };

  const handle = openSheet((host) => {
    body = host;
    paint();
  }, { title: "Scan progress", subtitle: "Wiz DevSecOps collection", closeOnRouteChange: true });

  return {
    close: () => handle.close(),
    update: (next) => { current = next; paint(); },
  };
}
