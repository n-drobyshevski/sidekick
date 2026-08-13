// Toxic Combinations: what the estate looks like in combination terms, then one card per
// pattern, then the issues inside it.
//
// The page is built around the thing it was previously only asserting. Wiz rates these
// issues MEDIUM and LOW; this register treats them a level higher because the 5Rs
// data-security framework sits at 53%. That used to be a paragraph repeated in all four
// cards. It is now the severity-shift bars: the same population drawn twice on one scale,
// so the amplifier is a shape you can see rather than a claim you have to take.
//
// The condition matrix answers the other half. A toxic combination is a conjunction —
// missing guardrail, excessive privilege, sensitive-data reach — and the matrix shows,
// per pattern, which conditions the source rule tests (a filled mark) and which its
// assets carry anyway (a hollow one). Internet exposure is tested by no rule, so every
// mark in that column is risk stacked on top of the pattern rather than part of it.
//
// All view state (open pattern, filters, sort, page) lives in `view`, outside paint(),
// and is mirrored into the hash. That is what fixes the old bug where a background SWR
// revalidation called paint(fresh) and silently collapsed the table you had open.

import { bootstrap, navigate, setParams, swrCall } from "../store.js";
import { dueChip, fwTags, openAssetSheet, openIssueSheet } from "../detailSheets.js";
import { kindIconSvg, kindLabel, categoryOf } from "../icons.js";
import {
  clear, dataTable, debounce, el, emptyState, errorState, kpiCard, pager, sectionLabel,
  select,
  selectField, sevBadge, sevKeyRow, sevSegmentBar, sevSpoken, skeleton, togglePills,
} from "../ui.js";
import {
  CONDITION_KEYS, ISSUE_COMPARATORS, ISSUE_SORT_DESC, SEVERITY_RANK,
  applyIssueFilters, comboParamPatch, conditionPresent, groupMatches, issueFilterOptions,
  rankGroups, readComboParams, shiftSegments, shiftSummary, sortIssues,
} from "./comboView.js";

/**
 * A condition's kind icon, named so the stylesheet can colour it. kindIconSvg carries no
 * class of its own — the caller names it, as the inventory's asset cards do — and the
 * stroke has to be reached through that name because it lives on the inner <g>.
 */
function condIcon(key, size) {
  const svg = kindIconSvg(key, size);
  svg.setAttribute("class", "kind-icon");
  return svg;
}

/** Asset chips shown before the list folds into a "+N more" button. */
const ASSET_PREVIEW = 8;
const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 200;

// Placeholder shown until api_getToxicCombos resolves; paint() clears the host. It
// mirrors the real page shape — KPI row, the two summary cards, then the pattern stack —
// so the pane reveals a laid-out page instead of growing sections as data lands.
function combosSkeleton(count) {
  const kpis = el("div", { class: "kpi-row" });
  for (let i = 0; i < 4; i++) {
    kpis.append(el("div", { class: "kpi-card" },
      el("div", { class: "skeleton-stack", style: "gap:9px" },
        skeleton("line", { width: "62%" }),
        skeleton("stat", { width: "45%" }),
        skeleton("line", { width: "78%" }))));
  }
  const summary = el("div", { class: "chart-row" },
    el("div", { class: "chart-card" },
      skeleton("line", { width: "220px" }),
      el("div", { class: "skeleton-stack", style: "margin-top:14px; gap:14px" },
        skeleton("line", { height: "26px" }),
        skeleton("line", { height: "26px" }))),
    el("div", { class: "chart-card" },
      skeleton("line", { width: "200px" }),
      el("div", { class: "skeleton-stack", style: "margin-top:14px" },
        ...[0, 1, 2, 3].map(() => skeleton("line", { height: "18px" })))));

  const stack = el("div", {});
  for (let i = 0; i < count; i++) {
    stack.append(el("div", { class: "card combo-card", style: "margin-bottom:16px" },
      el("div", { style: "display:flex; align-items:center; gap:10px" },
        skeleton("line", { width: "min(40%, 26rem)" }),
        skeleton("pill", { width: "150px" })),
      // The real .combo-note is capped at --measure, so a percentage bar here would
      // promise a full-pane slab and then snap back to a third of it.
      el("div", { style: "margin-top:12px" },
        skeleton("line", { width: "min(90%, var(--measure))" })),
      el("div", { style: "display:flex; gap:8px; margin-top:12px" },
        skeleton("pill", { width: "90px" }),
        skeleton("pill", { width: "110px" }),
        skeleton("pill", { width: "70px" })),
      // The affected-asset chips are the widest, tallest part of a real card — without
      // them the placeholder is a short block that jumps when the data arrives.
      el("div", {
        style: "display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:center",
      }, ...["60px", "210px", "180px", "230px", "170px", "200px"]
        .map((w) => skeleton("pill", { width: w }))),
      el("div", { style: "display:flex; gap:8px; margin-top:14px" },
        skeleton("pill", { width: "104px" }),
        skeleton("pill", { width: "118px" }))));
  }
  return el("div", { role: "status", "aria-label": "Loading toxic combinations" },
    kpis, summary, stack);
}

