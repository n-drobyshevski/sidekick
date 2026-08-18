// Shared drill-down sheets: asset detail (verdict, evidence, AARS pillars, topology,
// identity) and issue detail (justification, fix, frameworks, amplifier note). Used by
// the graph, inventory, and combos pages so every surface opens the same drawer.
//
// Order is a decision, not a layout: the verdict and the fix come before the ledger of
// infrastructure facts, because the analyst opened this to decide something.

import { bootstrapCached, navigate, swrCall } from "./store.js";
import { egoGraph } from "./egoGraph.js";
import { expansionStatus, mergeLiveRels, shouldAutoExpand } from "./egoLayout.js";
import { categoryOf, edgeLabel, kindIconSvg, kindLabel } from "./icons.js";
import { severityMixText } from "./graphNode.js";
import { slaState } from "./pages/comboView.js";
import {
  assetSections, configFindingSections, issueSections, recordCursor,
} from "./recordSections.js";
import {
  FINDINGS_SCORE_LABEL, clear, codeBlock, copyButton, el, emptyState, errorState, fmtDate,
  fmtDateTime,
  meter, openSheet, outcomeBadge, percentileText, plural, scoreChip, sevBadge, sheetRow,
  sheetSection, skeleton, statusPill, tierBadge, uiIcon,
} from "./ui.js";

/** Fallback only — the caps in force ride on the bootstrap payload. */
const PILLAR_MAX = { toxic: 50, compliance: 30, data: 22 };
const PILLAR_LABEL = {
  toxic: "Toxic combinations",
  compliance: "Compliance gaps",
  data: "Data exposure",
};
const NEIGHBOR_PREVIEW = 12;

/**
 * The pillar ceilings the score was actually computed against. They are editable on the
 * AARS Rules page, so reading them off the rule keeps the bars, the x/max labels and the
 * announced aria-valuemax honest after an edit.
 */
function pillarCaps() {
  const boot = bootstrapCached();
  return (boot && boot.aarsRule && boot.aarsRule.pillarCaps) || PILLAR_MAX;
}

/** The combination's own name — "Toxic combination" alone doesn't say which one. */
function comboTitle(id) {
  const boot = bootstrapCached();
  const legend = (boot && boot.comboLegend) || [];
  const hit = legend.filter((g) => g.id === id)[0];
  return hit ? hit.title : "Toxic combination";
}

/** The combination's amplifier note — what the issue sheet seeds without a round trip. */
function comboNote(id) {
  const boot = bootstrapCached();
  const legend = (boot && boot.comboLegend) || [];
  const hit = legend.filter((g) => g.id === id)[0];
  return hit ? hit.amplifierNote : "";
}

function pillarBars(pillars, caps) {
  const wrap = el("div", {});
  for (const key of ["toxic", "compliance", "data"]) {
    const value = Number(pillars[key] ?? 0);
    const max = Number(caps[key] ?? PILLAR_MAX[key]) || 1;
    wrap.append(
      el("div", { class: "pillar-row" },
        el("span", { class: "pillar-name" }, PILLAR_LABEL[key]),
        meter(value, {
          max,
          className: "meter--flex",
          label: `${PILLAR_LABEL[key]}, ${value} of ${max} points`,
        }),
        el("span", { class: "pillar-val" }, `${value}/${max}`),
      ),
    );
  }
  return wrap;
}

// Framework mappings are lookup keys, not narrative: grouped by taxonomy so four
// vocabularies stop reading as one undifferentiated row of codes.
const FW_GROUPS = [
  { key: "owaspLlm", label: "OWASP LLM" },
  { key: "owaspAgentic", label: "OWASP Agentic" },
  { key: "owaspMl", label: "OWASP ML" },
  { key: "fiveRs", label: "5Rs" },
];

/**
 * `compact` collapses the four families into one strip — a list row is a preview, and four
 * labelled lines per row buries the rule name it sits under. The issue sheet, where the
 * mappings are the subject, gets the grouped form.
 */
export function fwTags(frameworks, compact) {
  if (!frameworks) return null;
  if (compact) {
    const codes = [];
    for (const g of FW_GROUPS) {
      for (const c of frameworks[g.key] || []) codes.push(c);
    }
    if (!codes.length) return null;
    return el("div", { class: "fw-tags" }, ...codes.map((c) => el("span", { class: "fw-tag" }, c)));
  }
  const groups = [];
  for (const g of FW_GROUPS) {
    const codes = frameworks[g.key] || [];
    if (!codes.length) continue;
    groups.push(
      el("div", { class: "fw-group" },
        el("span", { class: "fw-group-label" }, g.label),
        el("div", { class: "fw-tags" }, ...codes.map((c) => el("span", { class: "fw-tag" }, c))),
      ),
    );
  }
  return groups.length ? el("div", { class: "fw-groups" }, ...groups) : null;
}

/**
 * The SLA deadline as a verdict, never as a raw ISO string. The verdict itself comes
 * from slaState so the sheet, the combos issue table and the combos KPI row cannot
 * disagree about when something is overdue or merely due soon.
 */
export function dueChip(dueAt) {
  const sla = slaState(dueAt, Date.now());
  if (!sla) return null;
  return el(
    "span",
    { class: `pill ${sla.kind}`, title: `Due ${fmtDateTime(dueAt)}` },
    sla.label,
  );
}

function kvRow(dt, dd) {
  return [el("dt", {}, dt), el("dd", {}, dd)];
}

/** A fact worth a row. Six em dashes in a column is noise the eye has to filter. */
function kvIf(dt, dd) {
  return dd ? kvRow(dt, dd) : [];
}

function yesNoUnknown(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return "Unknown (inherited from host)";
}

/** A placeholder shaped like the record that is coming, not a spinner. */
function assetSkeleton() {
  return el("div", { class: "sheet-loading" },
    sheetSection(null, skeleton("title", { width: "45%" })),
    sheetSection(null, 
      skeleton("line", { width: "34%", height: "10px" }),
      skeleton("line", { height: "58px" }),
      skeleton("line", { height: "58px" })),
    sheetSection(null, 
      skeleton("line", { width: "28%", height: "10px" }),
      skeleton("line", { height: "8px", radius: "999px" }),
      skeleton("line", { height: "8px", radius: "999px" }),
      skeleton("line", { height: "8px", radius: "999px" })));
}

function issueSkeleton() {
  return el("div", { class: "sheet-loading" },
    sheetSection(null, 
      skeleton("line", { width: "30%", height: "10px" }),
      skeleton("line", { height: "44px" })),
    sheetSection(null, 
      skeleton("line", { width: "36%", height: "10px" }),
      skeleton("line", { height: "44px" })),
    sheetSection(null, 
      skeleton("line", { width: "24%", height: "10px" }),
      skeleton("line", { height: "80px" })));
}

// ------------------------------------------------------------------ record vocabulary

/**
 * The cloud platform, whichever shape the record arrived in. The graph seeds the sheet
 * with a raw graph node (`cloudPlatform`); the inventory seeds it with a table row
 * (`cloud`). Reading only one left the pre-RPC subtitle blank through one of the two doors
 * into the same sheet.
 */
function anyCloud(rec) {
  return rec.cloud || rec.cloudPlatform || "";
}

/** A long, opaque identifier: clipped in the grid, whole in the tooltip. */
function idValue(text) {
  return el("span", { class: "kv-trunc", title: text }, text);
}

/**
 * A status with a mark beside the word. The word is the signal — the dot only reinforces
 * it, and reads the same to anyone who can't tell the two greens apart.
 */
function statusValue(status) {
  if (!status) return "";
  const live = String(status).toUpperCase() === "ACTIVE";
  return el("span", {},
    el("span", {
      class: "kv-dot " + (live ? "kv-dot--ok" : "kv-dot--idle"), "aria-hidden": "true",
    }),
    status);
}

/**
 * The ports and source ranges behind an exposure, when the public-exposure paths carried
 * any. Trailing clause, so the insight reads as a sentence rather than a field dump.
 */
function exposureDetail(evidence) {
  if (!evidence) return "";
  const parts = [];
  if (evidence.ports && evidence.ports.length) parts.push("port " + evidence.ports.join(", "));
  if (evidence.sourceIpRanges && evidence.sourceIpRanges.length) {
    parts.push("from " + evidence.sourceIpRanges.join(", "));
  }
  return parts.length ? " — " + parts.join(" ") : "";
}

