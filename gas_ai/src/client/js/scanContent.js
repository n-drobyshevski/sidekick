// "What we scan with Wiz" — the coverage content, and the pure layer that decides how much
// of it this deployment can actually back with data.
//
// Prose is sourced from ai/ai_agents_discovery_queries.md, ai/ai_framework.md and
// ai/ai_issues_and_complience_overview.md, and describes what the Wiz *product* does.
// Every NUMBER, by contrast, is resolved from the last sync through `figure()` — this file
// holds no figures of its own. It used to: four areas carried hand-typed `stat` strings,
// and three of them named things this app has never collected (per-framework compliance
// percentages, MFA status, supply-chain findings). A page that cannot tell a measured
// number from a transcribed one is the "implied confidence" PRODUCT.md forbids.
//
// So the honest states are three, not two, and an area's state is DERIVED wherever a
// resolver can decide it: if `figure()` cannot produce a number — an older server bundle
// without the KPI, a failed RPC, an estate with none of that thing — the area degrades to
// `partial` on its own rather than asserting a figure it cannot compute. Only "we never
// ask Wiz this" and "we ask, but what comes back does not cover what the prose claims" are
// declared, because no payload can tell you either.
//
// TODO: coverage is INFERRED here, not recorded. A sync step the tenant rejects with a 400
// (syncJobs.ts, skippedSteps) shows up as `partial` only if it happens to zero out a KPI.
// The durable fix is a `coverage_json` column on sync_history, written at commit time with
// one row per step; then this page would report what ran rather than what resolved.

/** The three coverage states, worst-informed last. Glyph + label, never colour alone. */
export const COVERAGE = {
  live: {
    glyph: "●",
    label: "Reporting",
    rank: 0,
    pill: "ok",
    blurb: "a figure from the last sync",
    // What a diagram node says when it has no figure to print. The blurbs are sentences;
    // these have to fit on one line beside a title.
    short: "",
  },
  partial: {
    glyph: "◐",
    label: "Partial",
    rank: 1,
    pill: "warn",
    blurb: "queried and stored, but not totalled here",
    short: "not totalled",
  },
  unscanned: {
    glyph: "○",
    label: "Not scanned",
    rank: 2,
    pill: "neutral",
    blurb: "no query runs in this deployment",
    short: "not scanned",
  },
};

export const COVERAGE_ORDER = ["live", "partial", "unscanned"];

/**
 * Where a scan area's results end up. Ids are app routes.
 *
 * AARS Rules is deliberately NOT here. Nothing lands on it: it is the model that prices
 * what the sync collected, which is the spine's "score" step, not a screen a query flows
 * into. Listing it would draw a destination box with no edge reaching it — a picture of a
 * connection this app does not have.
 */
export const DESTINATIONS = [
  { id: "graph", title: "Security Graph", sub: "nodes, edges, attack paths" },
  { id: "inventory", title: "AI Inventory", sub: "the scored asset register" },
  { id: "combos", title: "Toxic Combinations", sub: "the multi-condition patterns" },
  { id: "config", title: "Cloud Configuration", sub: "failing controls by rule" },
];

const n = (v) => Number(v || 0);