export async function renderCombos(main, params) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Toxic Combinations"),
    el("p", { class: "page-sub" },
      "Multi-condition risk patterns on AI assets: privileged access, sensitive data and " +
      "missing guardrails combined. Wiz severity is shown beside the adjusted severity " +
      "this register adds, never replaced by it."),
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
  host.append(combosSkeleton((boot.comboLegend || []).length || 4));

  // Seeded from the URL so a filtered, sorted, expanded view is shareable — and held out
  // here so an SWR repaint restores it instead of throwing it away.
  const view = readComboParams(params);
  // group id -> the rows api_getIssues answered with. Kept so a repaint re-renders the
  // open table from memory rather than flashing a loading line at the analyst.
  const issueRows = new Map();
  let payload = null;

  function persist() {
    setParams(comboParamPatch(view));
  }

  let data;
  try {
    data = await swrCall("api_getToxicCombos", {}, (fresh) => paint(fresh));
  } catch (e) {
    clear(host).append(errorState("Couldn't load toxic combinations.", {
      detail: String((e && e.message) || e),
    }));
    return;
  }
  paint(data);

  // --------------------------------------------------------------------------- paint

  function paint(fresh) {
    payload = fresh;
    const digest = fresh.digest || null;
    const digestById = new Map(
      ((digest && digest.groups) || []).map((g) => [g.id, g]));
    clear(host);

    // A payload cached before the digest shipped still renders the page — it just can't
    // draw the parts that are made of counts. Honest state beats a blank pane.
    if (digest) {
      host.append(kpiRow(digest.totals), summaryRow(digest, digestById));
    }

    const ranked = rankGroups(fresh.groups || []);
    const shown = ranked.filter((g) => groupMatches(g, digestById.get(g.id), view));

    host.append(patternsHeader(ranked, shown, digestById));

    if (!shown.length) {
      host.append(emptyState(
        "No pattern matches these filters.",
        "Clear the severity or condition filter to see all " + ranked.length + " patterns.",
      ));
      return;
    }
    for (const group of shown) {
      host.append(patternCard(group, digestById.get(group.id)));
    }
  }

  // ------------------------------------------------------------------------- summary

  function kpiRow(totals) {
    const dueSub = totals.noDueDate
      ? totals.dueSoon + " due within 7 days · " + totals.noDueDate + " with no deadline"
      : totals.dueSoon + " due within 7 days";
    return el("div", { class: "kpi-row" },
      kpiCard("Open issues", String(totals.totalOpen),
        totals.reRated + " re-rated by the amplifier"),
      kpiCard("Assets affected", String(totals.assetsAffected),
        "distinct across every pattern"),
      kpiCard("Patterns active", totals.patternsActive + " of " + totals.patternsTotal,
        "combination rules with open issues"),
      kpiCard("Past due", String(totals.pastDue), dueSub),
    );
  }

  function summaryRow(digest, digestById) {
    return el("div", { class: "chart-row" },
      shiftCard(digest.totals),
      matrixCard(digest, digestById));
  }

  /**
   * The amplifier, drawn. Both bars are scaled by the same total, so the second one is
   * the first one's severity mix moved rather than a differently-shaped chart. Each bar
   * is one graphic with a full name; the keys under it repeat every level as dot + word
   * + count, so nothing here is carried by colour alone.
   */
  function shiftCard(totals) {
    const total = totals.totalOpen;
    return el("div", { class: "chart-card" },
      el("h3", {}, "Severity, before and after the amplifier"),
      el("p", { class: "chart-note" },
        "The same " + total + " open issue" + (total === 1 ? "" : "s") +
        ", rated twice. Wiz native above, this register's adjusted severity below."),
      el("div", { class: "combo-shift" },
        shiftRow("Wiz native", totals.nativeMix, total),
        el("div", { class: "combo-shift-rule" },
          el("span", { class: "combo-shift-rule-glyph", "aria-hidden": "true" }, "↓"),
          el("span", {}, "5Rs data security at 53% — restriction controls are failing"),
        ),
        shiftRow("Adjusted", totals.adjustedMix, total),
      ),
      el("p", { class: "small muted", style: "margin:12px 0 0" }, shiftSummary(totals)),
    );
  }

  function shiftRow(label, mix, total) {
    // shiftSegments already returns [{sev, count}] worst-first and is unit-tested in
    // comboView.test.js — it stays the source of truth for what the bar is made of.
    const segments = shiftSegments(mix, total);
    return el("div", { class: "combo-shift-row" },
      el("div", { class: "combo-shift-head" },
        el("span", { class: "label" }, label)),
      sevSegmentBar(segments, {
        size: "lg",
        emptyHatch: true,
        label: `${label} severity: ${segments.length ? sevSpoken(segments) : "no issues"}`,
      }),
      sevKeyRow(segments, { variant: "legend" }));
  }

  /**
   * Rows are patterns, columns are the risk conditions. A filled mark means the source
   * rule tests that condition — it is part of what makes this pattern this pattern. A
   * hollow one means the rule doesn't test it but the affected assets carry it anyway.
   * The counts say how many, because "tests for high privileges OR sensitive data" is a
   * disjunction and 9-of-9 is a very different tenant from 2-of-9.
   */
  function matrixCard(digest, digestById) {
    const ranked = rankGroups(payload.groups || []);
    const grid = el("div", {
      class: "combo-matrix",
      role: "table",
      "aria-label": "Risk conditions by combination pattern",
    });

    const headRow = el("div", { class: "combo-matrix-row", role: "row" });
    headRow.append(el("div", { class: "combo-matrix-corner", role: "columnheader" },
      el("span", { class: "label" }, "Pattern")));
    for (const key of CONDITION_KEYS) {
      const active = view.cond === key;
      headRow.append(el("div", { class: "combo-matrix-colhead", role: "columnheader" },
        el("button", {
          class: "combo-cond-btn",
          "data-category": categoryOf(key),
          "aria-pressed": active ? "true" : "false",
          // Named explicitly because the narrow breakpoint hides the visible label and
          // leaves only the icon. It leads with that same label, so the accessible name
          // still contains the visible one wherever the label is showing.
          "aria-label": kindLabel(key) + ", filter patterns by this condition",
          title: active ? "Clear this filter" : "Show only patterns with this condition",
          onclick: () => {
            view.cond = active ? "" : key;
            view.page = 0;
            persist();
            paint(payload);
          },
        },
          condIcon(key, 14),
          el("span", {}, kindLabel(key)))));
    }
    grid.append(headRow);

    for (const group of ranked) {
      const dg = digestById.get(group.id);
      const row = el("div", { class: "combo-matrix-row", role: "row" });
      row.append(el("div", { class: "combo-matrix-rowhead", role: "rowheader" },
        el("button", {
          class: "combo-matrix-jump",
          onclick: () => openPattern(group.id),
        },
          el("span", { class: "sev-dot sev-fill-" + group.adjustedSeverity, "aria-hidden": "true" }),
          el("span", {}, group.shortLabel),
          el("span", { class: "combo-matrix-jump-num num" }, String(group.count)))));
      for (const key of CONDITION_KEYS) {
        row.append(matrixCell(group, (dg && dg.conditions && dg.conditions[key]) || null, key));
      }
      grid.append(row);
    }

    return el("div", { class: "chart-card" },
      el("h3", {}, "What makes each pattern toxic"),
      el("p", { class: "chart-note" },
        "Filled: the Wiz rule tests this condition. Hollow: the rule doesn't, but the " +
        "affected assets carry it anyway. Counts are assets."),
      grid,
      el("p", { class: "small muted", style: "margin:10px 0 0" },
        "Internet exposure is tested by no rule here, so every mark in that column is " +
        "risk stacked on top of the pattern. “?” is exposure inherited from a host and " +
        "not determined."),
    );
  }

  function matrixCell(group, tally, key) {
    const name = kindLabel(key);
    if (!tally || (!tally.required && !tally.carried && !tally.unknown)) {
      return el("div", { class: "combo-cell", role: "cell" },
        el("span", { class: "combo-cell-mark is-none", "aria-hidden": "true" }, "—"),
        el("span", { class: "sr-only" }, name + ": not present"));
    }
    const marks = [];
    const spoken = [];
    if (tally.carried) {
      marks.push(el("span", {
        class: "combo-cell-mark " + (tally.required ? "is-required" : "is-extra"),
        "aria-hidden": "true",
      }, tally.required ? "●" : "○"));
      marks.push(el("span", { class: "combo-cell-num num" },
        tally.carried === tally.total
          ? String(tally.carried)
          : tally.carried + "/" + tally.total));
      spoken.push((tally.required ? "tested by the rule, carried by " : "carried by ") +
        tally.carried + " of " + tally.total + " assets");
    } else if (tally.required) {
      // The rule tests it, but this tenant's assets don't show it — a disjunctive rule
      // matched on its other arm. Saying nothing here would read as "not tested".
      marks.push(el("span", { class: "combo-cell-mark is-required-only", "aria-hidden": "true" }, "●"));
      marks.push(el("span", { class: "combo-cell-num num muted" }, "0"));
      spoken.push("tested by the rule, carried by no asset");
    }
    if (tally.unknown) {
      marks.push(el("span", { class: "combo-cell-mark is-unknown", "aria-hidden": "true" }, "?"));
      marks.push(el("span", { class: "combo-cell-num num muted" }, String(tally.unknown)));
      spoken.push(tally.unknown + " undetermined");
    }
    return el("div", { class: "combo-cell", role: "cell" },
      ...marks,
      el("span", { class: "sr-only" }, name + ": " + spoken.join(", ")));
  }

  // ------------------------------------------------------------------ pattern header

  function patternsHeader(ranked, shown, digestById) {
    const bar = el("div", { class: "combo-toolbar" });
    bar.append(sectionLabel(
      shown.length === ranked.length
        ? "Patterns"
        : "Patterns — " + shown.length + " of " + ranked.length));

    const present = SEVERITY_RANK.filter((sev) =>
      ranked.some((g) => String(g.adjustedSeverity).toUpperCase() === sev));
    // Single-select: pressing the chosen level again clears it. The level's NAME is the
    // non-colour signal, as on the graph's filter pills.
    const pills = togglePills({
      options: present,
      selected: view.sev,
      ariaLabel: "Filter by adjusted severity",
      onToggle: (sev) => {
        view.sev = view.sev === sev ? "" : sev;
        view.page = 0;
        persist();
        paint(payload);
      },
    });

    const controls = el("div", { class: "combo-toolbar-controls" }, pills);
    if (view.sev || view.cond) {
      controls.append(el("button", {
        class: "link",
        onclick: () => {
          view.sev = "";
          view.cond = "";
          view.page = 0;
          persist();
          paint(payload);
        },
      }, "Clear filters"));
    }
    bar.append(controls);
    return bar;
  }

  function openPattern(id) {
    view.open = id;
    persist();
    paint(payload);
    const card = document.getElementById("combo-" + id);
    if (card) {
      card.scrollIntoView({ block: "start", behavior: "auto" });
      const toggle = card.querySelector(".combo-issues-toggle");
      if (toggle) toggle.focus();
    }
  }

  // -------------------------------------------------------------------- pattern card

  function patternCard(group, dg) {
    const card = el("div", { class: "card combo-card", id: "combo-" + group.id });
    const counts = [
      group.count + " issue" + (group.count === 1 ? "" : "s"),
      (dg ? dg.assetCount : group.assets.length) + " asset" +
        ((dg ? dg.assetCount : group.assets.length) === 1 ? "" : "s"),
    ];
    if (dg && dg.pastDue) counts.push(dg.pastDue + " past due");

    card.append(
      el("div", { class: "combo-head" },
        el("h3", { class: "combo-title" }, group.title),
        shiftBadge(group.nativeSeverity, group.adjustedSeverity),
        el("span", { class: "combo-count num" }, counts.join(" · ")),
      ),
      el("div", { class: "combo-note", role: "note" }, group.amplifierNote),
    );

    const conditions = conditionStrip(group, dg);
    if (conditions) card.append(conditions);

    const fw = fwTags(group.frameworks, false);
    if (fw) card.append(el("div", { style: "margin-top:12px" }, fw));

    if (group.assets.length) card.append(assetRow(group));

    const issuesHost = el("div", { class: "combo-issues" });
    const expanded = view.open === group.id;
    const toggle = el("button", {
      class: "combo-issues-toggle",
      "aria-expanded": expanded ? "true" : "false",
      "aria-controls": "combo-issues-" + group.id,
      onclick: () => {
        view.open = view.open === group.id ? "" : group.id;
        view.page = 0;
        persist();
        paint(payload);
      },
    }, expanded ? "Hide issues" : "Show issues");
    issuesHost.id = "combo-issues-" + group.id;

    card.append(
      el("div", { class: "combo-actions" },
        toggle,
        el("button", {
          onclick: () => navigate("graph", { seed: group.id, seedKind: "combo" }),
        }, "Open in graph"),
      ),
      issuesHost,
    );

    if (expanded) loadIssues(group, issuesHost);
    return card;
  }

  /** Wiz native and adjusted as one reading, not a badge with a caption floating beside it. */
  function shiftBadge(native, adjusted) {
    const from = sevBadge(native);
    const to = sevBadge(adjusted);
    from.setAttribute("aria-hidden", "true");
    to.setAttribute("aria-hidden", "true");
    return el("span", {
      class: "combo-shift-badge",
      role: "img",
      "aria-label": "Wiz native " + native + ", treated as " + adjusted,
    }, from, el("span", { class: "combo-shift-arrow", "aria-hidden": "true" }, "→"), to);
  }

  /** The conditions this rule tests, named — the card's half of the matrix row. */
  function conditionStrip(group, dg) {
    const keys = CONDITION_KEYS.filter((key) => {
      const tally = dg && dg.conditions && dg.conditions[key];
      return tally ? conditionPresent(tally) : (group.conditions || []).indexOf(key) >= 0;
    });
    if (!keys.length) return null;
    const row = el("div", { class: "combo-conds" },
      el("span", { class: "label" }, "Conditions"));
    for (const key of keys) {
      const tally = dg && dg.conditions && dg.conditions[key];
      const required = tally ? tally.required : true;
      row.append(el("span", {
        class: "combo-cond" + (required ? "" : " is-extra"),
        "data-category": categoryOf(key),
        title: required
          ? "Tested by the Wiz rule for this pattern"
          : "Not tested by the rule — carried by these assets anyway",
      },
        condIcon(key, 13),
        el("span", {}, kindLabel(key)),
        // A chip with no figure would read as a flat "present". When the only assets
        // here are the undetermined ones, say so — "?2" is a different claim from "2".
        tally && tally.carried
          ? el("span", { class: "combo-cond-num num" }, String(tally.carried))
          : tally && tally.unknown
            ? el("span", {
              class: "combo-cond-num num",
              title: "Exposure inherited from a host and not determined",
            }, "?" + tally.unknown)
            : null));
    }
    return row;
  }

  function assetRow(group) {
    const row = el("div", { class: "combo-assets" },
      el("span", { class: "label" }, "Assets"));
    const chips = group.assets.map((a) => el("button", {
      class: "asset-chip",
      onclick: () => openAssetSheet(a.id, { seed: a }),
      "aria-label": a.name + ", AARS " + (a.aars === null || a.aars === undefined ? "unscored" : a.aars),
    },
      el("span", { class: "asset-chip-name" }, a.name),
      a.aarsSeverity
        ? el("span", {
          class: "asset-chip-score num sev-" + a.aarsSeverity,
          "aria-hidden": "true",
        }, String(a.aars))
        : null));

    const head = chips.slice(0, ASSET_PREVIEW);
    const tail = chips.slice(ASSET_PREVIEW);
    for (const chip of head) row.append(chip);
    if (tail.length) {
      // The graph's per-kind cap idiom: a long tail folds into one button rather than
      // making the asset list the tallest thing on the card.
      const more = el("button", {
        class: "asset-more",
        onclick: () => {
          for (const chip of tail) row.insertBefore(chip, more);
          more.remove();
        },
      }, "+" + tail.length + " more");
      row.append(more);
    }
    return row;
  }

  // --------------------------------------------------------------------- issue table

  async function loadIssues(group, mount) {
    const cachedRows = issueRows.get(group.id);
    if (cachedRows) {
      renderIssues(group, mount, cachedRows);
      return;
    }
    clear(mount).append(el("div", { role: "status", "aria-label": "Loading issues" },
      skeleton("line", { height: "18px" }),
      el("div", { style: "height:8px" }),
      skeleton("line", { height: "18px" })));
    try {
      const res = await swrCall("api_getIssues", { group: group.id }, (fresh) => {
        issueRows.set(group.id, fresh.rows || []);
        if (view.open === group.id) renderIssues(group, mount, fresh.rows || []);
      });
      issueRows.set(group.id, res.rows || []);
      if (view.open !== group.id) return; // the analyst closed it while we were fetching
      renderIssues(group, mount, res.rows || []);
    } catch (e) {
      clear(mount).append(errorState("Couldn't load the issues for this pattern.", {
        detail: String((e && e.message) || e),
      }));
    }
  }

  function renderIssues(group, mount, rows) {
    clear(mount);
    const options = issueFilterOptions(rows);
    const filtered = applyIssueFilters(rows, view);
    const sorted = view.sort ? sortIssues(filtered, view.sort, view.dir) : filtered;
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (view.page >= pageCount) view.page = pageCount - 1;
    const slice = sorted.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);

    mount.append(
      issueFilterBar(group, mount, rows, options, filtered.length, rows.length),
      issueTable(mount, group, slice),
      pager(view.page, pageCount, sorted.length, (next) => {
        view.page = next;
        persist();
        renderIssues(group, mount, rows);
      }),
    );
  }

  function issueFilterBar(group, mount, rows, options, shownCount, totalCount) {
    const rerender = () => {
      view.page = 0;
      persist();
      renderIssues(group, mount, rows);
    };

    const search = el("input", {
      type: "search",
      value: view.q,
      placeholder: "Asset, region, account, project",
      "aria-label": "Search issues in this pattern",
    });
    // Debounced because every keystroke re-sorts and re-pages the whole group.
    search.addEventListener("input", debounce(() => {
      view.q = search.value;
      rerender();
      const refocus = mount.querySelector("input[type=search]");
      if (refocus) {
        refocus.focus();
        refocus.setSelectionRange(refocus.value.length, refocus.value.length);
      }
    }, SEARCH_DEBOUNCE_MS));

    const bar = el("div", { class: "filter-bar" },
      el("div", { class: "field" }, search),
      issueFilterField("Account", "acct", options.accounts, rerender),
      issueFilterField("Project", "proj", options.projects, rerender),
      el("div", { class: "filter-meta" },
        el("span", { class: "count" },
          shownCount === totalCount
            ? totalCount + " issue" + (totalCount === 1 ? "" : "s")
            : shownCount + " of " + totalCount + " issues")),
    );
    return bar;
  }

  function issueFilterField(labelText, key, values, onChange) {
    return selectField(labelText, select({
      options: values,
      value: view[key],
      ariaLabel: labelText,
      placeholder: "All",
      onChange: (v) => {
        view[key] = v;
        onChange();
      },
    }));
  }

  function issueTable(mount, group, rows) {
    const COLS = [
      { key: "asset", label: "Asset", cell: (i) => i.assetName },
      { key: "severity", label: "Adjusted", cell: (i) => sevBadge(i.adjustedSeverity) },
      { key: "native", label: "Wiz native", cell: (i) => i.nativeSeverity },
      { key: "due", label: "Due", cell: (i) => dueChip(i.dueAt) || "—" },
      { key: "region", label: "Region", cell: (i) => i.region || "—" },
      { key: "account", label: "Account", cell: (i) => i.account || "—" },
      { key: null, label: "Projects", cell: (i) => (i.projects || []).join(", ") || "—" },
    ];

    // `dir` is 1/-1 against each column's natural first-click order (ISSUE_SORT_DESC),
    // which is this page's convention and is unit-tested in comboView.test.js. The shared
    // table only needs to know which way the active column currently reads.
    const descending = view.sort && (ISSUE_SORT_DESC[view.sort] ? view.dir === 1 : view.dir === -1);

    return dataTable({
      columns: COLS.map((col, i) => ({
        key: col.key || `col-${i}`,
        label: col.label,
        sortable: !!col.key,
        cell: col.cell,
      })),
      rows,
      sort: view.sort ? { key: view.sort, descending } : null,
      onSort: (key) => {
        view.dir = view.sort === key ? -view.dir : 1;
        view.sort = key;
        view.page = 0;
        persist();
        renderIssues(group, mount, issueRows.get(group.id) || []);
      },
      onRowOpen: (issue) => openIssueSheet(issue.id),
      rowLabel: (issue) => "Issue on " + issue.assetName,
      emptyText: "No issue in this pattern matches the current filters.",
    });
  }
}
