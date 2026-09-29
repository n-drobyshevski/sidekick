// The MTTR split's row sheet, the half of it that is not DOM: which findings a row stands for,
// how to ask the server for them, and the words the sheet puts round them. The OS register's
// `gas/src/client/js/pages/_splitSheet.js`, in this register's words.
//
// A ROW OF THE SPLIT IS A POPULATION, AND THE SHEET HAS TO OPEN ON EXACTLY IT. The split's
// dimension follows the header scope (`readModels.buildMttrSplit`): per domain unscoped, per
// support group inside a domain or a project, per repository inside a one-group project. The
// header scope is SERVER state here (`settings.domainView` / `settings.projectView`), so it
// rides on every request by itself; what the sheet adds is the row's bucket, as `split` —
// which `readModels.scopedRows` applies INSIDE that scope, never past it.
//
// THREE REGISTERS, NOT ONE. A row counts sca, sast and secrets findings together (the page's
// own register filter aside), but `api_getRegisterRows` lists one register at a time — each
// has its own columns (`REGISTER_ROW_COLUMNS`). So the sheet's findings list carries a
// register switch, offering only the registers the row actually has findings in.
//
// "(none)" is `readModels.SPLIT_NONE`, the split's label for a missing value, and
// `test/splitSheet.test.js` holds this copy to its source.
//
// WHY `pages/`, NOT `ui/`: `shared.test.js` pins `ui/` to the local list, and this is one
// section's vocabulary.

/** `server/readModels.ts` SPLIT_NONE — the split's label for "no value". */
export const SPLIT_NONE = "(none)";

/** The registers, in the order the switch offers them. */
export const SPLIT_REGISTERS = ["sca", "sast", "secrets"];

/** Each register's name on the switch. */
export const REGISTER_LABELS = { sca: "Dependencies", sast: "Code", secrets: "Secrets" };

/** The dimension's noun, lowercase for prose and capitalised for a heading. */
export const SPLIT_DIMS = {
  domain: { noun: "domain", Noun: "Domain" },
  supportGroup: { noun: "support group", Noun: "Support group" },
  repo: { noun: "repository", Noun: "Repository" },
};

/** The dimension's words, falling back to domain for a payload that names none. */
export function splitDim(dimension) {
  return SPLIT_DIMS[dimension] || SPLIT_DIMS.domain;
}

/** A split row's own label. */
export function splitGroupOf(row) {
  return String((row && row.group) ?? "");
}

/**
 * The two requests behind one row's sheet. `pageScope` is the MTTR page's own register filter
 * (sca / sast / secrets, or null for all three) and rides on the MTTR request unchanged, so the
 * per-severity table measures what the row measured.
 */
export function splitSheetRequests(dimension, row, pageScope) {
  const by = SPLIT_DIMS[dimension] ? dimension : "domain";
  const group = splitGroupOf(row);
  const mttr = { groupBy: by, groupValue: group };
  if (pageScope) mttr.scope = pageScope;
  return { mttr, register: { split: { by, value: group } } };
}

/**
 * The registers the findings list offers: the page's own register when it is filtered to one,
 * else every register the row has findings in (`totalByScope`), in `SPLIT_REGISTERS` order.
 * Never empty — a row with no per-register counts (an older payload) offers all three.
 */
export function splitSheetRegisters(row, pageScope) {
  if (pageScope && SPLIT_REGISTERS.includes(pageScope)) return [pageScope];
  const totals = (row && row.totalByScope) || null;
  if (!totals) return SPLIT_REGISTERS.slice();
  const present = SPLIT_REGISTERS.filter((s) => Number(totals[s]) > 0);
  return present.length ? present : SPLIT_REGISTERS.slice();
}

/**
 * Which register the list opens on: the first with something OPEN in this row, else the first
 * offered — the open backlog is the question a reader drilling into a slow group asks first.
 */
export function splitSheetFirstRegister(row, registers) {
  const open = (row && row.openByScope) || {};
  return registers.find((s) => Number(open[s]) > 0) || registers[0];
}

/**
 * Where the findings list opens: the OPEN backlog when the register has one, else RESOLVED —
 * an open list that is empty by definition is a dead end rather than an answer.
 */
export function splitSheetDefaults(row, register) {
  const open = Number(row && row.openByScope && row.openByScope[register]) || 0;
  const status = open > 0 || (!(row && row.openByScope) && Number(row && row.open) > 0)
    ? "open" : "resolved";
  return { status, ...splitSheetSortFor(register, status) };
}

