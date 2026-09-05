// What the app says when it is loading, empty, broken, or asking.
//
// The help tip that used to live here is now ui/tip.js: it outgrew this file the moment it
// stopped being a bubble parked inside its trigger.

import { appConfig } from "../appConfig.js";
import { el } from "./dom.js";
import { relativeAge } from "./figures.js";
import { fmtDateTime } from "./format.js";

export function toast(message, kind) {
  let host = document.getElementById("toasts");
  if (!host) {
    host = el("div", { id: "toasts" });
    document.body.append(host);
  }
  const t = el("div", { class: `toast ${kind || ""}`, role: "status" }, message);
  host.append(t);
  setTimeout(() => t.remove(), 6000);
}

/** Modal confirm dialog; resolves true/false. */
export function confirmDialog({ title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const dlg = el(
      "dialog",
      {},
      el("h3", {}, title),
      typeof body === "string" ? el("p", { class: "muted" }, body) : body,
      el(
        "div",
        { class: "dialog-actions" },
        el("button", { onclick: () => done(false) }, "Cancel"),
        el(
          "button",
          { class: danger ? "danger" : "primary", onclick: () => done(true) },
          confirmLabel,
        ),
      ),
    );
    function done(v) {
      dlg.close();
      dlg.remove();
      resolve(v);
    }
    dlg.addEventListener("cancel", () => done(false));
    document.body.append(dlg);
    dlg.showModal();
  });
}

/**
 * Failure, not emptiness: announced, retryable in place, and the raw exception demoted
 * into a disclosure instead of printed at the reader as body copy.
 */
export function errorState(message, o) {
  const p = o || {};
  return el(
    "div",
    { class: "empty empty--error", role: "alert" },
    el("div", {}, message),
    p.onRetry
      ? el("div", { class: "empty-actions" },
          el("button", { class: "primary", onclick: p.onRetry }, "Try again"))
      : null,
    p.detail
      ? el("details", { class: "empty-detail" },
          el("summary", {}, "Technical details"),
          el("div", { class: "small" }, String(p.detail)))
      : null,
  );
}

/**
 * Loading placeholder block: a calm opacity pulse (no shimmer sweep — DESIGN.md forbids the
 * SaaS tell), aria-hidden so screen readers hear the page's role=status label instead. Variants
 * (line/title/stat/pill/chart) set default height/radius; width/height/radius override inline.
 * Reduced motion drops the pulse for a static hairline block (in styles.css).
 */
export function skeleton(variant = "", { width, height, radius } = {}) {
  const node = el("div", {
    class: `skeleton${variant ? " skeleton--" + variant : ""}`,
    "aria-hidden": "true",
  });
  if (width) node.style.width = width;
  if (height) node.style.height = height;
  if (radius) node.style.borderRadius = radius;
  return node;
}

/**
 * A column of placeholder lines — the `flex-column + N skeleton lines` idiom that every
 * page's loading stub had written out inline, with its own gap and its own array literal.
 *
 * `widths` cycles, so a stack can look like text rather than like a stack of identical
 * bars. Each page keeps its own SHAPE (the stub IS the layout, and a stub that predicts
 * the wrong page makes the real content jump); only this repetition is shared.
 */
export function skeletonStack(count, { gap = "12px", height, widths, variant = "line" } = {}) {
  const stack = el("div", { class: "skeleton-stack" });
  stack.style.gap = gap;
  for (let i = 0; i < count; i++) {
    stack.append(skeleton(variant, {
      height,
      width: widths ? widths[i % widths.length] : undefined,
    }));
  }
  return stack;
}

/**
 * Absence, announced — and never a stand-in for failure.
 *
 * THIS IS NOT `errorState`. A render that THREW is a defect the reader can report and often
 * retry; an empty section is a state the register is legitimately in. They were the same
 * component here until the first-run pass, which is how five pages came to print "Couldn't
 * render the half-life." inside a `role="status"` box a screen reader announces as calm news.
 *
 * THE THIRD ARGUMENT IS THE FIRST-RUN CASE, and it exists rather than a fourth component
 * because "nothing here yet" and "nothing here yet, and here is what would put something
 * here" are the same claim with the second half filled in. `items` is a list of
 * `{figure, unlock, route, routeLabel}`: WHAT is missing, WHAT would unlock it, and WHERE the
 * action lives. `route` is a hash route (`"#/settings"`); a null route means the control is
 * not a page — it is the Run sync button in the rail — and `routeLabel` then renders as text
 * rather than as a link that would go nowhere.
 *
 * Both older call shapes still work: `emptyState(msg)` and `emptyState(msg, hint)`.
 */
