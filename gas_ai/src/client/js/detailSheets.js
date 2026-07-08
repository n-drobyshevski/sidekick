// Shared drill-down sheets: asset detail (identity, AARS pillars, issues, neighbors)
// and issue detail (justification, frameworks, amplifier note). Used by the graph,
// inventory, and combos pages so every surface opens the same drawer.

import { call } from "./api.js";
import { bootstrapCached, navigate } from "./store.js";
import { kindLabel } from "./icons.js";
import { aarsChip, clear, el, emptyState, openSheet, sevBadge } from "./ui.js";

const PILLAR_MAX = { toxic: 50, compliance: 30, data: 22 };
const PILLAR_LABEL = {
  toxic: "Toxic combinations",
  compliance: "Compliance gaps",
  data: "Data exposure",
};

function pillarBars(pillars) {
  const wrap = el("div", {});
  for (const key of ["toxic", "compliance", "data"]) {
    const value = Number(pillars[key] ?? 0);
    const max = PILLAR_MAX[key];
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    const fill = el("div", { class: "pillar-fill" });
    fill.style.width = `${pct}%`;
    wrap.append(
      el("div", { class: "pillar-row" },
        el("span", { class: "pillar-name" }, PILLAR_LABEL[key]),
        el("div", {
          class: "pillar-track", role: "meter",
          "aria-valuemin": "0", "aria-valuemax": String(max), "aria-valuenow": String(value),
          "aria-label": `${PILLAR_LABEL[key]}: ${value} of ${max} points`,
        }, fill),
        el("span", { class: "pillar-val" }, `${value}/${max}`),
      ),
    );
  }
  return wrap;
}

function fwTags(frameworks) {
  const tags = [];
  const push = (prefix, list) => {
    for (const code of list || []) tags.push(`${prefix}${code}`);
  };
  push("", frameworks?.owaspLlm);
  push("", frameworks?.owaspAgentic);
  push("ML: ", frameworks?.owaspMl);
  push("5Rs: ", frameworks?.fiveRs);
  if (!tags.length) return null;
  return el("div", { class: "fw-tags" }, ...tags.map((t) => el("span", { class: "fw-tag" }, t)));
}

function kvRow(dt, dd) {
  return [el("dt", {}, dt), el("dd", {}, dd)];
}

