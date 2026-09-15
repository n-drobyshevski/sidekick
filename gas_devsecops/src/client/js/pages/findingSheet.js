// One finding, opened as the signature sheet — the register's only per-row drill-down.
//
// WHAT THIS SHEET IS ALLOWED TO KNOW, AND WHY THE LIST IS SO SHORT. It draws from THE WIRE
// ROW AND NOTHING ELSE: `REGISTER_ROW_COLUMNS[scope]` plus `finding_key`
// (`domain/pagePayload.ts`), which is exactly what `api_getRegisterRows` already sent to
// paint the table the reader clicked. No second RPC, no lookup, no merge with an aggregate
// payload — so a sheet can never show a figure the row behind it could not support, and
// opening fifty findings costs fifty renders and zero calls. `test/findingSheet.test.js`
// measures that claim by handing the model a Proxy row and asserting the set of keys it
// touched is a subset of that scope's own column list.
//
// FOUR THINGS IT REFUSES TO PRINT, each for its own reason:
//
//   1. A RESOLUTION DATE. `resolved_at` is not on the wire for any scope, and inventing one
//      from `last_seen` would be the exact error `registerModel.js` exists to prevent: where
//      `resolution_src` is "disappeared" the date is THE SCAN THAT FIRST STOPPED SEEING THE
//      FINDING, an upper bound whose error is the scan interval. So the death side of the
//      clock is stated as two separate facts a reader can tell apart — the WORD
//      (`PROVENANCE_LABEL`: "Gone by" vs "Resolved", with `PROVENANCE_HELP` behind it) and
//      "Last seen", which is a measurement and is labelled as one.
//   2. A SEVERITY ON SECRETS. `sev` is `""` there, so the sheet's severity accent is not
//      painted at all. Severity on that register grades a DETECTION, not whether a
//      credential is live (CLAUDE.md; `REGISTER_ROW_COLUMNS.secrets` carries no `severity`
//      column to read even if this file wanted one). The header chip is the VALIDATION state
//      instead, which is the axis that answers the question a reader came with.
//   3. A STATUS WORD ON SECRETS. `status` / `resolution_src` / `reopened_count` are not in
//      that scope's column list either, so `provenance()` is never called for it — it would
//      read `undefined` and answer a confident "Open" for every row in the register. The
//      secrets clock states what it has: first seen, last seen, and the four lifecycle dates
//      under "Removed is not rotated".
//   4. THE CREDENTIAL ITSELF. No `snippet`, no `validationDetails`, ever — the allowlist on
//      the server is why they cannot arrive, and `test/pagesLit.test.js`'s gate 5 plus this
//      package's own test hold the client end of it.
//
// THE MODEL IS PURE AND THE DOM HALF IS THIN, the same split `registerModel.js` and
// `pages/sca.js`'s view models already make: there is no jsdom in this project, so the half
// that can be WRONG has to be callable from node. `findingSheetModel` returns strings, chip
// descriptors and section/row data; `openFindingSheet` turns that into the shared sheet and
// decides nothing.
//
// DESIGN REFERENCE: the orphan `pages/register.js`'s `detailSheet` (deleted in this wave now
// that this file exists), minus `resolved_at`, `owner_project` and the `twin_*` fields — all
// four are read off a row that never carries them, so every one of those rows would have
// printed a dash while implying the register had looked.

import {
  absentText, codeBlock, copyButton, days1, el, fmtDate, openSheet, sheetSection, statusPill,
  tipLabel, triCell,
} from "../ui.js";
import { PROVENANCE, PROVENANCE_HELP, PROVENANCE_LABEL, REGISTERS, provenance } from "./registerModel.js";

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

/** A boolean that is genuinely non-nullable on the wire (`awaiting_vendor_fix`). Yes / No. */
function yesNoOf(v) {
  return v ? "Yes" : "No";
}

/** EPSS is a probability 0..1 off the wire; printed as the percentage it names. */
function epssOf(v) {
  if (v === null || v === undefined || v === "") return absentText;
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : absentText;
}

/** `path:line`, or just the path, or nothing at all — never `null:null`. */
function locationOf(path, line) {
  const p = textOf(path);
  if (p === absentText) return absentText;
  const l = line === null || line === undefined || line === "" ? null : String(line).trim();
  return l ? `${p}:${l}` : p;
}

/** One `{label, value}` row, with an optional tip and an optional render kind. */
function row(label, value, help, extra) {
  return { label, value, help: help || null, ...(extra || {}) };
}

/* ------------------------------------------------------------------- the header chips */