export function emptyState(message, hint, opts) {
  const o = opts || {};
  const items = Array.isArray(o.items) ? o.items : [];
  const node = el(
    "div",
    { class: "empty" + (o.variant ? " empty--" + o.variant : ""), role: "status" },
    el("div", {}, message),
    hint ? el("div", { class: "small", style: "margin-top:6px" }, hint) : null,
  );
  if (items.length) {
    node.append(el("ul", { class: "empty-items" }, ...items.map((it) => el(
      "li",
      { class: "empty-item" },
      el("span", { class: "empty-item-figure" }, String(it.figure)),
      el("span", { class: "empty-item-unlock small" }, String(it.unlock)),
      it.route
        ? el("a", { class: "linklike empty-item-action", href: it.route },
            String(it.routeLabel || "Open settings"))
        : el("span", { class: "empty-item-action small muted" },
            String(it.routeLabel || "No control — it unlocks itself")),
    ))));
  }
  return node;
}

/**
 * The one line every page owes a reader whose ledger has never been read.
 *
 * WHY THIS IS ONE SENTENCE AND NOT A PANEL. Executive earns the full unlock list because it
 * is the page a leader is allowed to read alone. Every other page is already one click deep
 * and its own sections say what they are missing; what those pages owed a reader was the
 * ORIGIN — a page of dashes with no line saying "nothing has been read yet" leaves the reader
 * to decide between a broken app and an empty one.
 *
 * `synced` distinguishes two genuinely different states. No sync at all is a first run. A
 * sync that ran and saved nothing is a MEASUREMENT — the tenant answered and had nothing to
 * report — and saying "no sync has run yet" there would be false.
 *
 * THE NOUN IS THE MANIFEST'S, AND THAT IS NOT A STYLE POINT. This sentence was hard-coded
 * to "sync", which is what two of the three registers call the thing that fills them. gas
 * does not: its endpoint is `api_runScan`, its bootstrap field is `latestScan`, and the
 * button in its rail says "Run scan". A shared notice telling a gas reader that "no sync has
 * run yet" names a control that app does not have — the reader is being sent to look for
 * something that is not there, which is worse than the generic wording it replaced.
 * `sync.noun` is the manifest field `appConfig.js` already reserved; the two registers that
 * say "sync" get it by default and gas declares "scan".
 *
 * READ INSIDE THE FUNCTION, never at module top level — appConfig.js's rule 2. A top-level
 * read runs during import, which under esbuild happens before `app.js`'s own body, and would
 * throw on a correctly-wired app.
 *
 * `unit` is the same argument for the thing being counted: gas measures findings on a host,
 * gas_ai assets in a graph. Defaulted, so no existing caller changes.
 */
export function firstRunNotice({ synced, hint }) {
  const sync = appConfig().sync || {};
  const noun = sync.noun || "sync";
  const unit = sync.unit || "findings";
  return emptyState(
    synced
      ? `The last ${noun} saved no ${unit}, so there is nothing here to measure yet.`
      : `No ${noun} has run yet, so nothing on this page has been measured.`,
    hint,
    { variant: "notice" },
  );
}

/**
 * The sync-zone freshness line, unified across all three apps: `Last <noun> <datetime> ·
 * <relativeAge>` once something has been saved, `No <noun>s yet.` before the first one.
 *
 * P8 replaces three shapes of this sentence that had drifted: gas's rail said "Last scan
 * <datetime>" and appended " — N days ago" only once N reached 2, so a scan an hour old
 * showed no age at all; gas_ai's rail had the same day-only gate under a different em dash;
 * gas_devsecops's rail showed the datetime with no relative age at all. One call, one
 * separator ("·", not "—", so it reads as one fact in two parts rather than a correction),
 * and `relativeAge` (this module's sibling) supplies the full just-now/min/hour/day
 * granularity gas's OWN Scan History page already had, so nothing lost precision to gain
 * consistency.
 *
 * THE NOUN IS THE MANIFEST'S, for the same reason `firstRunNotice`'s is, two functions up:
 * this app's front door may be a scan rather than a sync, and the caption sits right beside
 * the Run button that says so. `sync.noun` is read here rather than threaded through as a
 * parameter, because every call site already reads it (directly or via `firstRunNotice`) and
 * a second spelling of the same manifest lookup is exactly the drift this function exists to
 * end.
 *
 * TAKES THE PLAIN TIMESTAMP, not the record it came from. The three apps disagree on the
 * field name (`latestSync.finished_at` in one, `latestSync.ts` / `latestScan.ts` in the other
 * two) — a disagreement CLAUDE.md's DevSecOps section calls out by name for a different pair
 * of fields ("the same field name carries different kinds"). Keeping that extraction in each
 * app's own `railFooter` and handing this function one value means the shared half never has
 * to learn a fourth shape, and a future field rename stays a one-line change in the app that
 * made it.
 *
 * READ INSIDE THE FUNCTION, never at module top level — appConfig.js's rule 2.
 */
export function syncCaption(ts) {
  const noun = (appConfig().sync || {}).noun || "sync";
  if (!ts) return `No ${noun}s yet.`;
  return `Last ${noun} ${fmtDateTime(ts)} · ${relativeAge(ts)}`;
}
