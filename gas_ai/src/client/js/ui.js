// Shared DOM helpers and components: element builder, severity/AARS badges, KPI
// tiles, toasts, pager, dialogs, and the drill-down sheet shell.

import { parseHash } from "./store.js";

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v; // trusted, builder-side strings only
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Severity badge: tinted pill + dot + label (never color alone).
 *
 * `role="img"`, not `role="status"`: a status is an aria-live region, and the detail sheet
 * paints one badge per issue and per finding — a dozen insertions into a dozen live regions
 * is an announcement storm, not information. The badge is a static graphic with a name.
 */
export function sevBadge(sev) {
  const s = String(sev || "UNKNOWN").toUpperCase();
  return el(
    "span",
    { class: `sev-badge sev-${s}`, role: "img", "aria-label": `Severity ${s}` },
    el("span", { class: "sev-dot", "aria-hidden": "true" }),
    s,
  );
}

/**
 * AARS chip: score + its severity, styled with that severity's token — dot + number +
 * label, never color alone. The AARS scale carries the same values as the Wiz severity
 * scale, so the token needs no translation.
 */
export function aarsChip(score, severity) {
  if (score === null || score === undefined || !severity) {
    return el("span", { class: "muted small" }, "—");
  }
  return el(
    "span",
    {
      class: `aars-chip sev-${severity}`,
      role: "img",
      "aria-label": `AARS ${score}, ${severity}`,
    },
    el("span", { class: "sev-dot", "aria-hidden": "true" }),
    String(score),
    el("span", {}, severity),
  );
}

export function statusPill(kind, text) {
  return el("span", { class: `pill ${kind}` }, text);
}

/**
 * A track/fill progress bar. `pct` 0–100 renders a determinate fill; `null` renders an
 * indeterminate (animated, with a static reduced-motion fallback) bar. `state` tints
 * the fill ("" | "failed" | "cancelled" | "done").
 */
export function progressBar(pct, state = "") {
  const determinate = typeof pct === "number" && !Number.isNaN(pct);
  const attrs = {
    class: `progress-track${determinate ? "" : " indeterminate"}${state ? " " + state : ""}`,
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
  };
  if (determinate) attrs["aria-valuenow"] = String(Math.round(pct));
  const fill = el("div", { class: "progress-fill" });
  if (determinate) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  return el("div", attrs, fill);
}

// Timestamps are stored canonically as UTC; the UI shows them in Europe/Paris
// wall-clock. sv-SE renders a clean ISO-like "YYYY-MM-DD HH:MM"; en-GB gives the
// DST-aware zone abbreviation (CET in winter, CEST in summer).
export const DISPLAY_TZ = "Europe/Paris";

const _dateFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});
const _dateTimeFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const _zoneFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TZ, timeZoneName: "short",
});

function parisZone(date) {
  const part = _zoneFmt.formatToParts(date).find((p) => p.type === "timeZoneName");
  return part ? part.value : "CET";
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  return _dateFmt.format(new Date(t));
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  const d = new Date(t);
  return `${_dateTimeFmt.format(d)} ${parisZone(d)}`;
}

export function kpiCard(label, value, sub, chip) {
  return el(
    "div",
    { class: "kpi-card" },
    el("div", { class: "kpi-label" }, label),
    el("div", { class: "kpi-value num" }, value, chip || null),
    sub ? el("div", { class: "kpi-sub" }, sub) : null,
  );
}

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

/**
 * Prev/Next controls, or a bare row count when a single page fits. The buttons carry
 * `data-nav` so a caller that rebuilds the pager on every page change can put keyboard
 * focus back on the control that was just used.
 */
export function pager(page, pageCount, total, onPage) {
  if (pageCount <= 1) {
    return el("div", { class: "pager" },
      `${total.toLocaleString()} row${total === 1 ? "" : "s"}`);
  }
  return el(
    "div",
    { class: "pager" },
    el("button", {
      "data-nav": "prev",
      onclick: () => onPage(page - 1),
      disabled: page <= 0,
    }, "‹ Prev"),
    `Page ${page + 1} of ${pageCount} — ${total.toLocaleString()} rows`,
    el("button", {
      "data-nav": "next",
      onclick: () => onPage(page + 1),
      disabled: page >= pageCount - 1,
    }, "Next ›"),
  );
}

/** Client-side file download from a text payload. */
export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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

// ------------------------------------------------------------------- detail sheet

let sheetSeq = 0;
/** The one mounted sheet. Opening a second one swaps it — sheets never stack. */
let activeSheet = null;
let routeHookInstalled = false;

/** Matches the .sheet transform transition in styles.css. */
const SHEET_EXIT_MS = 220;