/**
 * What Wiz says about this asset, as words. Only the flags that are actually set: an
 * absent flag is not a finding, and a tri-state flag left null means "inherited from the
 * host, undetermined" — which is not evidence of anything.
 */
function insightRow(node) {
  const items = [];
  const add = (tone, kind, label) => items.push(
    el("div", { class: "insight insight--" + tone },
      el("span", { class: "insight-mark" }, kindIconSvg(kind, 14)),
      label));
  if (node.adminPriv) add("bad", "EXCESSIVE_PRIVILEGE", "Admin privileges");
  else if (node.highPriv) add("warn", "EXCESSIVE_PRIVILEGE", "High privileges");
  // The exposure ladder, strongest evidence first. A validated endpoint is Wiz's scanner
  // saying it connected and the tenant's policy rating what it found; a reachable host is
  // the topology saying the compute underneath answers the internet; the two flags are what
  // the asset says about itself, and on a hosted asset they say nothing at all. Only the
  // best-supported one is shown — three lines all meaning "exposed" would read as three
  // findings.
  const evidence = node.exposureEvidence;
  const endpointCount = (evidence && evidence.endpointIds ? evidence.endpointIds.length : 0);
  const hostCount = (evidence && evidence.hostIds ? evidence.hostIds.length : 0);
  if (endpointCount) {
    add("bad", "INTERNET_EXPOSURE",
      "Validated exposure — " + endpointCount + " endpoint" + (endpointCount === 1 ? "" : "s") +
      (evidence.exposureLevel ? " rated " + evidence.exposureLevel : "") +
      exposureDetail(evidence));
  } else if (hostCount) {
    add("bad", "INTERNET_EXPOSURE",
      "Reachable through its host" + exposureDetail(evidence));
  } else if (node.openInternet) add("bad", "INTERNET_EXPOSURE", "Open to all internet");
  else if (node.internet) add("warn", "INTERNET_EXPOSURE", "Internet exposed");
  // The endpoint's own record, on the ENDPOINT row itself. Both halves, because either one
  // alone misleads: an open port behind SSO rates Low and is not an exposure.
  if (node.portValidation || node.exposureLevel) {
    const rated = node.exposureLevel === "High" || node.exposureLevel === "Medium";
    add(rated ? "bad" : "neutral", "ENDPOINT",
      "Exposure level " + (node.exposureLevel || "unrated") +
      (node.portValidation ? " · port " + node.portValidation.toLowerCase() : ""));
  }
  // Above the two flags below it, because it is the stronger claim: those say Wiz
  // classified something here, this says what was actually found.
  if (node.dataFindingCount) {
    const mix = severityMixText(node.dataFindingSeverities);
    add("bad", "DATA_FINDING",
      node.dataFindingCount + " data findings" + (mix ? " — " + mix : ""));
  }
  if (node.sensitiveData) add("warn", "SENSITIVE_DATA", "Holds sensitive data");
  if (node.sensitiveAccess) add("warn", "SENSITIVE_DATA", "Access to sensitive data");
  if (node.guardrailMissing) add("warn", "MISSING_GUARDRAIL", "No guardrail");
  // Who can reach this asset, and how many of them have stopped showing up. The dormant
  // clause is the finding — an account nobody uses that still holds admin on an AI asset is
  // a backdoor with no one watching it.
  const access = node.humanAccess;
  const reachCount = (access && access.identityIds ? access.identityIds.length : 0);
  if (reachCount) {
    const dormant = (access.inactiveCount || 0);
    add(access.admin ? "bad" : "warn", "IDENTITY_ACCESS_FINDING",
      reachCount + " human identit" + (reachCount === 1 ? "y" : "ies") +
      (access.admin ? " at admin" : " at high privilege") +
      (dormant ? " — " + dormant + " dormant" : ""));
  }
  if (node.inactive === true) {
    add("warn", "SERVICE_ACCOUNT",
      "Dormant" + (node.inactiveTimeframe ? " · " + node.inactiveTimeframe : " in the last 90 days"));
  }
  if (node.identityPurpose === "AGENTIC") add("neutral", "SERVICE_ACCOUNT", "Agentic identity");
  return items.length ? el("div", { class: "insights" }, ...items) : null;
}

/** The infrastructure ledger, two columns wide. Absent facts leave no row. */
function propsGrid(node) {
  const analytics = node.issueAnalytics;
  const account = node.cloudAccountRef;
  return el("dl", { class: "kv kv--cols2" },
    ...kvIf("Name", node.name),
    ...kvRow("Kind", kindLabel(node.kind)),
    ...kvIf("Native type", node.nativeType),
    ...kvIf("Cloud platform", [node.cloud, node.region].filter(Boolean).join(" · ")),
    ...kvIf("Cloud account", node.cloudAccount),
    ...kvIf("Account ID", account && account.externalId ? idValue(account.externalId) : ""),
    ...kvIf("Projects", (node.projects || []).join(", ")),
    ...kvIf("Status", statusValue(node.status)),
    ...kvIf("Technology", (node.technologyCategories || []).join(", ")),
    ...kvIf("External ID", node.externalId ? idValue(node.externalId) : ""),
    // Wiz's own per-identity rollup. Labelled as such so it stops looking like a second,
    // disagreeing count of the open issues listed in the Issues section.
    ...(analytics && analytics.total
      ? kvRow("Wiz related issues", `${analytics.total} across all severities`)
      : []),
  );
}

/** When the landscape first saw this asset and when it last did — sync provenance, not risk. */
function provStrip(node) {
  const bits = [];
  if (node.firstSeen) bits.push(el("span", {}, "First seen " + fmtDateTime(node.firstSeen)));
  if (node.lastSeen) bits.push(el("span", {}, "Last seen " + fmtDateTime(node.lastSeen)));
  return bits.length ? el("div", { class: "prov-strip" }, ...bits) : null;
}

/** One neighbour as a row you can step into. */
function relRow(n, onOpen) {
  const out = n.direction === "out";
  return sheetRow({
    extraClass: "sheet-rel",
    badge: el("span", { class: "sheet-rel-dir" },
      el("span", { "aria-hidden": "true" }, out ? "→" : "←"),
      el("span", { class: "sr-only" }, out ? "outbound" : "inbound")),
    meta: [
      el("strong", {}, n.node.name),
      el("span", { class: "small muted" }, kindLabel(n.node.kind)),
      // Prose on the chip, Wiz's own enum on the tooltip: the register is read here and
      // cross-referenced against the tenant there, so neither can be the one that goes.
      el("span", { class: "domain-chip", title: n.edge.type },
        edgeLabel(n.edge.type) +
        (n.edge.accessType ? ` [${n.edge.accessType}]` : "") +
        (n.edge.negated ? " (absent)" : "")),
    ],
    ariaLabel: `${out ? "Outbound" : "Inbound"} ${edgeLabel(n.edge.type)} to ${n.node.name}`,
    onOpen: () => onOpen(n),
  });
}

function relList(items, onOpen) {
  return el("div", { class: "sheet-list" }, ...items.map((n) => relRow(n, onOpen)));
}

/** Dress a ready-made control (copyButton's, say) as one of the header toolbar's buttons. */
function toolButton(btn) {
  btn.classList.add("sheet-tool");
  return btn;
}

/**
 * Whether a live expansion can say anything about this node at all.
 *
 * AGENT_EXPANSION is rooted at type AI_AGENT, so expanding a bucket or a service account
 * asks a question that cannot match. The server refuses those too; this keeps the app from
 * offering an action that could only ever come back empty.
 */
function canExpand(node) {
  if (!node || node.kind !== "AI_AGENT") return false;
  // Credentials too: without them the endpoint can only answer "needs credentials", and a
  // control whose sole outcome is an apology is worse than no control. The Settings page
  // is where that state is explained.
  const boot = bootstrapCached();
  return Boolean(boot && boot.hasCredentials);
}

/**
 * One expansion RPC, resolving to a payload in every case — a rejection becomes an
 * `error` record rather than a throw, so the button path and the automatic path can share
 * one shape and the card always has something honest to say.
 */