/** Asset drill-down. opts.graphActions adds "Focus graph here" / "Expand neighbors". */
export function openAssetSheet(assetId, opts = {}) {
  openSheet(async (body, close) => {
    body.append(el("p", { class: "muted" }, "Loading…"));
    let detail;
    try {
      detail = await call("api_getAssetDetail", { id: assetId });
    } catch (e) {
      clear(body).append(emptyState("Couldn't load this asset.", String(e.message || e)));
      return;
    }
    if (!detail) {
      clear(body).append(emptyState("Asset not found in the last sync."));
      return;
    }
    const boot = bootstrapCached();
    const bandSeverity = boot?.palette?.aarsBandSeverity || {};
    const { node, issues, neighbors, findings } = detail;
    clear(body);

    const head = el("div", { class: "sheet-section" },
      el("div", { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap" },
        node.severity ? sevBadge(node.severity) : null,
        aarsChip(node.aars, node.aarsBand, bandSeverity),
        (node.comboGroups || []).length
          ? el("span", { class: "pill bad" }, "Toxic combination")
          : null,
        node.guardrailMissing ? el("span", { class: "pill warn" }, "No guardrail") : null,
        node.identityPurpose === "AGENTIC" ? el("span", { class: "pill" }, "Agentic") : null,
        node.issueAnalytics && node.issueAnalytics.total
          ? el("span", { class: "pill" }, `${node.issueAnalytics.total} related issue${node.issueAnalytics.total === 1 ? "" : "s"}`)
          : null,
      ),
    );

    const facts = el("dl", { class: "kv" },
      ...kvRow("Kind", kindLabel(node.kind)),
      ...kvRow("Native type", node.nativeType || "—"),
      ...kvRow("Cloud", node.cloud || "—"),
      ...kvRow("Region", node.region || "—"),
      ...kvRow("Status", node.status || "—"),
      ...kvRow("Projects", (node.projects || []).join(", ") || "—"),
      ...kvRow("Internet exposed",
        node.internet === true ? "Yes" : node.internet === false ? "No"
          : "Unknown (inherited from host)"),
      ...kvRow("Open to all internet",
        node.openInternet === true ? "Yes" : node.openInternet === false ? "No"
          : "Unknown (inherited from host)"),
      ...kvRow("Sensitive data access", node.sensitiveAccess ? "Yes" : "No"),
      ...kvRow("High privileges", node.highPriv ? "Yes" : "No"),
      ...kvRow("Admin privileges", node.adminPriv ? "Yes" : "No"),
      ...(node.technologyCategories && node.technologyCategories.length
        ? kvRow("Technology", node.technologyCategories.join(", "))
        : []),
    );

    body.append(
      head,
      el("div", { class: "sheet-section" }, el("span", { class: "label" }, "Identity"), facts),
    );

    if (node.aarsPillars) {
      body.append(
        el("div", { class: "sheet-section" },
          el("span", { class: "label" }, `AARS breakdown — ${node.aars}`),
          pillarBars(node.aarsPillars),
        ),
      );
    }

    if (issues && issues.length) {
      const list = el("div", {});
      for (const issue of issues) {
        list.append(
          el("div", { style: "padding:8px 0; border-bottom:1px solid var(--hairline)" },
            el("div", { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap" },
              sevBadge(issue.adjustedSeverity),
              el("span", { class: "small muted" }, `native ${issue.nativeSeverity}`),
            ),
            el("div", { class: "small", style: "margin-top:4px" }, issue.ruleName),
            issue.justification
              ? el("div", { class: "small muted", style: "margin-top:2px" }, issue.justification)
              : null,
            fwTags(issue.frameworks),
          ),
        );
      }
      body.append(
        el("div", { class: "sheet-section" },
          el("span", { class: "label" }, `Open issues (${issues.length})`),
          list,
        ),
      );
    }

    if (findings && findings.length) {
      const list = el("div", {});
      for (const f of findings) {
        list.append(
          el("div", { style: "padding:8px 0; border-bottom:1px solid var(--hairline)" },
            el("div", { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap" },
              sevBadge(f.severity),
              el("span", { class: "small muted" }, f.ruleShortId || "—"),
            ),
            f.remediation
              ? el("div", { class: "small muted", style: "margin-top:2px; white-space:pre-wrap" },
                  f.remediation)
              : null,
          ),
        );
      }
      body.append(
        el("div", { class: "sheet-section" },
          el("span", { class: "label" }, `Compliance findings (${findings.length})`),
          list,
        ),
      );
    }

    if (neighbors && neighbors.length) {
      const list = el("ul", { style: "margin:0; padding-left:18px; font-size:13px" });
      for (const n of neighbors.slice(0, 20)) {
        const arrow = n.direction === "out" ? "→" : "←";
        list.append(el("li", {},
          `${arrow} ${n.edge.type}${n.edge.accessType ? ` [${n.edge.accessType}]` : ""} `,
          el("strong", {}, n.node.name),
          el("span", { class: "muted" }, ` (${kindLabel(n.node.kind)})`),
        ));
      }
      body.append(
        el("div", { class: "sheet-section" },
          el("span", { class: "label" }, `Relationships (${neighbors.length})`),
          list,
          neighbors.length > 20
            ? el("div", { class: "small muted" }, `+ ${neighbors.length - 20} more — expand in the graph`)
            : null,
        ),
      );
    }

    const actions = el("div", { class: "sheet-actions" });
    if (opts.onFocusGraph) {
      actions.append(el("button", { onclick: () => { close(); opts.onFocusGraph(node.id); } },
        "Focus graph here"));
    } else {
      actions.append(el("button", {
        onclick: () => { close(); navigate("graph", { seed: node.id }); },
      }, "Open in graph"));
    }
    if (opts.onExpand) {
      actions.append(el("button", { onclick: () => { close(); opts.onExpand(node.id); } },
        "Expand neighbors"));
    }
    body.append(actions);
  }, { title: opts.title || "Asset", subtitle: assetId, ariaLabel: "Asset detail" });
}

/** Issue drill-down. */
export function openIssueSheet(issueId) {
  openSheet(async (body, close) => {
    body.append(el("p", { class: "muted" }, "Loading…"));
    let detail;
    try {
      detail = await call("api_getIssueDetail", { id: issueId });
    } catch (e) {
      clear(body).append(emptyState("Couldn't load this issue.", String(e.message || e)));
      return;
    }
    if (!detail) {
      clear(body).append(emptyState("Issue not found."));
      return;
    }
    const { issue, group } = detail;
    clear(body);

    body.append(
      el("div", { class: "sheet-section" },
        el("div", { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap" },
          sevBadge(issue.adjustedSeverity),
          el("span", { class: "small muted" }, `Wiz native ${issue.nativeSeverity}`),
        ),
        group
          ? el("div", { class: "combo-note", role: "note" }, group.amplifierNote)
          : null,
      ),
      el("div", { class: "sheet-section" },
        el("span", { class: "label" }, "Facts"),
        el("dl", { class: "kv" },
          ...kvRow("Rule", issue.ruleName),
          ...kvRow("Rule id", issue.ruleId || "—"),
          ...kvRow("Asset", issue.assetName),
          ...kvRow("Status", issue.status),
          ...kvRow("Region", issue.region || "—"),
          ...kvRow("Account", issue.account || "—"),
          ...kvRow("Projects", (issue.projects || []).join(", ") || "—"),
          ...kvRow("Created", issue.createdAt || "—"),
          ...kvRow("Due", issue.dueAt || "—"),
        ),
      ),
    );
    if (issue.justification) {
      body.append(
        el("div", { class: "sheet-section" },
          el("span", { class: "label" }, "Why it matters"),
          el("p", { class: "small", style: "margin:0" }, issue.justification),
        ),
      );
    }
    const fix = issue.remediation || issue.resolutionRecommendation;
    if (fix) {
      body.append(
        el("div", { class: "sheet-section" },
          el("span", { class: "label" }, "Recommended fix"),
          el("p", { class: "small", style: "margin:0; white-space:pre-wrap" }, fix),
        ),
      );
    }
    const tags = fwTags(issue.frameworks);
    if (tags) {
      body.append(
        el("div", { class: "sheet-section" },
          el("span", { class: "label" }, "Framework mappings"),
          tags,
        ),
      );
    }
    body.append(
      el("div", { class: "sheet-actions" },
        el("button", {
          onclick: () => { close(); navigate("graph", { seed: issue.assetId }); },
        }, "Open in graph"),
      ),
    );
  }, { title: "Issue", subtitle: issueId, ariaLabel: "Issue detail" });
}
