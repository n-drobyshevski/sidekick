// Attribution — audits how OS findings map onto domains and support groups
// (subscription Wiz/provisioning tag) across the WHOLE register. Unlike
// the other pages it deliberately ignores the header scope
// filters (it measures the mapping itself), so there is no scopeBar here. Coverage KPIs,
// a per-domain coverage table, an unassigned-resource explorer with a closed-loop
// "Attribute…" handoff into Settings, per-rule health, and untagged subscriptions —
// all from one paginated RPC (api_getAttribution).
//
// THIS PAGE AUDITS TWO MECHANISMS, NOT ONE. A finding reaches its domain by the tenant's
// `Wiz/Domain` tag where there is one, and by a manual group's rules where there is not. The
// by-source strip is what separates them, and it is the page's most useful number now: `tag`
// rising and `rule` falling is the estate being tagged, which is the direction of travel. The
// rule-health and unassigned-explorer sections below still audit the FALLBACK only — they are
// about rules, and a tag-attributed finding never reaches a rule to be traced.

import { bootstrap, setParams, swrCall } from "../store.js";
import { renderDomainsEditor } from "./domainsEditor.js";
import {
  clear, el, emptyState, fmtDate, helpTip, kpiCard, pager, settingsPanel,
  statusPill,
} from "../ui.js";

// The engine's placeholder domain for findings that matched no rule (domainRules.UNASSIGNED).
// The client bundle can't import the TS constant; mirrored here like overview.js does.
const UNASSIGNED = "Unassigned";
// Its counterpart for rows that carried no attribution input at all (resolveDomain's
// NOT_ATTRIBUTABLE) — compacted and imported resolved history. Structurally absent from a live
// frame, so this page shows it only if it ever appears.
const NOT_ATTRIBUTABLE = "Not attributable";

// Condition-type -> a short human phrase for the rule-health condition summary. Mirrors the
// shapes domainsEditor.js writes (tag: key/value, name_regex: pattern, subscription/
// support_group: values[]).
function summarizeCondition(c) {
  if (!c || typeof c !== "object") return "?";
  if (c.type === "tag") {
    const key = c.key || "(tag)";
    return c.value ? `tag ${key}=${c.value}` : `tag ${key} set`;
  }
  if (c.type === "name_regex") return `name matches "${c.pattern || ""}"`;
  if (c.type === "subscription") return `subscription in [${(c.values || []).join(", ")}]`;
  if (c.type === "support_group") return `support group in [${(c.values || []).join(", ")}]`;
  return c.type || "?";
}

/** One rule ({ conditions: [...] }) -> "cond AND cond AND …"; its conditions are AND-ed. */
function summarizeRule(rule) {
  const conds = (rule && rule.conditions) || [];
  if (!conds.length) return "(no conditions)";
  return conds.map(summarizeCondition).join(" AND ");
}

// RuleStatus -> [pill kind, label]. Keeps the color/label split honest (never color alone).
const STATUS_PILL = {
  ok: ["ok", "fires"],
  shadowed: ["warn", "shadowed"],
  dead: ["bad", "never matches"],
  malformed: ["neutral", "malformed"],
};

