// Shared DOM helpers and components: element builder, severity badges, KPI tiles,
// change chips, toasts, pager, CSV download, dialogs, and the finding sheet shell.

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

/** Severity badge: tinted pill + dot + label (never color alone). */
export function sevBadge(sev) {
  const s = String(sev || "UNKNOWN").toUpperCase();
  return el(
    "span",
    { class: `sev-badge sev-${s}`, role: "status", "aria-label": `Severity ${s}` },
    el("span", { class: "sev-dot", "aria-hidden": "true" }),
    s,
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

/**
 * Signed change chip vs a previous value. up = worse (red) for counts of risk.
 * `fmt` formats the (unsigned) magnitude in the value's own unit — e.g.
 * `changeChip(median, prev, { fmt: fmtDays })` -> "+2.3mo" — so the delta never
 * contradicts the scale of the figure it annotates. `suffix` appends a unit to a plain
 * number ("%"). An `aria-label` restates the direction in words for screen readers.
 */
export function changeChip(current, previous, { invert = false, fmt = null, suffix = "" } = {}) {
  if (previous === null || previous === undefined || Number.isNaN(previous)) return null;
  const delta = current - previous;
  if (!delta) return el("span", { class: "chg flat", "aria-label": "unchanged" }, "±0");
  const worse = invert ? delta < 0 : delta > 0;
  const cls = worse ? "up" : "down";
  const sign = delta > 0 ? "+" : "−";
  const mag = fmt ? fmt(Math.abs(delta)) : `${round1(Math.abs(delta))}${suffix}`;
  return el("span", { class: `chg ${cls}`, "aria-label": `${worse ? "up" : "down"} ${mag}` },
    `${sign}${mag}`);
}

// NVD link for a CVE id. Built so no literal `//` byte sequence appears in the bundle:
// SSL-inspecting middleboxes have been observed stripping "comments" from the served
// page and truncating lines at a bare `//`. The join (which esbuild cannot constant-
// fold, unlike `"a" + "b"`) yields "https://nvd.nist.gov/vuln/detail/<id>" at runtime;
// the build guard in esbuild.config.mjs enforces the invariant.
export function nvdUrl(id) {
  return ["https:", "", "nvd.nist.gov", "vuln", "detail", encodeURIComponent(id || "")].join("/");
}

export function round1(v) {
  return Math.round(v * 10) / 10;
}

export function fmtDays(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (v < 1 / 24) return "<1h";
  if (v < 1) return `${Math.round(v * 24)}h`;
  if (v < 30) return `${v.toFixed(1)}d`;
  if (v < 365) return `${(v / 30).toFixed(1)}mo`;
  return `${(v / 365).toFixed(1)}y`;
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

export function pager(page, pageCount, total, onPage) {
  if (pageCount <= 1) {
    return el("div", { class: "pager" }, `${total.toLocaleString()} rows`);
  }
  return el(
    "div",
    { class: "pager" },
    el("button", { onclick: () => onPage(page - 1), disabled: page <= 0 }, "‹ Prev"),
    `Page ${page + 1} of ${pageCount} — ${total.toLocaleString()} rows`,
    el("button", { onclick: () => onPage(page + 1), disabled: page >= pageCount - 1 }, "Next ›"),
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

// Nudge size for the resize handle's ArrowLeft/ArrowRight keyboard control. Roughly what a
// couple of drag-pixels-worth of intent looks like as a single discrete step.
const SHEET_RESIZE_STEP = 24;

// Sandbox-tolerant localStorage read/write for a sheet's user-chosen width, same try/catch
// pattern as loadPref/savePref in mttr.js — duplicated here (rather than imported) because
// ui.js is shared infrastructure and can't reach into a page module's private helpers.
function loadSheetWidth(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = Number(localStorage.getItem(storageKey));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
}
function saveSheetWidth(storageKey, px) {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, String(Math.round(px)));
  } catch {
    // Sandbox without storage — the resize simply won't survive the next open.
  }
}

/**
 * Right-anchored sheet (the signature drill-down overlay). Returns {close}.
 *
 * Resizing: `width` sets the initial CSS width (a plain default of `min(520px, 92vw)` applies
 * when omitted, unchanged from before resizing existed); `minWidth` floors how far the user can
 * drag it in (px, default 360); `storageKey`, when given, persists the user's dragged/keyboard-
 * resized width across opens (clamped to the viewport at hand) — omit it for sheets where a
 * remembered width isn't worth the localStorage key (e.g. transient scan-detail popovers).
 */
export function openSheet(renderBody, opts = {}) {
  const {
    title = "", subtitle = "", ariaLabel = title || "Detail",
    width, minWidth = 360, storageKey,
  } = opts;
  const scrim = el("div", { class: "sheet-scrim" });
  const sheet = el("aside", {
    class: "sheet",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": ariaLabel,
    tabindex: "-1",
  });

  // The sheet is right-anchored, so its right edge is pinned and only its *width* — i.e. its
  // left edge — moves. `maxWidthPx` is recomputed on every clamp rather than cached, since the
  // viewport can change (window resize) between an initial open and a later drag.
  const maxWidthPx = () => window.innerWidth * 0.96;
  const clampWidth = (px) => Math.min(Math.max(px, minWidth), maxWidthPx());

  // A persisted width (from a previous drag/keyboard resize, if storageKey is set) wins over
  // the caller's `width` default, which wins over the bare CSS default. Re-clamping the stored
  // value guards against it having been saved on a wider viewport than the current one.
  const storedWidth = loadSheetWidth(storageKey);
  if (storedWidth !== null) {
    sheet.style.width = `${clampWidth(storedWidth)}px`;
  } else if (width) {
    sheet.style.width = width;
  }

  const prevFocus = document.activeElement;
  function close() {
    scrim.classList.remove("open");
    sheet.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => {
      scrim.remove();
      sheet.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }, 240);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      // basic focus trap
      const focusables = sheet.querySelectorAll("button, a[href], input, select, [tabindex]");
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  }
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.append(scrim, sheet);

  // Resize handle: a slim strip on the sheet's left edge. Dragging (or ArrowLeft/ArrowRight
  // once focused) widens/narrows the sheet. It's inserted before the header/body so it's the
  // first thing a keyboard user tabs to — a reasonable place for a structural, always-present
  // control — and it's a normal focusable element, so the Tab-trap above already covers it.
  const handle = el("div", {
    class: "sheet-resize-handle",
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize panel",
    tabindex: "0",
  });
  function applyWidth(px, persist) {
    const clamped = clampWidth(px);
    sheet.style.width = `${clamped}px`;
    if (persist) saveSheetWidth(storageKey, clamped);
  }
  let dragging = false;
  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    // Suppress text selection for the duration of the drag — without this, a fast drag over
    // the chart/table content behind the handle selects it like a click-drag would.
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // Right-anchored sheet: width is simply the distance from the pointer to the viewport's
    // right edge, recomputed fresh each move (not a delta from drag-start) so the sheet can
    // never "drift" out of sync with the pointer.
    applyWidth(window.innerWidth - e.clientX, false);
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
    applyWidth(window.innerWidth - e.clientX, true);
  }
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    // ArrowLeft widens (matches dragging the left edge further left); ArrowRight narrows.
    const delta = e.key === "ArrowLeft" ? SHEET_RESIZE_STEP : -SHEET_RESIZE_STEP;
    applyWidth(sheet.getBoundingClientRect().width + delta, true);
  });
  sheet.append(handle);

  if (title) {
    sheet.append(
      el("div", { class: "sheet-header" },
        el("div", { class: "sheet-heading" },
          el("h2", { class: "sheet-title" }, title),
          subtitle ? el("div", { class: "sheet-subtitle muted small" }, subtitle) : null),
        el("button", { class: "sheet-close", "aria-label": "Close", onclick: close }, "✕")),
    );
  }
  // Content always lands in a padded, scrollable body — never the bare sheet frame.
  const body = el("div", { class: "sheet-body" });
  sheet.append(body);
  renderBody(body, close);
  requestAnimationFrame(() => {
    scrim.classList.add("open");
    sheet.classList.add("open");
    sheet.focus();
  });
  return { close };
}