async function expandNow(assetId) {
  try {
    return await swrCall("api_expandAsset", { id: assetId });
  } catch (e) {
    return { source: "error", error: e && e.message ? e.message : String(e) };
  }
}

/**
 * The "Expand from Wiz" affordance.
 *
 * No busy state of its own any more: it hands off to beginExpansion, which repaints the
 * card into its in-flight state — the button gives way to the card's own "Expanding from
 * Wiz…" line. One indicator, in one place, whichever path started the work.
 */
function expandButton(onStart) {
  return el("button", { class: "sheet-tool", onclick: onStart },
    uiIcon("graph", 14), "Expand from Wiz");
}

/**
 * What the map is actually showing. Principle 5 of PRODUCT.md in one line: a snapshot and
 * a live read look identical on screen, so the difference has to be said out loud —
 * including when the live read refused rows it could not trust.
 */
function provenanceContent(live, addedCount, expanding) {
  const s = expansionStatus(live, addedCount, expanding);
  if (s.state === "expanding") {
    // The ring is decoration; the sentence is the signal. Someone who cannot see the ring,
    // or who has motion turned off, still gets told what is happening in words.
    return [el("p", { class: "small muted" },
      el("span", { class: "prov-spinner", "aria-hidden": "true" }),
      "Expanding from Wiz…")];
  }
  if (s.state === "stored-only") {
    return [el("p", { class: "small muted" }, "Neighborhood from the last sync.")];
  }
  if (s.state === "error") {
    return [el("p", { class: "small sheet-prov-bad" },
      "Live expansion failed: " + s.error + " Showing the last sync.")];
  }
  if (s.state === "no-credentials") {
    return [el("p", { class: "small muted" },
      "Live expansion needs Wiz credentials. Showing the last sync.")];
  }
  if (s.state === "unsupported") {
    // The affordance is hidden for non-agents, so this should be unreachable from the UI.
    // It exists because the server can still answer it, and a silent empty result here
    // would read exactly like a successful expansion that found nothing.
    return [el("p", { class: "small muted" },
      "Live expansion is defined for AI agents. Showing the last sync.")];
  }
  const parts = ["Expanded live " + fmtDateTime(s.fetchedAt) + "."];
  parts.push(s.added > 0
    ? plural(s.added, "connection") + " not in the last sync."
    : "Nothing the last sync had missed.");
  if (s.total > s.added + 1) {
    parts.push(plural(s.total, "entity") + " found in total, including beyond one hop.");
  }
  const notes = [];
  if (s.truncated) notes.push("Result was capped; open the graph for the rest.");
  if (s.arityMismatches) {
    // Not a cosmetic warning. A mismatch means the tenant returned an entity array of a
    // different length than the query's selected-node count, so those rows were refused
    // rather than decoded onto the wrong nodes — the spec and the schema have diverged.
    notes.push(plural(s.arityMismatches, "row") +
      " skipped: the tenant's response shape did not match the query.");
  }
  return [
    el("p", { class: "small muted" }, parts.join(" ")),
    notes.length ? el("p", { class: "small sheet-prov-warn" }, notes.join(" ")) : null,
  ];
}

/** A bordered card inside the overlay: the one-pixel whisper, never a second real shadow. */
function sheetCard(title, action, ...children) {
  return el("div", { class: "sheet-card" },
    el("div", { class: "sheet-card-head" },
      el("h4", { class: "sheet-card-title" }, title),
      action || null),
    el("div", { class: "sheet-card-body" }, ...children));
}

// --------------------------------------------------------------------------- asset

/**
 * Asset drill-down — the two-pane record sheet: a section rail beside a content pane.
 *
 * opts: title/seed (paint the header before the RPC lands), onFocusGraph / onExpand
 * (graph-page actions), backTo ({ label, onBack }), records ({ ids, index, open, label })
 * to step through the list the sheet was opened from without closing it.
 */