export async function renderAttribution(main, params, ctx) {
  const boot = await bootstrap();

  // Severity scope — the app-wide display setting, as on Overview. scopeParam() shares the
  // default cache entry when nothing is filtered out.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];

  // Current page of the unassigned-resource explorer, mirrored in the hash so
  // #/attribution?page=2 deep-links (0-based; omitted for the first page).
  let page = Math.max(0, parseInt(params.page || "", 10) || 0);

  main.append(
    el("h1", {}, "Attribution"),
    el("p", { class: "page-sub" },
      "How every finding maps onto the manual groups and support groups, across the whole " +
      "register. The header scope switcher is deliberately not " +
      "applied here — this page audits the mapping itself.",
    ),
  );

  if (!boot.latestScan) {
    main.append(emptyState(
      "No scan saved yet.",
      "Use “Run scan” in the sidebar to take the first measurement.",
    ));
    return;
  }

  const bodyHost = el("div", {}, el("p", { class: "muted" }, "Computing attribution…"));
  main.append(bodyHost);

  // Null when every selectable severity is chosen (shares the default cache entry); else the
  // chosen subset. Same contract as overview.js.
  function scopeParam() {
    return sevScope.length === boot.palette.selectable.length ? null : [...sevScope];
  }

  // One paginated RPC; revisits paint instantly from the session cache and repaint in the
  // background only when the revalidated payload differs. The forPage guard drops a late
  // background repaint whose page the user has already navigated away from.
  async function load() {
    const forPage = page;
    const paintIf = (data) => { if (forPage === page) renderBody(data); };
    paintIf(await swrCall("api_getAttribution",
      { severities: scopeParam(), page, pageSize: 50 }, paintIf));
  }
  await load();

  function goPage(p) {
    if (p < 0 || p === page) return;
    page = p;
    setParams(page ? { page } : {});
    load();
  }

  function renderBody(data) {
    clear(bodyHost);
    if (!data || !data.flatScan) {
      bodyHost.append(emptyState(
        "The ledger holds no per-finding scan yet.",
        "Attribution needs a flat (per-finding) scan — grouped scans carry only counts. " +
        "Run a scan from the sidebar.",
      ));
      return;
    }

    const coverage = data.coverage || {};
    const unassigned = data.unassigned || { rows: [], total: 0, page: 0, pageCount: 0 };
    const ruleHealthRows = data.ruleHealth || [];
    const untagged = data.untagged || [];
    const supportGroups = data.supportGroups || null;
    const sgMap = data.supportGroupMap || { configured: false, keys: 0, groups: 0, tagKey: "" };

    // Honest source: when the latest scan is grouped (counts only), these sections read the
    // last per-finding scan. Same note Overview shows.
    if (data.scan && data.scan.scanId && data.scan.scanId !== boot.latestScan.scanId) {
      bodyHost.append(el("p", { class: "small muted" },
        `The latest scan is grouped (counts only) — attribution reads the last per-finding ` +
        `scan from ${fmtDate(data.scan.ts)}.`));
    }

    renderKpis(coverage, unassigned, untagged);
    renderCoverageTable(coverage);
    renderSupportGroupCoverage(supportGroups, sgMap);

    // THE LEDGER LIST IS CHECKED BEFORE THE ALL-CLEAR, and that ordering is the whole point.
    // Every figure above is about the current scan, so an operator who has just fixed their
    // tagging lands squarely in the branch below — and used to be told "Everything is
    // attributed" by a page that had never looked at the ledger, while the MTTR by-domain
    // split drew an Unassigned bar over resolved history. The celebration is only honest when
    // BOTH populations are clean.
    const ledgerRows = data.unassignedLedger || [];
    const frameClear = (coverage.unassignedFindings || 0) === 0 &&
      (coverage.supportGroupUnresolved || 0) === 0;
    if (frameClear && !ledgerRows.length) {
      bodyHost.append(emptyState(
        "Everything is attributed.",
        "Every finding maps to a manual group and every subscription with findings carries a " +
        "support group, in this scan and across the ledger. Nothing to troubleshoot.",
      ));
      return;
    }
    // Live attribution is complete and the history is not — the reported case. The frame-side
    // diagnostics have nothing to say, so they are skipped and only the ledger list is drawn.
    if (frameClear) {
      bodyHost.append(el("p", { class: "section-note" },
        "Every finding in the current scan is attributed. The lifecycles below are not, and "
        + "they are the ones the MTTR by-domain split draws as Unassigned."));
      renderUnassignedLedger(ledgerRows);
      return;
    }

    // Inline domain-rule editing: a hidden editor instance whose dialog opens over the audit
    // page. onCommitted saves each Apply immediately and ctx.refresh() re-runs the audit, so a
    // rule gets fixed here without a trip to Settings. (The visible domain-management list —
    // reorder / add / import — stays in Settings; the "Edit domains in Settings →" link reaches it.)
    const editorHost = el("div", { style: "display:none" });
    bodyHost.append(editorHost);
    const editor = renderDomainsEditor(editorHost, boot, ctx, { onCommitted: () => editor.save() });

    renderUnassigned(unassigned, editor);
    renderRuleHealth(ruleHealthRows, editor);
    renderUntagged(untagged, sgMap);
    renderUnassignedLedger(ledgerRows);
  }

  // ------------------------------------------------- unassigned lifecycles (ledger)

  /** The base rows behind the MTTR by-domain split's Unassigned bar.
   *
   *  Separate from `renderUnassigned` above because it answers a different question over a
   *  different population: that one lists live RESOURCES a rule could still be written for,
   *  this one lists LIFECYCLES — mostly resolved, mostly unreachable — whose stored tag
   *  snapshot predates whatever fixed the live estate. `Last seen` is the column that decides
   *  whether a row is worth chasing: a recent one will heal on the next scan, an old one will
   *  not, because Wiz no longer re-lists it for any scan to refresh. */
  function renderUnassignedLedger(rows) {
    if (!rows || !rows.length) return;
    const body = el("tbody", {});
    for (const r of rows) {
      const nm = (r.nearMisses || [])[0];
      const tagEntries = Object.entries(r.tags || {});
      body.append(el("tr", {},
        el("td", {},
          el("div", {}, r.asset),
          nm
            ? el("div", { class: "small muted" },
              "almost matches ", el("em", {}, nm.domain), ` — rule ${nm.ruleIndex + 1}`,
              (nm.failedTypes && nm.failedTypes.length)
                ? `, failing: ${nm.failedTypes.join(", ")}` : "")
            : null,
        ),
        el("td", { class: "muted" }, r.subscription || "—"),
        el("td", { class: "muted" }, r.supportGroup || "—"),
        el("td", { class: "num" }, (r.open || 0).toLocaleString()),
        el("td", { class: "num" }, (r.resolved || 0).toLocaleString()),
        el("td", { class: "muted" }, r.lastSeen ? fmtDate(r.lastSeen) : "—"),
        el("td", { class: "small muted" },
          tagEntries.length ? tagEntries.map(([k, v]) => `${k}=${v}`).join(", ") : "no tags"),
      ));
    }
    bodyHost.append(settingsPanel({
      title: "Unassigned lifecycles (ledger)",
      description:
        "Findings the register still holds that no tag and no rule claims — the rows behind "
        + "the MTTR by-domain split's Unassigned bar. Mostly resolved history: the tag bag "
        + "stored on a lifecycle is a snapshot from when it was last seen, so fixing tagging "
        + "today cannot reach one Wiz no longer re-lists. A recent Last seen will heal on the "
        + "next scan; an old one will not.",
      body: el("div", { class: "table-wrap" },
        el("table", { class: "data" },
          el("thead", {}, el("tr", {},
            el("th", { scope: "col" }, "Asset"),
            el("th", { scope: "col" }, "Subscription"),
            el("th", { scope: "col" }, "Support group"),
            el("th", { scope: "col" }, "Open"),
            el("th", { scope: "col" }, "Resolved"),
            el("th", { scope: "col" }, "Last seen"),
            el("th", { scope: "col" }, "Stored tags"))),
          body)),
    }));
  }

  // ------------------------------------------------------------------ KPI band

  function renderKpis(coverage, unassigned, untagged) {
    const total = coverage.totalFindings || 0;
    const attributed = coverage.attributedFindings || 0;
    const pct = total ? Math.round((attributed / total) * 100) : 0;
    // Prefer the coverage engine's distinct-asset count; fall back to the paginated total.
    const unassignedResources = typeof coverage.unassignedAssets === "number"
      ? coverage.unassignedAssets
      : (unassigned.total || 0);
    bodyHost.append(el("div", { class: "kpi-row" },
      kpiCard("Attributed findings", `${attributed.toLocaleString()} (${pct}%)`,
        `of ${total.toLocaleString()} findings`),
      kpiCard("Unassigned findings", (coverage.unassignedFindings || 0).toLocaleString(),
        "no tag, and matched no rule"),
      kpiCard("Unassigned resources", unassignedResources.toLocaleString(),
        "distinct assets with no domain"),
      kpiCard("Untagged subscriptions", untagged.length.toLocaleString(),
        "no support group tag"),
    ));
    renderBySource(coverage.bySource, total, boot.domainTagKey);
  }

  // WHICH MECHANISM CLAIMED EACH FINDING — the split the two KPIs above cannot show, because
  // "attributed" is now the sum of two very different stories. Rendered as one line of figures
  // rather than four more cards: it is a composition, and four cards would read as four
  // independent measures. Omitted entirely on a payload without `bySource` (a cached
  // pre-upgrade entry) rather than drawn as four zeroes, which would read as total failure.
  function renderBySource(bySource, total, tagKey) {
    if (!bySource) return;
    const parts = [
      ["tag", `by ${tagKey || "Wiz/Domain"} tag`],
      ["rule", "by a manual group rule"],
      ["none", "claimed by neither"],
      ["missing", "no attribution input"],
    ].filter(([k]) => (bySource[k] || 0) > 0 || k === "tag" || k === "rule");
    const line = el("p", { class: "small muted", style: "margin:-4px 0 14px" },
      "Attributed ");
    parts.forEach(([k, label], i) => {
      const n = bySource[k] || 0;
      const pctOf = total ? Math.round((n / total) * 100) : 0;
      if (i) line.append(" · ");
      line.append(el("strong", {}, n.toLocaleString()), ` ${label} (${pctOf}%)`);
    });
    bodyHost.append(line);
  }

  // -------------------------------------------------------- coverage by domain

  function renderCoverageTable(coverage) {
    const byDomain = coverage.byDomain || [];
    if (!byDomain.length) {
      bodyHost.append(settingsPanel({
        title: "Coverage by domain",
        body: emptyState("Nothing to split — no Wiz/Domain tags and no manual groups.",
          "Tag resources in Wiz, or add manual groups in Settings, to attribute findings."),
      }));
      return;
    }
    const total = coverage.totalFindings || 0;
    const body = el("tbody", {});
    for (const d of byDomain) {
      const isUnassigned = d.domain === UNASSIGNED;
      const isMissing = d.domain === NOT_ATTRIBUTABLE;
      const share = total ? d.findings / total : 0;
      // Zero-count real domains never matched anything (possibly dead); a non-empty
      // Unassigned row is a coverage gap. Never a warning on an empty Unassigned row (good).
      // `Not attributable` is NEITHER: nothing an operator does here can close it, so flagging
      // it as a gap would put a permanent red pill beside work that does not exist.
      const marker = isMissing
        ? statusPill("neutral", "no inputs")
        : isUnassigned
          ? (d.findings > 0 ? statusPill("bad", "coverage gap") : null)
          : (d.findings === 0 ? statusPill("warn", "no matches") : null);
      body.append(el("tr", {},
        el("td", {},
          el("span", { style: "display:inline-flex; align-items:center; gap:8px" },
            el("strong", {}, d.domain), marker)),
        el("td", { class: "num" }, (d.findings || 0).toLocaleString()),
        el("td", { class: "num" }, (d.assets || 0).toLocaleString()),
        el("td", {},
          el("div", { class: "mix-cell" },
            shareBar(share),
            el("span", { class: "mix-text small muted num" }, `${Math.round(share * 100)}%`))),
      ));
    }
    bodyHost.append(settingsPanel({
      title: "Coverage by domain",
      description: "How this scan's findings distribute across domains — Wiz/Domain tag values "
        + "and the manual groups that claim what is untagged.",
      body: el("div", { class: "table-wrap panel-flush" },
        el("table", { class: "data" },
          el("thead", {}, el("tr", {},
            ...["Domain", "Findings", "Assets", "Share"].map((h) => el("th", { scope: "col" }, h)))),
          body)),
    }));
  }

  // -------------------------------------------------- coverage by support group

  // The support-group dual of the value-chain coverage table, plus a map-health line — the
  // view for troubleshooting why findings resolve to (none). A finding's support group is the
  // Wiz/provisioning tag of its subscription, resolved live from the refreshed map; the "(none)"
  // row is the unresolved bucket (subscription untagged, or its identity not joining the map).
  function renderSupportGroupCoverage(sg, sgMap) {
    sg = sg || { rows: [], totalFindings: 0, resolvedFindings: 0 };
    const notes = [];

    // Map-health note: the one line that tells an unrefreshed map (0 keys) apart from a
    // populated one that isn't joining the findings' subscription identity (keys > 0 yet
    // nothing resolves) — the two failure modes an operator otherwise can't distinguish.
    if (!sgMap.configured) {
      notes.push(el("p", { class: "section-note", style: "margin-top:0" },
        "Support groups aren’t mapped yet — every finding resolves to (none). Use “Refresh " +
        "support groups” in ",
        el("a", { href: "#/settings", target: "_self" }, "Settings"), " to build the map."));
    } else {
      const total = sg.totalFindings || 0;
      const resolved = sg.resolvedFindings || 0;
      const pct = total ? Math.round((resolved / total) * 100) : 0;
      const stuck = (sgMap.keys || 0) > 0 && resolved === 0 && total > 0;
      notes.push(el("p", { class: "section-note", style: "margin-top:0" },
        `Map: ${(sgMap.keys || 0).toLocaleString()} subscription key${sgMap.keys === 1 ? "" : "s"} → `
        + `${(sgMap.groups || 0).toLocaleString()} group${sgMap.groups === 1 ? "" : "s"} (tag `,
        el("code", {}, sgMap.tagKey || "Wiz/provisioning"),
        `). ${resolved.toLocaleString()} of ${total.toLocaleString()} findings resolved (${pct}%).`));
      // Keys present but nothing joins → a subscription-identity mismatch, not an empty map.
      // Its own paragraph (statusPill is inline, but the copy is a distinct diagnostic line).
      if (stuck) {
        notes.push(el("p", { class: "small", style: "margin-top:-4px" },
          statusPill("bad", "not joining"),
          " The map has keys but no finding matched — the subscription identity on findings "
          + "isn’t joining the map. Check the tag key and that findings carry the same "
          + "subscription id / external id / name the map is indexed under."));
      }

      // The concrete map side of the join: a sample of the identity tokens the map is
      // indexed under (folded, exactly as the join compares them). Shown only when something
      // is unresolved — the case where eyeballing them against the subscription id / ext id /
      // name in the Untagged subscriptions table below reveals a mismatch. Chips, not prose,
      // so the actual values are scannable.
      const sample = sgMap.sampleKeys || [];
      if (sample.length && (sg.unresolvedFindings || 0) > 0) {
        const more = (sgMap.keys || 0) - sample.length;
        const chips = [];
        sample.forEach((k, i) => {
          if (i) chips.push(document.createTextNode(", "));
          chips.push(el("code", {}, k));
        });
        notes.push(el("p", { class: "small muted", style: "margin-top:-4px" },
          "Indexed under (sample): ", ...chips,
          more > 0 ? ` … (+${more.toLocaleString()} more)` : "",
          ". Compare these against the subscription id / external id / name your findings "
          + "carry — the Untagged subscriptions table below lists the unresolved ones."));
      }
    }

    const rows = sg.rows || [];
    if (!rows.length) {
      bodyHost.append(settingsPanel({
        title: "Coverage by support group",
        body: [...notes, emptyState("No findings to attribute to a support group.")],
      }));
      return;
    }
    const total = sg.totalFindings || 0;
    const body = el("tbody", {});
    for (const g of rows) {
      const share = total ? g.findings / total : 0;
      // A non-empty "(none)" row is the unresolved gap; resolved groups carry no marker.
      const marker = g.unresolved && g.findings > 0 ? statusPill("bad", "unresolved") : null;
      body.append(el("tr", {},
        el("td", {},
          el("span", { style: "display:inline-flex; align-items:center; gap:8px" },
            el("strong", {}, g.group), marker)),
        el("td", { class: "num" }, (g.findings || 0).toLocaleString()),
        el("td", { class: "num" }, (g.assets || 0).toLocaleString()),
        el("td", {},
          el("div", { class: "mix-cell" },
            shareBar(share),
            el("span", { class: "mix-text small muted num" }, `${Math.round(share * 100)}%`))),
      ));
    }
    bodyHost.append(settingsPanel({
      title: "Coverage by support group",
      description: "A finding's support group is its subscription's Wiz/provisioning tag.",
      body: [...notes, el("div", { class: "table-wrap panel-flush" },
        el("table", { class: "data" },
          el("thead", {}, el("tr", {},
            ...["Support group", "Findings", "Assets", "Share"].map((h) => el("th", { scope: "col" }, h)))),
          body))],
    }));
  }

  // ------------------------------------------------------- unassigned resources

  function renderUnassigned(unassigned, editor) {
    const rows = unassigned.rows || [];
    if (!rows.length) {
      bodyHost.append(settingsPanel({
        title: "Unassigned resources",
        body: emptyState("No unassigned resources on this page.",
          "Every finding here maps to a manual group."),
      }));
      return;
    }
    const body = el("tbody", {});
    for (const r of rows) {
      // Top near-miss as a muted second line under the asset name ("almost matches
      // Payments — rule 2, failing: tag"). ruleIndex is 0-based; show it 1-based.
      const nm = (r.nearMisses || [])[0];
      const nearLine = nm
        ? el("div", { class: "small muted" },
            "almost matches ", el("em", {}, nm.domain), ` — rule ${nm.ruleIndex + 1}`,
            (nm.failedTypes && nm.failedTypes.length)
              ? `, failing: ${nm.failedTypes.join(", ")}` : "")
        : null;
      const tagEntries = Object.entries(r.tags || {});
      const tagsText = tagEntries.length
        ? tagEntries.map(([k, v]) => `${k}=${v}`).join(", ")
        : "—";
      body.append(el("tr", {},
        el("td", {}, el("strong", {}, r.asset || "—"), nearLine),
        el("td", {}, r.assetType || "—"),
        el("td", {}, r.subscription || "—"),
        el("td", {}, r.supportGroup ? r.supportGroup : statusPill("neutral", "(none)")),
        el("td", {}, el("span", { class: "small muted" }, tagsText)),
        el("td", {},
          el("div", { class: "mix-cell" },
            mixStrip(r.sevCounts || {}),
            el("span", { class: "mix-text small muted num" },
              mixText(r.sevCounts || {}) || `${(r.findings || 0).toLocaleString()}`))),
        el("td", {},
          el("button", { type: "button", title: `Attribute ${r.asset || "resource"}`,
            onclick: () => editor.openWithPrefill({
              asset: r.asset, subscription: r.subscription,
              subscriptionExtId: r.subscriptionExtId, supportGroup: r.supportGroup,
            }) }, "Attribute…")),
      ));
    }
    bodyHost.append(settingsPanel({
      title: "Unassigned resources",
      description: "Assets whose findings matched no rule. “Attribute…” seeds a new " +
        "rule for the resource in the manual-group editor.",
      body: [
        el("div", { class: "table-wrap panel-flush" },
          el("table", { class: "data" },
            el("thead", {}, el("tr", {},
              ...["Asset", "Type", "Subscription", "Support group", "Tags", "Findings", ""]
                .map((h) => el("th", { scope: "col" }, h)))),
            body)),
        pager(unassigned.page || 0, unassigned.pageCount || 1,
          unassigned.total || rows.length, goPage),
      ],
    }));
  }

  // --------------------------------------------------------------- rule health

  function renderRuleHealth(rows, editor) {
    const desc = ["How each mapping rule performs against this scan. ",
      helpTip(el("span", { class: "linklike" }, "status guide"),
        ["Fires — claims findings under first-match priority.",
         "Shadowed — matches findings, but an earlier rule or group claims them first.",
         "Never matches — matches nothing in this scan (a dead rule).",
         "Malformed — the rule failed to compile and never matches."])];
    const footer = el("a", { href: "#/settings", target: "_self" },
      "Edit manual groups in Settings →");
    if (!rows.length) {
      bodyHost.append(settingsPanel({
        title: "Rule health", description: desc, footer,
        body: emptyState("No rules to check.",
          "Add manual groups in Settings to route findings."),
      }));
      return;
    }
    const items = (boot.settings.domains && boot.settings.domains.items) || [];
    const body = el("tbody", {});
    for (const rh of rows) {
      const rule = items[rh.domainIndex] && items[rh.domainIndex].rules
        ? items[rh.domainIndex].rules[rh.ruleIndex] : null;
      const [kind, label] = STATUS_PILL[rh.status] || ["neutral", rh.status || "?"];
      body.append(el("tr", {},
        el("td", {}, el("strong", {}, rh.domain)),
        el("td", {}, el("span", { class: "small muted" }, summarizeRule(rule))),
        el("td", { class: "num" }, (rh.fired || 0).toLocaleString()),
        el("td", { class: "num" }, (rh.matched || 0).toLocaleString()),
        el("td", {}, statusPill(kind, label)),
        el("td", {}, el("button", { type: "button", title: `Edit ${rh.domain}`,
          onclick: () => editor.openEditor(rh.domainIndex) }, "Edit")),
      ));
    }
    bodyHost.append(settingsPanel({
      title: "Rule health", description: desc, footer,
      body: el("div", { class: "table-wrap panel-flush" },
        el("table", { class: "data" },
          el("thead", {}, el("tr", {},
            ...["Manual group", "Rule", "Fired", "Matched", "Status", ""].map((h) => el("th", { scope: "col" }, h)))),
          body)),
    }));
  }

  // ------------------------------------------------------ untagged subscriptions

  function renderUntagged(untagged, sgMap) {
    if (!sgMap.configured) {
      bodyHost.append(settingsPanel({
        title: "Untagged subscriptions",
        body: emptyState(
          "Support groups aren’t mapped yet.",
          el("span", {}, "Use “Refresh support groups” in ",
            el("a", { href: "#/settings", target: "_self" }, "Settings"),
            " to identify which subscriptions carry a support group.")),
      }));
      return;
    }
    const desc = "A subscription’s support group is the value of its Wiz/provisioning tag. " +
      "These subscriptions carry findings but no such tag, so their findings resolve to (none).";
    if (!untagged.length) {
      bodyHost.append(settingsPanel({
        title: "Untagged subscriptions", description: desc,
        body: emptyState("Every subscription with findings carries a support group."),
      }));
      return;
    }
    const body = el("tbody", {});
    for (const u of untagged) {
      body.append(el("tr", {},
        el("td", {}, el("strong", {}, u.subscription)),
        el("td", {}, u.extId),
        el("td", { class: "num" }, (u.assets || 0).toLocaleString()),
        el("td", {},
          el("div", { class: "mix-cell" },
            mixStrip(u.sevCounts || {}),
            el("span", { class: "mix-text small muted num" },
              mixText(u.sevCounts || {}) || `${(u.findings || 0).toLocaleString()}`))),
      ));
    }
    bodyHost.append(settingsPanel({
      title: "Untagged subscriptions", description: desc,
      body: el("div", { class: "table-wrap panel-flush" },
        el("table", { class: "data" },
          el("thead", {}, el("tr", {},
            ...["Subscription", "Ext ID", "Assets", "Findings"].map((h) => el("th", { scope: "col" }, h)))),
          body)),
    }));
  }

  // ----------------------------------------------------------------- helpers

  /** Single-value proportional bar reusing the mix-strip idiom: one accent fill at `fraction`
   *  of the width. Decorative — the exact percent rides in the visible .mix-text beside it. */
  function shareBar(fraction) {
    const strip = el("div", { class: "mix-strip", "aria-hidden": "true" });
    const span = el("span", {});
    span.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    span.style.background = "var(--accent)";
    strip.append(span);
    return strip;
  }

  /** Proportional severity-mix bar. Decorative (aria-hidden); the exact counts ride in the
   *  visible .mix-text the caller renders beside it. Copied from overview.js. */
  function mixStrip(sevCounts) {
    const total = boot.palette.order.reduce((a, s) => a + (sevCounts[s] || 0), 0);
    const strip = el("div", { class: "mix-strip", "aria-hidden": "true" });
    if (!total) return strip;
    for (const s of boot.palette.order) {
      if (!sevCounts[s]) continue;
      const span = el("span", {});
      span.style.width = `${(sevCounts[s] / total) * 100}%`;
      span.style.background = boot.palette.colors[s];
      strip.append(span);
    }
    return strip;
  }

  function mixText(sevCounts) {
    return boot.palette.order
      .filter((s) => sevCounts[s])
      .map((s) => `${s} ${sevCounts[s]}`)
      .join(" · ");
  }
}
