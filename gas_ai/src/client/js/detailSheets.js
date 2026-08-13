// Shared drill-down sheets: asset detail (verdict, evidence, AARS pillars, topology,
// identity) and issue detail (justification, fix, frameworks, amplifier note). Used by
// the graph, inventory, and combos pages so every surface opens the same drawer.
//
// Order is a decision, not a layout: the verdict and the fix come before the ledger of
// infrastructure facts, because the analyst opened this to decide something.

import { call } from "./api.js";
import { bootstrapCached, navigate } from "./store.js";
import { kindLabel } from "./icons.js";
import { slaState } from "./pages/comboView.js";
import {
  aarsChip, clear, el, emptyState, errorState, fmtDate, fmtDateTime, meter,
  openSheet, plural, sevBadge, sheetRow, sheetSection, skeleton, statusPill,
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

// --------------------------------------------------------------------------- asset

/**
 * Asset drill-down. opts: title/seed (paint the header before the RPC lands),
 * onFocusGraph / onExpand (graph-page actions), backTo ({ label, onBack }).
 */
export function openAssetSheet(assetId, opts = {}) {
  const seed = opts.seed || {};
  const seedTitle = seed.name || opts.title || "Asset";
  const seedSub = [kindLabel(seed.kind), seed.cloud, seed.region].filter(Boolean).join(" · ");

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

      ctx.setHeading({
        title: node.name,
        subtitle: [kindLabel(node.kind), node.cloud, node.region].filter(Boolean).join(" · "),
        sev: node.aarsSeverity || "",
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

      // 1 — the verdict. The score is the product; it leads, and it leads as a number.
      if (node.aars !== null && node.aars !== undefined) {
        const p = node.aarsPillars;
        body.append(
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

      // 2 — the evidence, with the fix attached. This is why the sheet exists.
      if (openIssues.length) {
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
              backTo: { label: node.name, onBack: () => openAssetSheet(assetId, opts) },
            }),
          }));
        }
        body.append(sheetSection(`Open issues (${openIssues.length})`, list));
      }

      if (compliance.length) {
        const list = el("div", { class: "sheet-list" });
        for (const f of compliance) {
          list.append(sheetRow({
            badge: sevBadge(f.severity),
            meta: [el("span", { class: "small muted" }, f.ruleShortId || "—")],
            fix: f.remediation,
          }));
        }
        body.append(sheetSection(`Compliance findings (${compliance.length})`, list));
      }

      // 3 — the audit trail behind the number.
      if (node.aarsPillars) {
        body.append(sheetSection("AARS breakdown", pillarBars(node.aarsPillars, caps)));
      }

      // 4 — topology. Every neighbour is a step you can take, not a line of text.
      if (rels.length) {
        const list = el("div", { class: "sheet-list" });
        const paint = (limit) => {
          clear(list);
          for (const n of rels.slice(0, limit)) {
            const out = n.direction === "out";
            list.append(sheetRow({
              extraClass: "sheet-rel",
              badge: el("span", { class: "sheet-rel-dir" },
                el("span", { "aria-hidden": "true" }, out ? "→" : "←"),
                el("span", { class: "sr-only" }, out ? "outbound" : "inbound")),
              meta: [
                el("strong", {}, n.node.name),
                el("span", { class: "small muted" }, kindLabel(n.node.kind)),
                el("span", { class: "domain-chip" },
                  n.edge.type + (n.edge.accessType ? ` [${n.edge.accessType}]` : "")),
              ],
              ariaLabel: `${out ? "Outbound" : "Inbound"} ${n.edge.type} to ${n.node.name}`,
              onOpen: () => openAssetSheet(n.node.id, {
                seed: n.node,
                onFocusGraph: opts.onFocusGraph,
                onExpand: opts.onExpand,
                expandable: opts.expandable,
                backTo: { label: node.name, onBack: () => openAssetSheet(assetId, opts) },
              }),
            }));
          }
          if (rels.length > limit) {
            list.append(el("button", {
              class: "linklike sheet-more",
              onclick: () => paint(rels.length),
            }, `Show all ${rels.length} relationships`));
          }
        };
        paint(NEIGHBOR_PREVIEW);
        body.append(sheetSection(`Relationships (${rels.length})`, list));
      }

      // 5 — the reference ledger, last, because it is reference.
      const analytics = node.issueAnalytics;
      body.append(sheetSection("Identity",
        el("dl", { class: "kv" },
          ...kvRow("Kind", kindLabel(node.kind)),
          ...kvIf("Native type", node.nativeType),
          ...kvIf("Cloud", node.cloud),
          ...kvIf("Cloud account", node.cloudAccount),
          ...kvIf("Region", node.region),
          ...kvIf("Status", node.status),
          ...kvIf("Projects", (node.projects || []).join(", ")),
          ...kvRow("Internet exposed", yesNoUnknown(node.internet)),
          ...kvRow("Open to all internet", yesNoUnknown(node.openInternet)),
          ...kvIf("Holds sensitive data", node.sensitiveData ? "Yes" : ""),
          ...kvIf("Technology", (node.technologyCategories || []).join(", ")),
          // Wiz's own per-identity rollup. Labelled as such so it stops looking like a
          // second, disagreeing count of the open issues listed above.
          ...(analytics && analytics.total
            ? kvRow("Wiz related issues", `${analytics.total} across all severities`)
            : []),
        ),
        (node.tags || []).length
          ? el("div", { class: "tag-strip", style: "margin-top:10px" },
              ...node.tags.map((t) => el("span", { class: "fw-tag" },
                t.value ? `${t.key}: ${t.value}` : t.key)))
          : null,
      ));

      // Native append() stringifies null into a literal "null" text node (unlike el(),
      // which drops it), so conditional children are filtered out here.
      const footBtns = [
        el("button", {
          class: "primary",
          onclick: () => {
            close();
            if (opts.onFocusGraph) opts.onFocusGraph(node.id);
            else navigate("graph", { seed: node.id });
          },
        }, opts.onFocusGraph ? "Focus graph here" : "Open in graph"),
        opts.onExpand
          ? el("button", { onclick: () => { close(); opts.onExpand(node.id); } },
              "Expand neighbors")
          : null,
      ];
      clear(ctx.footer()).append(...footBtns.filter(Boolean));

      ctx.announce(
        `${node.name}. AARS ${node.aars === null || node.aars === undefined ? "unscored" : node.aars}, ` +
        `${plural(openIssues.length, "open issue")}, ${plural(rels.length, "relationship")}.`,
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
  openSheet((body, close, ctx) => {
    async function render() {
      ctx.setBusy(true);
      clear(body).append(issueSkeleton());
      let detail;
      try {
        detail = await call("api_getIssueDetail", { id: issueId });
      } catch (e) {
        ctx.setBusy(false);
        clear(body).append(errorState("Couldn't load this issue.", {
          detail: e && e.message ? e.message : e,
          onRetry: render,
        }));
        return;
      }
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
        chips,
      });

      // Guarded on the note itself, not on the group: the Other bucket resolves to a real
      // group with no amplifier claim, and an empty note would render as a blank slab.
      if (group && group.amplifierNote) {
        body.append(el("div", { class: "sheet-section" },
          el("div", { class: "combo-note", role: "note" }, group.amplifierNote)));
      }
      if (issue.justification) {
        body.append(sheetSection("Why it matters",
          el("p", { class: "small", style: "margin:0" }, issue.justification)));
      }
      const fix = issue.remediation || issue.resolutionRecommendation;
      if (fix) {
        body.append(sheetSection("Recommended fix",
          el("p", { class: "sheet-fix-body", style: "margin:0" }, fix)));
      }
      const tags = fwTags(issue.frameworks);
      if (tags) body.append(sheetSection("Framework mappings", tags));

      // An accepted risk that lapsed. The expiry is read off the structured field; the
      // note is shown verbatim because it is a sentence a human wrote, and the date
      // inside its prose is not what anything here is computed from.
      if (issue.ignoreNote || issue.ignoreExpiredAt) {
        const rows = [];
        if (issue.ignoreExpiredAt) {
          rows.push(el("div", { style: "margin-bottom:8px" },
            statusPill("warn", "Ignore expired " + fmtDate(issue.ignoreExpiredAt))));
        }
        if (issue.ignoreNote) {
          rows.push(el("p", { class: "small", style: "margin:0; white-space:pre-wrap" },
            issue.ignoreNote));
        }
        body.append(sheetSection("Accepted risk", ...rows));
      }

      if ((issue.ticketUrls || []).length) {
        const list = el("div", { style: "display:grid; gap:6px" });
        issue.ticketUrls.forEach((url, n) => {
          list.append(el("a", {
            href: url,
            target: "_blank",
            rel: "noopener noreferrer",
            class: "small",
            style: "overflow-wrap:anywhere",
            "aria-label": "Open ticket " + (n + 1) + " in a new tab",
          }, url));
        });
        body.append(sheetSection("Tickets", list));
      }

      // Wiz's own remediation verdict, kept visibly separate from this register's
      // adjusted severity — they are two different opinions about the same issue.
      if (issue.aiVerdict) {
        const verdict = el("div", { style: "display:flex; align-items:center; gap:8px" },
          el("strong", { class: "small" }, issue.aiVerdict));
        if (issue.aiRecommendedSeverity) verdict.append(sevBadge(issue.aiRecommendedSeverity));
        body.append(sheetSection("Wiz AI analysis",
          verdict,
          el("p", { class: "small muted", style: "margin:8px 0 0" },
            "Wiz's recommendation, not this register's adjusted severity.")));
      }

      body.append(sheetSection("Facts",
        el("dl", { class: "kv" },
          ...kvIf("Rule id", issue.ruleId),
          ...kvRow("Asset", issue.assetName),
          ...kvRow("Status", issueStatusLabel(issue.status)),
          ...kvIf("Issue type", issueTypeLabel(issue.issueType)),
          ...kvIf("Assignee", issue.assignee),
          ...kvIf("Region", issue.region),
          ...kvIf("Account", issue.account),
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
        )));

      clear(ctx.footer()).append(
        el("button", {
          class: "primary",
          onclick: () => { close(); navigate("graph", { seed: issue.assetId }); },
        }, "Open in graph"),
      );

      ctx.announce(`${issueTitle(issue)} on ${issue.assetName}, ${issue.adjustedSeverity}.`);
    }
    render();
  }, {
    title: opts.title || "Issue",
    subtitle: issueId,
    closeOnRouteChange: true,
    backTo: opts.backTo || null,
  });
}
