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
import { CATEGORY_LABELS, CATEGORY_ORDER, kindIconSvg } from "./icons.js";
import {
  aarsChip, aarsPercentileMark, el, outcomeBadge, pluralize, scoreChip, sevBadge, statusPill,
  tierBadge,
} from "./ui.js";

/** The six headings, in reading order. Six headings and find-in-page beat a search box. */
export const FAMILIES = [
  { id: "graph", title: "Reading the graph" },
  { id: "signal", title: "Risk signals" },
  { id: "score", title: "The score" },
  { id: "severity", title: "Severity" },
  { id: "coverage", title: "Coverage and freshness" },
  { id: "framework", title: "Framework vocabularies" },
  // Phase 8: what a published number IS — its goal, formula, source and whether it was
  // measured or judged. See src/domain/measureSpec.ts for the authoritative record; this
  // family renders measureContent.js's mirror of it.
  { id: "measures", title: "Measure specifications" },
];

/**
 * Route titles for the "drawn on" line.
 *
 * Deliberately NOT imported from app.js: app.js reads `document` at module scope, so
 * importing it here would drag the whole SPA into a unit test and into this module's
 * import graph. helpContent.test.js asserts these keys against the PAGES object in
 * app.js by reading its source, which keeps the two in step without the cycle.
 */