function motionOk() {
  return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

const FOCUSABLE_SEL = [
  "a[href]", "button", "input", "select", "textarea", "summary",
  '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Tabbable descendants, in DOM order — disabled and non-rendered nodes excluded. */
// Open portaled popovers (the combobox listbox, which mounts on <body> so a scrolling
// panel cannot clip it). A sheet's focus trap stands down while any is open — their rows
// are outside the sheet subtree by design.
let openPortals = 0;

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
    if (openPortals) return;
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

export function emptyState(message, hint) {
  return el(
    "div",
    { class: "empty", role: "status" },
    el("div", {}, message),
    hint ? el("div", { class: "small", style: "margin-top:6px" }, hint) : null,
  );
}

export function sectionLabel(text) {
  return el("h2", { class: "section-label" }, text);
}

let _helpTipSeq = 0;

/**
 * Wrap `content` so hovering or focusing it reveals a quiet card explaining `lines`.
 * Reveal is pure CSS (`:hover` / `:focus-within`); the wrapper is focusable so keyboard
 * users get it too, and is `aria-describedby` a bubble that stays in the DOM at opacity 0
 * so screen readers announce the text either way. Escape blurs to dismiss.
 *
 * This replaces `title=` for anything that matters. A native tooltip is unreachable by
 * keyboard, invisible on touch, and truncated by the OS — fine for a hint, wrong for the
 * page's central disclaimer about what it is not showing you.
 */
export function helpTip(content, lines, { label, className } = {}) {
  const items = Array.isArray(lines) ? lines : [lines];
  const id = `helptip-${++_helpTipSeq}`;
  const bubble = el(
    "span",
    { class: "helptip-bubble", role: "tooltip", id },
    ...items.map((t) => el("span", { class: "helptip-line" }, t)),
  );
  // Pinned to the viewport just before each reveal. Absolutely positioned inside the
  // trigger it would be clipped by any overflow ancestor — and this one lives inside
  // .workbench-body, which is overflow:hidden, so an in-flow bubble would be cut off
  // entirely. Coordinates are recomputed on every reveal, so there is nothing to clean up
  // on hide (an opacity-0 fixed bubble cannot affect layout). Below by default, flipped
  // above when it would cross the viewport bottom, clamped to the side edges.
  const place = (wrapper) => {
    const r = wrapper.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let top = r.bottom + 8;
    if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 8);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8));
    bubble.style.position = "fixed";
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  };
  const attrs = {
    class: `helptip${className ? " " + className : ""}`,
    tabindex: "0",
    "aria-describedby": id,
    onkeydown: (e) => { if (e.key === "Escape") e.currentTarget.blur(); },
    onmouseenter: (e) => place(e.currentTarget),
    onfocusin: (e) => place(e.currentTarget),
  };
  if (label) attrs["aria-label"] = label;
  const kids = Array.isArray(content) ? content : [content];
  return el("span", attrs, ...kids, bubble);
}

// ------------------------------------------------------------------------- combobox

let _comboboxSeq = 0;

/** How many matches the list will render before it stops and says so. Rebuilding runs
 *  synchronously on every keystroke, and the asset picker's list is the whole estate. */
const COMBOBOX_MATCH_CAP = 100;
const COMBOBOX_DEBOUNCE_MS = 120;

function comboNormalize(list) {
  return (list || []).map((o) => (typeof o === "string"
    ? { value: o, label: o, hint: "", group: "" }
    : { value: o.value, label: o.label == null ? o.value : o.label, hint: o.hint || "", group: o.group || "" }));
}

/**
 * Searchable combobox: a trigger button plus a listbox popover, portaled to `<body>`.
 *
 * Forked from the OS-vulns tool's `filterCombobox` (gas/src/client/js/ui.js), which
 * fronts ~20 sidebar options where the value IS the label. This one fronts the whole
 * asset estate from inside a scrolling panel, so it differs in six ways:
 *
 *   - options are `{value, label, hint, group}` (or plain strings), searched on `label`
 *     and rendered under `role="presentation"` group headers that the keyboard walk skips;
 *   - `pinnedRows` replaces the hardwired `value === ""` reset row, because "Start from"
 *     has two preset rows and "" is a real state rather than "no filter";
 *   - the trigger prints the option's LABEL, resolved from the value, and an unknown
 *     value (a seed the option list never carried) keeps a caller-supplied fallback
 *     rather than blanking to the default;
 *   - `setOptions()` swaps the list in without firing onChange, keeping the query and
 *     clamping the active row, so a lazily-arriving fetch cannot disturb an open popover;
 *   - it opens downward, and repositions rather than closing when the panel behind it
 *     scrolls;
 *   - matches are capped and input is debounced.
 *
 * `onChange(value)` fires on selection. The returned wrapper carries `setValue(v)` and
 * `setOptions(list)`, neither of which fires `onChange` — that is what lets a caller
 * reflect external state onto the control without looping.
 */