/**
 * The provenance chip — sca and sast only, and the WORD is the whole point.
 *
 * `warn` rather than `ok` for a bounded date, matching the register table's own cell: the
 * pill's colour is read first, and a green tick over "it went at some unknown point in the
 * last scan interval" overstates what the ledger knows.
 */
function provenanceChip(r) {
  const p = provenance(r);
  const kind = p === PROVENANCE.OPEN
    ? "neutral"
    : p === PROVENANCE.BOUNDED || p === PROVENANCE.RETURNED ? "warn" : "ok";
  return { kind, text: PROVENANCE_LABEL[p], help: PROVENANCE_HELP[p] || null };
}

/**
 * The credential's own state, as the secrets header chip.
 *
 * A LIVE credential is the bad outcome whatever the finding's lifecycle says, and "never
 * checked" is a third answer rather than a soft no — on this tenant it is 99.6% of the
 * register, so collapsing it into "dead" would misprice nearly the whole population.
 */
function validationChip(r) {
  const v = textOf(r.validation_state).toUpperCase();
  if (v === "VALID") {
    return {
      kind: "bad",
      text: "Live",
      help: "Checked, and the credential still works. Removing it from HEAD does not change that.",
    };
  }
  if (v === "INVALID") {
    return { kind: "ok", text: "Dead", help: "Checked, and the credential no longer works." };
  }
  if (v === "ERROR") {
    return {
      kind: "warn",
      text: "Check failed",
      help: "The validation check errored, so nothing is known about this credential.",
    };
  }
  return {
    kind: "neutral",
    text: "Never checked",
    help: "Nobody has validated this credential. That is not the same as it being dead — on "
      + "this tenant almost every secret instance is in this state.",
  };
}

/* --------------------------------------------------------------------- the three models */

/** First seen / last seen, plus the state word and the two durations, for sca and sast. */
function clockSection(r, opts) {
  const p = provenance(r);
  const resolved = p !== PROVENANCE.OPEN && p !== PROVENANCE.RETURNED;
  const rows = [
    row("First seen", fmtDate(r.first_seen)),
    row(
      "Last seen",
      fmtDate(r.last_seen),
      resolved
        ? "The last scan that still returned this finding. It is a measurement; the "
          + "resolution date is not in this register, which is what the state word above says."
        : "The most recent scan that returned this finding.",
    ),
    row("State", PROVENANCE_LABEL[p], PROVENANCE_HELP[p] || null),
  ];
  // A DATE IS NOT PRINTED BESIDE THE STATE WORD. "Gone by 12 Aug" and "Resolved 12 Aug" are
  // the same pixel width and different claims, and this register has neither date on the
  // wire — so the word stands alone and "Last seen" above carries the only date there is.
  if (opts.age) rows.push(row("Age", days1(r.age_days), "Days open, as of the last sync."));
  if (opts.mttr && r.mttr_days !== null && r.mttr_days !== undefined) {
    rows.push(row("Time to remediate", days1(r.mttr_days)));
  }
  const reopened = r.reopened_count;
  if (typeof reopened === "number" && Number.isFinite(reopened) && reopened > 0) {
    rows.push(row("Reopened", `${reopened} time(s)`, PROVENANCE_HELP[PROVENANCE.RETURNED]));
  }
  return { label: "Clock", rows };
}

function scaSections(r, reg) {
  return [
    {
      label: "Identity",
      rows: [
        row(reg.identifierLabel, textOf(r.identifier)),
        row(reg.componentLabel, textOf(r.component)),
        row("Repository", textOf(r.repo_name)),
        row("Branch", textOf(r.branch)),
        row("Key", textOf(r.finding_key)),
      ],
    },
    clockSection(r, { age: true, mttr: true }),
    {
      label: "The second clock",
      rows: [
        row("Fixed version", textOf(r.fixed_version)),
        row(
          "Fix available",
          fmtDate(r.fix_available_at),
          { term: "two-clocks" },
        ),
        row(
          "Awaiting a vendor",
          yesNoOf(r.awaiting_vendor_fix),
          { term: "awaiting-fix" },
        ),
      ],
    },
    {
      label: "Exploitation",
      rows: [
        row("On KEV", null, "Null means Wiz never evaluated the signal — not a measured no.",
          { kind: "tri", tri: r.has_kev }),
        row("Known exploit", null, "Null means Wiz never evaluated the signal — not a measured no.",
          { kind: "tri", tri: r.has_exploit }),
        row("EPSS", epssOf(r.epss), "Wiz's own probability that this CVE is exploited in the "
          + "next 30 days. Absent where it was never scored."),
      ],
    },
  ];
}

