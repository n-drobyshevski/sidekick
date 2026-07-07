// Wiz Scans: the concise "what do we scan with Wiz" coverage page — one card per
// scan area, each linking to the page where its results live.

import { SCAN_AREAS } from "../scanContent.js";
import { el } from "../ui.js";

export async function renderScans(main) {
  main.append(
    el("h1", {}, "Wiz Scans"),
    el("p", { class: "page-sub" },
      "What Wiz continuously scans to build this dashboard's picture of AI security. " +
      "Each area feeds the graph, the inventory scores, or the toxic combinations."),
  );

  const grid = el("div", { class: "scan-cards" });
  for (const area of SCAN_AREAS) {
    const card = el("div", { class: "scan-card" },
      el("h3", {}, area.title),
      area.stat ? el("div", { class: "scan-stat" }, area.stat) : null,
      el("p", {}, area.what),
      area.callout ? el("div", { class: "scan-callout", role: "note" }, "⚠ " + area.callout) : null,
      area.link
        ? el("a", { class: "scan-link", href: `#/${area.link}`, target: "_self" },
            "See results ›")
        : null,
    );
    grid.append(card);
  }
  main.append(grid);

  main.append(
    el("p", { class: "small muted", style: "margin-top:16px" },
      "Sync cadence: daily at 05:00 UTC plus on-demand “Sync now”. Without credentials " +
      "the app runs on a bundled sample dataset (dry-run)."),
  );
}
