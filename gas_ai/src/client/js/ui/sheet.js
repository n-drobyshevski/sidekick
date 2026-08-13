// The drill-down sheet: a right-anchored modal overlay with a focus trap, plus the
// section/row vocabulary its bodies are written in.

import { parseHash } from "../store.js";
import { clear, el, motionOk } from "./dom.js";
import { portalsOpen } from "./portals.js";

let sheetSeq = 0;
/** The one mounted sheet. Opening a second one swaps it — sheets never stack. */
let activeSheet = null;
let routeHookInstalled = false;

/** Matches the .sheet transform transition in styles.css. */
const SHEET_EXIT_MS = 220;

/**
 * Close whatever sheet is mounted, if any. A page calls this as it remounts: the filters
 * drawer is deliberately NOT closeOnRouteChange (it rewrites its own query params on every
 * toggle and would close itself), so a genuine navigation that re-renders the same route
 * would otherwise leave the old drawer on screen, still wired to the previous render's
 * state. Focus is not restored — the page that owned it is already gone.
 */
export function closeActiveSheet() {
  if (activeSheet) activeSheet.close({ immediate: true, restoreFocus: false });
}

const FOCUSABLE_SEL = [
  "a[href]", "button", "input", "select", "textarea", "summary",
  '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Tabbable descendants, in DOM order — disabled and non-rendered nodes excluded. */
function focusablesIn(root) {
  return Array.prototype.filter.call(
    root.querySelectorAll(FOCUSABLE_SEL),
    (n) => !n.disabled && n.getClientRects().length,
  );
}

const SHEET_WIDE_KEY = "sidekickai.sheetWide";

function wantsWide() {
  try {
    return localStorage.getItem(SHEET_WIDE_KEY) === "1";
  } catch (e) {
    return false; // storage denied (private mode / embedded iframe) — just don't remember
  }
}

function rememberWide(on) {
  try {
    localStorage.setItem(SHEET_WIDE_KEY, on ? "1" : "0");
  } catch (e) { /* storage denied — the toggle still works for this session */ }
}

// Inline SVGs rather than glyphs: "✕" at 15px is a ~23px target, under the WCAG 2.5.8
// minimum, and the rest of the app draws its icons as paths.
const I_SHEET_CLOSE =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">' +
  '<path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round"/></svg>';
const I_SHEET_WIDEN =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">' +
  '<path d="M6.5 3 L2.5 8 L6.5 13 M9.5 3 L13.5 8 L9.5 13" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Right-anchored sheet (the signature drill-down overlay) — a three-zone shell: a pinned
 * header carrying the record's identity, a scrolling body, and a footer that is created
 * only if a consumer asks for one (`ctx.footer()`), so the drawers that append their own
 * actions into the body keep emitting exactly the DOM they always did.
 *
 * `renderBody(body, close, ctx)`; the returned handle IS `ctx`, so `{ close }` still
 * destructures. ctx: { sheet, header, body, close, footer(), setHeading(), setBusy(),
 * announce() }.
 *
 * opts: title, subtitle, sev (severity accent), ariaLabel (fallback when there is no
 * title), width (a CSS length for --sheet-w), autoFocus (false = don't steal focus, e.g.
 * a deep-linked drawer), expandable (offer the widen toggle), closeOnRouteChange,
 * backTo ({ label, onBack }), onClose (fires once, after teardown, however it closed).
 */
export function openSheet(renderBody, opts = {}) {
  const {
    title = "", subtitle = "", sev = "", ariaLabel = title || "Detail",
    width = "", autoFocus = true, onClose = null,
    expandable = false, closeOnRouteChange = false, backTo = null,
  } = opts;

  // Captured before the swap below: tearing the incumbent down moves focus to <body>,
  // and <body> is not somewhere to send a keyboard user back to.
  const prevFocus = document.activeElement;

  // Swap, never stack: tear the incumbent down with no exit transition and no focus
  // restore, so the incoming sheet keeps focus and the background stays inert throughout.
  if (activeSheet) activeSheet.close({ immediate: true, restoreFocus: false });

  const titleId = "sheet-title-" + ++sheetSeq;
  const scrim = el("div", { class: "sheet-scrim" });
  const sheet = el("aside", {
    class: "sheet" + (expandable && wantsWide() ? " sheet--wide" : ""),
    role: "dialog",
    "aria-modal": "true",
    tabindex: "-1",
  });
  // Label by the visible title where there is one: the accessible name is then the record's
  // own name, not a constant like "Asset detail" shared by every asset in the estate.
  if (title) sheet.setAttribute("aria-labelledby", titleId);
  else sheet.setAttribute("aria-label", ariaLabel);
  if (width) sheet.style.setProperty("--sheet-w", width);
  if (sev) sheet.dataset.sev = String(sev).toUpperCase();

  const appRoot = document.getElementById("app");
  const routeAtOpen = parseHash().route;
  let closed = false;
  let footerEl = null;

  const bodyEl = el("div", { class: "sheet-body" });

  function restoreFocus() {
    // After "Open in graph" the invoking row is gone with the page that held it; landing on
    // <body> would drop a keyboard user at nowhere, so fall back to the new page's main.
    const usable = prevFocus && prevFocus !== document.body && prevFocus.focus &&
      document.contains(prevFocus);
    // Walking a chain of sheets leaves the original invoker detached; land on the page's
    // main region rather than at the top of the document with nothing announced.
    const target = usable ? prevFocus : (document.getElementById("main") ||
      document.querySelector("h1"));
    if (!target || !target.focus) return;
    if (!usable && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    // The target sat inside the inert subtree until a moment ago, and inertness is not
    // lifted synchronously — focusing in the same tick silently no-ops onto <body>.
    requestAnimationFrame(() => {
      if (!activeSheet) target.focus();
    });
  }

  function close(o) {
    if (closed) return;
    closed = true;
    const immediate = !!(o && o.immediate) || !motionOk();
    const restore = !(o && o.restoreFocus === false);
    if (activeSheet && activeSheet.sheet === sheet) activeSheet = null;
    scrim.classList.remove("open");
    sheet.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    bodyEl.removeEventListener("scroll", onScroll);
    const finish = () => {
      scrim.remove();
      sheet.remove();
      // A swap already mounted its replacement: it owns the lock and the focus now.
      if (!activeSheet) {
        if (appRoot) appRoot.removeAttribute("inert");
        document.documentElement.classList.remove("sheet-open");
        if (restore) restoreFocus();
      }
      if (onClose) onClose();
    };
    if (immediate) finish();
    else setTimeout(finish, SHEET_EXIT_MS);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // A combobox inside the sheet portals its listbox to <body>, deliberately — the sheet
    // body scrolls and would clip an in-flow popover. While one is open its rows are
    // legitimately outside this subtree, so the trap has to stand down: the branch below
    // that pulls stray focus back in would otherwise yank Tab out of the list being
    // navigated. The popover runs its own Escape and outside-click dismissal.
    if (portalsOpen()) return;
    const items = focusablesIn(sheet);
    if (!items.length) {
      // An error or empty body has nothing to tab to; park on the sheet rather than
      // handing the page behind an open modal to the keyboard.
      e.preventDefault();
      sheet.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    // Focus opens on the (untabbable) title and can be knocked outside entirely; both
    // cases must land back inside instead of falling through to the scrim.
    if (!sheet.contains(at) || at === sheet || at === titleEl) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onScroll() {
    // A hairline, not a drop shadow: DESIGN.md's Whisper-Or-Lift rule reserves real
    // elevation for the overlay itself and forbids mid-weight shadows on its content.
    sheet.classList.toggle("is-scrolled", bodyEl.scrollTop > 2);
  }

  const titleEl = el("h2", { class: "sheet-title", id: titleId, tabindex: "-1" }, title);
  const subEl = el("div", { class: "sheet-subtitle muted small" }, subtitle);
  const chipsEl = el("div", { class: "sheet-chips" });
  const liveEl = el("div", { class: "sr-only", role: "status", "aria-live": "polite" });

  const headActions = el("div", { class: "sheet-headactions" });
  if (expandable) {
    headActions.append(el("button", {
      class: "sheet-widen",
      "aria-pressed": wantsWide() ? "true" : "false",
      "aria-label": wantsWide() ? "Narrow the sheet" : "Widen the sheet",
      html: I_SHEET_WIDEN,
      onclick: (e) => {
        const on = !sheet.classList.contains("sheet--wide");
        sheet.classList.toggle("sheet--wide", on);
        e.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
        e.currentTarget.setAttribute("aria-label", on ? "Narrow the sheet" : "Widen the sheet");
        rememberWide(on);
      },
    }));
  }
  headActions.append(el("button", {
    class: "sheet-close", "aria-label": "Close", html: I_SHEET_CLOSE,
    onclick: () => close(),
  }));

  const header = el("header", { class: "sheet-header" },
    backTo
      ? el("button", { class: "sheet-back linklike", onclick: () => {
          close({ immediate: true, restoreFocus: false });
          backTo.onBack();
        } }, el("span", { "aria-hidden": "true" }, "‹ "), "Back to " + backTo.label)
      : null,
    el("div", { class: "sheet-headrow" },
      el("div", { class: "sheet-heading" }, titleEl, subtitle ? subEl : null),
      headActions),
    chipsEl,
    liveEl);
  if (title) sheet.append(header);
  sheet.append(bodyEl);

  const ctx = {
    sheet, header, body: bodyEl, close,
    /** Created on first use, so untouched consumers keep today's DOM exactly. */
    footer() {
      if (!footerEl) {
        footerEl = el("div", { class: "sheet-footer" });
        sheet.append(footerEl);
      }
      return footerEl;
    },
    /** Refine the header once the RPC lands — the record's real name, not a placeholder. */
    setHeading(o) {
      const p = o || {};
      if (p.title !== undefined) titleEl.textContent = p.title;
      if (p.subtitle !== undefined) {
        subEl.textContent = p.subtitle;
        if (p.subtitle && !subEl.isConnected) titleEl.after(subEl);
      }
      if (p.sev !== undefined) {
        if (p.sev) sheet.dataset.sev = String(p.sev).toUpperCase();
        else delete sheet.dataset.sev;
      }
      if (p.chips) clear(chipsEl).append(...p.chips.filter(Boolean));
    },
    setBusy(on) {
      if (on) bodyEl.setAttribute("aria-busy", "true");
      else bodyEl.removeAttribute("aria-busy");
    },
    /** One announcement for the whole resolved record, not one per badge. */
    announce(text) {
      liveEl.textContent = text;
    },
  };

  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", onKey);
  bodyEl.addEventListener("scroll", onScroll, { passive: true });
  if (!routeHookInstalled) {
    routeHookInstalled = true;
    // Route NAME only: the graph's filters drawer rewrites its own query params on every
    // keystroke and must not close itself.
    window.addEventListener("hashchange", () => {
      if (activeSheet && activeSheet.closeOnRouteChange &&
          parseHash().route !== activeSheet.routeAtOpen) {
        activeSheet.close();
      }
    });
  }

  document.body.append(scrim, sheet);
  // aria-modal only informs assistive tech; inert is what stops a sighted keyboard user
  // tabbing into the page behind the scrim.
  if (appRoot) appRoot.setAttribute("inert", "");
  document.documentElement.classList.add("sheet-open");
  activeSheet = { sheet, close, closeOnRouteChange, routeAtOpen };

  renderBody(bodyEl, close, ctx);

  requestAnimationFrame(() => {
    scrim.classList.add("open");
    sheet.classList.add("open");
    // APG: for long content focus a static element at the top, not the first control,
    // so the body doesn't scroll out from under the reader.
    if (autoFocus) (title ? titleEl : sheet).focus();
  });
  return ctx;
}

/** A section of sheet body content, opened by a real heading (not a styled span). */
export function sheetSection(label, ...children) {
  return el(
    "section",
    { class: "sheet-section" },
    label ? el("h3", { class: "label sheet-section-title" }, label) : null,
    ...children,
  );
}

/**
 * One row for the sheet's issue / finding / relationship lists. Becomes a button when
 * `onOpen` is given, so a row that leads somewhere is reachable by keyboard.
 */
export function sheetRow(o) {
  const p = o || {};
  const kids = [
    el("div", { class: "sheet-row-head" }, p.badge || null, ...(p.meta || []).filter(Boolean)),
    p.title ? el("div", { class: "sheet-row-title" }, p.title) : null,
    p.note ? el("div", { class: "sheet-row-note" }, p.note) : null,
    p.tags || null,
    p.fix
      ? el("div", { class: "sheet-fix" },
          el("span", { class: "sheet-fix-label" }, "Recommended fix"),
          el("p", { class: "sheet-fix-body" }, p.fix))
      : null,
  ];
  const cls = "sheet-row" + (p.extraClass ? " " + p.extraClass : "");
  if (!p.onOpen) return el("div", { class: cls + " sheet-row--static" }, ...kids);
  return el(
    "button",
    { class: cls, type: "button", "aria-label": p.ariaLabel || null, onclick: p.onOpen },
    ...kids,
  );
}

export function sectionLabel(text) {
  return el("h2", { class: "section-label" }, text);
}
