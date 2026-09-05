// The Settings → System read-outs: one card vocabulary for the facts an operator checks when
// something looks wrong, and one renderer for each fact the three registers actually publish.
//
// WHY THIS IS NOT A PARITY EXERCISE. The three System tabs do not show the same five things,
// and this module does not make them. `gas` shows storage, an error log and a build stamp;
// `gas_ai` shows a credential state and a two-stamp build comparison; `gas_devsecops` shows a
// product name, a build stamp, a credential state and a last-sync line. EVERY SECTION HERE IS
// OPTIONAL and an app passes only what it already had — the win is that the chrome, the
// absent-value rule and the six section shapes are written once, so the NEXT section an app
// grows is free rather than a fourth invention.
//
// WHY A CARD GRID AND NOT `settingsPanel`. A diagnostic is a read-out, not a control. The
// settings-form vocabulary (`settingsPanel` + `settingRow`) says "this is a field you may
// edit", and gas_devsecops's build id sat in a `settingRow` looking exactly like one. The card
// carries a label, a right-aligned value and room for a widget, which is the shape of a fact.
//
// WHY THE CLASS PREFIX IS `.health-`, NOT `.diag-`. `.diag-list` / `.diag-row` / `.diag-warn`
// are ALREADY TAKEN, by `gas_ai/src/client/js/ui/diagList.js` — an unrelated concept (how well
// an AARS scoring rule is separating its population) on that app's Rules page. Two meanings
// under one prefix in one app is the collision this package exists to stop, so this family
// keeps the name gas's own grid already used and gas_ai's `.diag-*` keeps its meaning.
//
// NO CACHING ASSUMPTION LIVES HERE. The three apps keep a build stamp fresh three different
// ways — gas folds `BUILD_ID` into the server cache key, gas_ai keeps `build` outside the
// cached core, devsecops leaves `bootstrap()` uncached — and each one hands this module the
// RESULT. A shared module that fetched, cached or compared on its own behalf would be a fourth
// mechanism nobody asked for.
//
// NO `appConfig()` READ, at top level or inside a function: none of these facts is a name the
// manifest carries.

import { statusPill } from "./controls.js";
import { absent } from "./cells.js";
import { el } from "./dom.js";
import { emptyState } from "./feedback.js";
import { usageMeter } from "./usageMeter.js";

/**
 * The order sections take in the grid, and the whole set of them.
 *
 * It is chosen so that the two apps rendering the grid WHOLE keep the order they already had:
 * gas draws storage → errors → build, gas_devsecops product → build → credentials → lastSync,
 * and both are subsequences of this list. gas_ai has to interleave a non-diagnostic panel
 * between its two sections, so it places them itself from `sections` and this order never
 * reaches it.
 */
export const DIAGNOSTIC_SECTIONS = Object.freeze([
  "storage", "errors", "product", "build", "credentials", "lastSync",
]);

// ================================================================================ the card

/**
 * One read-out card. `label` names the fact; `value` is the short answer, right-aligned in the
 * head; `description` sits under the head; `body` is any widget the fact needs; `note` is the
 * last word. Everything but `label` is optional and an absent slot renders nothing at all —
 * not an empty element, which would leave a gap claiming there was something to say.
 *
 * `titleTag` is the label's ELEMENT, defaulting to a plain span. It exists so each app keeps
 * the heading count its System tab already had: gas has one `h2` above the whole grid and
 * labels its cards with spans, gas_ai had an `h2` per panel and passes `titleTag: "h2"`.
 * Getting this wrong is not a style bug — it either invents four headings where there was one
 * or deletes two a screen-reader user was navigating by.
 */
export function diagnosticCard({
  key, label, titleTag = "span", value, description, body, note,
} = {}) {
  const head = el("div", { class: "health-head" },
    el(titleTag, { class: "label health-label" }, label),
    value === null || value === undefined ? null : el("div", { class: "health-value" }, value));
  return el("div", { class: "health-item", "data-diag": key || null },
    head,
    description ? el("p", { class: "health-desc small muted" }, description) : null,
    ...[].concat(body || []),
    note ? el("p", { class: "health-note small muted" }, note) : null);
}

