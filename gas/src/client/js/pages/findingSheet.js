// One OS finding, opened as the signature sheet — this register's only per-row drill-down.
//
// WHAT THIS SHEET IS ALLOWED TO KNOW, AND WHY THE LIST IS SO SHORT. It draws from THE WIRE
// ROW AND NOTHING ELSE: `REGISTER_ROW_COLUMNS` plus `REGISTER_ROW_KEY`
// (`domain/pagePayload.ts`), which is exactly what `api_getRegisterRows` already sent to
// paint the table the reader clicked. No second RPC, no lookup, no merge with the insights
// payload — so a sheet can never show a figure the row behind it could not support, and
// opening fifty findings costs fifty renders and zero calls. `test/findingSheet.test.js`
// measures that claim by handing the model a Proxy row and asserting the set of keys it
// touched is a subset of the allowlist.
//
// FOUR THINGS IT REFUSES TO PRINT, each for its own reason:
//
//   1. A RESOLUTION DATE UNDER THE WRONG WORD. `resolved_at` IS on the wire here (unlike the
//      code registers, where none of the three scopes carries one) — and that makes the
//      refusal sharper rather than unnecessary. Where `resolution_src` is "disappeared" the
//      date is THE SCAN THAT FIRST STOPPED SEEING THE FINDING (`domain/reconcile.ts`), an
//      upper bound whose error is the scan interval. "Gone by 12 Aug" and "Resolved 12 Aug"
//      are the same pixel width and different claims, so the sheet prints EXACTLY ONE of
//      them and hangs `PROVENANCE_HELP.bounded` off the bounded one.
//   2. A CVSS SCORE. Not a ledger column and never has been (`pagePayload.ts`'s own note),
//      so it cannot arrive; a "CVSS" row would print an em dash on every finding in the
//      register — a sheet saying "we looked and found nothing" about a field nobody stored.
//      This register's spine is exploitability, and that is the section that exists.
//   3. A CONFIDENT `false` FOR A SIGNAL NOBODY EVALUATED. `has_kev`, `has_exploit` and
//      `internet_exposed` are TRI-STATE on the wire and stay tri-state here: `triCell`
//      renders yes / no / never-measured as three answers. `internet_exposed` is null on
//      every row resolved by disappearance (it is gone from the current frame), which is
//      exactly the case a `Boolean(...)` would turn into "not reachable".
//   4. AN OUTBOUND LINK IT BUILT ITSELF. The CVE's NVD page comes from `ui/nvd.js` and only
//      from there — a literal URL in a runtime string carries a bare `//`, which the
//      middlebox guard in `esbuild.config.mjs` fails the build on.
//
// THE MODEL IS PURE AND THE DOM HALF IS THIN, the same split `registerModel.js` and
// `overviewModel.js` already make: this project's vitest run sets no `environment`, so
// anything touching `document` cannot be unit-tested. `findingSheetModel` returns strings,
// chip descriptors and section/row data; `openFindingSheet` turns that into the shared sheet
// and decides nothing.
//
// Ported from `gas_devsecops/src/client/js/pages/findingSheet.js`, minus its three-scope
// switch and its secrets branch, plus this register's own Identity block (an asset, a cloud,
// a subscription, a support group, a domain — none of which a code finding has).

import { TIER_LABELS } from "../charts.js";
import {
  PROVENANCE, PROVENANCE_HELP, PROVENANCE_KIND, PROVENANCE_LABEL, fixLabel, provenance,
} from "./registerModel.js";
import {
  absent, absentText, codeBlock, copyButton, days1, el, fmtDate, nvdUrl, openSheet, pct1,
  sheetSection, statusPill, tipLabel, triCell,
} from "../ui.js";

/* ------------------------------------------------------------------ value formatting */