export function filterCombobox({
  value, options, pinnedRows, defaultLabel, ariaLabel, searchPlaceholder = "Search…",
  fallbackLabel = "", searchThreshold = 7, onChange, id,
}) {
  const seq = ++_comboboxSeq;
  const listboxId = `combobox-list-${seq}`;
  let current = value || "";
  let opts = comboNormalize(options);
  const pinned = comboNormalize(pinnedRows);

  function labelFor(v) {
    const hit = [...pinned, ...opts].find((o) => o.value === v);
    if (hit) return hit.label;
    // A value the list doesn't carry — e.g. a graph seeded from a derived risk node,
    // which the asset options endpoint never returns. Better a caller-supplied name than
    // silently reading as "nothing selected".
    return v ? (fallbackLabel || v) : defaultLabel;
  }

  const triggerText = el("span", { class: "combobox-trigger-text" });
  const trigger = el(
    "button",
    {
      type: "button", class: "combobox-trigger",
      "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": ariaLabel,
      onclick: (e) => { e.stopPropagation(); open ? close() : openPop(); },
    },
    triggerText,
    el("span", { class: "combobox-caret", "aria-hidden": "true" }, "▾"),
  );
  const wrap = el("div", { class: "combobox", id: id || null }, trigger);

  function paintTrigger() {
    const text = labelFor(current);
    triggerText.textContent = text;
    trigger.title = text;
  }
  paintTrigger();

  let open = false;
  let pop = null;
  let searchEl = null;
  let listEl = null;
  let query = "";
  let debounce = null;
  let rows = [];      // selectable rows only, in DOM order — the roving-index array
  let activeIndex = 0;

  function matching() {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => o.label.toLowerCase().includes(q)
      || (o.hint && o.hint.toLowerCase().includes(q)));
  }

  function optionRow(o, idx) {
    const optId = `${listboxId}-opt-${idx}`;
    const row = el(
      "li",
      { id: optId, role: "option", class: "combobox-option",
        "aria-selected": current === o.value ? "true" : "false" },
      o.label,
      o.hint ? el("span", { class: "combobox-option-hint" }, o.hint) : null,
    );
    row.addEventListener("click", () => select(o.value));
    listEl.append(row);
    rows.push({ value: o.value, id: optId, node: row });
  }

  /**
   * Rebuild the rows for the current query. `keepActive` holds the highlight on the row
   * carrying that value if it survived the rebuild — used by setOptions/setValue, which
   * must not yank the keyboard position out from under someone mid-scroll. Typing resets
   * the highlight to the first row instead.
   */
  function buildRows({ keepActive } = {}) {
    clear(listEl);
    rows = [];
    let idx = 0;
    // Pinned presets sit above the list, but they are searchable text like anything else:
    // holding an unmatched "All toxic combinations" at the top while someone types an
    // asset name puts a wrong row under the first ArrowDown.
    const q = query.trim().toLowerCase();
    const shownPinned = q ? pinned.filter((o) => o.label.toLowerCase().includes(q)) : pinned;
    for (const p of shownPinned) optionRow(p, idx++);
    if (shownPinned.length) rows[rows.length - 1].node.classList.add("combobox-option--last-pinned");

    const matches = matching();
    const shown = matches.slice(0, COMBOBOX_MATCH_CAP);
    let group = "";
    for (const o of shown) {
      // A header only earns its place when the group below it is non-empty, which the
      // slice above can change from keystroke to keystroke.
      if (o.group && o.group !== group) {
        listEl.append(el("li", { role: "presentation", class: "combobox-group" }, o.group));
        group = o.group;
      } else if (!o.group) {
        group = "";
      }
      optionRow(o, idx++);
    }
    if (!matches.length && !shownPinned.length) {
      listEl.append(el("li", { role: "presentation", class: "combobox-empty" },
        query.trim() ? "No matches" : "Nothing to choose from"));
    } else if (matches.length > shown.length) {
      listEl.append(el("li", { role: "presentation", class: "combobox-empty" },
        `Showing ${shown.length} of ${matches.length} — keep typing to narrow`));
    }

    const want = keepActive === undefined ? current : keepActive;
    const at = rows.findIndex((r) => r.value === want);
    activeIndex = at >= 0 ? at : 0;
    highlightActive();
  }

  function highlightActive() {
    rows.forEach((r, i) => r.node.classList.toggle("active", i === activeIndex));
    const activeId = rows[activeIndex] ? rows[activeIndex].id : "";
    if (searchEl) searchEl.setAttribute("aria-activedescendant", activeId);
    else if (listEl) listEl.setAttribute("aria-activedescendant", activeId);
  }

  function scrollActiveIntoView() {
    const row = rows[activeIndex];
    if (row) row.node.scrollIntoView({ block: "nearest" });
  }

  function select(v) {
    current = v;
    paintTrigger();
    close();
    trigger.focus();
    if (onChange) onChange(current);
  }

  // Positioned against the live trigger rect, opening downward (these triggers sit at the
  // top of a panel, not at the bottom of a rail), clamped to the viewport, with the list's
  // max-height capped to the room actually below so the LIST scrolls rather than the
  // popover running off screen.
  function position() {
    const rect = trigger.getBoundingClientRect();
    const popWidth = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 8));
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const flip = below < 200 && above > below;
    pop.style.width = `${popWidth}px`;
    pop.style.left = `${left}px`;
    if (flip) {
      pop.style.top = "";
      pop.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      listEl.style.maxHeight = `${Math.min(320, Math.max(120, above))}px`;
    } else {
      pop.style.bottom = "";
      pop.style.top = `${rect.bottom + 6}px`;
      listEl.style.maxHeight = `${Math.min(320, Math.max(120, below))}px`;
    }
  }

  function openPop() {
    open = true;
    query = "";
    const showSearch = opts.length > searchThreshold;
    listEl = el("ul", { role: "listbox", class: "combobox-list", id: listboxId, "aria-label": ariaLabel });
    if (showSearch) {
      searchEl = el("input", {
        type: "text", class: "combobox-search", placeholder: searchPlaceholder,
        role: "combobox", "aria-expanded": "true", "aria-controls": listboxId,
        "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false",
        // Debounced: each rebuild is one <li> per match, synchronously, and this list can
        // be the whole estate.
        oninput: () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            query = searchEl.value;
            buildRows({ keepActive: null });
          }, COMBOBOX_DEBOUNCE_MS);
        },
        onkeydown: onListKey,
      });
      pop = el("div", { class: "combobox-pop" }, searchEl, listEl);
    } else {
      searchEl = null;
      listEl.setAttribute("tabindex", "-1");
      listEl.addEventListener("keydown", onListKey);
      pop = el("div", { class: "combobox-pop" }, listEl);
    }
    document.body.append(pop);
    openPortals += 1;
    buildRows();
    position();
    trigger.setAttribute("aria-expanded", "true");

    // pointerdown as well as click: the graph canvas takes a pointer capture to pan
    // (graphView.js), so a pan that ends outside the window never delivers the click that
    // would otherwise dismiss this.
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    wrap.addEventListener("focusout", onFocusOut);
    pop.addEventListener("focusout", onFocusOut);

    if (searchEl) searchEl.focus();
    else listEl.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    clearTimeout(debounce);
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    wrap.removeEventListener("focusout", onFocusOut);
    if (pop) { pop.removeEventListener("focusout", onFocusOut); pop.remove(); }
    openPortals = Math.max(0, openPortals - 1);
    pop = null; searchEl = null; listEl = null; rows = [];
  }

  function isInside(node) { return node && (wrap.contains(node) || (pop && pop.contains(node))); }
  function onDocPointer(e) { if (!isInside(e.target)) close(); }
  function onDocClick(e) { if (!isInside(e.target)) close(); }
  function onFocusOut(e) { if (!isInside(e.relatedTarget)) close(); }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); trigger.focus(); } }

  // Reposition rather than close. The panel this lives in scrolls, so closing on scroll
  // would dismiss the popover the moment someone scrolled down to reach its list. Only a
  // trigger that has left the viewport entirely closes.
  function onScrollOrResize(e) {
    if (e && e.target && pop && pop.contains(e.target)) return; // the list's own scrolling
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) close();
    else position();
  }

  function onListKey(e) {
    if (!rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, rows.length - 1); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Home") { e.preventDefault(); activeIndex = 0; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "End") { e.preventDefault(); activeIndex = rows.length - 1; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows[activeIndex]; if (row) select(row.value); }
  }

  /** Reflect an external state change onto the control — no onChange, no focus move. */
  wrap.setValue = (v) => {
    current = v || "";
    paintTrigger();
    if (open) buildRows({ keepActive: rows[activeIndex] ? rows[activeIndex].value : current });
  };
  /** Swap the option list in (the lazy fetch), keeping any open popover usable. */
  wrap.setOptions = (list) => {
    opts = comboNormalize(list);
    paintTrigger();
    if (open) buildRows({ keepActive: rows[activeIndex] ? rows[activeIndex].value : current });
  };
  wrap.isOpen = () => open;
  wrap.closePopover = close;
  return wrap;
}
