// The drill-down sheet: a right-anchored modal overlay with a focus trap, plus the
// section/row vocabulary its bodies are written in.

import { clampSheetWidth, recordCursor } from "../recordSections.js";
import { parseHash } from "../store.js";
import { clear, el, motionOk } from "./dom.js";
import { portalsOpen } from "./portals.js";
import { uiIcon } from "./uiIcons.js";

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

/**
 * A record sheet's remembered geometry, as one value rather than two competing ones: the
 * literal "wide" preset, or a pixel width the user dragged to. Storing a class AND a width
 * would let the two disagree, and an inline width silently wins over a class.
 */
const RECORD_WIDTH_KEY = "sidekickai.recordSheetWidth";

function loadRecordWidth() {
  try {
    return localStorage.getItem(RECORD_WIDTH_KEY) || "";
  } catch (e) {
    return "";
  }
}

function rememberRecordWidth(v) {
  try {
    if (v) localStorage.setItem(RECORD_WIDTH_KEY, String(v));
    else localStorage.removeItem(RECORD_WIDTH_KEY);
  } catch (e) { /* storage denied — the resize still works for this session */ }
}

/**
 * Nudge size for the resize separator's arrow keys — roughly a couple of drag-pixels of
 * intent as one discrete step. Ported with the rest of the splitter from the OS-vulns
 * build (gas/src/client/js/ui.js).
 */
const SHEET_RESIZE_STEP = 24;
/** The sheet is right-anchored: its right edge is pinned and only its width moves. */
const SHEET_MAX_VW = 96;

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
 *
 * Four further options turn this into the two-pane RECORD sheet (the asset and issue
 * registers). Every one of them is opt-in and adds DOM only when asked for, so the five
 * utility drawers that pass none of them emit exactly the markup they always did:
 *   rail        — true (or { ariaLabel }) for the section rail beside the content pane;
 *                 fill it with ctx.rail(sections, onSelect)
 *   resizable   — a draggable/arrow-keyed left edge, width persisted across opens
 *   records     — { ids, index, open(id, index), label } for the prev/next cluster
 *   headerActions — nodes for the toolbar row under the heading
 */
