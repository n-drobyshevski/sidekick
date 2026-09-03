// Sync progress: a persistent card in the sidebar sync zone + a details drawer, bound to the
// JobRow SUMMARY the poller fetches (`jobSummarySlice` — never the raw JobRow: no `cursor`,
// no `journal_ref`, see src/domain/pagePayload.ts's SECURITY RULE). `syncViewModel` is pure
// (no DOM) so the state logic is unit-testable without a browser; the renderers below wrap it
// in the shared ui/ primitives. Ported from gas_ai/src/client/js/syncProgress.js, the chassis
// this register forked from, and reshaped for the one thing that register never had to draw:
// a single job that walks THREE registers in a row.
//
// ------------------------------------------------------------------------------------------
// ONE JOB WALKS THREE SCOPES SEQUENTIALLY (src/server/scanJobs.ts): sca, then sast, then
// secrets. During FETCHING `job.scope` names which one is in flight; the instant the LAST
// scope's FETCHING finishes, `scanJobs.ts` sets `scope` back to null and it stays null through
// RECONCILING / PERSISTING / DONE — so "phase is past FETCHING" is this view's own signal that
// every scope was walked, not a guess. Which register is in flight, which are done and which
// are still queued is the single most important thing this card says: a reader watching a
// 41-page walk needs to see it moving, not wonder whether it is stuck on page 12 of sca
// forever. `scopeSequence` below carries that, and both renderers put it on screen.
//
// WHY THERE IS NO FRACTION-COMPLETE BAR WHILE FETCHING. `findings_so_far` is cumulative
// across the WHOLE job — `step()` in scanJobs.ts seeds `findings` from `job.findings_so_far`
// once and never resets it between scopes. `total_count` is the CURRENT scope's own total,
// reset to 0 the moment a new scope starts. Dividing the first by the second is only ever
// correct for sca, the first scope: from the first page of sast onward the numerator already
// carries every row sca contributed, so the "percentage" would sit near 100% for the rest of
// the walk regardless of how much of sast or secrets had actually landed. Rather than ship a
// bar that is honest for one scope in three and silently wrong for the other two, the bar
// stays indeterminate for the whole of FETCHING (and for RECONCILING/PERSISTING, which have no
// total of their own either) — the scope walk and the live row count are what say the sync is
// moving, and neither one fabricates a precision the payload cannot support.

import { clear, el, openSheet, progressBar, tipAnchor } from "./ui.js";

/** Mirrors `SCOPES` in src/domain/config.ts — the fixed walk order. Duplicated rather than
 *  imported: no client module reaches into src/domain (it is server-only domain logic; the
 *  client keeps its own small copies of the handful of constants it needs — severity.js is
 *  the same pattern for the severity palette). */
export const SYNC_SCOPES = ["sca", "sast", "secrets"];

const SCOPE_LABEL = { sca: "SCA", sast: "SAST", secrets: "Secrets" };