/**
 * The short answer for a one-line fact, and the ONE place "absent is never zero" is enforced
 * for this family. A nullish or blank value is refused BEFORE anything renders it: with an
 * `emptyText` it becomes that sentence, without one the shared muted em dash. `0` and `false`
 * are values and pass through — `String(0)` is not blank.
 *
 * gas_devsecops spelled this as `boot.product || "—"`, which reads a genuinely empty string the
 * same way but hands back a bare glyph with no muted styling and nothing for a screen reader;
 * `absent()` is this vocabulary's own answer and carries both.
 */
function factValue(value, emptyText) {
  if (value instanceof Node) return value;
  if (value === null || value === undefined || String(value).trim() === "") {
    return emptyText ? el("span", { class: "muted small" }, emptyText) : absent();
  }
  return String(value);
}

// ============================================================================ the sections

/**
 * Storage: how much of a hard ceiling the store has spent. `body` is the caller's own host
 * node, because the only app that shows this in Settings fills it from an RPC that resolves
 * after the page is drawn; `storageBody()` below is what it puts in there.
 */
function storageSection(spec, titleTag) {
  return diagnosticCard({
    key: "storage", titleTag, label: spec.label || "Storage",
    description: spec.description || null, body: spec.body, note: spec.note || null,
  });
}

/**
 * The contents of the storage card: the meter, then one muted line per sentence the caller
 * wants under it.
 *
 * THE SENTENCES ARE THE REGISTER'S, NOT THIS MODULE'S. gas counts "scan(s) … tracked
 * vulnerabilities"; a code register counts findings and a graph register assets. Passing them
 * as `lines` is what keeps one vocabulary from being spoken on another's page. Nullish and
 * blank lines are dropped, so a caller may build the list conditionally without guarding.
 */
export function storageBody({ used, total, label, state = "", note, lines } = {}) {
  const out = [usageMeter({ used, total, label, state, note })];
  let first = true;
  for (const line of Array.isArray(lines) ? lines : []) {
    if (line === null || line === undefined || String(line).trim() === "") continue;
    out.push(el("p", {
      class: "muted small", style: first ? "margin:10px 0 0" : "margin:6px 0 0",
    }, line));
    first = false;
  }
  return out;
}

/**
 * Recent errors: a count badge, a way in, and what the log does not cover.
 *
 * `badge` and `action` are the caller's nodes — the badge because its count arrives from an RPC
 * that may fail (a decorative figure, left blank rather than faked), the action because the RPC
 * names and the sheet it opens are the app's. `covers` and `note` are what a NARROWER log owes
 * its reader: gas_devsecops's payload carries `covers: "jobs"` because it never ported the
 * errorLog tab and records job failures only.
 *
 * AN APP WITH NO ERROR LOG PASSES NOTHING AND GETS NO CARD. gas_ai has no recent-errors
 * mechanism at all, and an empty-state card there would claim a log exists and happens to be
 * quiet — the opposite of the truth.
 */
function errorsSection(spec, titleTag) {
  const row = spec.badge || spec.action
    ? el("div", { class: "health-row" }, spec.badge || null, spec.action || null)
    : null;
  return diagnosticCard({
    key: "errors", titleTag, label: spec.label || "Recent errors",
    description: spec.description || null,
    body: [row, spec.covers ? coversLine(spec.covers) : null],
    note: spec.note || null,
  });
}

/** What a narrower log does not cover, in the words of the payload that admitted it. */
function coversLine(covers) {
  return el("p", { class: "health-covers small muted" },
    "Covers ", el("strong", {}, String(covers)), " only.");
}

/** The deployed product's own name — a deployment fact, and the sibling of the build stamp. */
function productSection(spec, titleTag) {
  return diagnosticCard({
    key: "product", titleTag, label: spec.label || "Product",
    value: factValue(spec.value, spec.emptyText), note: spec.note || null,
  });
}

