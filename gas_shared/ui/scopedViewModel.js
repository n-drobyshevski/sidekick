// What the scoped viewer's shell SAYS, apart from how it draws it — and the roster editor's
// arithmetic. DOM-free, so gas_shared/test/contracts/scopedView.js can pin it in node.
//
// A scoped viewer is someone admitted to a register but only to their own domains / teams
// (gas: domains + support groups; gas_devsecops: domains + projects). Their boot payload is
// `{role: "scoped", scope, summary, …}` and their shell is two read-only pages. The summary
// shape is shared by both registers (gas/src/domain/scopeSummary.ts is the reference), which
// is why one page renders either.

import { fmtDays, num } from "./figures.js";

/** The dimensions each register assigns, keyed as its server stores them. */
export const SCOPE_DIM_LABELS = {
  d: { one: "domain", many: "domains", field: "domains" },
  g: { one: "support group", many: "support groups", field: "supportGroups" },
  p: { one: "project", many: "projects", field: "projects" },
};

/** Every value in a viewer scope, dimension by dimension, in the order the server stored. */
export function scopeValues(scope) {
  const s = scope && typeof scope === "object" ? scope : {};
  const out = [];
  for (const key of Object.keys(SCOPE_DIM_LABELS)) {
    const field = SCOPE_DIM_LABELS[key].field;
    const vals = Array.isArray(s[field]) ? s[field] : [];
    for (const v of vals) if (v) out.push({ dim: key, value: String(v) });
  }
  return out;
}

/**
 * The scope as one short phrase for the header badge and the page title: "Payments",
 * "Payments + CS-core", "Payments + 3 more". Never empty — an empty scope is not a state the
 * server can serve, and saying "everything" here would be the one wrong answer.
 */
export function scopeLabel(scope, max = 2) {
  const vals = scopeValues(scope).map((v) => v.value);
  if (!vals.length) return "No scope";
  if (vals.length <= max) return vals.join(" + ");
  return vals.slice(0, max).join(" + ") + ` + ${vals.length - max} more`;
}

/** A spoken sentence of the same, for the badge's tooltip and the summary's lede. */
export function scopeSentence(scope) {
  const parts = [];
  const s = scope && typeof scope === "object" ? scope : {};
  for (const key of Object.keys(SCOPE_DIM_LABELS)) {
    const meta = SCOPE_DIM_LABELS[key];
    const vals = Array.isArray(s[meta.field]) ? s[meta.field].filter(Boolean) : [];
    if (!vals.length) continue;
    parts.push(`${vals.length === 1 ? meta.one : meta.many} ${vals.join(", ")}`);
  }
  return parts.length ? `Findings in ${parts.join(" and in ")}.` : "No scope assigned.";
}

function pctText(v) {
  const n = num(v);
  return n === null ? null : `${Math.round(n)}%`;
}

/**
 * The summary's tiles, as label / value / sub triples. Nulls stay null — the tile renders the
 * absent dash, because a censored median is "not observable yet", not zero days.
 */
export function summaryTiles(summary) {
  const s = summary || {};
  const mttr = s.mttr || {};
  const sla = s.sla || {};
  const aw = s.awaiting || {};
  const median = num(mttr.median);
  const lower = num(mttr.medianLowerBound);
  return [
    {
      key: "open",
      label: "Open findings",
      value: num(s.open),
      sub: num(s.resolved) !== null ? `${Number(s.resolved).toLocaleString()} resolved` : "",
    },
    {
      key: "mttr",
      label: "MTTR (median)",
      value: median !== null ? fmtDays(median) : lower !== null ? `≥ ${fmtDays(lower)}` : null,
      sub: num(mttr.p90) !== null ? `p90 ${fmtDays(mttr.p90)}` : "p90 not observable yet",
    },
    {
      key: "pastSla",
      label: "Open past SLA",
      value: num(sla.pastSla),
      sub: pctText(sla.pastSlaPct) ? `${pctText(sla.pastSlaPct)} of open` : "",
    },
    {
      key: "attainment",
      label: "Closed within SLA",
      value: pctText(sla.attainmentPct),
      sub: "of resolved findings",
    },
    {
      key: "awaiting",
      label: "Awaiting vendor fix",
      value: num(aw.count),
      sub: pctText(aw.pctOfOpen) ? `${pctText(aw.pctOfOpen)} of open` : "",
    },
  ];
}