/**
 * A row value as text, refusing null/undefined/blank BEFORE any cast.
 *
 * `String(null)` is `"null"` and `Number(null)` is `0` — both are confident answers about a
 * field nobody filled in. Everything absent lands on `absentText`, which the DOM half below
 * promotes to a muted dash exactly the way `dataTable` does for a table cell.
 */
function textOf(v) {
  if (v === null || v === undefined) return absentText;
  const s = String(v).trim();
  return s === "" ? absentText : s;
}

/** EPSS is a probability 0..1 off the wire; printed as the percentage it names. `pct1`
 *  refuses the absent values before the cast and renders the em dash for them. */
function epssOf(v) {
  if (v === null || v === undefined || v === "") return absentText;
  const n = Number(v);
  return Number.isFinite(n) ? pct1(n * 100) : absentText;
}

/** One `{label, value}` row, with an optional tip and an optional render kind. */
function row(label, value, help, extra) {
  return { label, value, help: help || null, ...(extra || {}) };
}

/* ------------------------------------------------------------------- the header chips */

/** The provenance chip — the WORD is the whole point, and its tone is stated once, in
 *  `registerModel.js`, so the chip and the table cell cannot disagree about it. */
function provenanceChip(r) {
  const p = provenance(r);
  return { kind: PROVENANCE_KIND[p], text: PROVENANCE_LABEL[p], help: PROVENANCE_HELP[p] || null };
}

/**
 * The risk tier as the second chip.
 *
 * `unknown` KEEPS A WORD rather than becoming a dash: it is a measurement gap, not a low
 * score, and a sheet that showed nothing there would read as a finding with no tier instead
 * of one whose signals were never captured. Its tip routes to the entry that says so.
 */
function tierChip(r) {
  const tier = textOf(r.risk_tier);
  if (tier === absentText) {
    return {
      kind: "neutral",
      text: "Unclassified",
      help: { term: "unclassified" },
    };
  }
  const key = String(r.risk_tier);
  return {
    kind: key === "kev" ? "bad" : key === "exploit" ? "warn" : "neutral",
    text: TIER_LABELS[key] || key,
    help: key === "unknown" ? { term: "unclassified" } : { term: "risk-tiers" },
  };
}

/* --------------------------------------------------------------------- the sections */

/** What the finding IS and where it lives. */
function identitySection(r) {
  const cve = textOf(r.cve);
  return {
    label: "Identity",
    rows: [
      cve === absentText
        ? row("CVE", absentText)
        : row("CVE", cve, "The finding's CVE identifier, as Wiz reports it.",
          { kind: "link", href: nvdUrl(cve) }),
      row("Asset", textOf(r.asset_name), "The host workload carrying this finding."),
      row("Asset type", textOf(r.asset_type)),
      row("Cloud", textOf(r.cloud)),
      row("Subscription", textOf(r.subscription_name)),
      row("Support group", textOf(r.support_group),
        "The owning group, from the subscription map. Absent where nothing maps this "
        + "subscription — a gap in attribution, not in the finding."),
      row("Domain", textOf(r.domain),
        "The business domain this asset resolved to, under the domain rules in force."),
      row("Key", textOf(r.vuln_key),
        "The ledger's own primary key for this finding. One clock per key.",
        { kind: "code" }),
    ],
  };
}

/**
 * THE SPINE OF THIS REGISTER. Every one of the first three is tri-state, and the third
 * answer is the one that matters: Wiz returns null for a signal it never evaluated, and a
 * sheet showing that as "No" has asserted the opposite of what is known.
 */
function exploitationSection(r) {
  return {
    label: "Exploitation",
    rows: [
      row("On KEV", null, { term: "kev" }, { kind: "tri", tri: r.has_kev }),
      row("Known exploit", null, { term: "known-exploit" },
        { kind: "tri", tri: r.has_exploit }),
      row("EPSS", epssOf(r.epss), { term: "epss" }),
      row(
        "Internet-reachable",
        null,
        r.internet_exposed === null || r.internet_exposed === undefined
          ? {
            term: "internet-exposed",
            lines: ["Not captured in the last scan — either the scan predates the exposure "
              + "fields, or this finding is no longer in the current frame at all. Not the "
              + "same as unreachable."],
          }
          : { term: "internet-exposed" },
        { kind: "tri", tri: r.internet_exposed ?? null },
      ),
    ],
  };
}