export const SCAN_AREAS = [
  {
    id: "aispm",
    title: "AI-SPM Inventory",
    query: "cloudResourcesV2 (INVENTORY_AI)",
    what: "Discovers every AI asset across clouds — agents (managed and hosted), models, " +
      "guardrails, pipelines, datasets and MCP servers — with ownership, region and " +
      "project context.",
    lands: "inventory",
    figure: (ctx) => {
      if (!ctx.kpis) return null;
      const projects = (ctx.boot.filterOptions && ctx.boot.filterOptions.projects) || [];
      return {
        value: String(n(ctx.kpis.aiAssets)),
        unit: "AI assets · " + n(ctx.kpis.agents) + " agents · " + projects.length + " projects",
        // `short` is the headline for the one-line diagram node; `value` + `unit` is the
        // full reading, and the register prints that. A node that carried the full unit
        // string would set the width of the whole picture.
        short: n(ctx.kpis.aiAssets) + " assets",
        source: "kpis.aiAssets",
      };
    },
  },
  {
    id: "toxic",
    title: "Toxic Combination Engine",
    query: "issuesV2 (AI risk category, both issue types) + per-rule relatedIssue (ISSUES_*)",
    what: "Every issue Wiz files under the AI risk category, tenant-wide — both toxic " +
      "combinations and cloud-configuration issues. Four multi-condition patterns are " +
      "modelled and re-rated (privileged agents with sensitive data access, model " +
      "invocation without guardrails, permissive execution identities); everything else " +
      "in the category is kept as Other AI risk rather than dropped.",
    lands: "combos",
    figure: (ctx) => {
      const totals = ctx.digest && ctx.digest.totals;
      if (!totals) return null;
      // Unresolved, not just OPEN — the same population the Wiz console counts, so this
      // figure can be compared against it directly.
      const parts = [n(totals.patternsActive) + " of " + n(totals.patternsTotal) + " patterns firing"];
      if (totals.unclassified) parts.push(n(totals.unclassified) + " outside them");
      return {
        value: String(n(totals.totalOpen)),
        unit: "unresolved · " + parts.join(" · "),
        short: n(totals.totalOpen) + " unresolved",
        source: "digest.totals.totalOpen",
      };
    },
  },
  {
    id: "guardrails",
    title: "Guardrail Coverage",
    query: "graphSearch · PROTECTED_BY with negate:true (GUARDRAIL_GAPS)",
    what: "Checks the PROTECTED_BY relationship between agents/models and guardrails; an " +
      "absent edge marks the asset “no guardrail” — the strongest single " +
      "amplifier in the toxic combinations.",
    lands: "graph",
    figure: (ctx) => {
      // protectedAgents is the numerator the server now ships. An older bundle without it
      // returns undefined here, and the area steps back to `partial` rather than printing
      // a coverage claim it cannot source.
      if (!ctx.kpis || ctx.kpis.protectedAgents === undefined || !ctx.kpis.agents) return null;
      return {
        value: n(ctx.kpis.protectedAgents) + " of " + n(ctx.kpis.agents),
        unit: "agents protected (" + n(ctx.kpis.guardrailCoveragePct) + "%)",
        pct: n(ctx.kpis.guardrailCoveragePct),
        short: n(ctx.kpis.guardrailCoveragePct) + "% of agents",
        source: "kpis.protectedAgents / kpis.agents",
      };
    },
  },
  {
    id: "dspm",
    title: "Sensitive Data (DSPM)",
    query: "graphSearch · RUNS_AS → ALLOWS_ACCESS_TO → HAS_DATA_FINDING",
    what: "Walks each agent's execution identity to the buckets and databases it can reach, " +
      "keeps the ones Wiz classified as holding sensitive data, and collects the findings " +
      "on them. The reachability is what the toxic combinations price, not the storage.",
    lands: "graph",
    // This area used to declare itself carried by INVENTORY_AI's two booleans, which was
    // honest but thin: it could say how many assets reach classified data and never which
    // data. It has its own step now.
    carriedBy: "SENSITIVE_DATA_ACCESS",
    figure: (ctx) => {
      // Zero and "never asked" are the same payload here, so a zero degrades the area to
      // `partial` rather than asserting a reading — the derived-not-declared rule this page
      // runs on. A tenant that rejected the step shows in the skipped-steps list beside it.
      if (!ctx.kpis || !n(ctx.kpis.sensitiveDatastores)) return null;
      return {
        value: String(n(ctx.kpis.sensitiveDatastores)),
        unit: "classified datastores in reach · " + n(ctx.kpis.dataFindings) + " findings",
        short: n(ctx.kpis.sensitiveDatastores) + " datastores in reach",
        source: "kpis.sensitiveDatastores",
      };
    },
  },
  {
    id: "ciem",
    title: "CIEM / IAM Analysis",
    // Narrowed deliberately. The SA_FINDINGS step does produce EXCESSIVE_ACCESS_FINDING and
    // LATERAL_MOVEMENT_FINDING nodes, but they live in the graph document and nothing
    // totals them — so the prose claims the privilege reading the figure can actually back,
    // and the findings are named in the detail sheet where the graph link sits beside them.
    query: "graphSearch · RUNS_AS, HAS_FINDING (RUNS_AS, SA_FINDINGS)",
    what: "Reads effective permissions on every identity an AI asset runs as, flagging the " +
      "admin and high-privilege ones. Excessive-access and lateral-movement findings on " +
      "those service accounts are drawn on the graph beside the identity they belong to.",
    lands: "graph",
    note: "The figure counts assets and identities carrying a privilege flag. The individual " +
      "excessive-access and lateral-movement findings are synced and drawn as graph nodes, " +
      "but nothing totals them, so they are not a number on this page.",
    figure: (ctx) => {
      if (!ctx.kpis || ctx.kpis.highPrivilege === undefined) return null;
      return {
        value: String(n(ctx.kpis.highPrivilege)),
        unit: "privileged · " + n(ctx.kpis.agenticIdentities) + " agentic identities",
        short: n(ctx.kpis.highPrivilege) + " privileged",
        source: "kpis.highPrivilege",
      };
    },
  },
  {
    id: "exposure",
    title: "Network Exposure",
    query: "graphSearch · RUNS reversed → VM/SERVERLESS[accessibleFrom.internet], " +
      "SERVES → ENDPOINT[exposureLevel High|Medium, port Open] " +
      "(HOST_EXPOSURE, ENDPOINT_EXPOSURE)",
    what: "Two questions, asked separately. The first walks each AI asset to the VM or " +
      "Cloud Run service underneath it and keeps the ones Wiz finds reachable from the " +
      "internet, with the ports and source ranges that make them so. The second keeps the " +
      "endpoints Wiz's dynamic scanner actually connected to and the tenant's exposure " +
      "policy rates High or Medium.",
    lands: "graph",
    note: "Reachable and exposed are different findings and this page keeps them apart. A " +
      "Cloud Run revision open to 0.0.0.0/0 on ports 80 and 443 is reachable; if the " +
      "endpoints it serves redirect to SSO, Wiz rates them Low and they are not a validated " +
      "exposure. The host query is also what resolves a hosted agent at all: an agent " +
      "carries no reachability flags of its own — they live on the compute — so before this " +
      "step every hosted asset was undetermined and nothing could ever settle it. The " +
      "lateral-movement and code-source paths the same document returns are archived with " +
      "each page but not yet turned into graph edges.",
    figure: (ctx) => {
      if (!ctx.kpis || ctx.kpis.internetExposed === undefined) return null;
      // Three numbers, because there are three grades of evidence and collapsing them is
      // the one thing this area must not do. Undetermined still rides along rather than
      // folding into "not exposed" — the under-reporting riskConditions.ts exists to
      // prevent — but it is now a number that can actually go down.
      const validated = n(ctx.kpis.internetValidated);
      const unknown = n(ctx.kpis.internetUnknown);
      const parts = [];
      if (validated) parts.push(validated + " validated endpoint" + (validated === 1 ? "" : "s"));
      if (unknown) parts.push(unknown + " undetermined");
      return {
        value: String(n(ctx.kpis.internetExposed)),
        unit: "reachable" + (parts.length ? " · " + parts.join(" · ") : ""),
        short: n(ctx.kpis.internetExposed) + " reachable",
        source: "kpis.internetExposed",
      };
    },
  },
  {
    id: "compliance",
    title: "Compliance Frameworks",
    query: "configurationFindings, FAIL only (CONFIG_FINDINGS)",
    what: "Configuration findings against the AI security frameworks enabled in the " +
      "tenant, stored whole and listed on the Cloud Configuration page. Failing ones carry " +
      "the framework codes they violate onto the asset record.",
    lands: "config",
    // Declared, not derived: complianceGaps resolves a real number, but the area's subject
    // is framework SCORING and this counts findings. A live badge here would let the number
    // stand in for the thing it is not.
    coverage: "partial",
    note: "This sync counts failing configuration findings, and the framework codes each one " +
      "violates are on the asset record. Per-framework scores — OWASP LLM, ML, Agentic, " +
      "5Rs — are not queried, not stored and not shown here. The framework tags on the " +
      "Toxic Combinations page are the static taxonomy, not a measured score. The step also " +
      "collects RESOLVED findings and their first-seen dates: Wiz sends no resolvedAt on a " +
      "configuration finding, so a closure can only ever be dated by this app having seen " +
      "it close. Nothing reads those yet, and they are excluded from the count below.",
    figure: (ctx) => (ctx.kpis
      ? {
        value: String(n(ctx.kpis.complianceGaps)),
        // A finding is keyed to the resource evaluated, which for most AI-security rules
        // is a region, an IAM policy or an unattached identity — not an AI asset. Those
        // price no AARS score, so the split is stated rather than left to be inferred.
        unit: "failing findings" +
          (n(ctx.kpis.complianceGapsUnlinked)
            ? " · " + n(ctx.kpis.complianceGapsUnlinked) + " not on an AI asset"
            : ""),
        short: n(ctx.kpis.complianceGaps) + " failing",
        source: "kpis.complianceGaps",
      }
      : null),
  },
  {
    id: "identity",
    title: "Human Identity Access",
    query: "graphSearch · ALLOWS_ACCESS_TO, INBOUND (IDENTITY_ACCESS)",
    what: "Which people, roles and external identities can reach AI assets. The access " +
      "paths are drawn on the graph beside the asset they reach.",
    lands: "graph",
    coverage: "partial",
    note: "Access paths are synced and drawn, but nothing totals them, so there is no figure " +
      "for this area. MFA and inactivity signals on those accounts are not collected at " +
      "all — no query selects them and no column stores them.",
    figure: () => null,
  },
  {
    id: "supply",
    title: "Code-to-Cloud Supply Chain",
    query: "—",
    what: "Traces hosted agents back through container images to source repositories " +
      "(BUILT_FROM), surfacing malicious-package and pipeline findings on the path.",
    // Nothing to land: with no query there are no results, so the diagram draws its edge
    // stopping at the spine rather than pretending a destination receives something.
    lands: "",
    coverage: "unscanned",
    note: "No sync step issues this query. CONTAINER_IMAGE and REPOSITORY nodes appear on " +
      "the graph only when the app is running on the bundled sample dataset — never from " +
      "a live tenant. The two network-exposure steps do request the code-source path (it " +
      "is part of the console document they send verbatim), and every page of it is kept " +
      "in the Drive archive; nothing normalizes it into edges yet, and it would only ever " +
      "cover the internet-exposed slice of the estate, so this area stays unscanned rather " +
      "than claiming coverage from a biased sample.",
    figure: () => null,
  },
];