/** The sparkline series off the summary's trend: open counts, and the median. */
export function summarySeries(summary) {
  const pts = summary && Array.isArray(summary.trend) ? summary.trend : [];
  return {
    open: pts.map((p) => num(p.open)),
    median: pts.map((p) => num(p.medianDays)),
    from: pts.length ? pts[0].date : null,
    to: pts.length ? pts[pts.length - 1].date : null,
  };
}

// --------------------------------------------------------------------- the roster editor

/**
 * One editor row: `{email, scope}` where scope is `{domains, supportGroups | projects}`.
 * `catalogue` is the server's `{dims:[{key,label,options:[{value,count}]}]}` (or null).
 */
export function rowChips(row, catalogue) {
  const known = {};
  const labels = {};
  for (const dim of (catalogue && catalogue.dims) || []) {
    known[dim.key] = {};
    labels[dim.key] = {};
    for (const o of dim.options || []) {
      known[dim.key][o.value] = num(o.count);
      // A project is stored by slug and read by name; a domain is both at once.
      labels[dim.key][o.value] = o.label || o.value;
    }
  }
  return scopeValues(row && row.scope).map((v) => ({
    ...v,
    label: (labels[v.dim] && labels[v.dim][v.value]) || v.value,
    // STALE, NOT DROPPED. A domain renamed in Wiz leaves the old name here; silently removing
    // it would quietly narrow somebody's access on the next save, so it stays and says so.
    stale: !!catalogue && !!known[v.dim] && !(v.value in known[v.dim]),
    count: known[v.dim] ? (known[v.dim][v.value] ?? null) : null,
  }));
}

/**
 * The open findings a row's scope would show, summed from the catalogue. An UPPER BOUND when
 * two dimensions are mixed — a finding in both a listed domain and a listed team is counted
 * once by the server and twice here — so the caller prints it with "up to".
 */
export function rowReach(row, catalogue) {
  const chips = rowChips(row, catalogue);
  let total = 0;
  let known = false;
  for (const c of chips) {
    if (c.count !== null) {
      total += c.count;
      known = true;
    }
  }
  const dims = new Set(chips.map((c) => c.dim));
  return { total: known ? total : null, upperBound: dims.size > 1 };
}

/** Normalised address, or "" — the same rule the server applies. */
export function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

/**
 * What stops a draft from saving, one sentence per problem, or [] when it may save. Mirrors
 * the server's validateScoped so the button is disabled for the same reasons the server would
 * refuse — the server stays the authority.
 */
export function draftProblems(rows, { owner = "", admins = [] } = {}) {
  const out = [];
  const seen = new Set();
  const privileged = new Set([normEmail(owner), ...admins.map(normEmail)].filter(Boolean));
  for (const r of rows || []) {
    const email = normEmail(r.email);
    if (!email) {
      out.push("Every row needs an email address.");
      continue;
    }
    if (email.indexOf("@") < 0 || /[,;\s]/.test(email)) out.push(`${email} is not an email address.`);
    if (seen.has(email)) out.push(`${email} is listed twice.`);
    seen.add(email);
    if (privileged.has(email)) out.push(`${email} is the owner or an admin and always has full access.`);
    if (!scopeValues(r.scope).length) out.push(`Pick at least one domain or team for ${email}.`);
  }
  return out;
}

/** Whether an address is outside the owner's Workspace domain — it can never match. */
export function foreignDomain(email, domain) {
  const e = normEmail(email);
  const d = String(domain || "").toLowerCase();
  if (!d || e.indexOf("@") < 0) return false;
  return e.slice(e.lastIndexOf("@") + 1) !== d;
}

/** The draft as `saveScoped` takes it, with empty dimensions dropped. */
export function rosterPayload(rows) {
  return (rows || []).map((r) => {
    const scope = {};
    for (const key of Object.keys(SCOPE_DIM_LABELS)) {
      const field = SCOPE_DIM_LABELS[key].field;
      const vals = r.scope && Array.isArray(r.scope[field]) ? r.scope[field] : null;
      if (vals) scope[field] = vals.slice();
    }
    return { email: normEmail(r.email), scope };
  });
}

/** Whether two rosters differ, ignoring order. */
export function rosterChanged(a, b) {
  const key = (rows) => JSON.stringify(rosterPayload(rows)
    .map((r) => ({ email: r.email, scope: Object.fromEntries(Object.entries(r.scope)
      .map(([k, v]) => [k, v.slice().sort()])) }))
    .sort((x, y) => (x.email < y.email ? -1 : x.email > y.email ? 1 : 0)));
  return key(a) !== key(b);
}