/**
 * The build stamp, in one of two forms decided by the DATA and not by the app:
 *
 *   ONE stamp  → the id, in the head. What gas and gas_devsecops publish: a `buildId` string.
 *   TWO stamps → a Client/Server comparison, plus a warning when they disagree. What gas_ai
 *                publishes, because its client and server bundles ship as separate files into
 *                one Apps Script project and a half-finished copy-paste deploy is invisible
 *                otherwise.
 *
 * A CALLER THAT PASSES NO `client` DOES NOT GET THE MISMATCH CHECK, and that is the point.
 * gas_devsecops has the identical `buildInfo.js` module sitting in its client, imported by
 * nothing; wiring it up here would be a new deployment claim for that register rather than the
 * same claim expressed once.
 *
 * The one-stamp form prints the id VERBATIM, "dev" included. `describeStamp`'s "dev means no
 * stamp" rule belongs to the comparison, where the question is whether two ids differ; on a
 * single stamp the reader is asking what is deployed, and "dev" is the answer when nothing
 * stamped it.
 */
function buildSection(spec, titleTag) {
  const label = spec.label || "Build";
  const hasClient = spec.client !== null && spec.client !== undefined;
  if (!hasClient) {
    const id = stampId(spec.server);
    return diagnosticCard({
      key: "build", titleTag, label,
      value: id === null ? absent() : el("code", { class: "small" }, id),
      description: spec.description || null, note: spec.note || null,
    });
  }
  const mismatch = buildMismatch(spec.client, spec.server);
  return diagnosticCard({
    key: "build", titleTag, label, description: spec.description || null,
    body: [
      el("dl", { class: "kv" },
        el("dt", {}, "Client"), el("dd", {}, describeStamp(spec.client)),
        el("dt", {}, "Server"), el("dd", {},
          spec.server === null || spec.server === undefined
            ? "unavailable"
            : describeStamp(spec.server))),
      mismatch && spec.mismatchNote
        ? el("p", { class: "health-mismatch small" }, spec.mismatchNote)
        : null,
    ],
    note: spec.note || null,
  });
}

/** A stamp's id, or null. Accepts the bare string two apps publish and the `{id}` gas_ai does. */
function stampId(stamp) {
  const raw = typeof stamp === "string" ? stamp : stamp && stamp.id;
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  return text.trim() === "" ? null : text;
}

/**
 * A stamp as shown to a person: the id itself, or "unknown".
 *
 * "dev" is what the `typeof __BUILD_ID__` guard in each app's `buildInfo.js` yields when the
 * bundle was built with no define step — vitest, or a dev server that skipped it. That is the
 * ABSENCE of a stamp rather than the name of a build, so it reads as unknown, and
 * `buildMismatch` below refuses to compare it.
 */
export function describeStamp(stamp) {
  const id = stampId(stamp);
  return id === null || id === "dev" ? "unknown" : id;
}

/**
 * Do two stamps disagree? Only when BOTH are real.
 *
 * Comparing an unstamped bundle ("dev", or missing) against a real one reported a deployment
 * fault on every local run, which is a false alarm about the one thing this panel exists to
 * report truthfully.
 */
export function buildMismatch(client, server) {
  const a = stampId(client);
  const b = stampId(server);
  if (a === null || b === null || a === "dev" || b === "dev") return false;
  return a !== b;
}

/**
 * Whether this deployment is reading a live tenant.
 *
 * `missingTone` HAS NO DEFAULT, ON PURPOSE. gas_ai draws a missing credential `neutral` —
 * dry-run against bundled sample data is a legitimate way to run that workbook — and
 * gas_devsecops draws it `bad`, because a register with nothing to sync is broken. Those are
 * different claims about the same boolean, so this module refuses to guess: a caller that omits
 * the tone gets a throw naming the choice, the way `appConfig()` refuses an unset manifest
 * rather than defaulting to one app's answer.
 */
function credentialsSection(spec, titleTag) {
  if (spec.missingTone !== "neutral" && spec.missingTone !== "bad") {
    throw new Error(
      'diagnosticsPanel(): credentials.missingTone must be "neutral" or "bad" — whether a '
      + "missing credential is a legitimate dry-run or a fault is the register's claim, not "
      + "this module's.",
    );
  }
  const present = spec.present === true;
  return diagnosticCard({
    key: "credentials", titleTag, label: spec.label || "Wiz credentials",
    description: spec.description || null,
    // In a `.health-row`, not bare. The card is a column flex container, so a bare pill
    // stretches to the full card width and stops reading as a pill at all — which is exactly
    // what it did on first render in both apps that draw one.
    body: el("div", { class: "health-row" },
      present
        ? statusPill("ok", spec.okLabel || "Connected")
        : statusPill(spec.missingTone, spec.missingLabel || "No credentials")),
    note: spec.note || null,
  });
}

