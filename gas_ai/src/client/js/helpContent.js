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
//    kinds of number live in that column: a MEASUREMENT of the estate, which needs a sync,
//    and a SETTING — the node budget, the pillar caps, the band thresholds — which is the
//    model in force and is just as true before the first sync as after it. An entry that
//    reads a setting says so with `fromSettings`; everything else is withheld until a sync
//    exists, because an estate figure of zero read off an empty ledger is not zero, it is
//    unknown, and reporting it as zero is the implied confidence PRODUCT.md forbids.
//
// 4. THE FRAMEWORK CODES ARE INDEXED HERE, NOT COPIED. codebook.js already carries all
//    forty definitions and the AARS Rules page already browses them with live per-code
//    counts. This file names the five vocabularies with their vintage and standing and
//    links out. Copying the definitions is the wall this page exists to avoid.

import { CODEBOOK, FAMILY_GROUP } from "./codebook.js";
import { CATEGORY_LABELS, CATEGORY_ORDER, kindIconSvg } from "./icons.js";
import { aarsChip, el, pluralize, sevBadge, statusPill } from "./ui.js";

/** The six headings, in reading order. Six headings and find-in-page beat a search box. */
export const FAMILIES = [
  { id: "graph", title: "Reading the graph" },
  { id: "signal", title: "Risk signals" },
  { id: "score", title: "The score" },
  { id: "severity", title: "Severity" },
  { id: "coverage", title: "Coverage and freshness" },
  { id: "framework", title: "Framework vocabularies" },
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
  combos: "Toxic Combinations",
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
      "them — and the icon and the word are the KIND. Colour is never the only cue, and " +
      "two kinds sharing a glyph is normal: the icon rides beside the label, never instead " +
      "of it.",
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
        unit: "kinds in this estate",
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
    id: "sensitive-data",
    term: "SENSITIVE_DATA",
    aka: "classified-data reach",
    family: "signal",
    blurb:
      "The asset can reach data Wiz classified as PII, PHI or PCI. The REACHABILITY is " +
      "what the toxic combinations price, not the storage — a bucket full of PII that no " +
      "agent can read is a different finding from one that three agents can.",
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
    term: "AARS",
    aka: "AI Asset Risk Score",
    family: "score",
    blurb:
      "One number per asset, 0 to 100, summed across three pillars and clamped. It is this " +
      "app's own score, not a Wiz field: it prices what the sync collected, so the model " +
      "that produces it is editable and its inputs are persisted beside every score.",
    drawnOn: ["inventory", "graph", "aars"],
    mark: () => aarsChip(78, "HIGH"),
    count: (ctx) => {
      const k = ctx.kpis;
      if (!k || k.criticalAars === undefined) return null;
      return {
        n: n(k.criticalAars),
        value: String(n(k.criticalAars)),
        unit: "assets score Critical",
        route: "inventory",
        params: { aarsSeverities: "CRITICAL" },
      };
    },
  },
  {
    id: "aars-band",
    term: "AARS band",
    aka: "the score's own severity",
    family: "score",
    blurb:
      "The level a score falls into. Bands are re-derived from the stored score on every " +
      "read, so moving a threshold applies at once and retroactively — no re-sync, no " +
      "rescore. Changing the POINT model is the other thing entirely, and strands the " +
      "stored scores until they are recomputed.",
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
      "them and lifted by a multiplier when it is in more than one. Capped, so no single " +
      "pillar can carry the whole score.",
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
      "the one edited as a table.",
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
    id: "rescore",
    term: "Recompute scores",
    aka: "not a sync",
    family: "score",
    blurb:
      "Re-runs the enrichment over data already in the sheet and makes ZERO Wiz API calls. " +
      "It writes no sync-history row, because a rescore is not a sync and the trend must " +
      "not gain a point for an estate that never moved. Trend points carry the rule version " +
      "they were scored under, so a threshold edit reads as a break rather than as movement.",
    drawnOn: ["aars"],
    mark: () => el("span", { class: "pill neutral" }, "↻"),
    link: { label: "Open AARS Rules", route: "aars", params: {} },
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
    drawnOn: ["combos", "inventory", "graph"],
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
    drawnOn: ["inventory", "combos", "graph"],
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
    aka: "the bundled sample estate",
    family: "coverage",
    blurb:
      "With no Wiz credentials configured, “Sync now” persists a bundled sample dataset " +
      "instead of querying a tenant, and the whole app works. Every page says which mode " +
      "produced the figures it is showing, because a number from a sample and a number " +
      "from your estate are not the same kind of thing.",
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

// ---------------------------------------------------------------------------- resolvers

/**
 * One entry resolved against a payload: the record plus the count it earned.
 *
 * A resolver that throws is a resolver that cannot answer, which is exactly the
 * "not counted here" state — the same call scanContent.js's safeFigure() makes.
 */
export function resolveEntry(entry, ctx) {
  if (!entry.count) return { ...entry, resolved: null };
  // Before the first sync the estate is unknown, not empty. The KPI payload still answers
  // — with zeros, off an empty ledger — so without this guard the page would report "0 AI
  // assets reach classified data" for an estate nobody has looked at yet, and the coverage
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