/**
 * The sort a (register, status) lands on — each list's own clock, longest first, and only ever
 * a column that register ships (`REGISTER_ROW_COLUMNS`): secrets carries no `age_days` and
 * only sca carries `mttr_days`.
 */
export function splitSheetSortFor(register, status) {
  if (register === "secrets") {
    return status === "resolved"
      ? { sort: "removed_at", dir: "desc" }
      : { sort: "first_seen", dir: "asc" };
  }
  if (status === "resolved") {
    return register === "sca" ? { sort: "mttr_days", dir: "desc" } : { sort: "last_seen", dir: "desc" };
  }
  return { sort: "age_days", dir: "desc" };
}

/**
 * The findings table's column keys for this register, dimension and status — a subset of that
 * register's `REGISTER_ROW_COLUMNS`. A column that restates the row is dropped (every finding
 * under a repository row sits in that repository), and the clocks follow the status.
 */
export function splitSheetColumnKeys(register, dimension, status) {
  const keys = [];
  if (register === "sca") keys.push("identifier", "component", "severity");
  else if (register === "sast") keys.push("identifier", "cwe", "file_path", "severity");
  else keys.push("identifier", "secret_kind", "file_path", "validation_state");
  if (dimension !== "repo") keys.push("repo_name");
  if (register === "secrets") {
    keys.push("first_seen");
    if (status !== "open") keys.push("removed_at");
    return keys;
  }
  if (register === "sca") keys.push("awaiting_vendor_fix");
  if (status === "open") keys.push("first_seen", "age_days");
  else if (status === "resolved") keys.push("last_seen", ...(register === "sca" ? ["mttr_days"] : []));
  else keys.push("age_days", ...(register === "sca" ? ["mttr_days"] : []));
  keys.push("status");
  return keys;
}

/** The row button's accessible name — what a screen reader hears on the table row. */
export function splitRowLabel(dimension, row) {
  return `${splitGroupOf(row) || "Unnamed"}, ${splitDim(dimension).noun}, `
    + "open remediation and findings";
}

/**
 * The sheet's subtitle: what kind of bucket this is, what it sits inside (`within`, off the
 * split payload), and — once the payload says it (`countedDomain`) — the ONE domain the row
 * counts under. A support group is measured in a single domain (server/currentDomains.ts).
 */
export function splitSheetSubtitle(dimension, within, pageScope, countedDomain) {
  const parts = [splitDim(dimension).Noun];
  if (within && within.kind === "project" && within.value) parts.push(`in project ${within.value}`);
  if (dimension === "repo" && within && within.supportGroup) {
    parts.push(`support group ${within.supportGroup}`);
  }
  const counted = countedDomain
    || (within && within.kind === "domain" && within.value) || "";
  if (dimension !== "domain" && counted) parts.push(`domain ${counted}`);
  if (pageScope && REGISTER_LABELS[pageScope]) parts.push(`${REGISTER_LABELS[pageScope]} only`);
  return parts.join(" · ");
}

/**
 * One sentence for a bucket that is not a real owner — or null for one that is. On the sheet's
 * surface: it says what population the sheet is about.
 */
export function splitBucketNote(dimension, group) {
  if (group !== SPLIT_NONE) return null;
  if (dimension === "domain") {
    return "Findings whose repository carries no domain tag, and whose support group is not "
      + "pinned to a domain — the attribution gap, not a team.";
  }
  if (dimension === "supportGroup") {
    return "Findings whose repository sits in no CS-, CE- or LU- project, so no support group "
      + "owns it.";
  }
  return "Findings whose repository carries no name.";
}

/**
 * The sentence for an open list whose total disagrees with the row it was opened from — or
 * null when they agree. The row counts one register's open findings off `openByScope`; the
 * list is the register's own endpoint over the same bucket. The two can part where the MTTR
 * page leaves out repositories at end of life (Settings) and the register does not.
 */
export function splitCountNote(row, register, total, status) {
  if (status !== "open" || typeof total !== "number") return null;
  const open = Number(row && row.openByScope && row.openByScope[register]);
  if (!Number.isFinite(open) || open === total) return null;
  return `The row above counts ${open.toLocaleString()} open here; the register lists `
    + `${total.toLocaleString()} for the same bucket — the MTTR page can leave out `
    + "repositories at end of life (Settings), the register does not.";
}