export function openSheet(renderBody, opts = {}) {
  const {
    title = "", subtitle = "", sev = "", ariaLabel = title || "Detail",
    width = "", autoFocus = true, onClose = null,
    expandable = false, closeOnRouteChange = false, backTo = null,
    rail = null, resizable = false, records = null, headerActions = null,
  } = opts;

  // Captured before the swap below: tearing the incumbent down moves focus to <body>,
  // and <body> is not somewhere to send a keyboard user back to.
  const prevFocus = document.activeElement;

  // Swap, never stack: tear the incumbent down with no exit transition and no focus
  // restore, so the incoming sheet keeps focus and the background stays inert throughout.
  if (activeSheet) activeSheet.close({ immediate: true, restoreFocus: false });

  const seq = ++sheetSeq;
  const titleId = "sheet-title-" + seq;
  const paneId = "sheet-pane-" + seq;
  const storedWidth = rail ? loadRecordWidth() : "";
  const scrim = el("div", { class: "sheet-scrim" });
  const sheet = el("aside", {
    class: "sheet" +
      (rail ? " sheet--record" : "") +
      ((rail ? storedWidth === "wide" : expandable && wantsWide()) ? " sheet--wide" : ""),
    role: "dialog",
    "aria-modal": "true",
    tabindex: "-1",
  });
  // Label by the visible title where there is one: the accessible name is then the record's
  // own name, not a constant like "Asset detail" shared by every asset in the landscape.
  if (title) sheet.setAttribute("aria-labelledby", titleId);
  else sheet.setAttribute("aria-label", ariaLabel);
  if (width) sheet.style.setProperty("--sheet-w", width);
  if (sev) sheet.dataset.sev = String(sev).toUpperCase();

  // Declared before applyWidth so the separator can carry a live aria-valuenow; it only
  // exists on a resizable sheet.
  let grip = null;
  // The width we last asked for, not the width the box currently paints. `width` is a
  // transitioned property, so measuring the element mid-animation returns an interpolated
  // value — five arrow presses in a row each read the same in-flight number and all
  // resolved to one step.
  let wantWidth = null;
  let railRoot = null;
  let activeSectionId = null;
  // Panes are built once and then hidden, not rebuilt: switching sections must not re-run
  // an RPC-shaped render, and focusablesIn() already skips a hidden pane's controls.
  const panes = new Map();

  // Recomputed on every clamp rather than cached: the window can be resized between the
  // open and a later drag, and a width saved on a wider viewport must not survive verbatim.
  function widthFloor() {
    const raw = parseFloat(
      getComputedStyle(sheet).getPropertyValue("--sheet-w-record-min"),
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 520;
  }
  /** Tell the separator where it sits, in the same px the range is expressed in. */
  function reportWidth(px) {
    wantWidth = px;
    if (!grip) return;
    grip.setAttribute("aria-valuenow", String(Math.round(px)));
    grip.setAttribute("aria-valuemin", String(Math.round(widthFloor())));
    grip.setAttribute("aria-valuemax",
      String(Math.round((window.innerWidth * SHEET_MAX_VW) / 100)));
  }

  function applyWidth(px, persist) {
    const clamped = clampSheetWidth(px, widthFloor(), SHEET_MAX_VW, window.innerWidth);
    // An inline width outranks the .sheet--wide rule, so the preset has to stand down or
    // the toggle's pressed state would claim a width the sheet no longer has.
    sheet.classList.remove("sheet--wide");
    sheet.style.width = clamped + "px";
    reportWidth(clamped);
    if (persist) rememberRecordWidth(clamped);
    return clamped;
  }

  /** Where the next keyboard step starts from: the asked-for width, else the painted one. */
  function currentWidth() {
    return wantWidth === null ? sheet.getBoundingClientRect().width : wantWidth;
  }

  const appRoot = document.getElementById("app");
  const routeAtOpen = parseHash().route;
  let closed = false;
  let footerEl = null;
  // Undo work a body started that outlives its DOM — a ResizeObserver, a timer. The page
  // teardown hook in ui/timing.js only runs on a route change, and a sheet closes without
  // one, so anything registered there would keep firing at a detached node until the next
  // navigation.
  const disposers = [];

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
      for (const fn of disposers.splice(0)) {
        try {
          fn();
        } catch (e) {
          // One failed cleanup must not strand the others, or the focus restore below it.
          console.warn("sheet dispose failed:", e);
        }
      }
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
    // Alt+Up/Down walks the result set the sheet was opened from. Alt-modified so it can't
    // collide with the rail's own arrow keys or with scrolling the pane.
    if (records && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      stepRecord(e.key === "ArrowUp" ? -1 : 1);
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

  let renderPane = null;

  function railTabs() {
    return railRoot ? Array.prototype.slice.call(railRoot.querySelectorAll(".sheet-rail-item")) : [];
  }

  function selectSection(id) {
    if (!railRoot || id === activeSectionId) return;
    const tabs = railTabs();
    const tab = tabs.find((t) => t.dataset.sectionId === id);
    if (!tab) return;
    activeSectionId = id;
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      // Roving tabindex: the rail is one tab stop, arrows move within it.
      t.setAttribute("tabindex", on ? "0" : "-1");
      t.classList.toggle("is-active", on);
    });
    let pane = panes.get(id);
    if (!pane) {
      pane = el("div", { class: "sheet-pane" });
      panes.set(id, pane);
      bodyEl.append(pane);
      if (renderPane) renderPane(id, pane);
    }
    panes.forEach((p, key) => { p.hidden = key !== id; });
    bodyEl.setAttribute("aria-labelledby", tab.id);
    // A new section starts at its own top; carrying the previous pane's offset lands the
    // reader mid-content with no idea what they skipped.
    bodyEl.scrollTop = 0;
    onScroll();
  }

  function onRailKey(e, tabs) {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (keys.indexOf(e.key) === -1) return;
    e.preventDefault();
    const at = tabs.indexOf(document.activeElement);
    let next = at;
    if (e.key === "ArrowDown") next = (at + 1) % tabs.length;
    else if (e.key === "ArrowUp") next = (at - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else next = tabs.length - 1;
    const target = tabs[next];
    if (!target) return;
    target.focus();
    // Automatic activation: the panes are already built or cheap to build, so following
    // focus costs nothing and saves a keystroke (APG's default for exactly that case).
    selectSection(target.dataset.sectionId);
  }

  const titleEl = el("h2", { class: "sheet-title", id: titleId, tabindex: "-1" }, title);
  const subEl = el("div", { class: "sheet-subtitle muted small" }, subtitle);
  const chipsEl = el("div", { class: "sheet-chips" });
  const iconEl = el("div", { class: "sheet-icon", "aria-hidden": "true" });
  const toolbarEl = el("div", { class: "sheet-toolbar" });
  const liveEl = el("div", { class: "sr-only", role: "status", "aria-live": "polite" });

  const headActions = el("div", { class: "sheet-headactions" });
  if (expandable) {
    // On a record sheet the preset shares its state with the drag handle: pressing it
    // clears any dragged width so the token-driven wide rule applies again, and dragging
    // clears the class (see applyWidth). One geometry, two ways to reach it.
    const widenPressed = () => sheet.classList.contains("sheet--wide");
    headActions.append(el("button", {
      class: "sheet-widen",
      "aria-pressed": widenPressed() ? "true" : "false",
      "aria-label": widenPressed() ? "Narrow the sheet" : "Widen the sheet",
      onclick: (e) => {
        const on = !widenPressed();
        sheet.style.width = "";
        sheet.classList.toggle("sheet--wide", on);
        e.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
        e.currentTarget.setAttribute("aria-label", on ? "Narrow the sheet" : "Widen the sheet");
        if (rail) rememberRecordWidth(on ? "wide" : "");
        else rememberWide(on);
        // The preset hands the width back to the stylesheet, so what the separator reports
        // has to be re-measured — and only once the 160ms width ease has landed on it.
        wantWidth = null;
        if (grip) setTimeout(() => reportWidth(sheet.getBoundingClientRect().width), 220);
      },
    }, uiIcon("widen", 15)));
  }
  // A record sheet moves Close out to the scrim cluster beside prev/next, where the
  // reference puts it; every other sheet keeps it in the header.
  if (!records) {
    headActions.append(el("button", {
      class: "sheet-close", "aria-label": "Close",
      onclick: () => close(),
    }, uiIcon("close", 15)));
  }

  if (headerActions) toolbarEl.append(...[].concat(headerActions).filter(Boolean));

  const header = el("header", { class: "sheet-header" },
    backTo
      ? el("button", { class: "sheet-back linklike", onclick: () => {
          close({ immediate: true, restoreFocus: false });
          backTo.onBack();
        } }, el("span", { "aria-hidden": "true" }, "‹ "), "Back to " + backTo.label)
      : null,
    el("div", { class: "sheet-headrow" },
      rail ? iconEl : null,
      el("div", { class: "sheet-heading" }, titleEl, subtitle ? subEl : null),
      headActions),
    rail ? toolbarEl : null,
    chipsEl,
    liveEl);

  // --------------------------------------------------------- record-sheet chrome
  // The cluster LOOKS like it floats on the scrim, and that is the whole point of the
  // reference's layout — but it is a child of the dialog, positioned outside its left
  // edge. Anything genuinely outside `aside.sheet` would fall out of the focus trap and
  // out of aria-modal's subtree, and Close would become unreachable to a screen reader.
  let cluster = null;
  let posEl = null;
  function stepRecord(delta) {
    if (!records) return;
    const cur = recordCursor(records.ids, records.index);
    const id = delta < 0 ? cur.prevId : cur.nextId;
    if (id === null || id === undefined) return;
    records.open(id, records.index + delta);
  }
  if (records) {
    const cur = recordCursor(records.ids, records.index);
    const noun = records.label || "record";
    posEl = el("div", { class: "sheet-cluster-pos", "aria-hidden": "true" },
      cur.total ? cur.position + "/" + cur.total : "");
    cluster = el("div", { class: "sheet-cluster" },
      el("button", {
        class: "sheet-cluster-btn sheet-cluster-close", "aria-label": "Close",
        onclick: () => close(),
      }, uiIcon("close", 16)),
      el("button", {
        class: "sheet-cluster-btn",
        "aria-label": "Previous " + noun,
        disabled: cur.prevId === null ? true : null,
        onclick: () => stepRecord(-1),
      }, uiIcon("chevron-up", 16)),
      el("button", {
        class: "sheet-cluster-btn",
        "aria-label": "Next " + noun,
        disabled: cur.nextId === null ? true : null,
        onclick: () => stepRecord(1),
      }, uiIcon("chevron-down", 16)),
      posEl);
    sheet.append(cluster);
  }

  if (resizable) {
    // The Window Splitter pattern: a focusable separator that reports where it sits, so a
    // keyboard user can resize without a pointer. aria-valuenow is in px against a px
    // range — the pane it controls is measured that way.
    grip = el("div", {
      class: "sheet-grip",
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "Resize the sheet",
      "aria-controls": paneId,
      tabindex: "0",
    }, uiIcon("grip", 16));
    let dragging = false;
    grip.addEventListener("pointerdown", (e) => {
      dragging = true;
      grip.setPointerCapture(e.pointerId);
      // The width transition is there for the widen preset's one jump; under the pointer it
      // would make the edge lag behind the hand.
      sheet.classList.add("is-resizing");
      // Without this a fast drag selects the page text behind the handle like a click-drag.
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      // Width is the distance from the pointer to the viewport's right edge, recomputed
      // fresh each move rather than as a delta, so the edge can never drift off the pointer.
      if (dragging) applyWidth(window.innerWidth - e.clientX, false);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove("is-resizing");
      document.body.style.userSelect = "";
      applyWidth(window.innerWidth - e.clientX, true);
    };
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);
    grip.addEventListener("keydown", (e) => {
      const w = currentWidth();
      // ArrowLeft widens (it matches dragging the left edge further left); Home/End go to
      // the extremes, as the pattern specifies.
      if (e.key === "ArrowLeft") applyWidth(w + SHEET_RESIZE_STEP, true);
      else if (e.key === "ArrowRight") applyWidth(w - SHEET_RESIZE_STEP, true);
      else if (e.key === "End") applyWidth(window.innerWidth, true);
      else if (e.key === "Home") applyWidth(0, true);
      else return;
      e.preventDefault();
    });
    sheet.append(grip);
  }

  if (title) sheet.append(header);
  if (rail) {
    const railEl = el("nav", {
      class: "sheet-rail",
      role: "tablist",
      "aria-orientation": "vertical",
      "aria-label": (rail && rail.ariaLabel) || "Record sections",
    });
    bodyEl.setAttribute("role", "tabpanel");
    bodyEl.setAttribute("id", paneId);
    // The pane scrolls, so it must be reachable by keyboard even when it holds no control.
    bodyEl.setAttribute("tabindex", "0");
    sheet.append(el("div", { class: "sheet-panes" }, railEl, bodyEl));
    railRoot = railEl;
  } else {
    sheet.append(bodyEl);
  }
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
    /**
     * Build the section rail and show its first section. `sections` is the pure model from
     * recordSections.js; `render(id, pane)` fills a pane the first time it is shown.
     *
     * A section with no records stays in the rail, dimmed and counted 0, and remains
     * selectable — the pane then SAYS the asset is clean on it. Hiding the section would
     * make "no compliance findings" indistinguishable from "we don't check that", and a
     * disabled control would leave the reader nowhere to go to find out.
     */
    rail(sections, render) {
      if (!railRoot) return;
      clear(railRoot);
      clear(bodyEl);
      panes.clear();
      activeSectionId = null;
      const tabs = [];
      let group = null;
      let host = railRoot;
      (sections || []).forEach((s, i) => {
        if (s.group !== group) {
          group = s.group;
          host = railRoot;
          if (group) {
            const labelId = "sheet-railgrp-" + seq + "-" + i;
            const wrap = el("div", { class: "sheet-rail-group", role: "none" },
              el("div", { class: "sheet-rail-label", id: labelId, role: "none" }, group));
            railRoot.append(wrap);
            host = wrap;
            host.dataset.labelId = labelId;
          }
        }
        const tab = el("button", {
          class: "sheet-rail-item" + (s.empty ? " is-empty" : ""),
          type: "button",
          role: "tab",
          id: "sheet-tab-" + seq + "-" + s.id,
          "aria-controls": paneId,
          "aria-selected": "false",
          "aria-describedby": host === railRoot ? null : host.dataset.labelId,
          tabindex: "-1",
          onclick: () => selectSection(s.id),
          onkeydown: (e) => onRailKey(e, tabs),
        },
          el("span", { class: "sheet-rail-item-label" }, s.label),
          s.count === null || s.count === undefined
            ? null
            : el("span", { class: "sheet-rail-count" }, String(s.count)));
        tab.dataset.sectionId = s.id;
        tabs.push(tab);
        host.append(tab);
      });
      railRoot.dataset.count = String(tabs.length);
      renderPane = render;
      if (tabs.length) selectSection(tabs[0].dataset.sectionId);
    },
    /** Show a section by id, building its pane on first visit. */
    selectSection(id) {
      selectSection(id);
    },
    /** The currently-selected rail section id, or null on a sheet with no rail. */
    currentSection() {
      return activeSectionId;
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
      // The kind tile and the action toolbar are record-sheet chrome; both are set once the
      // record resolves, since both are derived from what it turned out to be.
      if (p.icon) {
        clear(iconEl).append(p.icon);
        if (p.tone) iconEl.dataset.tone = p.tone;
      }
      if (p.actions) clear(toolbarEl).append(...[].concat(p.actions).filter(Boolean));
    },
    setBusy(on) {
      if (on) bodyEl.setAttribute("aria-busy", "true");
      else bodyEl.removeAttribute("aria-busy");
    },
    /** Run `fn` when this sheet is torn down, however it closed. */
    onDispose(fn) {
      if (typeof fn === "function") disposers.push(fn);
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
  // After the mount, not before: widthFloor() reads a custom property off the element, and
  // an unattached node has no computed style to read it from.
  if (grip) {
    if (storedWidth && storedWidth !== "wide") {
      // A width dragged in a previous session, re-clamped to the viewport at hand.
      applyWidth(parseFloat(storedWidth), false);
    } else {
      // No dragged width: leave the token rule (or the wide preset) in charge and only
      // seed what the separator reports, so it does not start out claiming a bare 0.
      reportWidth(sheet.getBoundingClientRect().width);
    }
  }
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
