// The key sheet's content: what every word and mark on these screens means.
//
// Same split as scanContent.js, for the same reason. Prose lives here; NUMBERS do not.
// Every figure is resolved from the last sync through an entry's `count(ctx)`, so this
// file cannot carry a stale or transcribed figure the way a hand-typed glossary would.
//
// Four rules govern this file.
//
// 1. A MARK IS RENDERED, NEVER REDRAWN. `mark()` returns the real component — sevBadge,
//    aarsChip, kindIconSvg — so a specimen cannot drift into being a picture of a
//    component that no longer looks like that. The two exceptions are the coverage
//    glyphs and the gap shapes, which are characters in the product's own copy rather
//    than components, and are built here as spans.
//
// 2. A RESOLVER THAT CANNOT ANSWER RETURNS NULL. Not zero, not a guess. `resolveEntries`
//    wraps every call, so a missing KPI on an older server bundle degrades the entry to
//    "not counted here" instead of asserting a figure it cannot compute. This is
//    scanContent.js's safeFigure() call, made for the same reason.
//
// 3. A COUNT CARRIES ITS OWN ZERO, AND BEFORE A SYNC THERE IS NO COUNT AT ALL. `n` is the
//    raw number beside the display string, so the page can refuse to link a zero into an
//    empty filtered view — the one thing a count-as-link must never do. And two different
//    kinds of number live in that column: a MEASUREMENT of the landscape, which needs a sync,
//    and a SETTING — the node budget, the pillar caps, the band thresholds — which is the
//    model in force and is just as true before the first sync as after it. An entry that
//    reads a setting says so with `fromSettings`; everything else is withheld until a sync
//    exists, because a landscape figure of zero read off an empty ledger is not zero, it is
//    unknown, and reporting it as zero is the implied confidence PRODUCT.md forbids.
//
// 4. THE FRAMEWORK CODES ARE INDEXED HERE, NOT COPIED. codebook.js already carries all
//    forty definitions and the AARS Rules page already browses them with live per-code
//    counts. This file names the five vocabularies with their vintage and standing and
//    links out. Copying the definitions is the wall this page exists to avoid.

import { CODEBOOK, FAMILY_GROUP } from "./codebook.js";
import { MEASURE_ENTRIES } from "./measureContent.js";
import { CATEGORY_LABELS, CATEGORY_ORDER, kindIconSvg } from "../../../../gas_shared/icons.js";
import {
  aarsChip, el, outcomeBadge, pluralize, sevBadge, statusPill,
  tierBadge,
} from "./ui.js";

/** The eight headings, in reading order. Eight headings and find-in-page beat a search box. */
export const FAMILIES = [
  { id: "graph", title: "Reading the graph" },
  { id: "signal", title: "Risk signals" },
  { id: "score", title: "The score" },
  { id: "severity", title: "Severity" },
  { id: "coverage", title: "Coverage and freshness" },
  // What the issue ledger records BETWEEN syncs — arrival, departure, return. Separate from
  // "Coverage and freshness", which is about whether a sync ran at all: these terms are about
  // what changed once two of them had.
  { id: "lifecycle", title: "The issue lifecycle" },
  { id: "framework", title: "Framework vocabularies" },
  // Phase 8: what a published number IS — its goal, formula, source and whether it was
  // measured or judged. See src/domain/measureSpec.ts for the authoritative record; this
  // family renders measureContent.js's mirror of it.
  { id: "measures", title: "Measure specifications" },
];

/**
 * Route titles for the "drawn on" line.
 *
 * A SECOND COPY OF THE TITLES, and it stays one — but it is now a CHECKED copy.
 *
 * It cannot import the table: `pages.js` imports the page modules, the page modules import
 * this file, and closing that loop would be an import cycle. What changed is that the table
 * is importable at all, so `helpContent.test.js` holds every key AND every title here equal
 * to the real entry instead of only checking that the keys exist. A title that drifts from
 * the nav's own word for the page now fails a test rather than shipping two names for one
 * page.
 */
export const ROUTE_TITLES = {
  graph: "Security Graph",
  inventory: "AI Inventory",
  problems: "Priorities",
  combos: "Toxic Combinations",
  config: "Cloud Configuration",
  aars: "Scoring Models",
  scans: "Wiz Scans",
  data: "Storage",
  settings: "Settings",
};

const n = (v) => Number(v || 0);

/** A glyph the product spells as a character rather than drawing as a component. */
function glyph(ch, cls) {
  return el("span", { class: "help-glyph" + (cls ? " " + cls : ""), "aria-hidden": "true" }, ch);
}

/** The icon-only specimen, at the size the graph draws it. */
function kindMark(kind) {
  return el("span", { class: "help-kindmark", "aria-hidden": "true" }, kindIconSvg(kind, 18));
}

/**
 * One prose string as the `lines` array every entry now carries.
 *
 * The hand-authored entries below are WRITTEN as lines, because their first two are a tip
 * card and a card is 300px wide. The two generated families at the foot of this file are
 * not: their prose belongs to codebook.js and measureSpec.ts, which are the records this
 * page indexes rather than restates, so they are split on sentences instead of rewritten.
 * That is sound precisely because nothing points a tip at them — they are reached by
 * browsing the key sheet or by a `?term=` link, where the whole entry renders anyway, and
 * helpContent.test.js pins that no `term:` in the client names one.
 */