/**
 * One area resolved against a payload: the record, its figure, and the state that figure
 * earns. A declared `coverage` wins; otherwise a figure means `live` and no figure means
 * `partial`, which is what makes a missing KPI degrade instead of lie.
 */
export function resolveArea(area, ctx) {
  const declared = area.coverage || "";
  const figure = declared === "unscanned" ? null : safeFigure(area, ctx);
  const state = declared || (figure ? "live" : "partial");
  return { ...area, figure, state };
}

function safeFigure(area, ctx) {
  try {
    return area.figure(ctx) || null;
  } catch (e) {
    // A resolver that throws is a resolver that cannot answer, which is exactly `partial`.
    return null;
  }
}

export function resolveAreas(ctx) {
  return SCAN_AREAS.map((area) => resolveArea(area, ctx));
}

/** How many areas sit in each state. The header's hero and its strip both read this. */
export function coverageTally(resolved) {
  const tally = { live: 0, partial: 0, unscanned: 0 };
  for (const area of resolved) tally[area.state] += 1;
  return tally;
}

/** Register order: best-informed first, then alphabetical so the order never wobbles. */
export function rankAreas(resolved) {
  return [...resolved].sort((a, b) => {
    const byState = COVERAGE[a.state].rank - COVERAGE[b.state].rank;
    return byState || a.title.localeCompare(b.title);
  });
}

/** The destination record an area lands in, or null for an area whose results go nowhere. */
export function destinationOf(area) {
  return DESTINATIONS.find((d) => d.id === area.lands) || null;
}
