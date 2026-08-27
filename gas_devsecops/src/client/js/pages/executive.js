// Executive — the front door, and DEFAULT_ROUTE.
//
// A leader opens the app wanting ONE NUMBER. That number is the remediation half-life, and
// on this register it is usually a LOWER BOUND rather than a median, because more than half
// of the findings are still open at every observed time. The page says "> 479 d" and says
// why, because the alternative — quoting the closed-only median, which is what every tool
// does — describes the findings that had time to close and nothing else.
//
// IT MUST NOT DISAGREE WITH MTTR & SLA. Both read the same `kaplanMeier` result and both go
// through `executiveHeadline` in registerModel.js, so the same register cannot say two things
// about its own half-life on two pages.
//
// NO RUN-SCAN CONTROL. The composition stub promised one; the live Wiz fetch does not exist
// yet. A button that does nothing is worse than no button — it makes a reader believe the
// number in front of them is one click from being current. The page says what fed the
// register instead, which is the question the button would have been answering anyway.

import { swrCall } from "../store.js";
import { clear, el } from "../ui.js";
import { heroStat, kpiCard, pageHeader, statusPill } from "../ui/controls.js";
import { emptyState, errorState, skeletonStack } from "../ui/feedback.js";
import { sevBadge } from "../ui/severity.js";
import { fmtDate } from "../ui/format.js";
import { navigate } from "../store.js";
import { executiveHeadline, scopeSummaries } from "./registerModel.js";

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

function count(n) {
  return Number(n || 0).toLocaleString();
}

function days(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v < 10 ? `${v.toFixed(1)} d` : `${Math.round(v).toLocaleString()} d`;
}

function section(title, ...kids) {
  return el("section", { class: "card" },
    el("h2", { class: "section-label" }, title),
    ...kids);
}

/**
 * One register's card: its open count, the severity split, and when it was last measured.
 *
 * The whole card is a link into that register, because the question a summary raises is
 * always "which ones" and the answer is one route away.
 */
function scopeCard(s) {
  const entries = SEV_ORDER
    .filter((sev) => s.bySeverity[sev])
    .map((sev) => ({ sev, n: s.bySeverity[sev] }));

  const head = el("div", { class: "exec-scope-head" },
    el("span", { class: "kpi-label" }, s.title),
    el("span", { class: "kpi-value num" }, count(s.totals.open)),
    el("span", { class: "kpi-sub" }, "open"));

  const split = entries.length
    ? el("div", { class: "exec-sev-split" },
        ...entries.map(({ sev, n }) =>
          el("span", { class: "exec-sev-item" }, sevBadge(sev), el("span", { class: "num" }, count(n)))))
    // Never scanned and scanned-and-empty are different answers, and the caption below is
    // what tells them apart — so this says which of the two it is rather than showing nothing.
    : el("p", { class: "kpi-sub" },
        s.lastScan ? "nothing open" : "never measured");

  const measured = s.lastScan
    ? el("p", { class: "kpi-sub" },
        `Last measured ${fmtDate(s.lastScan.ts)}`,
        s.movement
          ? ` · +${count(s.movement.new_count)} new, −${count(s.movement.resolved_count)} closed`
            + (s.movement.reopened_count ? `, ${count(s.movement.reopened_count)} reopened` : "")
          : "")
    : el("p", { class: "kpi-sub" }, "No scan of this register has ever run.");

  return el("button", {
    class: "card exec-scope",
    type: "button",
    onclick: () => navigate(s.scope, {}),
    "aria-label": `${s.title}: ${s.totals.open} open findings. Open the register.`,
  }, head, split, measured);
}

function render(host, data) {
  clear(host);
  const head = executiveHeadline(data.km);
  const scopes = scopeSummaries(data);
  const totalOpen = scopes.reduce((a, s) => a + s.totals.open, 0);
  const totalAll = scopes.reduce((a, s) => a + s.totals.total, 0);

  host.append(pageHeader({
    hero: heroStat(
      "Remediation half-life",
      head.value === null ? "—" : `${head.bound ? "> " : ""}${days(head.value)}`,
      el("span", {},
        head.bound
          ? el("strong", { class: "hero-qualifier" },
              "a lower bound — more than half of the register is still open")
          : null,
        head.bound ? el("br", {}) : null,
        `${count(totalOpen)} open of ${count(totalAll)} findings · `
        + `${count(head.censored)} of them counted as still-running clocks rather than discarded`,
      ),
    ),
    stats: [
      kpiCard("Closed-only median", days(data.km.naiveMedian),
        `over ${count(data.km.events)} resolved — what a tool that discards open findings reports`),
      kpiCard("Open findings", count(totalOpen), "across all three registers"),
      kpiCard("Resolved", count(totalAll - totalOpen), "since the register began"),
    ],
  }));

  host.append(section("The three registers",
    el("div", { class: "exec-scope-grid" }, ...scopes.map(scopeCard)),
    el("p", { class: "stub-note" },
      "A register that has never been scanned says so rather than showing a zero — "
      + "“we have none” and “we never looked” are different answers.")));

  // What fed this, which is the question a Run scan button would have been answering.
  host.append(section("What this was measured from",
    data.sampleOnly
      ? el("p", {},
          statusPill("warn", "Sample data"),
          " Every scan in this register came from the bundled sample dataset. The live Wiz "
          + "fetch is not built yet, so there is no control here to run one — a button that "
          + "did nothing would be worse than none.")
      : el("p", {}, statusPill("ok", "Tenant data"),
          " Fed by scans against the Wiz tenant."),
    el("ul", { class: "stub-list" },
      ...scopes.map((s) => el("li", {},
        `${s.title}: `,
        s.lastScan
          ? `last scan ${fmtDate(s.lastScan.ts)}, covering `
            + (s.lastScan.severities ? s.lastScan.severities : "every severity")
          : "never scanned")))));
}

/** How fast code risk is closing, how much is open, and which way it is going. */
export function renderExecutive(host) {
  host.append(pageHeader({
    hero: heroStat("Remediation half-life", "…", "Reading the ledger"),
  }));
  host.append(el("section", { class: "card" }, skeletonStack(3)));

  const paint = (data) => {
    if (!data) return;
    if (!data.everScanned) {
      clear(host);
      host.append(pageHeader({
        hero: heroStat("Executive", "—",
          "How fast code risk is closing, how much is open, and which way it is going."),
      }));
      host.append(el("section", { class: "card" },
        emptyState("Nothing has been measured yet.",
          "The register is empty — which is not the same as having no findings. Until a scan "
          + "has run, every figure this page would show would be a claim about nothing.")));
      return;
    }
    render(host, data);
  };

  swrCall("api_getExecutive", {}, paint)
    .then(paint)
    .catch((err) => {
      clear(host);
      host.append(errorState(String(err && err.message ? err.message : err)));
    });
}