export function emptyState(message, hint) {
  return el(
    "div",
    { class: "empty" },
    el("div", {}, message),
    hint ? el("div", { class: "small", style: "margin-top:6px" }, hint) : null,
  );
}

export function sectionLabel(text) {
  return el("h2", { class: "section-label" }, text);
}

/**
 * Inline severity-scope filter: a trigger showing the current summary that opens a
 * popover of severity toggle pills. Shared by Overview and MTTR. `scope` is a live array
 * mutated in place so the caller's scopeParam() stays in sync; `onApply` fires (debounced)
 * whenever the selection changes, and is flushed on close so the label and the data never
 * disagree for more than a beat. `selectable` is palette.selectable.
 */
export function severityScopeFilter({ selectable, scope, onApply, ariaContext = "this page" }) {
  const nice = (s) => s[0] + s.slice(1).toLowerCase();
  function summary() {
    if (scope.length === selectable.length) return "All severities";
    const chosen = selectable.filter((s) => scope.includes(s));
    return chosen.length <= 2 ? chosen.map(nice).join(", ") : `${chosen.length} severities`;
  }

  const wrap = el("div", { class: "sev-filter" });
  const label = el("span", { class: "sev-filter-label" }, summary());
  const btn = el("button", {
    type: "button", class: "sev-filter-btn",
    "aria-expanded": "false",
    "aria-label": `Severities included in ${ariaContext}`,
    onclick: (e) => { e.stopPropagation(); open ? close() : openMenu(); },
  }, label, el("span", { class: "sev-filter-caret", "aria-hidden": "true" }, "▾"));

  const pills = el("div", { class: "pill-row" });
  const pillFor = {};
  for (const sev of selectable) {
    const pill = el("button", {
      type: "button", class: `sev-pill sev-${sev}`,
      "aria-pressed": scope.includes(sev) ? "true" : "false",
      onclick: () => toggle(sev),
    }, sev);
    pillFor[sev] = pill;
    pills.append(pill);
  }
  const menu = el(
    "div",
    { class: "sev-filter-menu", role: "group", "aria-label": `Severities included in ${ariaContext}` },
    el("span", { class: "sev-filter-caption label" }, "Include severities"),
    pills,
  );
  menu.hidden = true;
  wrap.append(btn, menu);

  function syncPills() {
    const lastOne = scope.length === 1;
    for (const sev of selectable) {
      const on = scope.includes(sev);
      const p = pillFor[sev];
      p.setAttribute("aria-pressed", on ? "true" : "false");
      // Visibly lock the sole remaining severity so the "keep at least one" floor reads
      // rather than a click that silently does nothing.
      if (on && lastOne) {
        p.setAttribute("aria-disabled", "true");
        p.title = "At least one severity must stay selected";
      } else {
        p.removeAttribute("aria-disabled");
        p.removeAttribute("title");
      }
    }
    label.textContent = summary();
  }
  syncPills();

  let applied = scope.join(",");
  let applyTimer = null;
  function doApply() {
    applied = scope.join(",");
    if (onApply) onApply();
  }
  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(doApply, 300);
  }

  function toggle(sev) {
    const i = scope.indexOf(sev);
    if (i >= 0) {
      if (scope.length === 1) return; // floor: keep at least one severity selected
      scope.splice(i, 1);
    } else {
      scope.push(sev);
    }
    syncPills();
    scheduleApply();
  }

  let open = false;
  function openMenu() {
    open = true;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("focusout", onFocusOut);
    // Land keyboard focus inside the popover instead of leaving it on the trigger.
    const firstOn = selectable.find((s) => scope.includes(s)) || selectable[0];
    const target = pillFor[firstOn] || pills.firstChild;
    if (target) target.focus();
  }
  function close() {
    open = false;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    wrap.removeEventListener("focusout", onFocusOut);
    clearTimeout(applyTimer);
    if (scope.join(",") !== applied) doApply(); // flush any pending change on close
  }
  function onDocClick(e) { if (!wrap.contains(e.target)) close(); }
  function onKey(e) { if (e.key === "Escape") { close(); btn.focus(); } }
  // Tabbing past the last pill (or focus leaving the widget) closes it — a non-modal inline
  // popover should release focus, not trap it. relatedTarget null (focus lost to a non-
  // focusable target) is also "outside" and closes, matching outside-click.
  function onFocusOut(e) { if (!wrap.contains(e.relatedTarget)) close(); }
  return wrap;
}