/**
 * BOTH CLOCKS, AND THE ONE LINE THAT SAYS HOW THE DEATH DATE WAS ARRIVED AT.
 *
 * Exactly one dated resolution row is emitted, and which one it is is decided by
 * `resolution_src` — never by the presence of a date. An open row gets neither.
 */
function clockSection(r) {
  const p = provenance(r);
  const rows = [
    row("First seen", fmtDate(r.first_seen),
      "The first scan that returned this finding — where the detection clock starts."),
    row("Published", fmtDate(r.published_date),
      "When the CVE itself was disclosed. A different clock from ours: it runs before this "
      + "register had heard of the finding."),
    row("Fix available", fmtDate(r.fix_available_at), { term: "two-clocks" }),
    row("Awaiting a vendor", fixLabel(r.awaiting_vendor_fix), { term: "awaiting-fix" }),
    row("Last seen", fmtDate(r.last_seen),
      "The last scan that returned this finding. It is a measurement, whatever the state "
      + "word above it says."),
    row("State", PROVENANCE_LABEL[p], PROVENANCE_HELP[p] || null),
  ];
  // ONE DATED RESOLUTION ROW, OR NONE. A row printing `resolved_at` unconditionally would
  // give a bounded date the same weight as an observed one, which is the whole defect this
  // file's header names. `test/findingSheet.test.js` reproduces that rewrite and fails on it.
  if (p === PROVENANCE.OBSERVED) {
    rows.push(row("Resolved", fmtDate(r.resolved_at), PROVENANCE_HELP[PROVENANCE.OBSERVED]));
  } else if (p === PROVENANCE.BOUNDED) {
    rows.push(row("Gone by", fmtDate(r.resolved_at), PROVENANCE_HELP[PROVENANCE.BOUNDED]));
  }
  rows.push(row("Age", days1(r.age_days), { term: "age" }));
  rows.push(row("Actionable age", days1(r.actionable_age_days), { term: "actionable-age" }));
  if (r.mttr_days !== null && r.mttr_days !== undefined) {
    rows.push(row("Time to remediate", days1(r.mttr_days),
      "Days from first seen to the resolution date beside it."));
  }
  const reopened = r.reopened_count;
  if (typeof reopened === "number" && Number.isFinite(reopened) && reopened > 0) {
    rows.push(row("Reopened", reopened + " time(s)", { term: "returned" }));
  }
  return { label: "Clock", rows };
}

/**
 * The whole sheet as data: what it says, off one wire row.
 *
 * PURE. No DOM, no RPC, no globals — `openFindingSheet` below is the only thing that turns
 * this into elements, and `test/findingSheet.test.js` calls it directly.
 */
export function findingSheetModel(row_) {
  const r = row_ && typeof row_ === "object" ? row_ : {};
  const cve = textOf(r.cve);
  const asset = textOf(r.asset_name);
  const subscription = textOf(r.subscription_name);

  const subtitleParts = [];
  if (asset !== absentText) subtitleParts.push(asset);
  if (subscription !== absentText) subtitleParts.push(subscription);

  const copies = [];
  if (cve !== absentText) {
    copies.push({ label: "Copy CVE", title: "Copy the CVE identifier: " + cve, text: cve });
  }
  if (asset !== absentText) {
    copies.push({ label: "Copy asset", title: "Copy the asset name: " + asset, text: asset });
  }

  return {
    title: cve === absentText ? "Finding" : cve,
    subtitle: subtitleParts.join(" · "),
    sev: textOf(r.severity) === absentText ? "" : String(r.severity),
    chips: [provenanceChip(r), tierChip(r)],
    copies,
    sections: [identitySection(r), exploitationSection(r), clockSection(r)],
    // The one sentence that says where the record ends. No finding URL is on the wire — the
    // ledger stores none — so this states that rather than drawing a dead link.
    footnote: "Search Wiz for this CVE and asset; the register carries no link to the "
      + "finding itself.",
  };
}