export function openAssetSheet(assetId, opts = {}) {
  const seed = opts.seed || {};
  const seedTitle = seed.name || opts.title || "Asset";
  const seedSub = [kindLabel(seed.kind), anyCloud(seed), seed.region].filter(Boolean).join(" · ");

  // A close mid-flight must not let the in-flight RPC paint into a torn-down sheet.
  let disposed = false;

  openSheet((body, close, ctx) => {
    /**
     * Paint the record. `restoreSectionId`, when given, is the rail section the reader was
     * on before this call — set by a background revalidation's repaint, so a reader mid-way
     * through Relationships doesn't get yanked back to Overview under them.
     */
    function paint(detail, restoreSectionId) {
      const { node, issues, neighbors, findings } = detail;
      const openIssues = issues || [];
      const rels = neighbors || [];
      // Result of the live expansion — from the button, or fired automatically when the
      // auto-expand setting is on. Null until one of the two lands.
      let liveExpansion = null;
      let autoExpandStarted = false;
      let expanding = false;
      const compliance = findings || [];
      const caps = pillarCaps();
      clear(body);

      const openNeighbor = (n) => openAssetSheet(n.node.id, {
        seed: n.node,
        onFocusGraph: opts.onFocusGraph,
        onExpand: opts.onExpand,
        expandable: opts.expandable,
        // Sideways within the neighbour list, and still a way back up to this record.
        records: {
          ids: rels.map((r) => r.node.id),
          index: rels.indexOf(n),
          label: "relationship",
          open: (id, index) => openNeighbor(rels[index]),
        },
        backTo: { label: node.name, onBack: () => openAssetSheet(assetId, opts) },
      });
      const openGraph = () => {
        ctx.close();
        if (opts.onFocusGraph) opts.onFocusGraph(node.id);
        else navigate("graph", { seed: node.id });
      };

      ctx.setHeading({
        title: node.name,
        subtitle: [kindLabel(node.kind), node.cloud, node.region].filter(Boolean).join(" · "),
        // No accent, deliberately. This used to be `node.aarsSeverity`, which painted the
        // whole record — its heading rule and its rail — in the findings score's band
        // colour, making the band the sheet's verdict. It is the weakest verdict here: on
        // live data its top level holds 19 of 30 scored assets and two levels hold none
        // (ai/AARS_SCORING_ASSESSMENT.md §3). The chips below carry the two readings that
        // ARE decisions — the posture tier and the worst open problem — and neither is a
        // severity, so neither claims the stripe either.
        sev: "",
        icon: kindIconSvg(node.kind, 18),
        tone: categoryOf(node.kind),
        actions: [
          el("button", { class: "sheet-tool primary", onclick: openGraph },
            uiIcon("graph", 14),
            opts.onFocusGraph ? "Focus graph here" : "Open in graph"),
          opts.onExpand
            ? el("button", {
                class: "sheet-tool",
                onclick: () => { ctx.close(); opts.onExpand(node.id); },
              }, "Expand neighbors")
            : null,
          toolButton(copyButton(() => node.id, {
            label: "Copy ID", copiedLabel: "Copied", title: node.id,
          })),
        ],
        chips: [
          // Order is the argument: the two models that decide something lead, and the
          // findings score follows as context. Each is named, because they routinely
          // disagree and an unlabelled row of pills would read as one escalating scale.
          node.postureTier ? el("span", { class: "sheet-chip-label" }, "Posture") : null,
          node.postureTier ? tierBadge(node.postureTier) : null,
          node.worstOpenProblem
            ? el("span", { class: "sheet-chip-label" }, "Worst problem") : null,
          node.worstOpenProblem ? outcomeBadge(node.worstOpenProblem) : null,
          node.severity ? el("span", { class: "sheet-chip-label" }, "Worst issue") : null,
          node.severity ? sevBadge(node.severity) : null,
          el("span", { class: "sheet-chip-label" }, FINDINGS_SCORE_LABEL),
          scoreChip(node.aars, node.aarsPercentile, node.aarsSeverity),
          ...(node.comboGroups || []).map((g) => el("span", { class: "pill bad" }, comboTitle(g))),
          node.guardrailMissing ? el("span", { class: "pill warn" }, "No guardrail") : null,
          node.identityPurpose === "AGENTIC" ? el("span", { class: "pill neutral" }, "Agentic") : null,
          node.sensitiveAccess ? el("span", { class: "pill neutral" }, "Sensitive data access") : null,
          node.adminPriv
            ? el("span", { class: "pill neutral" }, "Admin privileges")
            : node.highPriv ? el("span", { class: "pill neutral" }, "High privileges") : null,
        ],
      });

      // One renderer per rail section, run the first time its pane is shown. Order here is
      // documentation only — the rail model in recordSections.js decides what appears and
      // in what sequence, and it is the thing under test.
      const panes = {
        overview(pane) {
          // The score leads as a number, and the number is immediately placed: a bare 72
          // out of 100 reads as "72% of the way to the worst possible asset", which is not
          // what it means. The percentile says what it does mean — where this asset sits
          // among the ones actually scored — and it carries its denominator, because
          // "60th percentile" of an unnamed population is not a measurement.
          if (node.aars !== null && node.aars !== undefined) {
            const p = node.aarsPillars;
            const scored = (bootstrapCached() || {}).counts;
            const place = percentileText(node.aarsPercentile, scored && scored.aarsScored);
            pane.append(
              el("div", { class: "sheet-section" },
                el("div", { class: "sheet-verdict" },
                  el("span", { class: "aars-total" }, String(node.aars)),
                  el("span", { class: "muted small" }, FINDINGS_SCORE_LABEL + " out of 100")),
                place
                  ? el("p", { class: "sheet-caption" },
                      place +
                      (node.aarsSeverity ? ` · level ${node.aarsSeverity}` : ""))
                  : null,
                p
                  ? el("p", { class: "sheet-caption" },
                      `Toxic ${p.toxic ?? 0} · Compliance ${p.compliance ?? 0} · Data ${p.data ?? 0}`)
                  : null,
              ),
            );
          }
          const insights = insightRow(node);
          if (insights) pane.append(sheetSection("Insights", insights));
          pane.append(sheetSection("Properties", propsGrid(node), provStrip(node)));
          // The picture, not a shorter copy of the list next door: what an agent is wired to
          // — the identity it runs as, the data it reaches, the guardrail it hasn't got —
          // is a shape, and a list makes the reader assemble it. Relationships still holds
          // every connection, and the map's own "+N more" stub leads there.
          // Stored neighbours come from the LAST SYNC's snapshot, which can only hold what
          // the battery's five fixed traversals collected. "Expand from Wiz" asks the
          // tenant about this one agent across all ten relationship subtrees the console
          // expands. Which of the two is on screen is stated, never implied — a map that
          // silently mixes a week-old snapshot with a live read is worse than either.
          const card = el("div");
          // Built once and re-parented on each repaint rather than rebuilt, so it stays one
          // live region: assistive tech announces "Expanding from Wiz…" and then the result
          // as changes to the same node, instead of two unrelated insertions.
          const prov = el("div", { class: "sheet-prov", role: "status", "aria-live": "polite" });
          const onExpanded = (result) => {
            if (disposed) return;
            expanding = false;
            liveExpansion = result;
            paintConnections();
          };
          // The one way in, for both the button and the automatic path. They used to differ
          // — the button disabled itself and relabelled, the automatic path showed nothing
          // at all — which is why an auto-expansion looked like an idle card until it
          // landed.
          const beginExpansion = () => {
            if (expanding) return;
            expanding = true;
            paintConnections();
            expandNow(node.id).then(onExpanded);
          };
          const paintConnections = () => {
            const merged = mergeLiveRels(node, rels, liveExpansion);
            let map = null;
            if (merged.length) {
              const boot = bootstrapCached();
              map = egoGraph({
                focal: node,
                rels: merged,
                palette: boot && boot.palette,
                onOpen: openNeighbor,
                onShowAll: () => ctx.selectSection("relationships"),
              });
              ctx.onDispose(map.destroy);
            }
            clear(prov).append(...provenanceContent(
              liveExpansion, merged.length - rels.length, expanding,
            ));
            clear(card).append(sheetCard(
              "Connections (" + merged.length + ")",
              el("div", { class: "sheet-card-tools" },
                // Offered only where it can succeed, and only while it still has something
                // to do: not while one is in flight, and not after a successful expansion,
                // where serverCache would hand back the same payload and the button would
                // be a control that visibly does nothing.
                canExpand(node) && !expanding
                  && (!liveExpansion || liveExpansion.source === "error")
                  ? expandButton(beginExpansion)
                  : null,
                el("button", { class: "sheet-tool", onclick: openGraph },
                  uiIcon("graph", 14), "Open in graph")),
              map ? map.node : emptyState("No connections in the last sync."),
              prov,
            ));
          };
          paintConnections();
          pane.append(card);
          // AFTER the first paint, never before it: the stored neighbours have to appear
          // at once, with the live result folded in when it arrives. Awaiting the RPC here
          // would put a network round trip in front of every agent sheet open.
          // `autoExpandStarted` guards the section renderer running again on a section
          // switch, which would otherwise re-fire on every visit to the overview.
          if (!autoExpandStarted && shouldAutoExpand(node, bootstrapCached())) {
            autoExpandStarted = true;
            beginExpansion();
          }
          // The record as the server sent it. An analyst who needs a field this sheet does
          // not name should not have to open the browser console to read it. Most analysts
          // never open this, so the stringify + code block are built lazily on first toggle
          // rather than paid on every Overview paint.
          const rawWrap = el("div", { style: "padding:8px 0 4px" });
          let rawBuilt = false;
          const rawDetails = el("details", { class: "disclosure" },
            el("summary", { class: "disclosure-toggle" }, "Raw record"),
            rawWrap);
          rawDetails.addEventListener("toggle", () => {
            if (rawBuilt || !rawDetails.open) return;
            rawBuilt = true;
            const raw = JSON.stringify(detail, null, 2);
            rawWrap.append(
              copyButton(() => raw, { label: "Copy JSON" }),
              codeBlock(raw, { label: "Raw record, as JSON", maxHeight: "320px" }));
          });
          pane.append(rawDetails);
        },

        issues(pane) {
          if (!openIssues.length) {
            pane.append(emptyState(
              "No open issues on this asset.",
              "Nothing in the last sync mapped an open risk issue here.",
            ));
            return;
          }
          const list = el("div", { class: "sheet-list" });
          for (const issue of openIssues) {
            list.append(sheetRow({
              badge: sevBadge(issue.adjustedSeverity),
              meta: [
                el("span", { class: "small muted" }, `Wiz native ${issue.nativeSeverity}`),
                dueChip(issue.dueAt),
              ],
              title: issueTitle(issue),
              note: issue.justification,
              tags: fwTags(issue.frameworks, true),
              fix: issue.remediation || issue.resolutionRecommendation,
              ariaLabel: `Issue: ${issueTitle(issue)}, ${issue.adjustedSeverity}`,
              // The full IssueRow is already in hand — seed the sheet, and seed every
              // prev/next step through this same list too.
              onOpen: () => openIssueSheet(issue.id, {
                seed: issue,
                records: {
                  ids: openIssues.map((i) => i.id),
                  index: openIssues.indexOf(issue),
                  label: "issue",
                  open: (id, i) => openIssueSheet(id, {
                    seed: openIssues[i],
                    backTo: { label: node.name, onBack: () => openAssetSheet(assetId, opts) },
                  }),
                },
                backTo: { label: node.name, onBack: () => openAssetSheet(assetId, opts) },
              }),
            }));
          }
          pane.append(list);
        },

        compliance(pane) {
          if (!compliance.length) {
            pane.append(emptyState(
              "No failing controls on this asset.",
              "The last sync returned no failing configuration finding against it. " +
              "Most AI-security controls are evaluated against regions, IAM policies and " +
              "identities rather than assets — the Cloud Configuration page has the full register.",
            ));
            return;
          }
          const list = el("div", { class: "sheet-list" });
          for (const f of compliance) {
            list.append(sheetRow({
              badge: sevBadge(f.severity),
              title: f.ruleName || f.name || f.ruleShortId,
              meta: [el("span", { class: "small muted" }, f.ruleShortId || "—")],
              fix: f.remediation,
              // The row is a door: the whole record — rule description, remediation
              // template, the Rego that decided this — is one fetch away rather than
              // absent, and this pane deliberately ships none of it.
              ariaLabel: "Open finding " + (f.ruleName || f.ruleShortId),
              onOpen: () => openConfigFindingSheet(f.id, {
                seed: f,
                backTo: {
                  label: node.name || assetId,
                  onBack: () => openAssetSheet(assetId, opts),
                },
              }),
            }));
          }
          pane.append(list);
        },

        combos(pane) {
          const groups = node.comboGroups || [];
          if (!groups.length) {
            pane.append(emptyState(
              "Not part of any toxic combination.",
              "No combination pattern in the register matched this asset.",
            ));
            return;
          }
          pane.append(el("div", { class: "tag-strip" },
            ...groups.map((g) => el("span", { class: "pill bad" }, comboTitle(g)))));
          const inCombo = openIssues.filter((i) => groups.indexOf(i.comboGroup) !== -1);
          if (inCombo.length) {
            pane.append(sheetSection(
              `Issues in these combinations (${inCombo.length})`,
              el("div", { class: "sheet-list" }, ...inCombo.map((issue) => sheetRow({
                badge: sevBadge(issue.adjustedSeverity),
                meta: [el("span", { class: "small muted" }, comboTitle(issue.comboGroup))],
                title: issueTitle(issue),
                ariaLabel: `Issue: ${issueTitle(issue)}, ${issue.adjustedSeverity}`,
                onOpen: () => openIssueSheet(issue.id, {
                  seed: issue,
                  backTo: { label: node.name, onBack: () => openAssetSheet(assetId, opts) },
                }),
              }))),
            ));
          }
        },

        aars(pane) {
          if (!node.aarsPillars) {
            pane.append(emptyState(
              "This asset carries no " + FINDINGS_SCORE_LABEL.toLowerCase() + ".",
              "Only AI assets are scored; supporting infrastructure is not.",
            ));
            return;
          }
          pane.append(pillarBars(node.aarsPillars, caps));
          const gaps = (node.aarsInput && node.aarsInput.gaps) || [];
          if (gaps.length) {
            pane.append(sheetSection(
              `Gaps priced into the score (${gaps.length})`,
              el("div", { class: "tag-strip" },
                ...gaps.map((g) => el("span", { class: "fw-tag" }, String(g.code || g)))),
            ));
          }
        },

        // Rendered whether or not anything is set: six explicit "No"s ARE the answer, and
        // an empty pane would leave the reader unsure the question was asked.
        exposure(pane) {
          pane.append(el("dl", { class: "kv" },
            ...kvRow("Internet exposed", yesNoUnknown(node.internet)),
            ...kvRow("Open to all internet", yesNoUnknown(node.openInternet)),
            ...kvRow("Holds sensitive data", node.sensitiveData ? "Yes" : "No"),
            ...kvRow("Access to sensitive data", node.sensitiveAccess ? "Yes" : "No"),
            ...kvRow("Admin privileges", node.adminPriv ? "Yes" : "No"),
            ...kvRow("High privileges", node.highPriv ? "Yes" : "No")));
        },

        guardrails(pane) {
          const protectedBy = rels.filter((n) => n.edge.type === "PROTECTED_BY");
          if (node.guardrailMissing) {
            pane.append(el("div", { class: "sheet-section" },
              statusPill("warn", "No guardrail"),
              el("p", { class: "sheet-caption" },
                "The guardrail-coverage scan found no protective control attached to this asset.")));
          }
          if (protectedBy.length) {
            pane.append(sheetSection(
              `Protected by (${protectedBy.length})`, relList(protectedBy, openNeighbor)));
          }
          if (!node.guardrailMissing && !protectedBy.length) {
            pane.append(emptyState(
              "Guardrail coverage was not assessed for this asset.",
              "The coverage scan reports only on AI assets that can carry a guardrail.",
            ));
          }
        },

        relationships(pane) {
          if (!rels.length) {
            pane.append(emptyState(
              "No relationships in the last sync.",
              "Nothing connects to this asset at the depth the graph was collected to.",
            ));
            return;
          }
          const list = el("div", { class: "sheet-list" });
          const paint = (limit) => {
            clear(list).append(...rels.slice(0, limit).map((n) => relRow(n, openNeighbor)));
            if (rels.length > limit) {
              list.append(el("button", {
                class: "linklike sheet-more",
                onclick: () => paint(rels.length),
              }, `Show all ${rels.length} relationships`));
            }
          };
          paint(NEIGHBOR_PREVIEW);
          pane.append(list);
        },

        // Who this asset ACTS AS, as opposed to what it is — the properties grid on
        // Overview already carries the infrastructure ledger.
        identity(pane) {
          const analytics = node.issueAnalytics;
          const runsAs = rels.filter((n) => n.edge.type === "RUNS_AS");
          const grants = rels.filter((n) => n.edge.type === "ALLOWS_ACCESS_TO" ||
            n.edge.type === "PERMITS_ACCESS_ROLE" || n.edge.type === "BOUND_TO");
          pane.append(el("dl", { class: "kv" },
            ...kvRow("Kind", kindLabel(node.kind)),
            ...kvIf("Identity purpose", node.identityPurpose === "AGENTIC"
              ? "Agentic (agent execution identity)"
              : node.identityPurpose),
            ...kvIf("Admin privileges", node.adminPriv ? "Yes" : ""),
            ...kvIf("High privileges", node.highPriv ? "Yes" : ""),
            ...(analytics && analytics.total
              ? kvRow("Wiz related issues", `${analytics.total} across all severities`)
              : [])));
          if (runsAs.length) {
            pane.append(sheetSection("Runs as", relList(runsAs, openNeighbor)));
          }
          if (grants.length) {
            pane.append(sheetSection(
              `Access granted (${grants.length})`, relList(grants, openNeighbor)));
          }
        },

        tags(pane) {
          const tags = node.tags || [];
          if (!tags.length) {
            pane.append(emptyState("No tags on this asset."));
            return;
          }
          pane.append(el("div", { class: "tag-strip" },
            ...tags.map((t) => el("span", { class: "fw-tag" },
              t.value ? `${t.key}: ${t.value}` : t.key))));
        },
      };

      ctx.rail(assetSections(detail), (id, pane) => {
        const render1 = panes[id];
        if (render1) render1(pane);
      });
      // Rail rebuild above defaults back to the first section — put the reader back where
      // they were before a background revalidation repainted under them.
      if (restoreSectionId) ctx.selectSection(restoreSectionId);

      const cursor = opts.records
        ? recordCursor(opts.records.ids, opts.records.index)
        : { position: 0, total: 0 };
      ctx.announce(
        `${node.name}. ${FINDINGS_SCORE_LABEL} ` +
        `${node.aars === null || node.aars === undefined ? "unscored" : node.aars}, ` +
        `${plural(openIssues.length, "open issue")}, ${plural(rels.length, "relationship")}.` +
        (cursor.total ? ` Record ${cursor.position} of ${cursor.total}.` : ""),
      );

      // Warm the next record in the list once the sheet has settled here — a click after a
      // dwell should resolve from cache. Registered per paint so a repaint re-arms it; the
      // dispose list only ever grows by one timer per paint, cleared together on close.
      if (cursor.nextId !== null && cursor.nextId !== undefined) {
        const nextId = cursor.nextId;
        const warmTimer = setTimeout(() => {
          swrCall("api_getAssetDetail", { id: nextId }).catch(() => {});
        }, 600);
        ctx.onDispose(() => clearTimeout(warmTimer));
      }
    }

    async function render() {
      ctx.setBusy(true);
      clear(body).append(assetSkeleton());
      let detail;
      try {
        detail = await swrCall("api_getAssetDetail", { id: assetId }, (fresh) => {
          if (disposed) return;
          // The place a reader is reading is worth more than the freshest paint landing
          // instantly under them — capture it, repaint, then put it back.
          const place = ctx.currentSection();
          paint(fresh, place);
        });
      } catch (e) {
        if (disposed) return;
        ctx.setBusy(false);
        clear(body).append(errorState("Couldn't load this asset.", {
          detail: e && e.message ? e.message : e,
          onRetry: render,
        }));
        return;
      }
      if (disposed) return;
      ctx.setBusy(false);
      if (!detail) {
        clear(body).append(emptyState(
          "Asset not found in the last sync.",
          "It may have been removed from the landscape since the sync ran.",
        ));
        return;
      }
      paint(detail);
    }

    render();
  }, {
    title: seedTitle,
    subtitle: seedSub || assetId,
    // Matches the painted heading above — the band does not accent the record.
    sev: "",
    expandable: opts.expandable !== false,
    closeOnRouteChange: true,
    backTo: opts.backTo || null,
    rail: { ariaLabel: "Asset sections" },
    resizable: true,
    records: opts.records || null,
    onClose: () => {
      disposed = true;
      if (opts.onClose) opts.onClose();
    },
  });
}

