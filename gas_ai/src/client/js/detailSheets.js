// Shared drill-down sheets: asset detail (verdict, evidence, AARS pillars, topology,
// identity) and issue detail (justification, fix, frameworks, amplifier note). Used by
// the graph, inventory, and combos pages so every surface opens the same drawer.
//
// Order is a decision, not a layout: the verdict and the fix come before the ledger of
// infrastructure facts, because the analyst opened this to decide something.

import { call } from "./api.js";
import { bootstrapCached, navigate } from "./store.js";
import { egoGraph } from "./egoGraph.js";
import { categoryOf, edgeLabel, kindIconSvg, kindLabel } from "./icons.js";
import { severityMixText } from "./graphNode.js";
import { slaState } from "./pages/comboView.js";
import { assetSections, issueSections, recordCursor } from "./recordSections.js";
import {
  aarsChip, clear, codeBlock, copyButton, el, emptyState, errorState, fmtDate, fmtDateTime,
  meter, openSheet, plural, sevBadge, sheetRow, sheetSection, skeleton, statusPill, uiIcon,
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
  if (node.openInternet) add("bad", "INTERNET_EXPOSURE", "Open to all internet");
  else if (node.internet) add("warn", "INTERNET_EXPOSURE", "Internet exposed");
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

/** When the estate first saw this asset and when it last did — sync provenance, not risk. */
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
    async function render() {
      ctx.setBusy(true);
      clear(body).append(assetSkeleton());
      let detail;
      try {
        detail = await call("api_getAssetDetail", { id: assetId });
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
          "It may have been removed from the estate since the sync ran.",
        ));
        return;
      }

      const { node, issues, neighbors, findings } = detail;
      const openIssues = issues || [];
      const rels = neighbors || [];
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
        sev: node.aarsSeverity || "",
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
          // Two severity-shaped chips sit side by side here — the asset's AARS level and
          // its worst open issue. They routinely disagree, so each is named.
          el("span", { class: "sheet-chip-label" }, "AARS"),
          aarsChip(node.aars, node.aarsSeverity),
          node.severity ? el("span", { class: "sheet-chip-label" }, "Worst issue") : null,
          node.severity ? sevBadge(node.severity) : null,
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
          // The verdict leads, and it leads as a number: the score is the product.
          if (node.aars !== null && node.aars !== undefined) {
            const p = node.aarsPillars;
            pane.append(
              el("div", { class: "sheet-section" },
                el("div", { class: "sheet-verdict" },
                  el("span", { class: "aars-total" }, String(node.aars)),
                  el("span", { class: "muted small" }, "AARS out of 100")),
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
          let map = null;
          if (rels.length) {
            const boot = bootstrapCached();
            map = egoGraph({
              focal: node,
              rels,
              palette: boot && boot.palette,
              onOpen: openNeighbor,
              onShowAll: () => ctx.selectSection("relationships"),
            });
            ctx.onDispose(map.destroy);
          }
          pane.append(sheetCard(
            `Connections (${rels.length})`,
            el("button", { class: "sheet-tool", onclick: openGraph },
              uiIcon("graph", 14), "Open in graph"),
            map ? map.node : emptyState("No connections in the last sync."),
          ));
          // The record as the server sent it. An analyst who needs a field this sheet does
          // not name should not have to open the browser console to read it.
          const raw = JSON.stringify(detail, null, 2);
          pane.append(el("details", { class: "disclosure" },
            el("summary", { class: "disclosure-toggle" }, "Raw record"),
            el("div", { style: "padding:8px 0 4px" },
              copyButton(() => raw, { label: "Copy JSON" }),
              codeBlock(raw, { label: "Raw record, as JSON", maxHeight: "320px" }))));
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
              onOpen: () => openIssueSheet(issue.id, {
                records: {
                  ids: openIssues.map((i) => i.id),
                  index: openIssues.indexOf(issue),
                  label: "issue",
                  open: (id) => openIssueSheet(id, {
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
              "No compliance findings on this asset.",
              "The last sync returned no configuration finding against it.",
            ));
            return;
          }
          const list = el("div", { class: "sheet-list" });
          for (const f of compliance) {
            list.append(sheetRow({
              badge: sevBadge(f.severity),
              meta: [el("span", { class: "small muted" }, f.ruleShortId || "—")],
              fix: f.remediation,
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
                  backTo: { label: node.name, onBack: () => openAssetSheet(assetId, opts) },
                }),
              }))),
            ));
          }
        },

        aars(pane) {
          if (!node.aarsPillars) {
            pane.append(emptyState(
              "This asset carries no AARS score.",
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

      const cursor = opts.records
        ? recordCursor(opts.records.ids, opts.records.index)
        : { position: 0, total: 0 };
      ctx.announce(
        `${node.name}. AARS ${node.aars === null || node.aars === undefined ? "unscored" : node.aars}, ` +
        `${plural(openIssues.length, "open issue")}, ${plural(rels.length, "relationship")}.` +
        (cursor.total ? ` Record ${cursor.position} of ${cursor.total}.` : ""),
      );
    }

    render();
  }, {
    title: seedTitle,
    subtitle: seedSub || assetId,
    sev: seed.aarsSeverity || "",
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
    async function render() {
      ctx.setBusy(true);
      clear(body).append(issueSkeleton());
      let detail;
      try {
        detail = await call("api_getIssueDetail", { id: issueId });
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
      const { issue, group } = detail;
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
    }
    render();
  }, {
    title: opts.title || "Issue",
    subtitle: issueId,
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