// Phase words for everything that ISN'T FETCHING — FETCHING gets its own "Fetching <scope>"
// label below, since naming the register in flight is the one fact worth stating twice.
const PHASE_WORD = {
  RECONCILING: "Reconciling ledger",
  PERSISTING: "Saving",
  DONE: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const STALL_MS = 15000; // between continuation hops, this flags "waiting…"
const STUCK_MS = 5 * 60 * 1000; // no progress this long → likely dead

function isTerminalPhase(phase) {
  return phase === "DONE" || phase === "FAILED" || phase === "CANCELLED";
}

/**
 * Whether the 3s poll should keep running for this job (or its absence).
 *
 * A null job (no active sync — the RPC returns null once nothing is running) and every
 * terminal phase both mean "stop"; this is the one predicate app.js's poll loop consults, so
 * the rule that a poll must not outlive its job lives in exactly one place.
 */
export function shouldContinuePolling(job) {
  return !!job && !isTerminalPhase(String(job.phase || ""));
}

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

/**
 * `jobSummarySlice` output + current epoch ms → a pure view model for the card/drawer.
 *
 * Every field below is built BY NAME — never by spreading `job` onto the result — so a future
 * bug that ever put `cursor` or `journal_ref` on the wire cannot ride this view model onto the
 * page. `test/syncProgress.test.js` pins that over the full `JSON.stringify` of the output.
 */
export function syncViewModel(job, nowMs) {
  if (!job) return null;
  const phase = String(job.phase || "");
  const state =
    phase === "DONE" ? "done"
    : phase === "FAILED" ? "failed"
    : phase === "CANCELLED" ? "cancelled"
    : "running";

  const currentScope = job.scope || null;
  const currentIdx = currentScope ? SYNC_SCOPES.indexOf(currentScope) : -1;
  // See the file header: once the phase is anything but FETCHING, scanJobs.ts has already
  // walked (and null'd out) every scope, whatever this job's final state turned out to be.
  const everyScopeFetched = phase !== "FETCHING";
  const scopeSequence = SYNC_SCOPES.map((key, i) => {
    let status;
    if (everyScopeFetched) status = "done";
    else if (currentIdx === -1) status = "todo"; // no scope chosen yet (the very first hop)
    else if (i < currentIdx) status = "done";
    else if (i === currentIdx) status = "active";
    else status = "todo";
    return { key, label: SCOPE_LABEL[key] || key, status };
  });

  const findings = Number(job.findings_so_far || 0);
  const totalRaw = job.total_count;
  const total = totalRaw === null || totalRaw === undefined ? null : Number(totalRaw);
  const scopeTotal = typeof total === "number" && Number.isFinite(total) && total > 0
    ? total : null;
  const page = Number(job.page || 0);

  // THE FRACTION IS PAGE-BASED, AND THAT IS THE ONLY HONEST ONE AVAILABLE.
  //
  // The obvious pair — `findings_so_far / total_count` — is wrong, and wrong in a way that
  // looks right: `findings_so_far` is cumulative across the whole sync while `total_count`
  // is only the CURRENT scope's total (scanJobs.ts's step()). So the ratio is correct while
  // sca is in flight and then climbs past 100% on sast and secrets, which is worse than no
  // bar at all. `page` and `page_size` are both reset on every scope advance, so they are
  // genuinely per-scope, and pages-fetched over pages-expected is a fraction of ONE register.
  //
  // It is deliberately not a fraction of the whole sync: the three registers differ by two
  // orders of magnitude (sca ~18,800 rows, sast 127), so weighting them equally would stall
  // at a third for minutes and then jump, and weighting them by size needs totals the job
  // does not know until it asks. A per-register bar plus the scope stepper says where the
  // walk is without pretending to know how long the rest takes.
  const pageSize = Number(job.page_size || 0);
  const scopePct =
    state === "running" && phase === "FETCHING" && scopeTotal !== null && pageSize > 0
      ? Math.max(0, Math.min(99, Math.round((page * pageSize * 100) / scopeTotal)))
      : null;
  const pct = state === "done" ? 100 : scopePct;

  const startedMs = parseMs(job.started_at);
  const updatedMs = parseMs(job.updated_at);
  const stalled =
    state === "running" && phase === "FETCHING" &&
    updatedMs !== null && nowMs - updatedMs > STALL_MS;
  const stuck =
    state === "running" && updatedMs !== null && nowMs - updatedMs > STUCK_MS;

  let phaseLabel = phase === "FETCHING"
    ? (currentScope ? `Fetching ${SCOPE_LABEL[currentScope] || currentScope}` : "Fetching")
    : (PHASE_WORD[phase] || phase || "Working");
  if (stalled) phaseLabel = "Waiting for next step…";

  const countsParts = [];
  if (findings > 0 || state !== "running") countsParts.push(`${findings.toLocaleString()} rows`);
  if (state === "running" && phase === "FETCHING" && scopeTotal) {
    countsParts.push(`~${scopeTotal.toLocaleString()} in ${SCOPE_LABEL[currentScope] || currentScope}`);
  }
  if (state === "running" && phase === "FETCHING" && page > 0) countsParts.push(`page ${page}`);
  const countsText = countsParts.join(" · ");

  return {
    phase,
    phaseLabel,
    state,
    scopeSequence,
    findingsSoFar: findings,
    scopeTotal,
    countsText,
    elapsedText: fmtElapsed(startedMs === null ? null : nowMs - startedMs),
    pct,
    scopePct,
    stalled,
    stuck,
    // Cancellation is only cooperative during FETCHING (scanJobs.ts's `isCancelRequested`
    // check lives inside the fetch page loop and nowhere else) — past it the run finishes in
    // seconds rather than being interruptible.
    canStop: state === "running" && phase === "FETCHING",
    error: cleanError(job.error),
  };
}

/** The scope-walk row: SCA → SAST → Secrets, each marked done / active / queued. Shared by
 *  the compact card and the details drawer so the two surfaces never say different things
 *  about which register is in flight. Colour never carries this alone — every chip pairs its
 *  tint with a glyph (✓ / ● / ○) AND a word in its accessible name. */
function scopeStepsRow(v) {
  const row = el("div", { class: "scan-steps", role: "list", "aria-label": "Registers" });
  for (const s of v.scopeSequence) {
    const glyph = s.status === "done" ? "✓" : s.status === "active" ? "●" : "○";
    const word = s.status === "done" ? "done" : s.status === "active" ? "in progress" : "queued";
    row.append(
      el("div", { class: `scan-step ${s.status}`, role: "listitem",
        "aria-label": `${s.label} — ${word}`,
        "aria-current": s.status === "active" ? "step" : null },
        el("span", { class: "scan-step-dot", "aria-hidden": "true" }, glyph),
        el("span", { "aria-hidden": "true" }, s.label)),
    );
  }
  return row;
}

/**
 * Compact card for the sync zone. `onStop`/`onDetails` are click handlers.
 *
 * A polite live region, so assistive tech hears phase transitions, completion and failure —
 * but only the phase line is announced (the volatile elapsed/scope-walk/bar/counts are
 * aria-hidden and updated in place) so a 3s poll doesn't chatter. A stuck run (no progress for
 * minutes) is surfaced here, on the always-visible card, not only inside the details drawer.
 */
export function renderSyncCard(host, job, { onStop, onDetails, nowMs, stopping } = {}) {
  const v = syncViewModel(job, nowMs || Date.now());
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
      // .sidebar.collapsed / the >800px rail). A real button so the details drawer — and Stop
      // through it — stays reachable in the icon-only rail; the ring + centered glyph mirror
      // phase/state for a glanceable "still working / done / failed" where the full card
      // can't fit.
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

  const phaseText = stopping ? "Stopping…" : v.stuck ? "Sync may have stopped" : v.phaseLabel;
  if (phaseEl.textContent !== phaseText) phaseEl.textContent = phaseText; // announce real transitions only

  elapsedEl.textContent = v.elapsedText || "";
  elapsedEl.style.display = v.elapsedText ? "" : "none";

  // The scope walk lives in the same slot as the bar (and inherits its collapsed-rail /
  // stacked-nav visibility rules for free — see styles/base.css's `.scan-progress-bar-slot`):
  // which register is in flight is exactly the kind of thing that has no business being
  // visible only when the sidebar happens to be wide.
  clear(barSlot).append(scopeStepsRow(v), progressBar(v.pct, v.state === "running" ? "" : v.state));

  // Collapsed-rail mini indicator: an indeterminate spin while running (this register never
  // claims a percent it cannot back — see syncViewModel's header comment), a terminal glyph
  // once the run settles. The card's state class (.running/.done/.failed/.stuck) tints the
  // ring in CSS; here we only feed the centered glyph and keep the button pointed at Details.
  const miniBtn = host.querySelector(".scan-progress-mini");
  const miniSpinner = miniBtn.querySelector(".scan-spinner");
  const miniPct = miniBtn.querySelector(".scan-progress-mini-pct");
  miniSpinner.classList.remove("is-determinate");
  miniSpinner.style.removeProperty("--scan-pct");
  const MINI_GLYPH = { done: "✓", failed: "✕", cancelled: "–" };
  miniPct.textContent = stopping ? "…" : v.stuck ? "!" : (MINI_GLYPH[v.state] || "");
  // The rail is too narrow for the phase words, so they live on the card and on the
  // accessible name of the button instead — hover or focus surfaces the same status the card
  // shows. In the collapsed rail this is the only status readout there is, which is exactly
  // why it can no longer be a native title: a tap on a phone reached none of it.
  const summary = [phaseText, v.countsText].filter(Boolean).join(" · ");
  miniBtn.setAttribute("aria-label", summary || "Sync progress");
  tipAnchor(miniBtn, summary || null);
  miniBtn.onclick = onDetails || null;
  miniBtn.disabled = !onDetails;

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
      // Past FETCHING the run can't be cancelled — explain rather than silently drop Stop. A
      // disabled control cannot be hovered in every browser, so the tip hangs off a wrapper:
      // the reason Stop went away has to survive the button being unable to take the pointer.
      actionsEl.append(tipAnchor(el("span", { class: "tip-disabled-wrap" },
        el("button", {
          class: "linklike", disabled: true,
          "aria-label": "Stop unavailable past the fetch step",
        }, "Stop")), "This step can't be interrupted — let it finish."));
    }
  }

  return v;
}

