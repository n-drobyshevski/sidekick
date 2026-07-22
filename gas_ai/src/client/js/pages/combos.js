// Toxic Combinations: one card per combination pattern (adjusted vs native severity,
// the 5Rs amplifier note, framework tags, affected assets), expanding into the issue
// table. Issue click opens the shared issue sheet.

import { bootstrap, navigate, swrCall } from "../store.js";
import { openAssetSheet, openIssueSheet } from "../detailSheets.js";
import { aarsChip, clear, el, emptyState, sevBadge, skeleton } from "../ui.js";

// Placeholder combo cards shown until api_getToxicCombos resolves; paint() clears the host.
function combosSkeleton() {
  const wrap = el("div", { role: "status", "aria-label": "Loading toxic combinations" });
  for (let i = 0; i < 3; i++) {
    wrap.append(el("div", { class: "card combo-card", style: "margin-bottom:16px" },
      el("div", { style: "display:flex; align-items:center; gap:10px" },
        skeleton("pill", { width: "80px" }),
        skeleton("line", { width: "40%" })),
      el("div", { style: "margin-top:12px" }, skeleton("line", { width: "90%" })),
      el("div", { style: "display:flex; gap:8px; margin-top:12px" },
        skeleton("pill", { width: "90px" }),
        skeleton("pill", { width: "110px" }),
        skeleton("pill", { width: "70px" }))));
  }
  return wrap;
}

export async function renderCombos(main) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Toxic Combinations"),
    el("p", { class: "page-sub" },
      "Multi-condition risk patterns on AI assets — privileged access, sensitive data " +
      "and missing guardrails combined. Severity shown as adjusted (5Rs 53% amplifier), " +
      "with Wiz native severity alongside."),
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
  host.append(combosSkeleton()); // replaced by paint() once api_getToxicCombos resolves

  let data;
  try {
    data = await swrCall("api_getToxicCombos", {}, (fresh) => paint(fresh));
  } catch (e) {
    host.append(emptyState("Couldn't load toxic combinations.", String(e.message || e)));
    return;
  }
  paint(data);

  async function paint(payload) {
    clear(host);
    const bandSeverity = boot.palette?.aarsBandSeverity || {};

    for (const group of payload.groups) {
      const card = el("div", { class: "card combo-card" });
      card.append(
        el("div", { class: "combo-head" },
          sevBadge(group.adjustedSeverity),
          el("span", { class: "small muted" }, `Wiz native ${group.nativeSeverity}`),
          el("h3", { style: "margin:0" }, group.title),
          el("span", { class: "combo-count" },
            `${group.count} issue${group.count === 1 ? "" : "s"}`),
        ),
        el("div", { class: "combo-note", role: "note" }, group.amplifierNote),
        el("div", { class: "fw-tags" },
          ...[
            ...(group.frameworks.owaspLlm || []),
            ...(group.frameworks.owaspAgentic || []),
            ...(group.frameworks.owaspMl || []).map((c) => `ML: ${c}`),
            ...(group.frameworks.fiveRs || []).map((c) => `5Rs: ${c}`),
          ].map((t) => el("span", { class: "fw-tag" }, t)),
        ),
      );

      if (group.assets.length) {
        const assetRow = el("div", {
          style: "display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:center",
        }, el("span", { class: "label" }, "Assets"));
        for (const a of group.assets) {
          assetRow.append(
            el("button", {
              class: "sev-pill",
              onclick: () => openAssetSheet(a.id, { title: a.name }),
              "aria-label": `${a.name}, AARS ${a.aars ?? "unscored"}`,
            }, `${a.name} `, aarsChip(a.aars, a.aarsBand, bandSeverity)),
          );
        }
        card.append(assetRow);
      }

      const actions = el("div", { style: "display:flex; gap:8px; margin-top:12px" });
      const issuesHost = el("div", { style: "margin-top:10px" });
      const toggle = el("button", {
        "aria-expanded": "false",
        onclick: async () => {
          const open = toggle.getAttribute("aria-expanded") === "true";
          if (open) {
            toggle.setAttribute("aria-expanded", "false");
            toggle.textContent = "Show issues";
            clear(issuesHost);
            return;
          }
          toggle.setAttribute("aria-expanded", "true");
          toggle.textContent = "Hide issues";
          issuesHost.append(el("p", { class: "muted small" }, "Loading…"));
          try {
            const res = await swrCall("api_getIssues", { group: group.id });
            clear(issuesHost).append(issueTable(res.rows));
          } catch (e) {
            clear(issuesHost).append(
              el("p", { class: "small", style: "color:var(--bad)" }, String(e.message || e)));
          }
        },
      }, "Show issues");
      actions.append(
        toggle,
        el("button", {
          onclick: () => navigate("graph", { seed: group.id, seedKind: "combo" }),
        }, "Open in graph"),
      );
      card.append(actions, issuesHost);
      host.append(card);
    }
  }

  function issueTable(rows) {
    const tbody = el("tbody", {});
    for (const issue of rows) {
      tbody.append(el("tr", {
        class: "clickable",
        tabindex: "0",
        role: "button",
        "aria-label": `Issue on ${issue.assetName}`,
        onclick: () => openIssueSheet(issue.id),
        onkeydown: (e) => {
          if (e.key === "Enter") openIssueSheet(issue.id);
        },
      },
        el("td", {}, issue.assetName),
        el("td", {}, sevBadge(issue.adjustedSeverity)),
        el("td", {}, issue.nativeSeverity),
        el("td", {}, issue.region || "—"),
        el("td", {}, issue.account || "—"),
        el("td", {}, (issue.projects || []).join(", ") || "—"),
      ));
    }
    return el("div", { class: "table-wrap" },
      el("table", { class: "data" },
        el("thead", {},
          el("tr", {},
            el("th", {}, "Asset"),
            el("th", {}, "Adjusted"),
            el("th", {}, "Native"),
            el("th", {}, "Region"),
            el("th", {}, "Account"),
            el("th", {}, "Projects"),
          )),
        tbody,
      ));
  }
}