// --------------------------------------------------------------------------- issue

/** Issue drill-down. opts.backTo returns to the asset sheet that opened it. */
/**
 * The Wiz issue type in the words the page uses elsewhere. Unknown values pass through
 * rather than being mapped to a guess — a type this build has not seen is still a fact.
 */
function issueTypeLabel(type) {
  if (type === "TOXIC_COMBINATION") return "Toxic combination";
  if (type === "CLOUD_CONFIGURATION") return "Cloud configuration";
  return type || "";
}

/** The issue status in the same words the pill beside it uses. */
function issueStatusLabel(status) {
  if (status === "IN_PROGRESS") return "In progress";
  if (status === "OPEN") return "Open";
  if (status === "RESOLVED") return "Resolved";
  if (status === "REJECTED") return "Rejected";
  return status || "";
}

/**
 * What to call an issue. Wiz names an issue by its source rule, but a rule shape this
 * document has no inline fragment for comes back as an empty object — the issue is still
 * real and still counted, so it needs a heading rather than a blank one. Falls back to the
 * issue type, then to a plain word; never invents a rule name.
 */
function issueTitle(issue) {
  return (issue && issue.ruleName)
    || issueTypeLabel(issue && issue.issueType)
    || "Issue";
}

export function openIssueSheet(issueId, opts = {}) {
  // The asset sheet has always had this guard; the issue sheet had not, so a close mid-RPC
  // could paint into a torn-down drawer.
  let disposed = false;

  openSheet((body, close, ctx) => {
    /**
     * Paint the record. `seeded` marks the zero-RPC path: the caller already held the row,
     * so this paint carries a provenance line and a background revalidation instead of the
     * usual busy/fetch dance. A seeded paint never arms the next-record warm timer — on a
     * seeded door, stepping to the next record is already free.
     */
    function paint(detail, seeded) {
      const { issue, group } = detail;
      let provNode = null;
      clear(body);

      // Status carries a word, not just a tint — the pill's text is the signal and the
      // colour only reinforces it.
      const chips = [
        sevBadge(issue.adjustedSeverity),
        el("span", { class: "small muted" }, `Wiz native ${issue.nativeSeverity}`),
      ];
      if (issue.status === "IN_PROGRESS") chips.push(statusPill("warn", "In progress"));
      if (issue.validatedAsExploitable) {
        chips.push(statusPill("bad", "Validated exploitable"));
      }
      chips.push(dueChip(issue.dueAt));

      ctx.setHeading({
        title: issueTitle(issue),
        subtitle: issue.assetName,
        sev: issue.adjustedSeverity || "",
        icon: kindIconSvg("ISSUE", 18),
        tone: categoryOf("ISSUE"),
        actions: [
          el("button", {
            class: "sheet-tool primary",
            onclick: () => { ctx.close(); navigate("graph", { seed: issue.assetId }); },
          }, uiIcon("graph", 14), "Open in graph"),
          toolButton(copyButton(() => issue.id, {
            label: "Copy ID", copiedLabel: "Copied", title: issue.id,
          })),
        ],
        chips,
      });

      const fix = issue.remediation || issue.resolutionRecommendation;
      const tickets = issue.ticketUrls || [];

      const panes = {
        overview(pane) {
          // PRODUCT.md principle 5: a stored read and a live read must not look identical
          // on screen. This paint came straight from a row the caller already held — no
          // fetch happened yet — so it says so, in the same vocabulary provenanceContent()
          // uses for the asset sheet's stored/live map. The --lead modifier drops that
          // vocabulary's separator rule: this line opens the pane instead of closing a card.
          if (seeded) {
            provNode = el("p", { class: "small muted sheet-prov sheet-prov--lead" },
              "From the list — checking for updates.");
            pane.append(provNode);
          }
          // Guarded on the note itself, not on the group: the Other bucket resolves to a
          // real group with no amplifier claim, and an empty note is a blank slab.
          if (group && group.amplifierNote) {
            pane.append(el("div", { class: "sheet-section" },
              el("div", { class: "combo-note", role: "note" }, group.amplifierNote)));
          }
          pane.append(sheetSection("Why it matters",
            issue.justification
              ? el("p", { class: "small", style: "margin:0" }, issue.justification)
              : el("p", { class: "small muted", style: "margin:0" },
                  "Wiz supplied no justification for this issue.")));
          pane.append(sheetSection("At a glance",
            el("dl", { class: "kv kv--cols2" },
              ...kvRow("Asset", issue.assetName),
              ...kvRow("Status", issueStatusLabel(issue.status)),
              ...kvIf("Issue type", issueTypeLabel(issue.issueType)),
              ...kvIf("Assignee", issue.assignee),
              ...kvIf("Created", issue.createdAt ? fmtDate(issue.createdAt) : ""),
              ...kvIf("Due", issue.dueAt ? fmtDateTime(issue.dueAt) : ""))));
        },

        fix(pane) {
          if (!fix) {
            pane.append(emptyState(
              "No remediation text on this issue.",
              "Neither the source rule nor the configuration finding carried one.",
            ));
            return;
          }
          pane.append(el("p", { class: "sheet-fix-body", style: "margin:0" }, fix));
        },

        tickets(pane) {
          if (!tickets.length) {
            pane.append(emptyState("No tickets linked to this issue."));
            return;
          }
          const list = el("div", { style: "display:grid; gap:6px" });
          tickets.forEach((url, n) => {
            list.append(el("a", {
              href: url,
              target: "_blank",
              rel: "noopener noreferrer",
              class: "small",
              style: "overflow-wrap:anywhere",
              "aria-label": "Open ticket " + (n + 1) + " in a new tab",
            }, url));
          });
          pane.append(list);
        },

        // An accepted risk that lapsed. The expiry is read off the structured field; the
        // note is shown verbatim because it is a sentence a human wrote, and the date
        // inside its prose is not what anything here is computed from.
        accepted(pane) {
          if (!issue.ignoreNote && !issue.ignoreExpiredAt) {
            pane.append(emptyState("This issue has not been accepted as a known risk."));
            return;
          }
          if (issue.ignoreExpiredAt) {
            pane.append(el("div", { style: "margin-bottom:8px" },
              statusPill("warn", "Ignore expired " + fmtDate(issue.ignoreExpiredAt))));
          }
          if (issue.ignoreNote) {
            pane.append(el("p", { class: "small", style: "margin:0; white-space:pre-wrap" },
              issue.ignoreNote));
          }
        },

        frameworks(pane) {
          const tags = fwTags(issue.frameworks);
          pane.append(tags || emptyState(
            "No framework mappings on this issue.",
            "The source rule maps to none of OWASP LLM, Agentic, ML or the 5Rs.",
          ));
        },

        // Wiz's own remediation verdict, kept visibly separate from this register's
        // adjusted severity — they are two different opinions about the same issue.
        ai(pane) {
          if (!issue.aiVerdict) {
            pane.append(emptyState("Wiz returned no AI analysis for this issue."));
            return;
          }
          const verdict = el("div", { style: "display:flex; align-items:center; gap:8px" },
            el("strong", { class: "small" }, issue.aiVerdict));
          if (issue.aiRecommendedSeverity) verdict.append(sevBadge(issue.aiRecommendedSeverity));
          pane.append(verdict,
            el("p", { class: "small muted", style: "margin:8px 0 0" },
              "Wiz's recommendation, not this register's adjusted severity."));
        },

        facts(pane) {
          pane.append(el("dl", { class: "kv kv--cols2" },
            ...kvIf("Rule id", issue.ruleId),
            ...kvRow("Asset", issue.assetName),
            ...kvRow("Status", issueStatusLabel(issue.status)),
            ...kvIf("Issue type", issueTypeLabel(issue.issueType)),
            ...kvIf("Assignee", issue.assignee),
            ...kvIf("Region", issue.region),
            ...kvIf("Account", issue.account),
            ...kvIf("Subscription", issue.subscriptionId ? idValue(issue.subscriptionId) : ""),
            ...kvIf("Business impact", issue.businessImpact),
            ...kvIf("Asset status", issue.entityStatus),
            ...kvIf("Environments", (issue.environments || []).join(", ")),
            ...kvIf("Projects", (issue.projects || []).join(", ")),
            ...kvIf("Created", issue.createdAt ? fmtDate(issue.createdAt) : ""),
            ...kvIf("Updated", issue.updatedAt ? fmtDate(issue.updatedAt) : ""),
            ...kvIf("Due", issue.dueAt ? fmtDateTime(issue.dueAt) : ""),
            ...kvIf("Resolved", issue.resolvedAt ? fmtDate(issue.resolvedAt) : ""),
            ...kvIf("Resolution", issue.resolutionReason),
            ...kvIf("Resolved by", issue.resolvedBy),
          ));
        },

        asset(pane) {
          if (!issue.assetId) {
            pane.append(emptyState("This issue is not attached to an asset in the register."));
            return;
          }
          pane.append(sheetCard(
            issue.assetName || issue.assetId,
            el("button", {
              class: "sheet-tool",
              onclick: () => openAssetSheet(issue.assetId, {
                seed: { name: issue.assetName },
                backTo: {
                  label: issueTitle(issue),
                  onBack: () => openIssueSheet(issueId, opts),
                },
              }),
            }, "Open asset"),
            el("dl", { class: "kv" },
              ...kvIf("Region", issue.region),
              ...kvIf("Account", issue.account),
              ...kvIf("Asset status", issue.entityStatus),
              ...kvIf("Projects", (issue.projects || []).join(", "))),
          ));
        },
      };

      ctx.rail(issueSections(detail), (id, pane) => {
        const render1 = panes[id];
        if (render1) render1(pane);
      });

      const cursor = opts.records
        ? recordCursor(opts.records.ids, opts.records.index)
        : { position: 0, total: 0 };
      ctx.announce(
        `${issueTitle(issue)} on ${issue.assetName}, ${issue.adjustedSeverity}.` +
        (cursor.total ? ` Record ${cursor.position} of ${cursor.total}.` : ""),
      );

      // Warm the next record after a dwell — but not on a seeded door: stepping through a
      // seeded list is already free, so there is nothing here worth prefetching.
      if (!seeded && cursor.nextId !== null && cursor.nextId !== undefined) {
        const nextId = cursor.nextId;
        const warmTimer = setTimeout(() => {
          swrCall("api_getIssueDetail", { id: nextId }).catch(() => {});
        }, 600);
        ctx.onDispose(() => clearTimeout(warmTimer));
      }

      // The fire-and-forget revalidation that makes the seeded paint honest rather than
      // merely fast. Off the critical path — nothing above awaited this. Repaints (and
      // re-announces, through paint's own ctx.announce above) only when the row actually
      // changed; either way the provisional line settles.
      if (seeded) {
        const settle = () => {
          if (provNode) {
            provNode.remove();
            provNode = null;
          }
        };
        swrCall("api_getIssueDetail", { id: issueId })
          .then((fresh) => {
            if (disposed) return;
            settle();
            // Compare the issue only, not the whole detail: the synthesised seed's `group`
            // is a one-field stand-in (comboNote's amplifierNote lookup), never shaped like
            // the server's real group object, so comparing the two wholesale would read as
            // "changed" on every single seeded open and double-announce an unchanged issue.
            if (JSON.stringify(fresh.issue) !== JSON.stringify(detail.issue)) paint(fresh, false);
          })
          .catch(() => {
            if (disposed) return;
            settle();
          });
      }
    }

    async function render() {
      // The caller already holds this exact row — paint it straight through, no transport
      // on the critical path at all.
      if (opts.seed && opts.seed.id === issueId) {
        paint({ issue: opts.seed, group: { amplifierNote: comboNote(opts.seed.comboGroup) } }, true);
        return;
      }
      ctx.setBusy(true);
      clear(body).append(issueSkeleton());
      let detail;
      try {
        // swrCall, not call: the graph door is the one that still fetches, and it is also
        // the one the next-record warm timer prefetches INTO this same cache. A bare call()
        // here would ignore that entry and re-pay the round trip it just spent.
        detail = await swrCall("api_getIssueDetail", { id: issueId }, (fresh) => {
          if (disposed) return;
          paint(fresh, false);
        });
      } catch (e) {
        if (disposed) return;
        ctx.setBusy(false);
        clear(body).append(errorState("Couldn't load this issue.", {
          detail: e && e.message ? e.message : e,
          onRetry: render,
        }));
        return;
      }
      if (disposed) return;
      ctx.setBusy(false);
      if (!detail) {
        clear(body).append(emptyState(
          "Issue not found.",
          "It may have been resolved or dropped since the last sync.",
        ));
        return;
      }
      paint(detail, false);
    }
    render();
  }, {
    // The header paints from the seed immediately — a real name and severity instead of
    // the literal word "Issue" over a raw id for the whole round trip.
    title: opts.seed ? issueTitle(opts.seed) : (opts.title || "Issue"),
    subtitle: opts.seed ? opts.seed.assetName : issueId,
    sev: opts.seed ? (opts.seed.adjustedSeverity || "") : "",
    closeOnRouteChange: true,
    backTo: opts.backTo || null,
    rail: { ariaLabel: "Issue sections" },
    resizable: true,
    expandable: true,
    records: opts.records || null,
    onClose: () => {
      disposed = true;
      if (opts.onClose) opts.onClose();
    },
  });
}