function sastSections(r, reg) {
  return [
    {
      label: "Identity",
      rows: [
        row(reg.identifierLabel, textOf(r.identifier), { term: "sast" }),
        row("CWE", textOf(r.cwe), { term: "cwe-top-25" }),
        row("Repository", textOf(r.repo_name)),
        row("Key", textOf(r.finding_key)),
      ],
    },
    {
      label: "Location",
      rows: [
        row("File and line", locationOf(r.file_path, r.start_line), null, { kind: "code" }),
        row("Language", textOf(r.language)),
        row("Scanner", textOf(r.origin)),
        row("AI verdict", textOf(r.ai_verdict)),
      ],
    },
    clockSection(r, { age: true, mttr: false }),
  ];
}

function secretsSections(r, reg) {
  return [
    {
      label: "Identity",
      rows: [
        row(reg.identifierLabel, textOf(r.identifier),
          "The credential's own id. The same credential in five files is five findings and "
          + "one rotation."),
        row("Kind", textOf(r.secret_kind)),
        // NOT the `validation-state` glossary entry, though the plan for this sheet said so:
        // that entry defines the credential's VALIDATION state (VALID/INVALID/UNKNOWN/ERROR),
        // and hanging it off "Confidence" told the reader that a detector grade and a
        // credential check are the same field. They are the two DIFFERENT axes this register
        // triages on, which is exactly why the toolbar offers both. Measured on the seeded
        // harness: the tip under "Confidence" read "Whether Wiz has confirmed a detected
        // credential still works…" over a value of "High".
        row("Confidence", textOf(r.confidence),
          "How sure the detector was that this string is a credential of that kind. It is "
          + "not a severity and not a check: whether the credential still works is the "
          + "credential state below."),
        row("Repository", textOf(r.repo_name)),
        row("Branch", textOf(r.branch)),
        row("Key", textOf(r.finding_key)),
      ],
    },
    {
      label: "Location",
      rows: [
        row("File and line", locationOf(r.file_path, r.start_line), null, { kind: "code" }),
      ],
    },
    {
      // THE SECTION THIS REGISTER EXISTS FOR. Four dates and a state, kept apart because
      // they are four different events — leaving HEAD is not being rotated, and neither is
      // being checked.
      label: "Removed is not rotated",
      rows: [
        row("Left HEAD", fmtDate(r.removed_at), { term: "removed" }),
        row("Credential state", validationChip(r).text, { term: "validation-state" }),
        row("Last checked", fmtDate(r.validated_at)),
        row("Observed dead", fmtDate(r.rotated_at), { term: "rotated" }),
      ],
    },
    {
      label: "Clock",
      rows: [
        row("First seen", fmtDate(r.first_seen)),
        row(
          "Last seen",
          fmtDate(r.last_seen),
          "The most recent scan that returned this finding. This register carries no "
          + "lifecycle status column, so the sheet states the dates it has rather than a "
          + "state word it would have to guess.",
        ),
      ],
    },
  ];
}

/**
 * The whole sheet as data: what it says, per scope, off one wire row.
 *
 * PURE. No DOM, no RPC, no globals — `openFindingSheet` below is the only thing that turns
 * this into elements, and `test/findingSheet.test.js` calls it directly.
 */
export function findingSheetModel(scope, row_) {
  const r = row_ || {};
  const reg = REGISTERS[scope] || {};
  const isSecrets = scope === "secrets";
  const repo = textOf(r.repo_name);
  const branch = scope === "sast" ? absentText : textOf(r.branch);

  const subtitleParts = [reg.title || scope];
  if (repo !== absentText) subtitleParts.push(branch === absentText ? repo : `${repo} @ ${branch}`);

  const sections = scope === "sca"
    ? scaSections(r, reg)
    : scope === "sast" ? sastSections(r, reg) : isSecrets ? secretsSections(r, reg) : [];

  const copies = [];
  const identifier = textOf(r.identifier);
  if (identifier !== absentText) {
    copies.push({
      label: "Copy id",
      title: `Copy ${reg.identifierLabel || "the identifier"}: ${identifier}`,
      text: identifier,
    });
  }
  if (scope === "sast" || isSecrets) {
    const where = locationOf(r.file_path, r.start_line);
    if (where !== absentText) {
      copies.push({ label: "Copy location", title: `Copy the file and line: ${where}`, text: where });
    }
  }

  return {
    scope,
    title: identifier === absentText ? "Finding" : identifier,
    subtitle: subtitleParts.join(" · "),
    // NO SEVERITY ACCENT ON SECRETS — see this file's header, point 2.
    sev: isSecrets ? "" : textOf(r.severity) === absentText ? "" : String(r.severity),
    chips: [isSecrets ? validationChip(r) : provenanceChip(r)],
    copies,
    sections,
    // THE SAST CAVEAT GETS ONE EXTRA SENTENCE, and it belongs here rather than in
    // `REGISTERS.sast.caveat`: the register-level caveat is written for a page of aggregates
    // ("every closed row here is dated by the scan that first stopped seeing it"), while a
    // reader looking at ONE finding is looking for the date itself and has to be told, in
    // this sheet, that there is not one to look at.
    caveat: scope === "sast" && reg.caveat
      ? `${reg.caveat} No resolution date is recorded for code findings; last seen is the `
        + "last scan that returned this one."
      : reg.caveat || "",
    // The one sentence that says where the record ends. No URL is on the wire for any scope
    // — the ledger stores none — so this states that rather than drawing a dead link.
    footnote: "Search Wiz for this id; the register carries no link to the finding.",
  };
}