export const ROUTE_TITLES = {
  graph: "Security Graph",
  inventory: "AI Inventory",
  problems: "Priorities",
  combos: "Toxic Combinations",
  config: "Cloud Configuration",
  aars: "AARS Rules",
  scans: "Wiz Scans",
  data: "Data",
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
    blurb:
      "Every node says what it is three times over: a pale category tint, a saturated " +
      "kind icon, and the kind spelled out underneath. The tint is the CATEGORY — five of " +
      "them — and the icon and the word are the KIND. Every kind draws its own mark, so a " +
      "glyph names one thing and one thing only. Colour is still never the only cue: the " +
      "icon rides beside the label, never instead of it.",
    drawnOn: ["graph", "inventory"],
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
    blurb:
      "A multi-condition pattern that only fires when risks COMBINE — a privileged agent " +
      "that can also reach classified data is not two findings, it is one path. Members " +
      "carry a crimson halo and a TC badge on the graph.",
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
    blurb:
      "Crimson is this app's identity colour. On the graph it marks toxic-combination " +
      "membership and nothing else — it is always paired with the TC badge and an " +
      "aria-label suffix, so it never carries meaning by colour alone. Severity stays on " +
      "the dot-and-word chip, in the shared palette.",
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
    blurb:
      "Wiz was asked for a relationship and found none. Rather than leave the gap off the " +
      "picture, the edge is drawn dashed and labelled with what is missing. The guardrail " +
      "gap is the one this app raises: a PROTECTED_BY edge that does not exist.",
    drawnOn: ["graph"],
    mark: () => el("span", { class: "help-dash", "aria-hidden": "true" }),
    link: { label: "Open the graph", route: "graph", params: {} },
  },
  {
    id: "risk-as-node",
    term: "Risk is a node",
    aka: "not a flag on a card",
    family: "graph",
    blurb:
      "Sensitive-data reach, internet exposure, excessive rights and the guardrail gap are " +
      "drawn as nodes hanging off the asset they describe, on the path — because that is " +
      "what an attack path is. They are derived when the graph is READ and never stored, " +
      "so an already-synced graph gains them without a re-sync.",
    drawnOn: ["graph"],
    mark: () => kindMark("EXCESSIVE_ACCESS_FINDING"),
    link: { label: "Open the graph", route: "graph", params: {} },
  },
  {
    id: "graph-query",
    term: "The query builder",
    aka: "FIND … THAT …",
    family: "graph",
    blurb:
      "A query reads FIND <entity> THAT <relationship> <entity>, and each further step walks " +
      "one more hop along the graph. In the table a ROW IS A PATH, not an asset: an agent " +
      "bound to two service accounts is two rows carrying the same name, and every shown step " +
      "adds a group of columns rather than a column. The eye keeps a step in the traversal " +
      "but drops its columns, an optional step keeps rows that would otherwise be dropped " +
      "with the group left empty, and NOT asserts the relationship is absent — which is how " +
      "you ask for an agent with no guardrail. The pickers only offer relationships this " +
      "tenant's graph actually holds, so a query that can match nothing is hard to build.",
    drawnOn: ["graph"],
    mark: () => el("span", { class: "pill neutral" }, "FIND"),
    link: { label: "Open the graph", route: "graph", params: {} },
  },
  {
    id: "depth-budget",
    term: "Depth and node budget",
    aka: "what bounds a view",
    family: "graph",
    blurb:
      "Depth bounds how far the traversal walks from its starting points. The node budget " +
      "is a hard ceiling on one view, counting the collapse stubs it also draws. Both keep " +
      "the server payload light; a view that hits the ceiling says so and offers Load more, " +
      "which widens that one view without changing the default.",
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
        params: {},
      };
    },
  },
  {
    id: "summary-stub",
    term: "The collapse stub",
    aka: "“+N more”",
    family: "graph",
    blurb:
      "A high-fanout neighbour set collapsed into one pill, which expands on demand. The " +
      "stub counts against the node budget like any other node, which is why a capped view " +
      "still shows them: the budget buys paths, not a field of disconnected dots.",
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
    blurb:
      "No guardrail is attached to this agent or model. Wiz tests the PROTECTED_BY " +
      "relationship on every agent, and an absent edge raises this node. It is the " +
      "strongest single amplifier in the toxic combinations.",
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
    blurb:
      "Wiz's DSPM verdict on one bucket or database — what class of sensitive data is in " +
      "it, and how severe. Drawn as one node per datastore carrying the count, because a " +
      "store with two hundred findings is one fact about that store, not two hundred " +
      "nodes. These are what turn “this agent can reach sensitive data” into a path you " +
      "can walk: agent → execution identity → datastore → findings.",
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
    blurb:
      "The FALLBACK marker: Wiz says this asset can reach data classified as PII, PHI or " +
      "PCI, but no path to the store could be walked — the tenant rejected the traversal, " +
      "or the grant is expressed some way it does not follow. Where the path IS walkable " +
      "the chain is drawn instead and this marker is suppressed, so one asset never tells " +
      "the same story twice. Its mark is the data-finding gem, left unfinished.",
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
    blurb:
      "The asset or the host underneath it is reachable from the internet. Managed agents " +
      "report it directly; hosted agents inherit it from the VM or service beneath them, " +
      "which Wiz reports as UNDETERMINED until that host is checked. Undetermined is " +
      "counted separately and never folded into “not exposed”.",
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
    blurb:
      "The identity an AI asset runs as holds admin or high-privilege permissions. The " +
      "individual excessive-access and lateral-movement findings on those service accounts " +
      "are synced and drawn beside the identity, but nothing totals them, so the figure " +
      "here counts assets and identities carrying the flag.",
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
    blurb:
      "An identity whose purpose is to execute agent work rather than to represent a " +
      "person. It is the join between an agent and everything that agent can reach, which " +
      "is why over-broad rights on one turn any hijack into unauthorised action.",
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
    blurb:
      "One number per asset, 0 to 100, summed across four pillars and clamped. It is this " +
      "app's own score, not a Wiz field: it prices what the sync collected, so the model " +
      "that produces it is editable and its inputs are persisted beside every score. It " +
      "counts what has already been FOUND — issues, compliance gaps, data exposure — which " +
      "is why it is not called a risk score; forward-looking consequence is the posture " +
      "tier's job. Surfaces show it as a percentile of the scored landscape, because the raw " +
      "number is only meaningful against the other assets.",
    drawnOn: ["inventory", "graph", "aars"],
    mark: () => scoreChip(78, 92, "HIGH"),
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
    id: "aars-percentile",
    term: "AARS percentile",
    aka: "rank within this landscape",
    family: "score",
    blurb:
      "Where this asset's score falls among every OTHER scored asset in the landscape, 0 to " +
      "100, using midrank so a tied score is shared rather than arbitrarily broken. It is " +
      "the lead read for one asset on the Inventory table and the asset sheet — a rank " +
      "survives the population shift that an absolute band does not, and it MOVES whenever " +
      "the landscape does, even when this asset's own score has not changed at all.",
    drawnOn: ["inventory"],
    mark: () => aarsPercentileMark(92, 78),
  },
  {
    id: "aars-band",
    term: "Findings score level",
    aka: "context beside a score, not a verdict",
    family: "score",
    blurb:
      "The level a score falls into. Bands are re-derived from the stored score on every " +
      "read, so moving a threshold applies at once and retroactively — no re-sync, no " +
      "rescore. Changing the POINT model is the other thing entirely, and strands the " +
      "stored scores until they are recomputed. A level is not a queue: on this landscape the " +
      "top one holds most of the scored assets and two hold none, so it is drawn tinted " +
      "only on the AARS Rules page, where the thresholds themselves are the subject, and " +
      "plain everywhere else. Its two honest readings are the distribution the trend " +
      "charts over time and the occupancy the rule editor reports.",
    drawnOn: ["aars", "inventory"],
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
    blurb:
      "Points for the combinations an asset is in, priced by the worst severity among " +
      "them and lifted by a multiplier once there is more than one issue. How that " +
      "multiplier scales is itself a choice: flat applies it once, log2 grows it with the " +
      "issue count so a tenth issue still moves the number. Capped, so no single pillar " +
      "can carry the whole score.",
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
    blurb:
      "Points for the framework codes an asset's failing findings violate, priced by an " +
      "ORDERED cascade — first match wins, ending in a fallback for codes the codebook " +
      "does not carry. Its quantity is order, not magnitude, which is why that pillar is " +
      "the one edited as a table. How the matched prices COMBINE is a second choice: " +
      "summing them pins most assets to the cap, because Wiz maps one underlying risk " +
      "onto an OWASP LLM code and an ASI code and an ML title, so root-sum-square is " +
      "offered to soften that triple charge and keep the pillar discriminating.",
    drawnOn: ["aars", "inventory"],
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
    blurb:
      "Points for what classified data the asset can reach, lifted by the 5Rs amplifier. " +
      "The amplifier is the one number on the model that is not a policy choice — it is a " +
      "systemic signal, so it applies to every data point regardless of asset. This " +
      "pillar's ceiling is DERIVED (top tier through the amplifier) rather than set.",
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
    blurb:
      "Points for whether the asset is reachable from the internet. Its three states are " +
      "not a severity ramp: UNDETERMINED is an epistemic state, not a middling amount of " +
      "exposure — Wiz reports it for a hosted agent because reachability is inherited " +
      "from the host underneath and was never evaluated on the agent itself. It prices " +
      "BELOW confirmed and ABOVE none, which is the honest reading of “this needs " +
      "checking”, and it must never be collapsed into either neighbour.",
    drawnOn: ["aars", "graph"],
    mark: () => el("span", { class: "pill neutral" }, "D"),
    more:
      "Priced at zero in the spec rule, which scores exposure nowhere even though the " +
      "graph draws it as a first-class node. The calibrated preset turns it on.",
    // No count: the bootstrap ships pillar caps for A, B and C only, and inventing a
    // ceiling for D from the client would be a figure with no source. The page says
    // where to read it instead.
    link: { label: "Open AARS Rules", route: "aars", params: {} },
  },
  {
    id: "gap-sources",
    term: "Gap sources",
    aka: "what may raise a gap",
    family: "score",
    blurb:
      "Separate from what a gap COSTS: which derivations are allowed to raise one at all. " +
      "Every source is off by default, because switching one on re-prices assets and the " +
      "applied table in the spec is normative for the default rule. They exist because " +
      "three rows of the default cascade price codes nothing in the live pipeline emits — " +
      "not shadowed, unreachable, with the signal each needs already in the sheets.",
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "±"),
    link: { label: "Open AARS Rules", route: "aars", params: {} },
  },
  {
    id: "rescore",
    term: "Recompute scores",
    aka: "not a sync",
    family: "score",
    blurb:
      "Re-runs the enrichment over data already in the sheet and makes ZERO Wiz API calls. " +
      "It writes no sync-history row, because a rescore is not a sync and the trend must " +
      "not gain a point for a landscape that never moved. Trend points carry the rule version " +
      "they were scored under, so a threshold edit reads as a break rather than as movement.",
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "↻"),
    link: { label: "Open AARS Rules", route: "aars", params: {} },
  },
  {
    id: "problem-tree",
    term: "Problem tree",
    aka: "ACT · Attend · Track* · Track",
    family: "score",
    blurb:
      "A 54-leaf decision tree — exploitation × technical impact × system exposure × " +
      "mission — that routes one issue or finding into one of four queues, first match " +
      "wins over an ordered cascade. It answers a different question than the findings " +
      "score: not a " +
      "rank, a queue, and it is built so most leaves land in Track or Track* and only a " +
      "documented, auditable minority reach Act. The AARS Rules page carries its editor on " +
      "a second tab.",
    drawnOn: ["aars", "problems"],
    mark: () => outcomeBadge("ACT"),
    link: { label: "Open the Problem tree tab", route: "aars", params: {} },
  },
  {
    id: "posture-tier",
    term: "Posture tier",
    aka: "a capability envelope, not a sum of problems",
    family: "score",
    blurb:
      "1 to 4, 4 worst — a first-match cascade over capability × containment × " +
      "consequence, the same mechanism the Problem tree uses, aimed at a different " +
      "question: not what has been FOUND on an asset, but what it could DO and what " +
      "stands in its way. An agent with zero open issues and unrestricted access to " +
      "sensitive data is not a low tier just because nothing has been found yet — this is " +
      "the one reading on the Inventory that is not an aggregate of the findings score or " +
      "of the " +
      "Problem tree's outcomes, deliberately drawn beside them rather than blended in.",
    drawnOn: ["aars", "inventory", "problems"],
    mark: () => tierBadge(4),
    link: { label: "Open the Posture tab", route: "aars", params: {} },
  },
  {
    id: "posture-axes",
    term: "Capability · containment · consequence",
    aka: "the posture lattice's three axes",
    family: "score",
    blurb:
      "Capability: identity power and data reach (BROAD/SCOPED/MINIMAL). Containment: how " +
      "much stands between the asset and the outside world (WEAK/PARTIAL/STRONG) — a clear " +
      "guardrail scan alone reads PARTIAL, never STRONG, until a confirmed non-exposure " +
      "corroborates it. Consequence: what a realized failure would cost " +
      "(SEVERE/MODERATE/LIMITED). 27 cells; a lethal-trifecta row (private data reach ∧ " +
      "untrusted-content ingress ∧ external egress) sits first in the default cascade and " +
      "is reported UNREACHABLE rather than fed a guess — this app has no live signal for " +
      "two of its three legs.",
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "27"),
    link: { label: "Open the Posture tab", route: "aars", params: {} },
  },
  {
    id: "priorities-rank",
    term: "The Priorities ranking",
    aka: "issues ∪ findings, one queue",
    family: "score",
    blurb:
      "Every unresolved issue and every open configuration finding, unioned into one list " +
      "and ranked on one scale — the thing neither Toxic Combinations (one pattern) nor " +
      "Cloud Configuration (findings only) can show. Worst-first at five levels: the " +
      "Problem tree's outcome, then the asset's posture tier, then how soon it is due, " +
      "then the amplification vector (identity power, data reach, whether language is the " +
      "control channel), then id for stability. Nothing in the union is ever dropped for " +
      "lacking a verdict — a row the tree never reached still gets a place, ranked last.",
    drawnOn: ["problems"],
    mark: () => el("span", { class: "pill neutral" }, "1–5"),
    link: { label: "Open Priorities", route: "problems", params: {} },
  },

  // ---------------------------------------------------------------------- severity
  {
    id: "severity",
    term: "Severity",
    aka: "six levels",
    family: "severity",
    blurb:
      "Critical, High, Medium, Low, Info, Unknown. Unknown is a local normalisation " +
      "bucket, never a value the API returns. Every severity on every screen is a coloured " +
      "DOT plus the level WORD — the red, orange and amber sit close enough together that " +
      "the redundant cue is load-bearing, not decorative.",
    drawnOn: ["combos", "inventory", "graph", "problems"],
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
    blurb:
      "What the 5Rs amplifier re-rates an issue to when the asset fails a data-security " +
      "control. The severity Wiz returned — the NATIVE one — sits beside it, never instead " +
      "of it, so an adjusted figure can always be traced back to what the scanner actually " +
      "said.",
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
    blurb:
      "The Problem tree's queue for this issue or finding — Act, Attend, Track* or Track. " +
      "It is a SEPARATE reading from the severity beside it, not a restatement of it: an " +
      "issue can be Critical and still read Track if nothing here confirms it is actually " +
      "exploitable, reachable or mission-relevant, and a coverage gap in the axes that " +
      "would confirm that reads Track* rather than being silently dropped. A dash means " +
      "undecided — a resolved row, or one this rule never reached.",
    drawnOn: ["combos", "config", "problems"],
    mark: () => outcomeBadge("TRACK_STAR"),
    link: { label: "Open the Problem tree tab", route: "aars", params: {} },
  },
  {
    id: "two-token",
    term: "Why the label is darker than the dot",
    aka: "the two-token rule",
    family: "severity",
    blurb:
      "Each level carries two colours: a vivid FILL for dots, marks and chart segments, " +
      "and a darker TEXT token for any coloured label. The fill is tuned to read as a " +
      "graphical mark on white; the text token is tuned to clear 4.5:1 on the pale tint " +
      "behind it. Setting a label in the fill colour would fail contrast, so the split is " +
      "deliberate and must not be collapsed.",
    drawnOn: ["inventory", "combos", "graph", "problems"],
    mark: () => el("span", { class: "help-twotoken", "aria-hidden": "true" }),
  },

  // ------------------------------------------------------------- coverage and freshness
  {
    id: "coverage-state",
    term: "Coverage state",
    aka: "● Reporting · ◐ Partial · ○ Not scanned",
    family: "coverage",
    blurb:
      "How well one Wiz scan area is backed by this deployment. Reporting means a figure " +
      "from the last sync; Partial means queried and stored but not totalled here; Not " +
      "scanned means no query runs at all. The state is DERIVED wherever a resolver can " +
      "decide it, so a missing figure steps back to Partial on its own rather than " +
      "asserting a number it cannot compute.",
    drawnOn: ["scans"],
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
    blurb:
      "With no Wiz credentials configured, “Sync now” persists a bundled sample dataset " +
      "instead of querying a tenant, and the whole app works. Every page says which mode " +
      "produced the figures it is showing, because a number from a sample and a number " +
      "from your landscape are not the same kind of thing.",
    drawnOn: ["settings", "data"],
    mark: () => statusPill("neutral", "Dry-run"),
    link: { label: "Check the connection", route: "settings", params: {} },
  },
  {
    id: "sync",
    term: "Sync",
    aka: "and its commit record",
    family: "coverage",
    blurb:
      "One pass of the Wiz query battery, normalised and enriched once, then written " +
      "wholesale. The sync-history row is written LAST and is the commit record: no history " +
      "row means the sync never happened. It runs on demand and daily at 05:00 UTC, and " +
      "resumes itself if one execution runs long.",
    drawnOn: ["data", "scans"],
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

  // --------------------------------------------------------------- framework vocabularies
  {
    id: "gap-shapes",
    term: "● exact · ◧ family · ◇ unknown",
    aka: "how a pricing rule matches",
    family: "framework",
    blurb:
      "On the AARS Rules cascade, each row says in words what it matches. A filled dot is " +
      "one named entry. A half-filled square is a prefix covering a whole vocabulary, and " +
      "the row states how many codes it catches and how many are priced above it. A " +
      "diamond is a code the codebook does not carry — a tenant-specific finding id, " +
      "priced by the fallback.",
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
    blurb: family.standing,
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
  "aars-score": ["inventory", "aars"],
  "aars-band": ["inventory", "aars"],
  "aars-percentile": ["inventory", "graph"],
  "aars-distinct-scores": ["aars"],
  "aars-tie-rate": ["aars"],
  "aars-effective-cardinality": ["aars"],
  "aars-pillar-saturation": ["aars"],
  "problem-outcome-distribution": ["problems", "combos", "config"],
  "action-concentration-ratio": ["problems"],
  "problem-axis-unknown-rate": ["aars"],
  "posture-tier-distribution": ["inventory", "problems"],
  "issue-sla-tally": ["combos", "problems"],
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
    blurb: m.goal + " " + m.formula,
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

export function resolveEntries(ctx) {
  return ENTRIES.map((entry) => resolveEntry(entry, ctx));
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