// -------------------------------------------------------------- cloud configuration

/** OPEN / RESOLVED / REJECTED with a word, never a bare tint. */
function configStatusPill(finding, gap) {
  if (gap) return statusPill("bad", "Failing");
  if (finding.status === "RESOLVED") return statusPill("good", "Resolved");
  if (finding.status === "REJECTED") return statusPill("warn", "Rejected");
  if (finding.result === "PASS") return statusPill("good", "Passing");
  return statusPill("neutral", finding.status || "Unknown");
}

/**
 * One configuration finding, whole.
 *
 * This is where the widened selection set pays for itself: the register row carries only
 * what a table cell needs, and everything explanatory — the rule's own description, the
 * resource-specific remediation, the Rego the evaluation actually ran, the IaC it traces
 * back to — arrives here, one finding at a time, because those fields repeat verbatim
 * across every finding of the same rule.
 */
export function openConfigFindingSheet(findingId, opts = {}) {
  let disposed = false;

  openSheet((body, close, ctx) => {
    function paint(detail) {
      const f = detail.finding;
      const gap = detail.gap;
      clear(body);

      const chips = [sevBadge(f.severity), configStatusPill(f, gap)];
      if ((f.ignoreRuleIds || []).length) chips.push(statusPill("warn", "Ignored"));
      if ((f.iacFindingIds || []).length) chips.push(statusPill("neutral", "From IaC"));
      if (!detail.asset) {
        // Stated, not hidden. A finding on a region or an IAM policy prices no AARS
        // score, and the sheet should say so where the score would otherwise be looked for.
        chips.push(statusPill("neutral", "Not an AI asset"));
      }

      ctx.setHeading({
        title: f.name || f.ruleName || f.id,
        subtitle: f.resourceName || f.resourceId,
        sev: f.severity || "",
        icon: kindIconSvg("ISSUE", 18),
        tone: categoryOf("ISSUE"),
        actions: [
          toolButton(copyButton(() => f.id, {
            label: "Copy ID", copiedLabel: "Copied", title: f.id,
          })),
        ],
        chips,
      });

      const panes = {
        overview(pane) {
          pane.append(sheetSection("What failed",
            el("p", { class: "small", style: "margin:0" },
              f.ruleName || f.name || "This control has no description on the rule.")));
          if (f.risks && f.risks.length) {
            pane.append(sheetSection("Risk categories",
              el("div", { class: "pill-row" },
                ...f.risks.map((r) => statusPill("neutral", r.replace(/_/g, " ").toLowerCase())))));
          }
          if (f.firstSeenAt) {
            pane.append(sheetSection("Age",
              el("p", { class: "small", style: "margin:0" },
                "First seen " + fmtDate(f.firstSeenAt) +
                (f.analyzedAt ? " · last evaluated " + fmtDate(f.analyzedAt) : "")),
              // Wiz sends no resolvedAt on a configuration finding, so this sheet can date
              // the start of the problem and never its end. Saying so beats implying the
              // absent field is a zero.
              el("p", { class: "small muted", style: "margin:6px 0 0" },
                "Wiz reports no resolution date for configuration findings; " +
                "closure can only be dated from this app's own sync history.")));
          }
        },

        fix(pane) {
          const own = f.remediation;
          const template = f.remediationInstructions;
          if (!own && !template) {
            pane.append(emptyState("The rule carries no remediation text."));
            return;
          }
          if (own) {
            pane.append(sheetSection("For this resource", codeBlock(own, {
              label: "Remediation for this resource", maxHeight: "340px",
            })));
          }
          // Shown second and labelled: the template still carries its {{placeholders}},
          // and mistaking it for the resolved instructions above would mean pasting a
          // literal {{roleName}} into a CLI.
          if (template && template !== own) {
            pane.append(sheetSection("Rule template", codeBlock(template, {
              label: "Rule remediation template", maxHeight: "260px",
            })),
            el("p", { class: "small muted", style: "margin:6px 0 0" },
              "The rule's generic instructions, placeholders unresolved."));
          }
        },

        accepted(pane) {
          const ids = f.ignoreRuleIds || [];
          if (!ids.length) {
            pane.append(emptyState("No ignore rule covers this finding."));
            return;
          }
          pane.append(el("p", { class: "small", style: "margin:0 0 8px" },
            plural(ids.length, "ignore rule") + " cover this finding, so someone has " +
            "accepted this risk. It still counts as a failing control while its status " +
            "stays OPEN."));
          pane.append(el("div", { class: "sheet-list" },
            ...ids.map((id) => sheetRow({ meta: [el("span", { class: "small muted" }, id)] }))));
        },

        iac(pane) {
          const ids = f.iacFindingIds || [];
          if (!ids.length) {
            pane.append(emptyState(
              "Wiz did not trace this finding to infrastructure as code.",
              "Either the resource was not provisioned from scanned IaC, or the mapping is absent.",
            ));
            return;
          }
          pane.append(el("p", { class: "small", style: "margin:0 0 8px" },
            "Wiz mapped this misconfiguration back to IaC. Fixing it at source stops it " +
            "returning on the next deploy."));
          pane.append(el("div", { class: "sheet-list" },
            ...ids.map((id) => sheetRow({ meta: [el("span", { class: "small muted" }, id)] }))));
        },

        rule(pane) {
          if (!f.ruleDescription) {
            pane.append(emptyState("The rule carries no description."));
            return;
          }
          pane.append(el("p", { class: "small", style: "margin:0; white-space:pre-wrap" },
            f.ruleDescription));
        },

        policy(pane) {
          if (!f.opaPolicy) {
            pane.append(emptyState("No policy document on this rule."));
            return;
          }
          pane.append(
            el("p", { class: "small muted", style: "margin:0 0 8px" },
              "The Rego the evaluation actually ran — the definition of pass and fail here."),
            codeBlock(f.opaPolicy, { label: "Rule policy", maxHeight: "420px" }),
          );
        },

        resource(pane) {
          pane.append(el("dl", { class: "kv kv--cols2" },
            ...kvIf("Name", f.resourceName),
            ...kvIf("Type", f.resourceType),
            ...kvIf("Status", f.resourceStatus),
            ...kvIf("Id", f.resourceId ? idValue(f.resourceId) : ""),
            ...kvIf("External id", f.targetExternalId ? idValue(f.targetExternalId) : ""),
            ...kvIf("Cloud", f.cloudProvider),
            ...kvIf("Subscription", f.subscriptionName),
            ...kvIf("Business impact", f.businessImpact),
          ));
        },

        asset(pane) {
          if (!detail.asset) {
            pane.append(emptyState(
              "This finding is not on an AI asset.",
              "It was evaluated against a " + (f.resourceType || "resource").toLowerCase() +
              ", which the AI inventory does not hold — so it counts as a compliance gap " +
              "but prices no asset's " + FINDINGS_SCORE_LABEL.toLowerCase() + ".",
            ));
            return;
          }
          pane.append(sheetCard(
            detail.asset.name || detail.asset.id,
            el("button", {
              class: "sheet-tool",
              onclick: () => openAssetSheet(detail.asset.id, {
                seed: { name: detail.asset.name },
                backTo: {
                  label: f.name || f.ruleName || "Finding",
                  onBack: () => openConfigFindingSheet(findingId, opts),
                },
              }),
            }, "Open asset"),
            el("dl", { class: "kv" },
              ...kvIf("Kind", detail.asset.kind ? kindLabel(detail.asset.kind) : ""),
              ...kvIf("Cloud", detail.asset.cloud),
              ...kvIf("Region", detail.asset.region)),
          ));
        },

        projects(pane) {
          const projects = f.projects || [];
          if (!projects.length) {
            pane.append(emptyState("No projects on this resource."));
            return;
          }
          pane.append(el("div", { class: "sheet-list" },
            ...projects.map((p) => sheetRow({
              meta: [
                el("span", { class: "small" }, p.name),
                p.businessImpact
                  ? el("span", { class: "small muted" }, p.businessImpact)
                  : null,
              ].filter(Boolean),
            }))));
        },

        facts(pane) {
          pane.append(el("dl", { class: "kv kv--cols2" },
            ...kvIf("Rule", f.ruleShortId),
            ...kvIf("Rule id", f.ruleId ? idValue(f.ruleId) : ""),
            ...kvRow("Status", f.status || "—"),
            ...kvRow("Result", f.result || "—"),
            ...kvIf("Counts as a gap", gap ? "Yes" : "No"),
            ...kvIf("Source", f.source),
            ...kvIf("First seen", f.firstSeenAt ? fmtDate(f.firstSeenAt) : ""),
            ...kvIf("Last evaluated", f.analyzedAt ? fmtDateTime(f.analyzedAt) : ""),
            ...kvIf("Framework codes", (f.frameworkCodes || []).join(", ")),
            ...kvIf("Risks", (f.risks || []).join(", ")),
            ...kvIf("Threats", (f.threats || []).join(", ")),
          ));
        },
      };

      ctx.rail(configFindingSections(detail), (id, pane) => {
        const render1 = panes[id];
        if (render1) render1(pane);
      });

      ctx.announce(
        (f.name || f.ruleName || "Configuration finding") +
        " on " + (f.resourceName || f.resourceId) + ", " + f.severity + "." +
        (gap ? " Failing." : " Not currently failing."),
      );
    }

    async function render() {
      ctx.setBusy(true);
      clear(body).append(skeleton("line", { height: "18px" }));
      let detail;
      try {
        detail = await swrCall("api_getConfigFindingDetail", { id: findingId }, (fresh) => {
          if (disposed || !fresh) return;
          paint(fresh);
        });
      } catch (e) {
        if (disposed) return;
        ctx.setBusy(false);
        clear(body).append(errorState("Couldn't load this finding.", {
          detail: e && e.message ? e.message : e,
          onRetry: render,
        }));
        return;
      }
      if (disposed) return;
      ctx.setBusy(false);
      if (!detail) {
        clear(body).append(emptyState(
          "This finding is no longer in the register.",
          "The last sync rewrote the findings tab and did not return it.",
        ));
        return;
      }
      paint(detail);
    }
    render();
  }, {
    title: opts.seed ? (opts.seed.name || opts.seed.ruleName) : (opts.title || "Finding"),
    subtitle: opts.seed ? (opts.seed.resourceName || opts.seed.resourceId) : findingId,
    sev: opts.seed ? (opts.seed.severity || "") : "",
    closeOnRouteChange: true,
    backTo: opts.backTo || null,
    rail: { ariaLabel: "Finding sections" },
    resizable: true,
    expandable: true,
    records: opts.records || null,
    onClose: () => {
      disposed = true;
      if (opts.onClose) opts.onClose();
    },
  });
}
