// AI Inventory: the estate's posture up top, a faceted filter drawer, and the asset
// register as a sortable table or a card grid. Row click opens the shared asset sheet;
// "Open in graph" deep-links.
//
// The page never holds the whole estate unless it's cheap to. api_getAssets answers with
// every row (`all: true`) only while the inventory fits under the server's row ceiling —
// then the filters, the sort, the pager and the facet counts all run in the browser with
// no further RPCs, which is what a Google Apps Script round trip per keystroke deserves.
// Past the ceiling it answers one page at a time and the same controls become server round
// trips: search is debounced harder, a filter change resets to page 1, and each page and
// its facet counts are fetched on demand.
//
// Either way the posture header and the filter vocabulary describe the WHOLE inventory,
// not the page and not the filtered subset — the server aggregates them once per sync, so
// they stay honest when the client is holding 50 rows out of 5,000.
//
// The filter/sort/facet logic itself lives in ../assetQuery.js, a hand-kept mirror of
// src/domain/assetTable.ts that test/assetQueryMirror.test.ts holds to it.

import { bootstrap, listJoin, navigate, setParams, swrCall } from "../store.js";
import { openAssetSheet } from "../detailSheets.js";
import { trendLine } from "../charts.js";
import {
  CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, kindIconSvg, kindLabel,
} from "../icons.js";
import { facetGroup, filterUI } from "../filters.js";
import {
  ASSET_FLAGS, DEFAULT_SORT_DIR, FACET_KEYS,
  facetCounts, filterAssetRows, pageOf, resolveAssetQuery, sortAssetRows,
} from "../assetQuery.js";
import {
  aarsChip, clear, closeActiveSheet, confirmDialog, dataTable, el, emptyState, errorState,
  fmtDate, meter, pager, plural, sectionLabel, sevBadge, sevEntries, sevKeyRow,
  sevSegmentBar, sevSpoken, skeleton, skeletonStack, toast,
} from "../ui.js";

const PAGE_SIZES = [25, 50, 100, 250];
const DEFAULT_PAGE_SIZE = 50;

/** The AARS levels the trend draws. Mirrors TREND_SEVERITIES in src/domain/aarsTrend.ts. */
const CHARTED_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
/** The strip shows every level, INFO included — a distribution that hides its biggest
 *  bucket is not a distribution. The trend still omits it; each says which it is doing. */
const STRIP_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

const FLAG_LABELS = {
  combo: "In a toxic combination",
  guardrail: "Missing a guardrail",
  agentic: "Agentic identity",
};

const FACET_LABELS = {
  aarsSeverities: "AARS severity",
  severities: "Issue severity",
  kinds: "Asset kind",
  clouds: "Cloud",
  regions: "Region",
  projects: "Project",
  flags: "Risk signals",
};

/** Which columns can be sorted, and what each one is called in the header. */
const COLUMNS = [
  { key: "name", label: "Name", sort: "name" },
  { key: "kind", label: "Kind", sort: "kind" },
  { key: "cloud", label: "Cloud", sort: "cloud" },
  { key: "region", label: "Region", sort: "region" },
  { key: "aars", label: "AARS", sort: "aars" },
  { key: "severity", label: "Issues", sort: "severity" },
  { key: "combos", label: "Toxic combo", sort: "combos" },
  { key: "guardrail", label: "Guardrail", sort: null },
  { key: "projects", label: "Projects", sort: null },
  { key: "actions", label: "", sort: null },
];

const VIEWS_KEY = "sidekickai.inventoryViews";
/** Params a saved view carries. Never `page` (a view opens at the top) and never `panel`. */
const VIEW_PARAMS = [
  "q", "aarsSeverities", "severities", "kinds", "clouds", "regions", "projects", "flags",
  "sort", "dir", "view", "size",
];

// -------------------------------------------------------------------- small helpers

/**
 * The score as a quantity beside the chip that gives its level. Neutral graphite on
 * purpose: the level is already colored on the chip, and fifty tinted bars down a page is
 * the wall of color PRODUCT.md rejects. Decorative because aarsChip already names both
 * the number and the level — one announcement per cell, not two.
 */
function aarsMeter(score) {
  return meter(score, { decorative: true, className: "meter--score" });
}

/**
 * Open issues on this asset, split by severity. The row's severity badge says which is
 * worst; this says how many of each, which is the difference between one stray HIGH and
 * a pile of them. Both come from the same issue rows, so they cannot disagree.
 */
