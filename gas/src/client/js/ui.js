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

/** Right-anchored sheet (the signature drill-down overlay). Returns {close}. */
export function openSheet(renderBody, opts = {}) {
  const { title = "", subtitle = "", ariaLabel = title || "Detail" } = opts;
  const scrim = el("div", { class: "sheet-scrim" });
  const sheet = el("aside", {
    class: "sheet",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": ariaLabel,
    tabindex: "-1",
  });
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

let _helpTipSeq = 0;

/**
 * A small hover/focus explainer: an "i" glyph that reveals a quiet card of `lines`. Used on
 * headline metrics to explain how a number is calculated. Reveal is pure CSS (:hover /
 * :focus-within on `.helptip`), so keyboard users get it by tabbing to the focusable trigger
 * and it inherits the app's focus ring; the trigger is `aria-describedby` the bubble (which
 * stays in the DOM, opacity-hidden) so screen readers announce the text. Escape blurs the
 * trigger to dismiss. Meaning is text, never colour — the surface is the neutral popover
 * recipe (white / hairline / --shadow-card), matching `.sev-filter-menu`.
 */
export function helpTip(lines, { label = "More info" } = {}) {
  const items = Array.isArray(lines) ? lines : [lines];
  const id = `helptip-${++_helpTipSeq}`;
  const bubble = el(
    "span",
    { class: "helptip-bubble", role: "tooltip", id },
    ...items.map((t) => el("span", { class: "helptip-line" }, t)),
  );
  const trigger = el("button", {
    type: "button",
    class: "helptip-trigger",
    "aria-label": label,
    "aria-describedby": id,
    onkeydown: (e) => { if (e.key === "Escape") e.currentTarget.blur(); },
  }, "i");
  return el("span", { class: "helptip" }, trigger, bubble);
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