/** The row button's accessible name: what opens, in the order a reader would say it. */
export function findingRowLabel(scope, r) {
  const reg = REGISTERS[scope] || {};
  const who = textOf((r || {}).identifier);
  const where = textOf((r || {}).repo_name);
  const parts = [who === absentText ? (reg.title || "Finding") : who];
  if (where !== absentText) parts.push(where);
  parts.push("open details");
  return parts.join(", ");
}

/* ------------------------------------------------------------------------- the DOM half */

/** A `<dl class="kv">` pair. `absentText` becomes a muted dash, as it does in a table cell. */
function kvRow(r) {
  const dt = el("dt", {}, tipLabel(r.label, r.help));
  let value;
  if (r.kind === "tri") value = triCell(r.tri);
  else if (r.kind === "code") {
    value = r.value === absentText
      ? el("span", { class: "muted" }, absentText)
      : codeBlock(r.value, { label: `${r.label}: ${r.value}` });
  } else if (r.value === absentText) value = el("span", { class: "muted" }, absentText);
  else value = r.value;
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
 * the whole lifecycle, though: a toolbar change rewrites the query params of the SAME route,
 * which repaints the page under a sheet the shared hook would keep open — so the three
 * register pages call `closeActiveSheet()` at the top of their paint.
 */
export function openFindingSheet(scope, r, opts) {
  const model = findingSheetModel(scope, r);
  const rows = opts && Array.isArray(opts.rows) ? opts.rows : [];
  const index = rows.indexOf(r);
  const records = index === -1 ? null : {
    ids: rows.map((x) => (x && x.finding_key !== undefined ? x.finding_key : null)),
    index,
    label: "finding",
    open: (_id, i) => openFindingSheet(scope, rows[i], { rows }),
  };

  const ctx = openSheet((body) => {
    // THE COPY BUTTONS LIVE IN THE BODY, NOT IN `headerActions`, and that is a fact about
    // the shared component rather than a preference: `openSheet` only appends its
    // `toolbarEl` to the header when `rail` is set (gas_shared/ui/sheet.js), so a flat
    // finding sheet passing headerActions would build the buttons and never show them. A
    // finding is one flat fact and takes no section rail (root DESIGN.md), so the actions
    // row goes at the top of the body where it is the first thing after the identity.
    if (model.copies.length) {
      body.append(el("div", { class: "finding-actions" },
        ...model.copies.map((c) => copyButton(() => c.text, { label: c.label, title: c.title }))));
    }
    for (const section of model.sections) {
      body.append(sheetSection(section.label,
        el("dl", { class: "kv" }, ...section.rows.flatMap(kvRow))));
    }
    if (model.caveat) {
      body.append(sheetSection("What this register cannot tell you",
        el("p", { class: "small muted" }, model.caveat)));
    }
    body.append(el("p", { class: "sheet-caption" }, model.footnote));
  }, {
    title: model.title,
    subtitle: model.subtitle,
    sev: model.sev,
    closeOnRouteChange: true,
    records,
  });

  ctx.setHeading({
    chips: model.chips.map((c) => statusPill(c.kind, c.text, c.help || undefined)),
  });
  // ONE announcement for the whole record, and it names the position: prev/next moves the
  // sheet under a reader who never sees the cluster's own "3/50".
  if (records) {
    ctx.announce(`Finding ${records.index + 1} of ${records.ids.length}: ${model.title}`);
  }
  return ctx;
}