/**
 * Detailed drawer: the scope walk + counts/elapsed (+ error).
 *
 * Returns `{ close, update }`. The poller feeds fresh job summaries through `update(job)` so
 * the open panel tracks the sync live — rows, scope, elapsed and phase all advance without the
 * user having to close and reopen it. Without this the body is a one-shot snapshot.
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
    // running sync's timer keeps ticking on every poll tick — not just when the panel opens.
    const v = syncViewModel(currentJob, Date.now());
    clear(bodyEl);

    const actions = el("div", { class: "sheet-actions", style: "margin-top:16px" });
    // v.canStop is recomputed each paint, so the Stop button retires once FETCHING ends.
    if (v.canStop && onStop) {
      actions.append(el("button", { class: "danger", onclick: () => { onStop(); closeFn(); } },
        "Stop sync"));
    } else if (v.state === "running" && onStop) {
      actions.append(tipAnchor(el("span", { class: "tip-disabled-wrap" },
        el("button", { class: "danger", disabled: true,
          "aria-label": "Stop unavailable past the fetch step" }, "Stop sync")),
        "This step can't be interrupted — let it finish."));
    }
    actions.append(el("button", { class: "primary", onclick: closeFn }, "Close"));

    // Note: native Node.append() stringifies null into a literal "null" text node
    // (unlike el(), which drops it) — so conditional children are filtered out here.
    const children = [
      scopeStepsRow(v),
      progressBar(v.pct, v.state === "running" ? "" : v.state),
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
        el("dd", {}, `${v.findingsSoFar.toLocaleString()}` +
          (v.scopeTotal ? ` (~${v.scopeTotal.toLocaleString()} in the current register)` : "")),
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
    { title: "Sync progress", subtitle: "SCA, SAST & secrets", ariaLabel: "Sync progress" },
  );

  return {
    close: handle.close,
    update(nextJob) {
      currentJob = nextJob;
      paint();
    },
  };
}