/**
 * When the register last ran, as the caller phrased it.
 *
 * A STRING, NOT A TIMESTAMP, because the phrase is the app's: gas_devsecops names the scopes a
 * run covered and counts its own noun. No relative-age phrase is added here — there is no
 * `figures.relativeAge` in this package yet, and inventing one on the way past would put a
 * second age vocabulary beside the one that is coming.
 */
function lastSyncSection(spec, titleTag) {
  return diagnosticCard({
    key: "lastSync", titleTag, label: spec.label || "Last sync",
    value: factValue(spec.value, spec.emptyText), note: spec.note || null,
  });
}

const BUILDERS = {
  storage: storageSection,
  errors: errorsSection,
  product: productSection,
  build: buildSection,
  credentials: credentialsSection,
  lastSync: lastSyncSection,
};

// =============================================================================== the panel

/**
 * The System-tab read-outs an app has, as a grid of cards.
 *
 * Returns `{ node, grid, sections }`. `node` is what an app appends when its diagnostics are
 * contiguous — gas and gas_devsecops both draw the whole grid in one place. `sections` is the
 * same cards by key, for an app that must put something non-diagnostic BETWEEN two of them:
 * gas_ai's "Show experimental content" sits between its credential card and its build card and
 * is not a diagnostic, so it places all three itself and never touches `node`.
 *
 * `heading` renders the one `h2.section-label` above the grid that both grid-drawing apps
 * already had ("System health" in gas, "Deployment" in gas_devsecops). Omitting it draws no
 * heading — an app whose cards carry their own (`titleTag: "h2"`) must not also gain one here.
 *
 * @param {object}  spec
 * @param {string}  [spec.heading]     the h2 above the grid
 * @param {string}  [spec.titleTag]    the element every card's label is drawn as ("span")
 * @param {object}  [spec.storage]     { label?, description?, body, note? }
 * @param {object}  [spec.errors]      { label?, description?, badge?, action?, covers?, note? }
 * @param {object}  [spec.product]     { label?, value, emptyText?, note? }
 * @param {object}  [spec.build]       { label?, server, client?, mismatchNote?, description?, note? }
 * @param {object}  [spec.credentials] { label?, present, okLabel?, missingLabel?, missingTone, description?, note? }
 * @param {object}  [spec.lastSync]    { label?, value, emptyText?, note? }
 */
export function diagnosticsPanel(spec = {}) {
  const titleTag = spec.titleTag || "span";
  const sections = {};
  const grid = el("div", { class: "health-grid" });
  for (const key of DIAGNOSTIC_SECTIONS) {
    const sub = spec[key];
    // `undefined` and `null` both mean "this register does not publish that", which is the
    // whole optionality contract. `false` is refused the same way rather than coerced.
    if (sub === null || sub === undefined || sub === false) continue;
    const card = BUILDERS[key](sub, titleTag);
    sections[key] = card;
    grid.append(card);
  }
  const node = spec.heading
    ? el("div", { class: "health-block" },
      el("h2", { class: "section-label" }, spec.heading), grid)
    : grid;
  return { node, grid, sections };
}

// ============================================================================ the error log

/**
 * A recent-errors payload, whatever envelope it arrived in, as `{ items, covers, note }`.
 *
 * The two shapes in this tree disagree at the top level: `gas`'s `api_getRecentErrors` answers a
 * BARE ARRAY of `{ts, op, kind, message}`, and `gas_devsecops`'s answers an OBJECT
 * `{errors, covers, note}` whose rows are `{job_id, kind, phase, scope, at, error}`. Neither is
 * wrong; a narrower log has something extra to say. Unwrapping both here is what lets one
 * renderer draw either.
 *
 * `Number(null)` HAS A COUSIN HERE: `.length` on something that was never a list. A payload
 * that is neither an array nor an object with an array in it yields an EMPTY list, and an empty
 * list is what `errorCountBadge` reads as "None recorded." — so anything that could be a failed
 * fetch must be refused BEFORE it reaches this function, by the caller's own catch. This
 * function's zero means "the log is empty", never "the log could not be read".
 *
 * `mapItem` exists because `kind` MEANS DIFFERENT THINGS in the two payloads: gas's is the
 * error's severity ("error" / "warn"), which is what the pill in the table is drawn from, while
 * devsecops's is the JOB's kind ("sync", "compact"). The default mapper takes gas's reading. An
 * app whose `kind` is not a severity must pass its own mapper rather than let this one guess.
 */