function issueBars(counts) {
  const entries = sevEntries(counts, STRIP_SEVERITIES.concat(["UNKNOWN"]));
  if (!entries.length) return null;
  const total = entries.reduce((n, e) => n + e.count, 0);
  // Length carries the volume and the segments carry the mix, so one issue and eight of
  // them don't draw the same bar — a normalized bar would make them identical and say the
  // opposite of what it looks like it says.
  return sevSegmentBar(entries, {
    size: "xs",
    width: `${Math.min(46, 10 + total * 4)}px`,
    label: `${plural(total, "open issue")}: ${sevSpoken(entries, { lower: true })}`,
  });
}

/** Saved views live per browser; a sandboxed iframe or private mode may refuse. */
function readViews() {
  try {
    const raw = window.localStorage.getItem(VIEWS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => v && v.name) : [];
  } catch (e) {
    return null; // storage unavailable — the caller hides the control entirely
  }
}

function writeViews(views) {
  try {
    window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views.slice(0, 12)));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Synchronous placeholder shown until api_getAssets resolves — mirrors the posture header,
 * the toolbar and the table so the boot splash reveals a laid-out page (not a blank pane),
 * and later navigations show structure under the route-overlay veil. Keep its shape in
 * step with paint(): the stub IS the layout, and a stub that predicts the wrong page
 * makes the real content jump when it lands.
 */
function inventorySkeleton() {
  const header = el("div", { class: "inv-header" },
    el("div", { class: "inv-hero" },
      skeleton("line", { width: "70%" }),
      skeleton("stat", { width: "45%" }),
      skeleton("line", { width: "85%" })),
    el("div", { class: "sev-strip" },
      skeleton("line", { width: "40%" }),
      skeleton("line", { height: "10px", radius: "999px" }),
      skeleton("line", { width: "90%" })),
    el("div", { class: "card stat-list" },
      ...Array.from({ length: 4 }, () => skeleton("line", { height: "18px" }))),
  );
  const toolbar = el("div", { class: "inv-toolbar" }, skeleton("line", { height: "34px" }));
  const rows = skeletonStack(8, { height: "18px" });
  return el("div", { role: "status", "aria-label": "Loading inventory" }, header, toolbar, rows);
}

// ------------------------------------------------------------------------ the page