/** The row button's accessible name: what opens, in the order a reader would say it. */
export function findingRowLabel(r) {
  const cve = textOf((r || {}).cve);
  const asset = textOf((r || {}).asset_name);
  const parts = [cve === absentText ? "Finding" : cve];
  if (asset !== absentText) parts.push(asset);
  parts.push("open details");
  return parts.join(", ");
}

/* ------------------------------------------------------------------------- the DOM half */

/** A `<dl class="kv">` pair. `absentText` becomes a muted dash, as it does in a table cell. */
function kvRow(r) {
  const dt = el("dt", {}, tipLabel(r.label, r.help));
  let value;
  if (r.kind === "tri") value = triCell(r.tri);
  else if (r.value === absentText) value = absent();
  else if (r.kind === "code") value = codeBlock(r.value, { label: r.label + ": " + r.value });
  else if (r.kind === "link") {
    value = el("a", { href: r.href, target: "_blank", rel: "noopener" }, r.value);
  } else value = r.value;
  return [dt, el("dd", {}, value)];
}

/**
 * Open the drill-down for one register row.
 *
 * `rows` is the CURRENT SERVER PAGE, and prev/next walk exactly that — not the register.
 * The table below the sheet holds those rows and no others, so stepping past the page's last
 * row would silently leave the set the reader is looking at.
 *
 * `closeOnRouteChange: true` because a finding belongs to the page that listed it. It is not
 * the whole lifecycle, though: every control in the register toolbar rewrites the query
 * params of the SAME route, which repaints the page under a sheet the shared hook would keep
 * open — so `renderOverview` calls `closeActiveSheet()` at the top of its paint.
 */
export function openFindingSheet(r, opts) {
  const model = findingSheetModel(r);
  const rows = opts && Array.isArray(opts.rows) ? opts.rows : [];
  const index = rows.indexOf(r);
  const records = index === -1 ? null : {
    ids: rows.map((x) => (x && x.vuln_key !== undefined ? x.vuln_key : null)),
    index,
    label: "finding",
    open: (_id, i) => openFindingSheet(rows[i], { rows }),
  };

  const ctx = openSheet((body) => {
    // THE COPY BUTTONS LIVE IN THE BODY, NOT IN `headerActions`, and that is a fact about
    // the shared component rather than a preference: `openSheet` only appends its toolbar
    // to the header when `rail` is set (gas_shared/ui/sheet.js), so a flat finding sheet
    // passing headerActions would build the buttons and never show them.
    if (model.copies.length) {
      body.append(el("div", { class: "finding-actions" },
        ...model.copies.map((c) => copyButton(() => c.text, { label: c.label, title: c.title }))));
    }
    for (const section of model.sections) {
      body.append(sheetSection(section.label,
        el("dl", { class: "kv" }, ...section.rows.flatMap(kvRow))));
    }
    body.append(el("p", { class: "sheet-caption" }, model.footnote));
  }, {
    title: model.title,
    subtitle: model.subtitle,
    sev: model.sev,
    // DESIGN.md's Finding Sheet: the three-zone shell at its stated width.
    width: "min(520px, 92vw)",
    closeOnRouteChange: true,
    records,
  });

  ctx.setHeading({
    chips: model.chips.map((c) => statusPill(c.kind, c.text, c.help || undefined)),
  });
  // ONE announcement for the whole record, and it names the position: prev/next moves the
  // sheet under a reader who never sees the cluster's own "3/50".
  if (records) {
    ctx.announce("Finding " + (records.index + 1) + " of " + records.ids.length + ": "
      + model.title);
  }
  return ctx;
}