function asLines(text) {
  const out = [];
  let cur = "";
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    cur += s[i];
    if (/[.!?]/.test(s[i]) && /^ +[A-Z“(]/.test(s.slice(i + 1))) {
      out.push(cur.trim());
      cur = "";
      i++;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [s];
}

// ------------------------------------------------------------------------ the entries
//
// `count(ctx)` receives { boot, kpis, digest, tally } and returns either null — meaning
// "this deployment cannot count it here" — or:
//
//   { n, value, unit, route, params }
//
// where `n` is the raw number the page tests for zero, `value` is what it prints, and
// route/params name the view the number opens. Omit route/params for a figure that has
// no filtered view to open.
//
// An entry with no `count` at all is a CONVENTION, not a quantity. Those carry `link`
// instead, so the right-hand column stays a column of destinations rather than a column
// of em-dashes.

export const ENTRIES = [
  // ------------------------------------------------------------------ reading the graph
  {
    id: "node-kind",
    term: "Node kind",
    aka: "tint, icon and word",
    family: "graph",
    lines: [
      "Every node says what it is three times: a category tint, a kind icon, the kind spelled.",
      "The tint is the CATEGORY, five of them; the icon and the word are the KIND.",
      "Every kind draws its own mark, so a glyph names one thing and one thing only.",
      "Colour is still never the only cue: the icon rides beside the label, never "
      + "instead of it.",
    ],
    drawnOn: ["graph", "inventory", "scans"],
    mark: () => kindMark("AI_AGENT"),
    // The strip of every category, so the reader can match a tint on screen to a word.
    strip: () => CATEGORY_ORDER.map((cat) => ({ cat, label: CATEGORY_LABELS[cat] })),
    more:
      "The full list of kinds, grouped by category and searchable, is the AI Inventory " +
      "filter drawer — where each one also says how many assets it would leave.",
    count: (ctx) => {
      const kinds = (ctx.boot.filterOptions && ctx.boot.filterOptions.kinds) || [];
      if (!kinds.length) return null;
      return {
        n: kinds.length,
        value: String(kinds.length),
        unit: "kinds in this landscape",
        route: "inventory",
        params: { panel: "filters" },
      };
    },
  },
  {
    id: "toxic-combination",
    term: "Toxic combination",
    aka: "TC",
    family: "graph",
    lines: [
      "A pattern that only fires when risks COMBINE, drawn as one path rather than two finds.",
      "Members carry a crimson halo and a TC badge on the graph.",
      "A privileged agent that can also reach classified data is one path, not two findings.",
    ],
    drawnOn: ["combos", "graph", "inventory"],
    mark: () => el("span", { class: "help-tc", "aria-hidden": "true" }, "TC"),
    count: (ctx) => {
      const t = ctx.digest && ctx.digest.totals;
      if (!t) return null;
      return {
        n: n(t.patternsActive),
        value: n(t.patternsActive) + " of " + n(t.patternsTotal),
        unit: "patterns firing",
        route: "combos",
        params: {},
      };
    },
  },
  {
    id: "tc-halo",
    term: "The crimson halo",
    aka: "membership, never severity",
    family: "graph",
    lines: [
      "Crimson is this app's identity colour.",
      "On the graph it marks toxic-combination membership and nothing else.",
      "Always paired with the TC badge and an aria-label suffix, so it never carries "
      + "meaning by colour alone.",
      "Severity stays on the dot-and-word chip, in the shared palette.",
    ],
    drawnOn: ["graph"],
    mark: () => el("span", { class: "help-halo", "aria-hidden": "true" }),
    count: (ctx) => {
      const t = ctx.digest && ctx.digest.totals;
      if (!t) return null;
      return {
        n: n(t.assetsAffected),
        value: String(n(t.assetsAffected)),
        unit: "assets in a combination",
        route: "inventory",
        params: { flags: "combo" },
      };
    },
  },
  {
    id: "negated-edge",
    term: "A dashed edge is an absence",
    aka: "the negated relationship",
    family: "graph",
    lines: [
      "Wiz was asked for a relationship and found none.",
      "The edge is drawn dashed and labelled with what is missing, not left off.",
      "The guardrail gap is the one this app raises: a PROTECTED_BY edge that does not "
      + "exist.",
    ],
    drawnOn: ["graph"],
    mark: () => el("span", { class: "help-dash", "aria-hidden": "true" }),
    link: { label: "Open the graph", route: "graph", params: {} },
  },
  {
    id: "risk-as-node",
    term: "Risk is a node",
    aka: "not a flag on a card",
    family: "graph",
    lines: [
      "Risks hang off the asset they describe, on the path — because that is what a path is.",
      "Derived when the graph is READ and never stored, so no re-sync is needed.",
      "Sensitive-data reach, internet exposure, excessive rights and the guardrail gap.",
    ],
    drawnOn: ["graph"],
    mark: () => kindMark("EXCESSIVE_ACCESS_FINDING"),
    link: { label: "Open the graph", route: "graph", params: {} },
  },
  {
    id: "graph-query",
    term: "The query builder",
    aka: "FIND … THAT …",
    family: "graph",
    lines: [
      "A query reads FIND <entity> THAT <relationship> <entity>; each step walks one hop.",
      "In the table a ROW IS A PATH, not an asset.",
      "An agent bound to two service accounts is two rows carrying the same name, and every "
      + "shown step adds a group of columns rather than a column.",
      "The eye keeps a step in the traversal but drops its columns, an optional step "
      + "keeps rows that would otherwise be dropped with the group left empty, and NOT "
      + "asserts the relationship is absent — which is how you ask for an agent with no "
      + "guardrail.",
      "The pickers only offer relationships this tenant's graph actually holds, so a "
      + "query that can match nothing is hard to build.",
    ],
    drawnOn: ["graph"],
    mark: () => el("span", { class: "pill neutral" }, "FIND"),
    link: { label: "Open the graph", route: "graph", params: {} },
  },
  {
    id: "depth-budget",
    term: "Depth and node budget",
    aka: "what bounds a view",
    family: "graph",
    lines: [
      "Depth bounds how far the traversal walks from its starting points.",
      "The node budget is a hard ceiling on one view, counting the collapse stubs it "
      + "also draws.",
      "Both keep the server payload light; a view that hits the ceiling says so and "
      + "offers Load more, which widens that one view without changing the default.",
    ],
    drawnOn: ["graph", "settings"],
    mark: () => el("span", { class: "pill neutral" }, "budget"),
    // The model in force, not a measurement — true before the first sync.
    fromSettings: true,
    count: (ctx) => {
      const s = ctx.boot.settings;
      if (!s) return null;
      return {
        n: n(s.maxNodes),
        value: "depth " + n(s.defaultDepth) + " · " + n(s.maxNodes),
        unit: "nodes per view",
        route: "settings",
        params: { tab: "graph" },
      };
    },
  },
  {
    id: "summary-stub",
    term: "The collapse stub",
    aka: "“+N more”",
    family: "graph",
    lines: [
      "A high-fanout neighbour set collapsed into one pill, which expands on demand.",
      "It counts against the node budget like any other node.",
      "Which is why a capped view still shows them: the budget buys paths, not a field of "
      + "disconnected dots.",
    ],
    drawnOn: ["graph"],
    mark: () => kindMark("SUMMARY"),
    link: { label: "Open the graph", route: "graph", params: {} },
  },

  // ---------------------------------------------------------------------- risk signals
  {
    id: "missing-guardrail",
    term: "MISSING_GUARDRAIL",
    aka: "“no guardrail”",
    family: "signal",
    lines: [
      "No guardrail is attached to this agent or model.",
      "Wiz tests the PROTECTED_BY relationship on every agent, and an absent edge raises "
      + "this node.",
      "It is the strongest single amplifier in the toxic combinations.",
    ],
    drawnOn: ["graph", "inventory"],
    mark: () => kindMark("MISSING_GUARDRAIL"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.protectedAgents === undefined || !k.agents) return null;
      const missing = n(k.agents) - n(k.protectedAgents);
      return {
        n: missing,
        value: missing + " of " + n(k.agents),
        unit: "agents unprotected",
        route: "inventory",
        params: { flags: "guardrail" },
      };
    },
  },
  {
    id: "data-finding",
    term: "DATA_FINDING",
    aka: "what Wiz found in the data",
    family: "signal",
    lines: [
      "Wiz's DSPM verdict on one bucket or database: what class of data, and how severe.",
      "One node per datastore, carrying the count.",
      "A store with two hundred findings is one fact about that store, not two hundred nodes.",
      "These are what turn “this agent can reach sensitive data” into a path you can "
      + "walk: agent → execution identity → datastore → findings.",
    ],
    drawnOn: ["graph"],
    mark: () => kindMark("DATA_FINDING"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.dataFindings === undefined) return null;
      return {
        n: n(k.dataFindings),
        value: String(n(k.dataFindings)),
        unit: pluralize(n(k.dataFindings), "finding") + " on reachable stores",
        route: "graph",
        params: { kinds: "DATA_FINDING" },
      };
    },
  },
  {
    id: "sensitive-data",
    term: "SENSITIVE_DATA",
    aka: "classified-data reach, unresolved",
    family: "signal",
    lines: [
      "The FALLBACK marker: reach to PII, PHI or PCI that no walkable path could confirm.",
      "Suppressed where the chain IS walkable, so one asset never tells the story twice.",
      "Either the tenant rejected the traversal, or the grant is expressed some way it does "
      + "not follow.",
      "Its mark is the data-finding gem, left unfinished.",
    ],
    drawnOn: ["graph"],
    mark: () => kindMark("SENSITIVE_DATA"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.sensitiveAccess === undefined) return null;
      return {
        n: n(k.sensitiveAccess),
        value: String(n(k.sensitiveAccess)),
        unit: "AI " + pluralize(n(k.sensitiveAccess), "asset") + " reach it",
        route: "graph",
        params: { kinds: "SENSITIVE_DATA" },
      };
    },
  },
  {
    id: "internet-exposure",
    term: "INTERNET_EXPOSURE",
    aka: "network reachability",
    family: "signal",
    lines: [
      "The asset or the host underneath it is reachable from the internet.",
      "Undetermined is counted separately and never folded into “not exposed”.",
      "Managed agents report it directly; hosted agents inherit it from the VM or service "
      + "beneath them, which Wiz reports as UNDETERMINED until that host is checked.",
    ],
    drawnOn: ["graph"],
    mark: () => kindMark("INTERNET_EXPOSURE"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.internetExposed === undefined) return null;
      const unknown = n(k.internetUnknown);
      return {
        n: n(k.internetExposed),
        value: String(n(k.internetExposed)),
        unit: "reachable" + (unknown ? " · " + unknown + " undetermined" : ""),
        route: "graph",
        params: { kinds: "INTERNET_EXPOSURE" },
      };
    },
  },
  {
    id: "excessive-privilege",
    term: "EXCESSIVE_PRIVILEGE",
    aka: "excessive rights",
    family: "signal",
    lines: [
      "The identity an AI asset runs as holds admin or high-privilege permissions.",
      "The figure counts assets and identities carrying the flag, not findings.",
      "The individual excessive-access and lateral-movement findings on those service "
      + "accounts are synced and drawn beside the identity, but nothing totals them.",
    ],
    drawnOn: ["graph"],
    mark: () => kindMark("EXCESSIVE_PRIVILEGE"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.highPrivilege === undefined) return null;
      return {
        n: n(k.highPrivilege),
        value: String(n(k.highPrivilege)),
        unit: "carry a privilege flag",
        route: "graph",
        params: { kinds: "EXCESSIVE_PRIVILEGE" },
      };
    },
  },
  {
    id: "agentic-identity",
    term: "Agentic identity",
    aka: "a service account an agent runs as",
    family: "signal",
    lines: [
      "An identity whose purpose is to execute agent work, not to represent a person.",
      "The join between an agent and everything that agent can reach.",
      "Which is why over-broad rights on one turn any hijack into unauthorised action.",
    ],
    drawnOn: ["graph", "inventory"],
    mark: () => kindMark("SERVICE_ACCOUNT"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.agenticIdentities === undefined) return null;
      return {
        n: n(k.agenticIdentities),
        value: String(n(k.agenticIdentities)),
        unit: n(k.agenticIdentities) === 1 ? "agentic identity" : "agentic identities",
        route: "inventory",
        params: { flags: "agentic" },
      };
    },
  },

  // ------------------------------------------------------------------------- the score
  {
    id: "aars",
    term: "Findings score",
    aka: "AARS — the identifier every column and route still uses",
    family: "score",
    lines: [
      "EXPERIMENTAL. One number per asset, 0 to 100, summed across four pillars and clamped.",
      "This app's own score, not a Wiz field: it prices what the sync collected.",
      "So the model that produces it is editable and its inputs are persisted beside "
      + "every score.",
      "It counts what has already been FOUND — issues, compliance gaps, data exposure — "
      + "which is why it is not called a risk score; forward-looking consequence is the "
      + "posture tier's job.",
      "The raw number is only meaningful against the other assets, which is why the "
      + "Scoring Models page reads it as a distribution rather than one asset at a time.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => aarsChip(78, "HIGH"),
    count: (ctx) => {
      // The scored POPULATION, not a count of one level. This read `criticalAars` until
      // that KPI was withdrawn: on live data the top level holds 19 of 30 scored assets,
      // so "N assets score Critical" was a restatement of "N assets are scored" wearing a
      // verdict's clothes. The denominator is the honest figure, and it is the one the
      // percentile beside every score is a percentile OF.
      const k = ctx.kpis;
      if (!k || k.aarsScored === undefined) return null;
      return {
        n: n(k.aarsScored),
        value: String(n(k.aarsScored)),
        unit: "assets scored",
        route: "inventory",
        params: {},
      };
    },
  },
  {
    id: "aars-band",
    term: "Findings score level",
    aka: "context beside a score, not a verdict",
    family: "score",
    lines: [
      "EXPERIMENTAL. The level a score falls into.",
      "Re-derived from the stored score on every read, so a threshold moves retroactively.",
      "No re-sync and no rescore is needed.",
      "Changing the POINT model is the other thing entirely, and strands the stored "
      + "scores until they are recomputed.",
      "A level is not a queue: on this landscape the top one holds most of the scored "
      + "assets and two hold none, so it is drawn tinted only on the AARS Rules page, "
      + "where the thresholds themselves are the subject, and plain everywhere else.",
      "Its two honest readings are the distribution the trend charts over time and the "
      + "occupancy the rule editor reports.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => sevBadge("HIGH"),
    // The model in force, not a measurement — true before the first sync.
    fromSettings: true,
    count: (ctx) => {
      const rule = ctx.boot.aarsRule;
      if (!rule || !rule.bands) return null;
      // Lower-case keys: AarsBands is {critical, high, medium, low} in src/domain/aars.ts,
      // and the bootstrap ships the rule's own object rather than a re-cased copy.
      const cuts = ["critical", "high", "medium", "low"]
        .map((lvl) => rule.bands[lvl])
        .filter((v) => typeof v === "number");
      if (cuts.length !== 4) return null;
      return {
        n: cuts.length,
        value: cuts.join(" / "),
        unit: "thresholds in force",
        route: "aars",
        params: {},
      };
    },
  },
  {
    id: "pillar-a",
    term: "Pillar A",
    aka: "toxic-combination participation",
    family: "score",
    lines: [
      "EXPERIMENTAL. Points for the combinations an asset is in, by worst severity.",
      "Capped, so no single pillar can carry the whole score.",
      "A multiplier lifts it once there is more than one issue. How that scales is itself a "
      + "choice: flat applies it once, log2 grows it with the issue count so a tenth issue "
      + "still moves the number.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "A"),
    // The model in force, not a measurement — true before the first sync.
    fromSettings: true,
    count: (ctx) => {
      const caps = ctx.boot.aarsRule && ctx.boot.aarsRule.pillarCaps;
      if (!caps || caps.toxic === undefined) return null;
      return { n: n(caps.toxic), value: "cap " + n(caps.toxic), unit: "of 100", route: "aars", params: {} };
    },
  },
  {
    id: "pillar-b",
    term: "Pillar B",
    aka: "compliance gaps",
    family: "score",
    lines: [
      "EXPERIMENTAL. Points for the framework codes an asset's failing findings violate.",
      "Priced by an ORDERED cascade, first match wins — so it is edited as a table.",
      "The cascade ends in a fallback for codes the codebook does not carry. Its quantity is "
      + "order, not magnitude.",
      "How the matched prices COMBINE is a second choice: summing them pins most assets "
      + "to the cap, because Wiz maps one underlying risk onto an OWASP LLM code and an "
      + "ASI code and an ML title, so root-sum-square is offered to soften that triple "
      + "charge and keep the pillar discriminating.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "B"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.complianceGaps === undefined) return null;
      return {
        n: n(k.complianceGaps),
        value: String(n(k.complianceGaps)),
        unit: "failing findings priced",
        route: "aars",
        params: {},
      };
    },
  },
  {
    id: "pillar-c",
    term: "Pillar C",
    aka: "data exposure",
    family: "score",
    lines: [
      "EXPERIMENTAL. Points for what classified data the asset can reach.",
      "Lifted by the 5Rs amplifier, the one number here that is not a policy choice.",
      "It is a systemic signal, so it applies to every data point regardless of asset.",
      "This pillar's ceiling is DERIVED (top tier through the amplifier) rather than set.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "C"),
    // The model in force, not a measurement — true before the first sync.
    fromSettings: true,
    count: (ctx) => {
      const caps = ctx.boot.aarsRule && ctx.boot.aarsRule.pillarCaps;
      if (!caps || caps.data === undefined) return null;
      return { n: n(caps.data), value: "cap " + n(caps.data), unit: "of 100", route: "aars", params: {} };
    },
  },
  {
    id: "pillar-d",
    term: "Pillar D",
    aka: "internet reachability",
    family: "score",
    lines: [
      "EXPERIMENTAL. Points for whether the asset is reachable from the internet.",
      "Its three states are not a severity ramp: UNDETERMINED is an epistemic state.",
      "Not a middling amount of exposure — Wiz reports it for a hosted agent because "
      + "reachability is inherited from the host underneath and was never evaluated on the "
      + "agent itself.",
      "It prices BELOW confirmed and ABOVE none, which is the honest reading of “this "
      + "needs checking”, and it must never be collapsed into either neighbour.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "D"),
    more:
      "Priced at zero in the spec rule, which scores exposure nowhere even though the " +
      "graph draws it as a first-class node. The calibrated preset turns it on.",
    // No count: the bootstrap ships pillar caps for A, B and C only, and inventing a
    // ceiling for D from the client would be a figure with no source. The page says
    // where to read it instead.
    link: { label: "Open Scoring Models", route: "aars", params: {} },
  },
  {
    id: "gap-sources",
    term: "Gap sources",
    aka: "what may raise a gap",
    family: "score",
    lines: [
      "EXPERIMENTAL. Which derivations may raise a gap at all — not what a gap COSTS.",
      "Every source is off by default, because switching one on re-prices assets.",
      "The applied table in the spec is normative for the default rule.",
      "They exist because three rows of the default cascade price codes nothing in the "
      + "live pipeline emits — not shadowed, unreachable, with the signal each needs "
      + "already in the sheets.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "±"),
    link: { label: "Open Scoring Models", route: "aars", params: {} },
  },
  {
    id: "rescore",
    term: "Recompute scores",
    aka: "not a sync",
    family: "score",
    lines: [
      "EXPERIMENTAL. Re-runs enrichment over the sheet and makes ZERO Wiz API calls.",
      "It writes no sync-history row, because a rescore is not a sync.",
      "The trend must not gain a point for a landscape that never moved.",
      "Trend points carry the rule version they were scored under, so a threshold edit "
      + "reads as a break rather than as movement.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "↻"),
    link: { label: "Open Scoring Models", route: "aars", params: {} },
  },
  {
    id: "problem-tree",
    term: "Problem tree",
    aka: "ACT · Attend · Track* · Track",
    family: "score",
    lines: [
      "EXPERIMENTAL. A 54-leaf decision tree routing one issue into one of four queues.",
      "Not a rank, a queue — which is the question the findings score does not answer.",
      "Exploitation × technical impact × system exposure × mission, first match wins over "
      + "an ordered cascade.",
      "Built so most leaves land in Track or Track* and only a documented, auditable "
      + "minority reach Act.",
      "The AARS Rules page carries its editor on a second tab.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => outcomeBadge("ACT"),
    link: { label: "Open the Problem tree tab", route: "aars", params: {} },
  },
  {
    id: "posture-tier",
    term: "Posture tier",
    aka: "a capability envelope, not a sum of problems",
    family: "score",
    lines: [
      "EXPERIMENTAL. 1 to 4, 4 worst: what an asset could DO, not what was found on it.",
      "A first-match cascade over capability × containment × consequence.",
      "An agent with zero open issues and unrestricted access to sensitive data is not a low "
      + "tier just because nothing has been found yet.",
      "The one reading on the Inventory that is not an aggregate of the findings score or of "
      + "the Problem tree's outcomes, deliberately drawn beside them rather than blended in.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => tierBadge(4),
    link: { label: "Open the Posture tab", route: "aars", params: {} },
  },
  {
    id: "posture-axes",
    term: "Capability · containment · consequence",
    aka: "the posture lattice's three axes",
    family: "score",
    lines: [
      "EXPERIMENTAL. Three axes over 27 cells: capability, containment, consequence.",
      "Identity power and data reach; what stands in the way; what a failure would cost.",
      "Capability is BROAD/SCOPED/MINIMAL, containment WEAK/PARTIAL/STRONG, consequence "
      + "SEVERE/MODERATE/LIMITED.",
      "A clear guardrail scan alone reads PARTIAL, never STRONG, until a confirmed "
      + "non-exposure corroborates it.",
      "A lethal-trifecta row (private data reach ∧ untrusted-content ingress ∧ external "
      + "egress) sits first in the default cascade and is reported UNREACHABLE rather than "
      + "fed a guess — this app has no live signal for two of its three legs.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "27"),
    link: { label: "Open the Posture tab", route: "aars", params: {} },
  },
  {
    id: "priorities-rank",
    term: "The Priorities ranking",
    aka: "issues ∪ findings, one queue",
    family: "score",
    lines: [
      "EXPERIMENTAL. Every unresolved issue and open finding, unioned and ranked on one scale.",
      "The thing neither Toxic Combinations nor Cloud Configuration alone can show.",
      "Worst-first at five levels: the Problem tree's outcome, then the asset's posture "
      + "tier, then how soon it is due, then the amplification vector (identity power, "
      + "data reach, whether language is the control channel), then id for stability.",
      "Nothing in the union is ever dropped for lacking a verdict — a row the tree never "
      + "reached still gets a place, ranked last.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "1–5"),
    link: { label: "Open Priorities", route: "problems", params: {} },
  },

  {
    id: "open-issues",
    term: "Open issues",
    aka: "the count the register ranks by",
    family: "score",
    lines: [
      "How many unresolved Wiz issues are attached to this asset, OPEN and IN_PROGRESS both.",
      "A count Wiz reported, not a grade this app computed — so it is the default sort.",
      "An issue somebody has started is still open work. It also orders the graph's "
      + "neighbours.",
      "The bar beside it splits the same issues by severity, so one stray High and a "
      + "pile of them do not draw the same mark.",
    ],
    drawnOn: ["inventory", "graph", "combos", "problems"],
    mark: () => el("span", { class: "num" }, "4"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.openIssues === undefined) return null;
      return { n: n(k.openIssues), value: String(n(k.openIssues)), unit: "open issues",
        route: "inventory", params: {} };
    },
  },
  {
    id: "cloud-findings",
    term: "Cloud findings",
    aka: "failing configuration findings, per asset",
    family: "score",
    lines: [
      "Failing cloud-configuration findings evaluated against this asset.",
      "MOST FINDINGS BELONG TO NO ASSET.",
      "The one definition of a failing control this app has: result FAIL, status OPEN, "
      + "not tombstoned.",
      "They are evaluated against a region, an access policy or a service account no "
      + "agent runs as, none of which the AI inventory holds, so this column reads lower "
      + "than the register's total by design and the inventory header says how many are "
      + "off-inventory.",
    ],
    drawnOn: ["inventory", "graph", "config"],
    mark: () => el("span", { class: "num" }, "2"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.complianceGaps === undefined) return null;
      return { n: n(k.complianceGaps), value: String(n(k.complianceGaps)),
        unit: "failing controls", route: "config", params: {} };
    },
  },
  {
    id: "posture-fails",
    term: "Compliance posture fails",
    aka: "distinct policies with a failing evaluation",
    family: "score",
    lines: [
      "How many framework policies have at least one failing evaluation, deduped by policy id.",
      "IT HAS NO PER-ASSET GRAIN AND NEVER WILL.",
      "One control mapped to six subcategories is one thing to fix, not six, and it is "
      + "counted over the rules judged AI-relevant.",
      "Wiz reports posture per framework, category, subcategory and policy, never per "
      + "resource, so there is no such thing as one asset's posture fails.",
      "It appears in page headers and in no table column.",
    ],
    drawnOn: ["inventory", "compliance"],
    mark: () => el("span", { class: "num" }, "5"),
    count: (ctx) => {
      const posture = ctx.kpis && ctx.kpis.frameworkPosture;
      if (!posture || !posture.frameworks) return null;
      return { n: n(posture.failingPolicies), value: String(n(posture.failingPolicies)),
        unit: "failing policies", route: "compliance", params: {} };
    },
  },

  {
    id: "rank-terms",
    term: "Priorities rank terms",
    aka: "rule · clock · exploitation · adjacency",
    family: "score",
    lines: [
      "The four readings the Priorities rank score blends, each edited on Settings' "
      + "Register tab and each optional.",
      "RULE: the operator's own judgement that a source rule matters this much, unset by "
      + "default.",
      "CLOCK: due-date urgency, or — once a preset turns on the fallback — a row's age "
      + "when it carries no due date.",
      "EXPLOITATION: a ladder folded up from an issue's linked findings — on the CISA "
      + "KEV catalog, an exploit exists, EPSS clears a threshold, or none observed — where "
      + "'none' reads mid-low rather than zero, because an observed absence is still a "
      + "measurement.",
      "ADJACENCY: how close the row sits to the AI estate, direct, adjacent, or UNLINKED "
      + "— read as 'no known link', never 'unrelated', because attribution edges are "
      + "sparse and an unlinked row is mostly a statement about how far the attribution "
      + "pass has reached, not a claim the row has nothing to do with AI.",
      "A term nobody could measure on a given row LEAVES THE BLEND rather than scoring "
      + "zero, so a sparsely-attributed row is never sunk to the floor for lacking a "
      + "reading the register never took.",
      "The shipped weights and every preset are a starting point for an evaluation "
      + "harness to move, not a final answer.",
    ],
    drawnOn: ["settings"],
    mark: () => el("span", { class: "pill neutral" }, "4 terms"),
    link: { label: "Open Settings → Register", route: "settings", params: { tab: "register" } },
  },
  {
    id: "rank-leads-sort",
    term: "Rank leads the Priorities order",
    aka: "rank_leads_sort",
    family: "score",
    lines: [
      "Off by default: Priorities orders by Wiz severity, then due date, then age, then id.",
      "On: the blended rank score leads instead, worst first.",
      "The iron rule applies here too, so a model's own number does not lead the register "
      + "until an evaluation harness's own figures say it should.",
      "A row the model could not score sorts last and falls through to the same four levels "
      + "beneath it, so nothing in the queue is ever dropped for lacking a rank.",
      "The toggle lives on Settings' Register tab beside the terms it would put in charge.",
    ],
    drawnOn: ["settings"],
    mark: () => el("span", { class: "pill neutral" }, "off by default"),
    link: { label: "Open Settings → Register", route: "settings", params: { tab: "register" } },
  },
  {
    // The Priorities title's own tip used to point at `priorities-rank`, which is the
    // Problem tree + posture tier cascade — EXPERIMENTAL, isolated to the Scoring Models
    // page, and not what this page has ranked by since `compareProblems` dropped both
    // (src/domain/problems.ts's own header: "THE OUTCOME AND THE POSTURE TIER USED TO LEAD
    // IT, and both are gone from here"). So the key sheet hid the very definition a visible
    // page's title pointed at whenever experimental content was off. This entry states what
    // the page actually does, is not experimental, and is drawn where it is read.
    id: "priorities-order",
    term: "The Priorities order",
    aka: "worst severity, then soonest due, then oldest",
    family: "score",
    lines: [
      "Worst-first, four levels: severity, then due date, then age, then id.",
      "Wiz's own severity leads — the loudest fact about a problem this app did not invent.",
      "Overdue counts as soonest and no deadline sorts last; age runs oldest first; id "
      + "makes two rows that agree on the first three sort the same way every time.",
      "This is the order the page has always used.",
      "Settings' \"Rank leads the Priorities order\" can put the blended rank score in "
      + "charge instead — off by default — and that entry says what changes and why the "
      + "switch exists.",
    ],
    drawnOn: ["problems"],
    mark: () => el("span", { class: "pill neutral" }, "1–4"),
  },

  // ---------------------------------------------------------------------- severity
  {
    id: "severity",
    term: "Severity",
    aka: "six levels",
    family: "severity",
    lines: [
      "Critical, High, Medium, Low, Info, Unknown.",
      "Unknown is a local normalisation bucket, never a value the API returns.",
      "Every severity on every screen is a coloured DOT plus the level WORD — the red, "
      + "orange and amber sit close enough together that the redundant cue is "
      + "load-bearing, not decorative.",
    ],
    drawnOn: ["combos", "inventory", "graph", "problems", "config", "compliance"],
    mark: () => sevBadge("CRITICAL"),
    count: (ctx) => {
      const c = ctx.boot.counts;
      if (!c || c.openIssues === undefined) return null;
      return {
        n: n(c.openIssues),
        value: String(n(c.openIssues)),
        unit: "open " + pluralize(n(c.openIssues), "issue"),
        route: "combos",
        params: {},
      };
    },
  },
  {
    id: "adjusted-severity",
    term: "Adjusted severity",
    aka: "versus native",
    family: "severity",
    lines: [
      "What the 5Rs amplifier re-rates an issue to when the asset fails a data control.",
      "The NATIVE severity Wiz returned sits beside it, never instead of it.",
      "So an adjusted figure can always be traced back to what the scanner actually said.",
    ],
    drawnOn: ["combos", "inventory"],
    mark: () => sevBadge("MEDIUM"),
    count: (ctx) => {
      const t = ctx.digest && ctx.digest.totals;
      if (!t || t.reRated === undefined) return null;
      return {
        n: n(t.reRated),
        value: n(t.reRated) + " of " + n(t.totalOpen),
        unit: "open issues re-rated",
        route: "combos",
        params: {},
      };
    },
  },
  {
    id: "priority",
    term: "Priority",
    aka: "the problem tree's outcome, not a severity",
    family: "severity",
    lines: [
      "EXPERIMENTAL. The Problem tree's queue: Act, Attend, Track* or Track.",
      "A SEPARATE reading from the severity beside it, never a restatement of it.",
      "An issue can be Critical and still read Track if nothing here confirms it is actually "
      + "exploitable, reachable or mission-relevant.",
      "A coverage gap in the axes that would confirm that reads Track* rather than being "
      + "silently dropped. A dash means undecided — a resolved row, or one the rule never "
      + "reached.",
      "EXPERIMENTAL, and confined to the Scoring Models page: it is computed and stored "
      + "on every sync, but nothing else in this app ranks, filters or sorts by it.",
    ],
    drawnOn: ["aars"],
    mark: () => outcomeBadge("TRACK_STAR"),
    link: { label: "Open the Problem tree tab", route: "aars", params: {} },
  },
  {
    id: "two-token",
    term: "Why the label is darker than the dot",
    aka: "the two-token rule",
    family: "severity",
    lines: [
      "Each level carries two colours: a vivid FILL for marks, a darker TEXT for labels.",
      "Setting a label in the fill colour would fail contrast, so the split must not collapse.",
      "The fill is tuned to read as a graphical mark on white; the text token is tuned "
      + "to clear 4.5:1 on the pale tint behind it.",
      "Setting a label in the fill colour would fail contrast, so the split is "
      + "deliberate and must not be collapsed.",
    ],
    drawnOn: ["inventory", "combos", "graph", "problems"],
    mark: () => el("span", { class: "help-twotoken", "aria-hidden": "true" }),
  },

  // ------------------------------------------------------------- coverage and freshness
  {
    id: "coverage-state",
    term: "Coverage state",
    aka: "● Reporting · ◐ Partial · ○ Not scanned",
    family: "coverage",
    lines: [
      "How well one Wiz scan area is backed by this deployment.",
      "Reporting: a figure. Partial: stored, not totalled. Not scanned: no query runs.",
      "The state is DERIVED wherever a resolver can decide it, so a missing figure steps "
      + "back to Partial on its own rather than asserting a number it cannot compute.",
    ],
    drawnOn: ["scans", "compliance", "inventory"],
    mark: () => glyph("●", "ok"),
    count: (ctx) => {
      const t = ctx.tally;
      if (!t) return null;
      const total = n(t.live) + n(t.partial) + n(t.unscanned);
      if (!total) return null;
      return {
        n: n(t.live),
        value: n(t.live) + " of " + total,
        unit: "areas reporting",
        route: "scans",
        params: {},
      };
    },
  },
  {
    id: "dry-run",
    term: "Dry-run",
    aka: "the bundled sample landscape",
    family: "coverage",
    lines: [
      "With no Wiz credentials, “Sync now” persists a bundled sample instead of a tenant.",
      "Every page says which mode produced the figures it is showing.",
      "A number from a sample and a number from your landscape are not the same kind of thing.",
    ],
    drawnOn: ["settings", "data"],
    mark: () => statusPill("neutral", "Dry-run"),
    link: { label: "Check the connection", route: "settings", params: { tab: "system" } },
  },
  {
    id: "sync",
    term: "Sync",
    aka: "and its commit record",
    family: "coverage",
    lines: [
      "One pass of the Wiz query battery, normalised and enriched once, written wholesale.",
      "The history row is written LAST and is the commit record: no row, no sync.",
      "It runs on demand and daily at 05:00 Europe/Paris, and resumes itself if one "
      + "execution runs long.",
    ],
    drawnOn: ["data", "problems", "scans"],
    mark: () => el("span", { class: "pill neutral" }, "↻"),
    count: (ctx) => {
      const s = ctx.boot.latestSync;
      if (!s || s.node_count === undefined) return null;
      return {
        n: n(s.node_count),
        value: String(n(s.node_count)),
        unit: "records in the last sync",
        route: "data",
        params: {},
      };
    },
  },

  {
    id: "register-scope",
    term: "Register scope",
    aka: "which Wiz risk categories the issue register collects",
    family: "coverage",
    lines: [
      "Which Wiz risk categories the register collects, set on Settings' Register tab.",
      "One category is mandatory: it is what makes this an AI register at all.",
      "Every other candidate category is opt-in.",
      "Every issue-shaped figure this app publishes (Priorities, AARS pillar A, Toxic "
      + "Combinations, the register itself) counts only the rows one frameworkCategory "
      + "filter returned, and nothing on an issue records which category fetched it, so a "
      + "row is only ever counted under the categories a sync had selected AT THE TIME IT "
      + "RAN.",
      "Widening the scope changes what every one of those figures counts, not how many "
      + "rows it holds — and the stored register keeps counting the OLD categories until "
      + "the next sync applies the new one.",
    ],
    // Also on the issue sheet's Lifecycle section: the two sighting dates there were both
    // read under this scope, and the row says which one.
    drawnOn: ["settings", "scans", "problems"],
    mark: () => statusPill("neutral", "Scope"),
    link: { label: "Open Settings → Register", route: "settings", params: { tab: "register" } },
  },

  // ------------------------------------------------------------------ the issue lifecycle
  {
    id: "first-seen",
    term: "First seen by this register",
    aka: "the ledger's own birth date, not Wiz's",
    family: "lifecycle",
    lines: [
      "The first sync that returned this issue.",
      "This register's OWN observation, deliberately not Wiz's created date.",
      "An issue can have existed in the tenant for a year before the first sync here looked, "
      + "and every lifecycle figure on this page measures from the date a sync recorded.",
      "Nothing backfills it — a row that predates the ledger has no earlier sighting to "
      + "claim, and inventing one would be a measurement nobody took.",
    ],
    drawnOn: ["combos", "inventory", "config", "problems"],
    mark: () => statusPill("neutral", "First seen"),
  },
  {
    id: "movement",
    term: "Movement",
    aka: "how the open backlog changed between two syncs",
    family: "lifecycle",
    lines: [
      "The open backlog now against what it was at an earlier sync.",
      "It needs TWO syncs before it can say anything, and seven days for the week-ago row.",
      "Replayed from the transition counts each sync recorded, never from two independently "
      + "stored totals. Until then the page says so rather than showing a difference of "
      + "nothing.",
      "Findings are not counted here: they never enter the lifecycle ledger, so no sync "
      + "has ever recorded one arriving or leaving.",
    ],
    drawnOn: ["data", "problems"],
    mark: () => statusPill("neutral", "±"),
  },
  {
    id: "disappearance",
    term: "Gone by",
    aka: "a departure dated by absence",
    family: "lifecycle",
    lines: [
      "Wiz never says an issue was fixed, so a departure is dated by the first sync to miss it.",
      "An UPPER BOUND whose error is the interval between syncs.",
      "An issue closed the morning after a Monday sync is dated Tuesday.",
      "It is also the reason a longer gap between syncs makes every departure look later "
      + "than it was, rather than making fewer of them.",
    ],
    // Also on the issue sheet's Lifecycle section, which is where a reader meets one
    // bounded date rather than a column of them.
    drawnOn: ["data", "combos", "inventory"],
    mark: () => statusPill("neutral", "Gone"),
  },
  {
    id: "episode",
    term: "Episode",
    aka: "an issue that left the register and came back",
    family: "lifecycle",
    lines: [
      "An issue that disappeared and was seen again starts a new episode.",
      "The count tells a genuine re-detection apart from one long open row.",
      "The register does NOT record when each episode began, only how many there have been, "
      + "so the gap between one and the next cannot be priced and no clock spans two.",
    ],
    // `data` was dropped here in P1.4: the sync-history "Returned" column now points at the
    // "returned" entry (a per-sync count) instead, so Episode (the per-issue count) is
    // reachable from these two routes' issue sheets only.
    drawnOn: ["combos", "inventory"],
    mark: () => statusPill("neutral", "↩"),
  },
  {
    id: "half-life",
    term: "Issue half-life",
    aka: "how long an issue survives in this register",
    family: "lifecycle",
    lines: [
      "The point by which half of every issue this register recorded had left it.",
      "A survival estimate, not an average of the ones that closed.",
      "Measured from the sync that first saw the row to the sync that first stopped seeing it.",
      "An average would drop every issue still open, and those are usually the slow ones the "
      + "figure exists to catch.",
      "A shorter half-life means the register is being worked through rather than merely "
      + "counted.",
    ],
    drawnOn: ["problems"],
    mark: () => statusPill("neutral", "½"),
  },
  {
    id: "censoring",
    term: "Still open, still counted",
    aka: "right-censoring",
    family: "lifecycle",
    lines: [
      "An issue still in the register has no departure date, and dropping it is the defect.",
      "Those are the rows that have survived longest, so each stays in as a partial one.",
      "It is known to have lasted at least the gap between its first and last sighting, and "
      + "holds the estimate up for exactly that span before dropping out.",
      "That span runs to the LAST SIGHTING, not to today, which is why the figure only "
      + "moves when a sync moves it and not merely because the page was opened later.",
    ],
    drawnOn: ["problems"],
    mark: () => statusPill("neutral", "+"),
  },
  {
    id: "lower-bound",
    term: "At least N days",
    aka: "the half-life the register has not reached yet",
    family: "lifecycle",
    lines: [
      "On a young register the estimate never falls to half, so there is no half-life.",
      "The page publishes the longest lifetime observed and says it is at least that.",
      "Rather than print a centre nobody measured.",
      "The number will grow with the register until enough issues have left for the "
      + "curve to cross, at which point it is replaced by the measured figure rather than "
      + "added to it.",
    ],
    drawnOn: ["problems"],
    mark: () => statusPill("neutral", "≥"),
  },
  {
    id: "returned",
    term: "Returned",
    aka: "how many came back in this one sync",
    family: "lifecycle",
    lines: [
      "How many issues this sync saw again after an earlier one stopped seeing them.",
      "A COUNT FOR THE SYNC, not a per-issue reading — the Gone column's mirror.",
      "An issue that returns twice adds one to the tally on each of the two syncs that caught "
      + "it, and this records when neither absence began.",
      "See Episode for the per-issue number this same event bumps on the row itself.",
    ],
    drawnOn: ["data"],
    mark: () => statusPill("neutral", "Returned"),
  },
  {
    id: "rail-status",
    term: "The rail status dot",
    aka: "one dot, one sentence",
    family: "lifecycle",
    lines: [
      "What the dot at the foot of the nav rail is saying, ranked by how actionable it is.",
      "A register nobody has synced is UNMEASURED, not stale, so it outranks stale.",
      "Running beats just-failed, beats never-synced, beats an unreadable sync date, beats "
      + "ran-too-long-ago, beats current.",
      "Dry-run decorates whichever of those states fired as an extra sentence — it never "
      + "replaces the reading, because a dry-run register still has its own real sync "
      + "history to be stale or current about.",
    ],
    drawnOn: ["data"],
    mark: () => statusPill("neutral", "●"),
  },
  {
    id: "stale",
    term: "Stale",
    aka: "more than two days since the last sync",
    family: "lifecycle",
    lines: [
      "The latest sync finished more than two days ago.",
      "Short on purpose: this register is meant to run daily.",
      "Two missed days already means the page is answering yesterday's question, and the dot "
      + "says so before a reader has to notice the date themselves.",
      "A register that has never synced at all is never called stale — it is unmeasured, "
      + "which the rail status dot ranks as the more urgent of the two.",
    ],
    drawnOn: ["data"],
    mark: () => statusPill("warn", "Stale"),
  },

  // --------------------------------------------------------------- framework vocabularies
  {
    id: "gap-shapes",
    term: "● exact · ◧ family · ◇ unknown",
    aka: "how a pricing rule matches",
    family: "framework",
    lines: [
      "On the AARS Rules cascade, each row says in words what it matches.",
      "A filled dot is one named entry.",
      "A half-filled square is a prefix covering a whole vocabulary, and the row states "
      + "how many codes it catches and how many are priced above it.",
      "A diamond is a code the codebook does not carry — a tenant-specific finding id, "
      + "priced by the fallback.",
    ],
    drawnOn: ["aars"],
    mark: () => glyph("◧"),
    link: { label: "Open the cascade", route: "aars", params: {} },
  },
];

// The five real vocabularies, indexed from codebook.js so their edition and their standing
// are stated once. A family prefix is a matching rule rather than a vocabulary, so the
// pseudo-group is skipped — resolveGap() in codebook.js makes the same distinction.
for (const family of CODEBOOK) {
  if (family.group === FAMILY_GROUP) continue;
  ENTRIES.push({
    id: "vocab-" + family.group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    term: family.group,
    aka: family.vintage,
    family: "framework",
    lines: asLines(family.standing),
    drawnOn: ["aars", "inventory"],
    mark: () => el("span", { class: "pill neutral" }, String(family.entries.length)),
    codes: family.entries.map((e) => e[0]),
    link: { label: "Browse the codes", route: "aars", params: {} },
  });
}

// Where each measure's number is actually drawn — hand-kept because a measure's
// `reportingFormat` in the TS module is prose, not a route list, and this is the one place
// that has to resolve to a real page for the "routes only to pages that exist" test.
const MEASURE_ROUTES = {
  // Every AARS row is ["aars"] now, and that is the point rather than an oversight: these
  // measures are drawn where the model is edited and nowhere else. `aars-percentile` is
  // absent because the measure itself is.
  "aars-score": ["aars"],
  "aars-band": ["aars"],
  "aars-distinct-scores": ["aars"],
  "aars-tie-rate": ["aars"],
  "aars-effective-cardinality": ["aars"],
  "aars-pillar-saturation": ["aars"],
  "problem-outcome-distribution": ["aars"],
  "action-concentration-ratio": ["problems"],
  "problem-axis-unknown-rate": ["aars"],
  "posture-tier-distribution": ["aars"],
  "issue-sla-tally": ["combos", "problems"],
  "issue-half-life": ["problems"],
  "compliance-gaps": ["inventory", "config"],
  "compliance-gaps-unlinked": ["inventory"],
  "guardrail-coverage-pct": ["scans"],
  "toxic-combo-patterns-active": ["combos"],
  "framework-average-posture": ["compliance"],
  "landscape-reach-stages": ["scans", "inventory"],
  "landscape-impact-tagged": ["scans"],
  "sync-step-yield": ["scans"],
  "landscape-reach-edge-census": ["scans"],
  "landscape-reach-axis-known-rate": ["scans"],
};

// One entry per measureSpec.ts record — pure documentation, no `count`, so it renders as a
// destination rather than a figure (the same "no count at all is a convention" rule this
// file's own header states). `id` is prefixed so it can never collide with a hand-authored
// entry above, mirroring the "vocab-" prefix the framework-codebook loop below already uses.
for (const m of MEASURE_ENTRIES) {
  const routes = MEASURE_ROUTES[m.id] || [];
  ENTRIES.push({
    id: "measure-" + m.id,
    term: m.measure,
    aka: m.type + " · " + m.measurementMethod,
    family: "measures",
    lines: [...asLines(m.goal), ...asLines(m.formula)],
    more: "Reads " + m.dataSource + ". Surfaced on: " + m.reportingFormat,
    drawnOn: routes,
    mark: () => el("span", { class: "pill neutral" }, m.measurementMethod === "Subjective" ? "S" : "O"),
    link: routes.length ? { label: "Open " + (ROUTE_TITLES[routes[0]] || routes[0]), route: routes[0], params: {} } : undefined,
  });
}

// ---------------------------------------------------------------------------- resolvers

/**
 * One entry resolved against a payload: the record plus the count it earned.
 *
 * A resolver that throws is a resolver that cannot answer, which is exactly the
 * "not counted here" state — the same call scanContent.js's safeFigure() makes.
 */
export function resolveEntry(entry, ctx) {
  if (!entry.count) return { ...entry, resolved: null };
  // Before the first sync the landscape is unknown, not empty. The KPI payload still answers
  // — with zeros, off an empty ledger — so without this guard the page would report "0 AI
  // assets reach classified data" for a landscape nobody has looked at yet, and the coverage
  // tally would count areas as reporting because their resolvers happened to return a 0.
  // Wiz Scans refuses to draw at all in this state; this is the same refusal, per entry.
  if (!entry.fromSettings && !(ctx.boot && ctx.boot.latestSync)) {
    return { ...entry, resolved: null };
  }
  let resolved = null;
  try {
    resolved = entry.count(ctx) || null;
  } catch (e) {
    resolved = null;
  }
  return { ...entry, resolved };
}

export function resolveEntries(ctx, entries = ENTRIES) {
  return entries.map((entry) => resolveEntry(entry, ctx));
}

/**
 * The book as it stands for a reader who cannot reach every page.
 *
 * One rule, derived rather than hand-kept: A DEFINITION DRAWN ONLY WHERE THE READER CANNOT
 * GO HAS NOWHERE TO BE READ, so it is dropped. That is the whole gate — no per-entry flag to
 * remember, and it stays right when a fourteenth verdict term lands on the Scoring Models
 * page. It covers three groups at once with `["aars"]` hidden: the isolated verdict entries
 * (drawnOn `["aars"]`), the cascade's gap shapes, and the `measure-*` records whose
 * MEASURE_ROUTES is that page alone.
 *
 * A term drawn in BOTH places survives — the codebook vocabularies are read on AI Inventory
 * as much as on the cascade — but loses the route it cannot offer, from its "Drawn on" line
 * and from its link. Half a destination list is honest; a chip naming a page that is not in
 * the rail is not.
 *
 * An entry with no `drawnOn` at all is a term with no home page, not a hidden one, and passes
 * through untouched.
 */
export function visibleEntries(entries, hiddenRoutes) {
  const hidden = new Set(hiddenRoutes || []);
  if (!hidden.size) return entries;
  const out = [];
  for (const entry of entries) {
    const drawn = entry.drawnOn || [];
    const left = drawn.filter((route) => !hidden.has(route));
    if (drawn.length && !left.length) continue;
    const linkGone = !!entry.link && hidden.has(entry.link.route);
    // An entry with nothing to strip is passed through BY IDENTITY, not copied. The page
    // resolves this list and then reads it again through groupByFamily, and `mark`/`count`
    // are functions the rest of the book is pinned against — a gate that quietly reboxed
    // every entry would make "is this the same term?" untestable everywhere downstream.
    if (drawn.length === left.length && !linkGone) {
      out.push(entry);
      continue;
    }
    const next = { ...entry, drawnOn: left };
    if (linkGone) delete next.link;
    out.push(next);
  }
  return out;
}

/**
 * How the whole book currently answers, in the four states its count column has.
 *
 * The header's hero and its strip read this; the count cell reads each entry. The two
 * MUST agree, so the branches below are the same branches, in the same order, that
 * countCell() takes in pages/help.js — a term is a convention (no `count` at all, so the
 * cell shows a destination), or its resolver could not answer, or it answered zero, or it
 * answered a figure. Re-deriving this in the page would be a second implementation of the
 * one question the page exists to answer, and the first sync where they disagreed would
 * be a page arguing with itself.
 *
 * Deliberately a SEPARATE function rather than something folded into resolveEntry: the
 * `fromSettings` entries are pinned by a Function.prototype.toString() check in
 * helpContent.test.js that asserts their `count` bodies never touch ctx.kpis / ctx.digest
 * / ctx.tally, and wrapping or generating those resolvers would defeat it silently.
 */
export function lexTally(resolved) {
  const t = { figure: 0, zero: 0, uncounted: 0, convention: 0 };
  for (const e of resolved) {
    if (!e.count) t.convention += 1;
    else if (!e.resolved) t.uncounted += 1;
    else if (!e.resolved.n) t.zero += 1;
    else t.figure += 1;
  }
  return t;
}

/** Entries in family order, grouped under their heading. Empty families are dropped. */
export function groupByFamily(resolved) {
  return FAMILIES
    .map((family) => ({
      family,
      entries: resolved.filter((e) => e.family === family.id),
    }))
    .filter((g) => g.entries.length > 0);
}

/** The entry a `?term=` deep link names, or null. */
export function findEntry(id) {
  const want = String(id || "").trim().toLowerCase();
  if (!want) return null;
  return ENTRIES.find((e) => e.id === want) || null;
}