export async function renderInventory(main, params) {
  // A drawer left open by the previous render of this page belongs to that render's state.
  // Drop it before building a new one; `panel=filters` below reopens it against this one.
  closeActiveSheet();
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "AI Inventory"),
    el("p", { class: "page-sub" },
      "Every AI asset and its supporting identity/data surface from the last sync, " +
      "scored with the AI Asset Risk Score (AARS)."),
  );

  if (!boot.latestSync) {
    main.append(emptyState(
      "No sync yet.",
      "Run “Sync now” in the sidebar — without credentials it loads the sample dataset.",
    ));
    return;
  }

  const host = el("div", {});
  main.append(host);
  host.append(inventorySkeleton()); // replaced by paint() once api_getAssets resolves

  // Filter, sort, paging and view state live here (outside paint) so they survive SWR
  // repaints; seeded from the URL so a filtered page is shareable and reloadable. The
  // single-select spellings (?kind=, ?cloud=, ?band=…) still resolve — resolveAssetQuery
  // folds each into its plural dimension.
  let query = paramsToQuery(params);
  let view = params.view === "cards" ? "cards" : "table";
  let panelName = params.panel === "filters" ? "filters" : "";

  function paramsToQuery(p) {
    return resolveAssetQuery({
      ...p,
      page: p.page ? Math.max(0, Number(p.page) - 1) : 0,
      pageSize: PAGE_SIZES.indexOf(Number(p.size)) >= 0 ? Number(p.size) : DEFAULT_PAGE_SIZE,
    });
  }

  function persistParams() {
    setParams({
      q: query.q,
      aarsSeverities: listJoin(query.aarsSeverities),
      severities: listJoin(query.severities),
      kinds: listJoin(query.kinds),
      clouds: listJoin(query.clouds),
      regions: listJoin(query.regions),
      projects: listJoin(query.projects),
      flags: listJoin(query.flags),
      // The single-select spellings were folded into the plural dimensions above; blank
      // them so a link carries one spelling of each filter rather than two.
      kind: "", cloud: "", region: "", project: "", aarsSeverity: "", severity: "", band: "",
      sort: query.sort === "aars" ? "" : query.sort,
      dir: query.dir === DEFAULT_SORT_DIR[query.sort] ? "" : query.dir,
      view: view === "table" ? "" : view,
      panel: panelName,
      page: query.page ? query.page + 1 : "",
      size: query.pageSize === DEFAULT_PAGE_SIZE ? "" : query.pageSize,
    });
  }

  // Every fetch takes a ticket. A response — including a background SWR revalidation of an
  // older request — is dropped unless it's still the newest, so a slow page 2 can't land
  // on top of the page 3 the user has already asked for.
  let ticket = 0;

  function requestParams() {
    return {
      all: true, // the server downgrades this to one page when the estate is too big
      q: query.q,
      aarsSeverities: query.aarsSeverities, severities: query.severities,
      kinds: query.kinds, clouds: query.clouds, regions: query.regions,
      projects: query.projects, flags: query.flags,
      sort: query.sort, dir: query.dir, page: query.page, pageSize: query.pageSize,
    };
  }

  // ---- state shared between paint() and the controls that outlive it
  let payload = null;
  let allMode = true;
  let facets = null;      // current facet counts, whichever side computed them
  let countText = null;   // the one live region on the page
  let resultsHost = null;
  let footerCount = null; // the drawer's running result count
  let syncStrip = null;   // re-marks the distribution strip when the AARS filter changes
  const facetGroups = new Map();

  /** Options for one dimension: the whole-inventory vocabulary, each with its count. */
  function facetOptions(key) {
    const vocab = key === "flags"
      ? ASSET_FLAGS.slice()
      : ((payload && payload.facets && payload.facets[key]) || []);
    const counts = new Map(
      ((facets && facets[key]) || []).map((f) => [f.value, f.count]),
    );
    // A selected value the vocabulary no longer knows (stale link, re-synced estate) is
    // still listed, so it can be switched off rather than silently filtering the table.
    const values = vocab.slice();
    for (const v of query[key]) if (values.indexOf(v) < 0) values.push(v);
    const options = values.map((value) => ({
      value,
      label: key === "kinds" ? kindLabel(value)
        : key === "flags" ? (FLAG_LABELS[value] || value)
        : value,
      count: counts.get(value) || 0,
      sev: (key === "aarsSeverities" || key === "severities") ? value : "",
      group: key === "kinds" ? (CATEGORY_LABELS[categoryOf(value)] || "Other") : "",
    }));
    // Kinds carry a category heading, so they have to arrive grouped — the vocabulary is
    // alphabetical, which would otherwise repeat "AI assets & compute" five times down
    // the list instead of once.
    if (key === "kinds") {
      const rank = (v) => {
        const i = CATEGORY_ORDER.indexOf(categoryOf(v.value));
        return i < 0 ? CATEGORY_ORDER.length : i;
      };
      options.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
    }
    return options;
  }

  // ---- the filter surface, created once so an open drawer survives a repaint
  const panel = filterUI({
    title: "Filter assets",
    subtitle: "Changes apply immediately",
    width: "min(420px, 92vw)",
    entries: () => filterEntries(),
    onPatch: (patch) => {
      for (const key of Object.keys(patch)) query[key] = patch[key];
      onFilterChange();
    },
    onClearAll: () => {
      for (const key of FACET_KEYS) query[key] = [];
      query.q = "";
      onFilterChange();
    },
    onPanelChange: (name) => {
      panelName = name;
      persistParams();
    },
    buildBody: (body, ctx) => buildDrawer(body, ctx),
  });

  /** What is applied right now — one chip per selected value, plus the search term. */
  /**
   * What is narrowing the view right now. `label` is the dimension and `value` is what was
   * picked, kept apart so the shared chip row can print "AARS severity · CRITICAL" with
   * the dimension muted — the same shape graphChips.js emits.
   */
  function filterEntries() {
    const out = [];
    if (query.q) {
      out.push({ key: "q", label: "Name", value: query.q, patch: { q: "" } });
    }
    for (const key of FACET_KEYS) {
      for (const value of query[key]) {
        const sev = (key === "aarsSeverities" || key === "severities") ? value : "";
        const shown = key === "kinds" ? kindLabel(value)
          : key === "flags" ? (FLAG_LABELS[value] || value)
          : value;
        out.push({
          key: `${key}-${value}`,
          label: FACET_LABELS[key] || key,
          value: shown,
          sev,
          patch: { [key]: query[key].filter((v) => v !== value) },
        });
      }
    }
    return out;
  }

  const firstTicket = ++ticket;
  let data;
  try {
    data = await swrCall("api_getAssets", requestParams(), (fresh) => {
      // A revalidation that landed before any interaction: the data itself changed, so
      // repaint the aggregates too.
      if (ticket === firstTicket) paint(fresh);
    });
  } catch (e) {
    clear(host).append(errorState("Couldn't load the inventory.", {
      detail: String(e.message || e),
      onRetry: () => renderInventory(clear(main), params),
    }));
    return;
  }
  paint(data);

  // ------------------------------------------------------------------ painting

  function paint(fresh) {
    payload = fresh;
    allMode = fresh.all !== false;
    clear(host);

    const kpis = fresh.kpis || {};
    // Band captions come from the AARS rule in force, so tuning a threshold on the AARS
    // Rules page renames these rather than leaving them quoting the old model.
    const bandLabel = (sev) => {
      const found = (boot.aarsRule?.bandRanges || []).find((b) => b.severity === sev);
      return found ? found.label : "";
    };

    if (boot.aarsRule?.stale) {
      host.append(
        el("div", { class: "notice warn", role: "status" },
          el("span", {}, "The AARS rule has changed since these scores were computed. " +
            "Recompute them on the AARS Rules page."),
          el("a", { class: "link", href: "#/aars", target: "_self" }, "Open AARS Rules")),
      );
    }

    host.append(postureHeader(kpis, fresh, bandLabel));
    host.append(toolbar());
    host.append(panel.chips);
    panel.chips.classList.add("inv-chips");

    resultsHost = el("div", { class: "table-host" });
    host.append(resultsHost);
    host.append(trendSection(fresh));

    renderResults(fresh);
    panel.sync();
    // Rewrite the URL into the canonical spelling: a link carrying ?kind= or ?band= (or a
    // value the estate no longer has) has already been folded into the plural dimensions,
    // so leave the address bar describing the filters that are actually applied.
    persistParams();
    if (panelName === "filters") panel.open(false);
  }

  // ---- posture header: one hero, one distribution, one stat list
  function postureHeader(kpis, fresh, bandLabel) {
    const counts = fresh.aarsSeverityCounts || {};
    const deltas = fresh.aarsDeltas || null;
    const scored = STRIP_SEVERITIES.reduce((n, sev) => n + (counts[sev] || 0), 0);
    const unscored = Number(fresh.total || 0) - scored;

    const hero = el("div", { class: "inv-hero" },
      el("div", { class: "kpi-label" }, "AI assets"),
      el("div", { class: "hero-value num" }, String(kpis.aiAssets ?? 0)),
      el("div", { class: "inv-hero-sub" },
        `${kpis.agents ?? 0} agents · ${kpis.agenticIdentities ?? 0} agentic identities`),
    );

    // The distribution strip: the page's cross-filter, and the keyboard-reachable twin of
    // clicking a bar. The bar itself is decoration (the keys carry the same numbers as
    // text), and every key is a real toggle button, so nothing here is mouse-only.
    const entries = sevEntries(counts, STRIP_SEVERITIES);
    const selected = () => new Set(query.aarsSeverities);
    const track = sevSegmentBar(entries, { size: "md", selected: selected() });
    const keys = sevKeyRow(entries, {
      variant: "toggle",
      ariaLabel: "Filter by AARS severity",
      isOn: (sev) => query.aarsSeverities.indexOf(sev) >= 0,
      describe: (e) => `${e.sev}, ${plural(e.count, "asset")}` +
        (bandLabel(e.sev) ? `, ${bandLabel(e.sev)}` : ""),
      // A delta only appears where history actually supports one: aarsTrend records
      // per-sync AARS counts, so these two are real. Nothing else on this header has
      // a recorded history, and nothing else gets a chip.
      suffix: (e) => {
        const delta = deltas && deltas.counts ? Number(deltas.counts[e.sev] || 0) : 0;
        if (!delta || (e.sev !== "CRITICAL" && e.sev !== "HIGH")) return null;
        return el("span", {
          class: "chg " + (delta > 0 ? "up" : "down"),
          title: `since the sync of ${fmtDate(deltas.since)}`,
        }, (delta > 0 ? "+" : "") + delta);
      },
      onToggle: (sev) => toggleFacet("aarsSeverities", sev),
    });
    const segs = new Map();
    const keyBtns = new Map();
    entries.forEach((e, i) => {
      segs.set(e.sev, track.children[i]);
      keyBtns.set(e.sev, keys.children[i]);
    });

    const strip = el("div", { class: "sev-strip" },
      el("div", { class: "kpi-label" }, "AARS severity"),
      track,
      keys,
      el("p", { class: "sev-strip-note" },
        `${scored} of ${fresh.total || 0} assets scored` +
        (unscored > 0 ? " · AARS covers AI assets and what they reach" : "") +
        (deltas ? ` · change since ${fmtDate(deltas.since)}` : "")),
    );

    const coverage = kpis.guardrailCoveragePct;
    const stats = el("div", { class: "card stat-list" },
      statRow("Guardrail coverage",
        coverage === null || coverage === undefined ? "—" : `${coverage}%`,
        "agents protected by a guardrail",
        coverage === null || coverage === undefined ? null : coverage),
      statRow("Sensitive data access", String(kpis.sensitiveAccess ?? 0), "AI assets"),
      statRow("Open issues", String(kpis.openIssues ?? 0), "toxic-combination instances"),
      statRow("Compliance gaps", String(kpis.complianceGaps ?? 0), "failing config findings"),
    );

    // The strip is a control, so it has to reflect state it did not itself change — a
    // chip cleared outside it, or the drawer's own AARS facet. Marked in place rather
    // than rebuilt, so the key you just pressed keeps focus.
    syncStrip = () => {
      const active = query.aarsSeverities;
      // Dimming lives on the bar, not on the strip wrapper: the bar is the thing that
      // recedes, and the class that does it now belongs to the shared .sevbar component.
      track.classList.toggle("sevbar--dim", active.length > 0);
      for (const [sev, seg] of segs) {
        seg.setAttribute("data-on", active.indexOf(sev) >= 0 ? "true" : "false");
      }
      for (const [sev, btn] of keyBtns) {
        btn.setAttribute("aria-pressed", active.indexOf(sev) >= 0 ? "true" : "false");
      }
    };

    return el("div", { class: "inv-header" }, hero, strip, stats);
  }

  function statRow(name, value, sub, meterPct) {
    return el("div", { class: "stat-row" },
      el("div", { class: "stat-name" }, name),
      el("div", { class: "stat-figure" },
        el("div", { class: "mini-value num" }, value),
        meterPct === null || meterPct === undefined ? null : meter(meterPct, {
          className: "meter--stat",
          label: `${name}, ${meterPct} percent`,
        })),
      el("div", { class: "stat-sub" }, sub),
    );
  }

  // ---- toolbar
  function toolbar() {
    const searchInput = el("input", {
      type: "search",
      "aria-label": "Search assets by name",
      placeholder: "Search name…",
      value: query.q,
    });
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      // Local filtering can keep up with typing; a server round trip per keystroke can't.
      searchTimer = setTimeout(() => {
        query.q = searchInput.value.trim().toLowerCase();
        onFilterChange();
      }, allMode ? 150 : 400);
    });

    const tableBtn = el("button", {
      "aria-pressed": view === "table" ? "true" : "false",
      onclick: () => setView("table"),
    }, "Table");
    const cardsBtn = el("button", {
      "aria-pressed": view === "cards" ? "true" : "false",
      onclick: () => setView("cards"),
    }, "Cards");
    const viewmode = el("div", {
      class: "viewmode", role: "group", "aria-label": "Result layout",
    }, tableBtn, cardsBtn);

    // role=status so the result count is announced when a filter changes what is shown.
    // It is the ONLY live region on this page: the chips, the facet counts and the badges
    // all change together, and announcing each would be a storm, not information.
    countText = el("span", { class: "count", role: "status" });

    return el("div", { class: "inv-toolbar" },
      el("div", { class: "workbench-search" }, searchInput),
      panel.trigger,
      savedViewsControl(),
      viewmode,
      el("div", { class: "inv-toolbar-end" }, countText),
    );
  }

  function setView(next) {
    if (view === next) return;
    view = next;
    persistParams();
    renderResults(payload);
    // Only the results were replaced; the toggle itself survives, so focus stays put.
    for (const btn of document.querySelectorAll(".viewmode button")) {
      btn.setAttribute("aria-pressed", btn.textContent.toLowerCase() === next ? "true" : "false");
    }
  }

  // ---- saved views (per browser; the URL is the shareable form)
  function savedViewsControl() {
    const views = readViews();
    if (views === null) return null; // storage refused — offer nothing rather than a broken control

    const sel = el("select", { "aria-label": "Saved views" },
      el("option", { value: "" }, views.length ? "Saved views…" : "No saved views"),
      ...views.map((v, i) => el("option", { value: String(i) }, v.name)),
    );
    sel.addEventListener("change", () => {
      const v = views[Number(sel.value)];
      sel.value = "";
      if (!v) return;
      // navigate(), not setParams(): a wholesale state change deserves a history entry, so
      // Back returns to the view they were on.
      navigate("inventory", v.params);
    });

    const save = el("button", {
      onclick: async () => {
        const input = el("input", {
          type: "text", placeholder: "e.g. Agents missing a guardrail",
          "aria-label": "View name",
          style: "width:100%; margin-bottom:4px",
        });
        const ok = await confirmDialog({
          title: "Save this view",
          body: el("div", {},
            el("p", { class: "muted small" },
              "Saves the current filters, sort and layout in this browser. " +
              "To share the view, copy the page link instead."),
            input),
          confirmLabel: "Save",
        });
        const name = input.value.trim();
        if (!ok || !name) return;
        const current = readViews() || [];
        const params = {};
        const hash = {};
        persistParams();
        const qs = location.hash.split("?")[1] || "";
        for (const pair of qs.split("&")) {
          if (!pair) continue;
          const [k, val] = pair.split("=");
          hash[decodeURIComponent(k)] = decodeURIComponent(val || "");
        }
        for (const k of VIEW_PARAMS) if (hash[k]) params[k] = hash[k];
        const next = current.filter((v) => v.name !== name);
        next.unshift({ name, params });
        if (!writeViews(next)) {
          toast("Couldn't save the view — this browser is blocking local storage.", "error");
          return;
        }
        if (next.length > 12) toast("Keeping the 12 most recent views.", "warn");
        // Rebuild the toolbar so the new view is listed.
        paint(payload);
      },
    }, "Save view");

    return el("div", { class: "saved-views" }, sel, save);
  }

  // ---- the filter drawer body
  function buildDrawer(body, ctx) {
    const root = el("div", { class: "sheet-filters" });
    facetGroups.clear();
    for (const key of FACET_KEYS) {
      const group = facetGroup({
        label: FACET_LABELS[key],
        // Named because it is the one dimension that narrows as you add to it.
        hint: key === "flags" ? "all of" : "any of",
        onToggle: (value) => toggleFacet(key, value),
      });
      facetGroups.set(key, group);
      root.append(group.root);
    }
    body.append(root);

    footerCount = el("span", { class: "count num" });
    ctx.footer().append(
      footerCount,
      el("button", {
        class: "link",
        onclick: () => {
          for (const k of FACET_KEYS) query[k] = [];
          query.q = "";
          onFilterChange();
          // Focus deliberately stays in the drawer: the app root is inert while the sheet
          // is open, so handing it to the trigger would drop it on the document.
        },
      }, "Clear all"),
    );

    const sync = () => {
      for (const [key, group] of facetGroups) group.update(facetOptions(key), query[key]);
      if (footerCount) {
        const shown = facets ? facets.matched : 0;
        const total = payload ? payload.total : 0;
        footerCount.textContent = `${shown} of ${total} assets`;
      }
    };
    sync();
    return sync;
  }

  function toggleFacet(key, value) {
    const current = query[key];
    query[key] = current.indexOf(value) >= 0
      ? current.filter((v) => v !== value)
      : current.concat([value]);
    onFilterChange();
  }

  // ------------------------------------------------------------------ update cycle

  function onFilterChange() {
    query.page = 0; // a narrower set makes the old page number meaningless
    persistParams();
    if (allMode) renderResults(payload);
    else reload(null);
    panel.sync();
    if (syncStrip) syncStrip();
  }

  /** Server-mode page/filter change: refetch, keeping the rest of the page in place. */
  function reload(navFocus) {
    const mine = ++ticket;
    resultsHost.setAttribute("aria-busy", "true");
    const settle = (fresh) => {
      if (mine !== ticket) return; // superseded while in flight
      resultsHost.removeAttribute("aria-busy");
      payload = fresh;
      renderResults(fresh);
      panel.sync();
      restoreFocus(navFocus);
    };
    swrCall("api_getAssets", requestParams(), settle)
      .then(settle)
      .catch((e) => {
        if (mine !== ticket) return;
        resultsHost.removeAttribute("aria-busy");
        clear(resultsHost).append(errorState("Couldn't load this page.", {
          detail: String(e.message || e),
          onRetry: () => reload(null),
        }));
      });
  }

  /**
   * Paging and sorting replace the controls that were just used, so keyboard focus falls
   * back to the document. Put it on the same control afterwards, or on its neighbor when
   * the move disabled it (first/last page).
   */
  function restoreFocus(token) {
    if (!token) return;
    if (token.sort) {
      const th = resultsHost.querySelector(`[data-sort="${token.sort}"]`);
      if (th) th.focus();
      return;
    }
    const same = resultsHost.querySelector(`[data-nav="${token.nav}"]`);
    const other = resultsHost.querySelector(
      `[data-nav="${token.nav === "prev" ? "next" : "prev"}"]`);
    const target = same && !same.disabled ? same : (other && !other.disabled ? other : null);
    if (target) target.focus();
  }

  function goToPage(next) {
    const active = document.activeElement;
    const nav = active && active.getAttribute ? active.getAttribute("data-nav") : null;
    query.page = Math.max(0, next);
    persistParams();
    if (allMode) {
      renderResults(payload);
      restoreFocus(nav ? { nav } : null);
    } else {
      reload(nav ? { nav } : null);
    }
  }

  function setSort(key) {
    if (query.sort === key) query.dir = query.dir === "asc" ? "desc" : "asc";
    else {
      query.sort = key;
      query.dir = DEFAULT_SORT_DIR[key];
    }
    query.page = 0;
    persistParams();
    if (allMode) {
      renderResults(payload);
      restoreFocus({ sort: key });
    } else {
      reload({ sort: key });
    }
  }

  // ------------------------------------------------------------------ the results

  function renderResults(current) {
    if (!current) return;
    clear(resultsHost);
    const requested = query.page;

    // All-mode holds every row and slices locally; server-mode is handed exactly the page
    // it asked for, already filtered and sorted by the shared domain module.
    let pageRows;
    let shown;
    let pageCount;
    if (allMode) {
      facets = facetCounts(current.rows, query);
      const filtered = sortAssetRows(
        filterAssetRows(current.rows, query), query.sort, query.dir);
      shown = filtered.length;
      const sliced = pageOf(filtered, query.page, query.pageSize);
      query.page = sliced.page; // a filter can strand the page number
      pageRows = sliced.rows;
      pageCount = sliced.pageCount;
    } else {
      facets = current.facetCounts || null;
      pageRows = current.rows;
      shown = current.filtered;
      pageCount = current.pageCount;
      query.page = current.page; // the server clamps out-of-range pages; mirror it back
    }

    // Either path can land on a different page than was asked for (a filter narrowed the
    // set, or the server clamped a deep link); keep the URL on the page in view.
    if (query.page !== requested) persistParams();

    countText.textContent = `${shown} of ${current.total} assets`;

    resultsHost.append(sectionLabel("Assets"));

    if (!shown) {
      const applied = filterEntries().length;
      resultsHost.append(el("div", { class: "empty", role: "status" },
        el("div", {}, "No assets match these filters."),
        el("p", { class: "small muted" },
          `${applied} filter${applied === 1 ? "" : "s"} applied.`),
        el("div", { class: "empty-actions" },
          el("button", {
            onclick: () => {
              for (const k of FACET_KEYS) query[k] = [];
              query.q = "";
              onFilterChange();
            },
          }, "Clear all filters")),
      ));
      return;
    }

    resultsHost.append(view === "cards" ? cardGrid(pageRows) : assetTable(pageRows));

    const sizeSel = el("select", { "aria-label": "Rows per page" },
      ...PAGE_SIZES.map((n) => el("option", { value: String(n) }, `${n} / page`)));
    sizeSel.value = String(query.pageSize);
    sizeSel.addEventListener("change", () => {
      const firstRow = query.page * query.pageSize; // keep the top of the page in view
      query.pageSize = Number(sizeSel.value);
      goToPage(Math.floor(firstRow / query.pageSize));
    });

    resultsHost.append(
      el("div", { class: "table-footer" }, sizeSel, pager(query.page, pageCount, shown, goToPage)),
    );
  }

  function openRow(row) {
    // The row already holds everything the sheet's header shows, so pass it as the seed:
    // identity and verdict paint on the same frame as the slide-in, and only the body
    // waits for the RPC.
    return () => openAssetSheet(row.id, { seed: row });
  }

  function graphButton(row) {
    return el("button", {
      class: "link",
      onclick: (e) => {
        e.stopPropagation();
        navigate("graph", { seed: row.id });
      },
    }, "Graph");
  }

  function assetTable(rows) {
    /** Cell renderers, keyed to COLUMNS above so header and body cannot drift apart. */
    const CELLS = {
      name: (row) => [row.name,
        row.agentic ? el("span", { class: "pill", style: "margin-left:6px" }, "Agentic") : null],
      kind: (row) => kindLabel(row.kind),
      cloud: (row) => row.cloud || "—",
      region: (row) => row.region || "—",
      aars: (row) => (row.aars === null || row.aars === undefined
        ? el("span", { class: "muted small" }, "—")
        : el("span", { class: "aars-cell" },
            aarsChip(row.aars, row.aarsSeverity), aarsMeter(row.aars))),
      severity: (row) => (row.severity
        ? el("span", { class: "issue-cell" }, sevBadge(row.severity), issueBars(row.issuesBySeverity))
        : "—"),
      combos: (row) => (row.combos ? el("span", { class: "pill bad" }, `TC ×${row.combos}`) : "—"),
      guardrail: (row) => (row.guardrailMissing ? el("span", { class: "pill warn" }, "missing") : "—"),
      projects: (row) => (row.projects || []).join(", ") || "—",
      actions: (row) => graphButton(row),
    };

    return dataTable({
      columns: COLUMNS.map((col) => ({
        key: col.sort || col.key,
        label: col.label,
        sortable: !!col.sort,
        cell: CELLS[col.key],
      })),
      rows,
      // `dir` is this page's own convention ("asc"/"desc", seeded from the URL); the shared
      // table only needs to know which way the active column currently reads.
      sort: query.sort ? { key: query.sort, descending: query.dir === "desc" } : null,
      onSort: setSort,
      onRowOpen: (row) => openRow(row)(),
      rowLabel: (row) => `${row.name}, ${kindLabel(row.kind)}`,
    });
  }

  function cardGrid(rows) {
    const grid = el("div", { class: "asset-grid" });
    for (const row of rows) {
      const svg = kindIconSvg(row.kind, 16);
      svg.setAttribute("class", "asset-card-icon");
      grid.append(el("button", {
        class: "asset-card",
        "aria-label": `${row.name}, ${kindLabel(row.kind)}` +
          (row.aars === null || row.aars === undefined ? "" : `, AARS ${row.aars}`),
        onclick: openRow(row),
      },
        el("div", { class: "asset-card-head" },
          svg,
          el("span", { class: "asset-card-name" }, row.name),
          row.aars === null || row.aars === undefined
            ? null
            : aarsChip(row.aars, row.aarsSeverity)),
        row.aars === null || row.aars === undefined ? null : aarsMeter(row.aars),
        el("div", { class: "asset-card-marks" },
          row.severity ? sevBadge(row.severity) : null,
          issueBars(row.issuesBySeverity),
          row.combos ? el("span", { class: "pill bad" }, `TC ×${row.combos}`) : null,
          row.guardrailMissing ? el("span", { class: "pill warn" }, "no guardrail") : null,
          row.agentic ? el("span", { class: "pill" }, "Agentic") : null),
        el("div", { class: "asset-card-meta" },
          el("span", {}, kindLabel(row.kind)),
          row.cloud ? el("span", {}, row.cloud) : null,
          row.region ? el("span", {}, row.region) : null),
      ));
    }
    return grid;
  }

  // ---- history: one point per sync, and it cannot be backfilled
  function trendSection(fresh) {
    const trend = fresh.aarsTrend || [];
    const ruleChanges = fresh.aarsTrendRuleChanges || [];
    const colorOf = (sev) => (boot.palette?.colors || {})[sev];
    const canvas = el("canvas", {
      "aria-label": "AARS severity over time, one line per level, excluding INFO",
      role: "img",
    });

    const card = el("div", { class: "chart-card" },
      el("h3", {}, "AARS severity over time"),
      el("p", { class: "chart-note" },
        trend.length >= 2
          ? `${trend.length} syncs · INFO not charted`
          : "One point per sync"),
      trend.length >= 2
        ? el("div", { class: "chart-box", style: "height:220px" }, canvas)
        : el("div", { class: "chart-empty", role: "status" },
            trend.length === 1
              ? "One sync recorded so far — the trend draws from the second."
              : "No history yet. Each sync adds a point; earlier syncs can't be recovered."),
      // Points scored under different AARS rules are not on the same scale. Rather than
      // let a threshold edit read as the estate moving, the note names the breaks.
      trend.length >= 2 && ruleChanges.length
        ? el("p", { class: "chart-note warn" },
            `The scoring rule changed ${ruleChanges.length} time` +
            `${ruleChanges.length === 1 ? "" : "s"} in this window ` +
            `(${ruleChanges.map((i) => fmtDate(trend[i].at)).join(", ")}). ` +
            "Points either side of a change were scored by different models.")
        : null,
    );

    if (trend.length >= 2) {
      requestAnimationFrame(() => {
        trendLine(canvas, trend.map((pt) => ({ x: pt.at })), {
          yLabel: "assets",
          series: CHARTED_SEVERITIES.map((sev) => ({
            label: sev,
            color: colorOf(sev),
            data: trend.map((pt) => (pt.counts || {})[sev] ?? 0),
          })),
        });
      });
    }

    return el("div", { class: "inv-history" }, sectionLabel("History"), card);
  }
}