export function normalizeErrorLog(payload, mapItem = defaultErrorItem) {
  const raw = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.errors) ? payload.errors : [];
  const envelope = Array.isArray(payload) ? {} : payload || {};
  return {
    items: raw.map((row) => mapItem(row || {})),
    covers: envelope.covers ? String(envelope.covers) : null,
    note: envelope.note ? String(envelope.note) : null,
  };
}

function defaultErrorItem(row) {
  return {
    at: row.at ?? row.ts ?? null,
    op: row.op ?? null,
    kind: row.kind ?? null,
    message: row.message ?? row.error ?? null,
  };
}

/**
 * The count badge for the errors card: a bad pill with the number, or the words a log that is
 * genuinely empty deserves.
 *
 * A pill, not a bare number, because a recorded error is a claim that something failed silently
 * — the badge is the only place a background failure surfaces at a glance. The empty case is a
 * SENTENCE and not a zero: "0" beside "Recent errors" reads as a metric, and this is a state.
 */
export function errorCountBadge(items) {
  const n = Array.isArray(items) ? items.length : 0;
  return n > 0
    ? statusPill("bad", `${n} recorded`)
    : el("span", { class: "muted small" }, "None recorded.");
}

/**
 * The body of the recent-errors drill-down: a toolbar, what the log does not cover, and either
 * the rows or an empty state.
 *
 * CLEAR IS A CAPABILITY, NOT A BUTTON THAT IS SOMETIMES DISABLED. `gas` has
 * `api_clearRecentErrors`; `gas_devsecops` has no clear RPC at all. Passing no `onClear` draws
 * no clear control — a disabled one would offer an operation that does not exist. Passed, it is
 * disabled only while there is nothing to clear, which is a different statement.
 *
 * `fmtDateTime` is the CALLER's, threaded in rather than imported, because the display zone is
 * resolved per app and a table of timestamps in the wrong zone is worse than one with none.
 */
export function errorLogBody({
  items, covers, note, onRefresh, onClear, fmtDateTime,
  emptyTitle = "No errors recorded.",
  emptyBody = "Background and foreground failures will appear here as they happen.",
  columns = ["When", "Operation", "Kind", "Message"],
} = {}) {
  const rows = Array.isArray(items) ? items : [];
  const out = [];
  if (onRefresh || onClear) {
    out.push(el("div", { style: "display:flex; gap:8px; margin-bottom:12px" },
      onRefresh ? el("button", { onclick: () => onRefresh() }, "Refresh") : null,
      onClear
        ? el("button", { disabled: rows.length ? null : true, onclick: () => onClear() }, "Clear log")
        : null));
  }
  if (covers) out.push(coversLine(covers));
  if (note) out.push(el("p", { class: "small muted" }, note));
  if (!rows.length) {
    out.push(emptyState(emptyTitle, emptyBody));
    return out;
  }
  const tbody = el("tbody", {});
  for (const e of rows) {
    tbody.append(el("tr", {},
      el("td", { class: "small muted", style: "white-space:nowrap" },
        e.at ? (fmtDateTime ? fmtDateTime(e.at) : String(e.at)) : absent()),
      // absent(), not a bolded em dash: an error the log could not name is a gap in the
      // record, and printing it in the same weight as a real operation name claims one.
      el("td", {}, e.op ? el("strong", {}, e.op) : absent()),
      el("td", {}, e.kind ? statusPill(e.kind === "error" ? "bad" : "warn", e.kind) : absent()),
      el("td", {},
        e.message
          ? el("code", { class: "small", style: "white-space:pre-wrap; word-break:break-word" },
            e.message)
          : absent()),
    ));
  }
  out.push(el("div", { class: "table-wrap" },
    el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ...columns.map((h) => el("th", { scope: "col" }, h)))),
      tbody)));
  return out;
}