let _comboboxSeq = 0;

/**
 * Reusable searchable combobox: a trigger `<button>` (same open/close/dismiss mechanics
 * as severityScopeFilter — capture-phase document click to close on outside click,
 * document keydown for Escape, focusout when focus leaves the widget) plus a listbox
 * popover. Used for the two global sidebar filters (Value Chain, Support group), each
 * needing ~20 options to stay scannable.
 *
 * The popover is portaled to `document.body` (not appended inside the wrapper) because
 * the sidebar scrolls (`overflow-y:auto`) and would clip an in-rail popover, and is
 * positioned `fixed`, opening upward from the trigger since the filters sit at the rail
 * bottom. It closes (rather than repositions) on scroll/resize.
 *
 * `options` is the selectable string[], NOT including the reset entry — the reset row
 * (label `defaultLabel`, value "") is always pinned at the top of the list regardless of
 * the search query. A search input appears only once `options.length > searchThreshold`,
 * so a short list (e.g. Value Chain) stays a plain dropdown.
 *
 * `onChange(newValue)` fires on selection. The returned wrapper carries `setValue(v)`,
 * which updates the shown label/active state WITHOUT firing onChange — for callers (e.g.
 * clearScope) that need to reset the control programmatically.
 */
export function filterCombobox({
  value, options, defaultLabel, ariaLabel, searchPlaceholder = "Search…",
  variant, searchThreshold = 7, onChange, id,
}) {
  const seq = ++_comboboxSeq;
  const listboxId = `combobox-list-${seq}`;
  let current = value || "";

  const triggerText = el("span", { class: "combobox-trigger-text" }, current || defaultLabel);
  const trigger = el(
    "button",
    {
      type: "button", class: `combobox-trigger${current ? " active" : ""}`,
      "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": ariaLabel,
      title: current || defaultLabel,
      onclick: (e) => { e.stopPropagation(); open ? close() : openPop(); },
    },
    triggerText,
    el("span", { class: "combobox-caret", "aria-hidden": "true" }, "▾"),
  );
  const wrap = el(
    "div",
    { class: `combobox sidebar-filter sidebar-filter--${variant}`, id: id || null },
    trigger,
  );

  let open = false;
  let pop = null;
  let searchEl = null;
  let listEl = null;
  let query = "";
  let rows = []; // [{ value, id, node }], reset row first, in DOM order
  let activeIndex = 0;

  function matchingOptions() {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }

  // Rebuilds the option rows for the current query. `resetActive` re-lands the active
  // (keyboard-highlighted) row on the first row — used when the query changes, per the
  // adaptive-search spec ("typing... resets the active option to the first row");
  // otherwise the active row tracks the current selection (used on open).
  function buildRows({ resetActive = false } = {}) {
    clear(listEl);
    rows = [];
    const resetId = `${listboxId}-opt-reset`;
    const resetRow = el(
      "li",
      { id: resetId, role: "option", class: "combobox-option combobox-option--reset",
        "aria-selected": current === "" ? "true" : "false" },
      defaultLabel,
    );
    resetRow.addEventListener("click", () => select(""));
    listEl.append(resetRow);
    rows.push({ value: "", id: resetId, node: resetRow });

    const matches = matchingOptions();
    matches.forEach((opt, i) => {
      const optId = `${listboxId}-opt-${i}`;
      const row = el(
        "li",
        { id: optId, role: "option", class: "combobox-option",
          "aria-selected": current === opt ? "true" : "false" },
        opt,
      );
      row.addEventListener("click", () => select(opt));
      listEl.append(row);
      rows.push({ value: opt, id: optId, node: row });
    });
    if (matches.length === 0 && query.trim()) {
      listEl.append(el("li", { role: "presentation", class: "combobox-empty" }, "No matches"));
    }

    if (resetActive) {
      activeIndex = 0;
    } else {
      const idx = rows.findIndex((r) => r.value === current);
      activeIndex = idx >= 0 ? idx : 0;
    }
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
    triggerText.textContent = current || defaultLabel;
    trigger.title = current || defaultLabel;
    trigger.classList.toggle("active", !!current);
    close();
    trigger.focus();
    if (onChange) onChange(current);
  }

  // Position the portaled popover against the live trigger rect: clamp horizontally to
  // the viewport, anchor its bottom edge just above the trigger (it always opens
  // upward — the filters sit at the rail bottom, expanded or collapsed), and cap the
  // list's own max-height to the space actually available above so the LIST scrolls
  // internally rather than the popover running off the top of the screen.
  function position() {
    const rect = trigger.getBoundingClientRect();
    const popWidth = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 8));
    pop.style.width = `${popWidth}px`;
    pop.style.left = `${left}px`;
    pop.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    listEl.style.maxHeight = `${Math.min(320, Math.max(120, rect.top - 24))}px`;
  }

  function openPop() {
    open = true;
    query = "";
    const showSearch = options.length > searchThreshold;
    listEl = el("ul", { role: "listbox", class: "combobox-list", id: listboxId, "aria-label": ariaLabel });
    if (showSearch) {
      searchEl = el("input", {
        type: "text", class: "combobox-search", placeholder: searchPlaceholder,
        role: "combobox", "aria-expanded": "true", "aria-controls": listboxId,
        "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false",
        oninput: () => { query = searchEl.value; buildRows({ resetActive: true }); },
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
    buildRows();
    position();
    trigger.setAttribute("aria-expanded", "true");

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
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    wrap.removeEventListener("focusout", onFocusOut);
    if (pop) { pop.removeEventListener("focusout", onFocusOut); pop.remove(); }
    pop = null; searchEl = null; listEl = null; rows = [];
  }

  function isInside(node) { return node && (wrap.contains(node) || (pop && pop.contains(node))); }
  function onDocClick(e) { if (!isInside(e.target)) close(); }
  function onFocusOut(e) { if (!isInside(e.relatedTarget)) close(); }
  function onKey(e) { if (e.key === "Escape") { close(); trigger.focus(); } }
  // Closing (rather than repositioning) on scroll/resize avoids a stale `fixed` popover
  // — cheap and correct, since these are rare while the popover is open. Scroll events
  // don't bubble, so this capture-phase window listener also sees the LIST's own
  // internal scrolling (e.g. scrollActiveIntoView() during keyboard nav) — that's not an
  // "outside" scroll and must not self-close the popover it's happening inside of.
  function onScrollOrResize(e) { if (e.target && pop && pop.contains(e.target)) return; close(); }

  function onListKey(e) {
    if (!rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, rows.length - 1); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Home") { e.preventDefault(); activeIndex = 0; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "End") { e.preventDefault(); activeIndex = rows.length - 1; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows[activeIndex]; if (row) select(row.value); }
  }

  // Programmatic reset (clearScope): updates the shown label/active state without
  // calling onChange or touching open state.
  wrap.setValue = (v) => {
    current = v || "";
    triggerText.textContent = current || defaultLabel;
    trigger.title = current || defaultLabel;
    trigger.classList.toggle("active", !!current);
  };
  return wrap;
}

let _helpTipSeq = 0;

/**
 * Wrap `content` so hovering (or focusing) it reveals a quiet card explaining `lines` — used
 * on headline metrics to explain how a number is calculated, with no separate glyph: the
 * metric itself is the hover target. Reveal is pure CSS (:hover / :focus-within on
 * `.helptip`); the wrapper is focusable so keyboard users get it too (inheriting the app's
 * focus ring) and is `aria-describedby` the bubble, which stays in the DOM (opacity-hidden)
 * so screen readers announce the text. Escape blurs to dismiss. Meaning is text, never colour
 * — the surface is the neutral popover recipe (white / hairline / --shadow-card), matching
 * `.sev-filter-menu`. `className` adds a layout variant (e.g. `hero-metric`) next to the base
 * `.helptip`; `label` optionally sets an aria-label (omit to let the wrapped content read).
 */
export function helpTip(content, lines, { label, className } = {}) {
  const items = Array.isArray(lines) ? lines : [lines];
  const id = `helptip-${++_helpTipSeq}`;
  const bubble = el(
    "span",
    { class: "helptip-bubble", role: "tooltip", id },
    ...items.map((t) => el("span", { class: "helptip-line" }, t)),
  );
  // Pin the bubble to the viewport just before each reveal. Left in document flow it's
  // absolutely positioned inside the trigger, so any overflow ancestor (e.g. a
  // .table-wrap's overflow-x:auto, which clips vertically too) cuts it off — table-header
  // tips were unreadable. position:fixed escapes every clipping context; coordinates are
  // recomputed on every reveal so no hide-time cleanup is needed (an opacity-0 fixed
  // bubble can't affect layout). The bubble keeps layout at opacity 0, so its rect is
  // measurable before it fades in. Below the trigger by default, flipped above when it
  // would cross the viewport bottom, clamped to the side edges.
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

/**
 * Header scope bar: dismissible chips for the global Value Chain / Support group filters,
 * rendered where the numbers are so a scoped dashboard never silently reads as the whole
 * register. Returns null when no global filter is active. `onClear(kind)` clears one.
 */
export function scopeBar({ domain, supportGroup, onClear }) {
  if (!domain && !supportGroup) return null;
  const bar = el("div", { class: "scope-bar", role: "status", "aria-label": "Active filters" });
  const chip = (kind, name, value) =>
    el("span", { class: "scope-chip" },
      el("span", { class: "scope-chip-key" }, `${name} · `),
      el("b", {}, value),
      onClear
        ? el("button", {
            class: "scope-chip-x", type: "button",
            "aria-label": `Clear ${name} filter`, title: `Clear ${name} filter`,
            onclick: () => onClear(kind),
          }, "✕")
        : null);
  if (domain) bar.append(chip("domain", "Value chain", domain));
  if (supportGroup) bar.append(chip("supportGroup", "Support group", supportGroup));
  return bar;
}

/**
 * Honesty note for the vendor-fix filter: shown (by the caller, guarded on
 * `boot.settings.showNoFix === false`) on every finding-visualizing page so a filtered
 * dashboard never silently reads as the whole register. Links back to the toggle in
 * Settings.
 */
export function noFixHiddenNote() {
  return el("p", { class: "muted small", role: "note" },
    "Findings without an available vendor fix are hidden. ",
    el("a", { href: "#/settings", target: "_self" }, "Settings"));
}
