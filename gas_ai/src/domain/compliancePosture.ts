// The Compliance page's read model: turning the flat posture rows back into the framework
// tree the page draws, plus the rollups its header states. Pure and unit-tested here, like
// configFindings.ts and assetTable.ts, so the server and the browser cannot disagree about
// what a framework scores.
//
// ONE RULE GOVERNS THIS WHOLE FILE: a posture that does not exist is never a zero.
//
// Wiz sends `compliancePosture: null` with an `emptyPostureReason` for two genuinely
// different situations — NO_RESOURCES ("you have nothing this subcategory applies to") and
// NO_POLICIES ("nobody has written a check for this") — and both are the OPPOSITE of a 0%
// score, which means "we checked and everything failed". A page that renders all three the
// same way is the implied confidence PRODUCT.md forbids, and it is a very easy mistake to
// make: `posture ?? 0` reads perfectly and is wrong.
//
// So emptiness is modelled as its OWN state with its own glyph and label, reusing the
// three-state vocabulary the Wiz Scans page already established rather than minting a
// second one, and nothing here ever coerces a null percentage.

import { SEVERITY_ORDER, type Severity } from "./config";
import type {
  EmptyPostureReason, FrameworkPolicyRow, FrameworkRow, PostureRow,
} from "./graphTypes";

/**
 * How a posture cell reads. `scored` is the only one carrying a number.
 *
 * Glyph AND label, never colour alone — the accessibility bar in PRODUCT.md makes the
 * redundant cue load-bearing, and these four are exactly the states the severity palette
 * would otherwise be asked to carry.
 */
export const POSTURE_STATES = {
  scored: {
    glyph: "●",
    label: "Scored",
    blurb: "assessed against this tenant",
  },
  noResources: {
    glyph: "○",
    label: "No resources",
    blurb: "nothing in this estate the checks apply to",
  },
  noPolicies: {
    glyph: "◌",
    label: "No policies",
    blurb: "no check is written for this — not a pass and not a failure",
  },
  unknown: {
    glyph: "◐",
    label: "Not reported",
    blurb: "no posture and no reason given",
  },
} as const;

export type PostureState = keyof typeof POSTURE_STATES;

/**
 * The state of one posture cell.
 *
 * Note the order: emptiness is decided BEFORE the number is looked at. A row carrying both
 * a percentage and an empty reason is contradictory, and trusting the reason is the
 * conservative read — it declines to state a score rather than stating one Wiz disowned.
 */
export function postureState(
  posturePct: number | null,
  emptyPostureReason: EmptyPostureReason | null,
): PostureState {
  const reason = String(emptyPostureReason ?? "").trim().toUpperCase();
  if (reason === "NO_RESOURCES") return "noResources";
  if (reason === "NO_POLICIES") return "noPolicies";
  if (reason) return "unknown";
  return posturePct === null ? "unknown" : "scored";
}

/**
 * Whether a node's title already opens with its own external id.
 *
 * The register prints the external id as a leading chip, which reads well when the title
 * is the bare name ("ASI01" · "Agent Goal Hijack"). The OWASP LLM framework numbers its
 * categories "1", "2" and NAMES them "1 LLM01:2025 Prompt Injection" — so the chip renders
 * "1" immediately before a title starting "1 ", and the row reads "11 LLM01:2025 …".
 *
 * Tested rather than eyeballed because it is a question about the data (does this title
 * repeat this id?) and the answer differs per framework.
 */
export function titleRepeatsExternalId(externalId: string, title: string): boolean {
  const id = String(externalId ?? "").trim();
  const t = String(title ?? "").trim();
  if (!id || !t) return false;
  if (!(t.toUpperCase().indexOf(id.toUpperCase()) === 0)) return false;
  // Only a WHOLE-token match counts: "ASI1" must not suppress the chip on "ASI10 Rogue
  // Agents", and "1" must not suppress it on "1.1 Prompt Injection".
  const next = t.charAt(id.length);
  return next === "" || next === " " || next === "\t";
}

/** One node of the tree the page renders. */
export interface PostureNode {
  frameworkId: string;
  externalId: string;
  /** False when the title already opens with the external id — see titleRepeatsExternalId. */
  showExternalId: boolean;
  title: string;
  description?: string;
  posturePct: number | null;
  state: PostureState;
  passCount: number;
  failCount: number;
  emptyPostureReason: EmptyPostureReason | null;
}

export interface SubcategoryNode extends PostureNode {
  assessmentScope?: string;
  mappingRationale?: string;
  /** Distinct policies mapped to this subcategory, worst severity first. */
  policies: FrameworkPolicyRow[];
  /** Policies with at least one failing evaluation — the unit of work. */
  failingPolicyCount: number;
}

export interface CategoryNode extends PostureNode {
  subcategories: SubcategoryNode[];
  /**
   * True when this category's ONLY subcategory restates the category itself — same
   * external id, same title.
   *
   * Several published frameworks are one level deep in practice: OWASP's Top 10 lists
   * arrive from Wiz as ten categories each holding exactly one subcategory with the
   * category's own id. Drawing a disclosure control there costs a click to reveal the row
   * you just read, duplicated. The register reads this flag and renders such a category as
   * a single row that opens the detail directly, keeping the two-level shape for
   * frameworks that genuinely use it (the 5Rs: Restrict → 2.1, 2.2, …).
   *
   * Computed here rather than in the page because it is a question about the DATA's shape,
   * which is testable, rather than about pixels, which is not.
   */
  mirrorsCategory: boolean;
}

export interface FrameworkTree {
  frameworkId: string;
  name: string;
  description?: string;
  posturePct: number | null;
  state: PostureState;
  emptyPostureReason: EmptyPostureReason | null;
  passSubCategoryCount: number;
  failSubCategoryCount: number;
  categories: CategoryNode[];
  /** Every subcategory, by state — the header's distribution strip. */
  stateCounts: Record<PostureState, number>;
  /** Distinct policies across the whole framework. Deduped: the same control maps many times. */
  policyCount: number;
  failingPolicyCount: number;
}

function severityRank(s: Severity): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

function emptyStateCounts(): Record<PostureState, number> {
  return { scored: 0, noResources: 0, noPolicies: 0, unknown: 0 };
}

function toNode(row: PostureRow, externalId: string): PostureNode {
  return {
    frameworkId: row.frameworkId,
    externalId,
    // Suppressed when the title already opens with it, so an OWASP LLM row reads
    // "1 LLM01:2025 Prompt Injection" rather than "11 LLM01:2025 Prompt Injection".
    showExternalId: !titleRepeatsExternalId(externalId, row.title),
    title: row.title,
    description: row.description,
    posturePct: row.posturePct,
    state: postureState(row.posturePct, row.emptyPostureReason),
    passCount: row.passCount,
    failCount: row.failCount,
    emptyPostureReason: row.emptyPostureReason,
  };
}

/**
 * Rebuild one framework's tree from the flat rows.
 *
 * The policy rows are joined per subcategory and DEDUPED BY POLICY ID WITHIN that
 * subcategory only. Deduping globally would be wrong: the same control legitimately
 * appears under several subcategories, and collapsing it would delete the mapping the
 * ledger stores it to preserve. Deduping not at all would be wrong too — a policy could
 * be listed twice under one subcategory if a sync overlapped — so the scope of the dedupe
 * is the thing to get right, and it is the subcategory.
 */
export function buildFrameworkTree(
  frameworkId: string,
  posture: PostureRow[],
  policies: FrameworkPolicyRow[],
  frameworks: FrameworkRow[] = [],
): FrameworkTree | null {
  const rows = posture.filter((p) => p.frameworkId === frameworkId);
  if (!rows.length) return null;

  const frameworkRow = rows.find((p) => p.level === "framework");
  const catalogue = frameworks.find((f) => f.id === frameworkId);

  const policiesBySub = new Map<string, FrameworkPolicyRow[]>();
  for (const p of policies) {
    if (p.frameworkId !== frameworkId) continue;
    const list = policiesBySub.get(p.subcategoryExternalId) ?? [];
    list.push(p);
    policiesBySub.set(p.subcategoryExternalId, list);
  }

  const subsByCategory = new Map<string, SubcategoryNode[]>();
  for (const row of rows) {
    if (row.level !== "subcategory") continue;
    const externalId = row.subcategoryExternalId ?? "";
    const raw = policiesBySub.get(externalId) ?? [];
    const seen = new Set<string>();
    const deduped = raw.filter((p) => {
      if (seen.has(p.policyId)) return false;
      seen.add(p.policyId);
      return true;
    });
    deduped.sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
    const node: SubcategoryNode = {
      ...toNode(row, externalId),
      assessmentScope: row.assessmentScope,
      mappingRationale: row.mappingRationale,
      policies: deduped,
      failingPolicyCount: deduped.filter((p) => p.failCount > 0).length,
    };
    const key = row.categoryExternalId ?? "";
    const list = subsByCategory.get(key) ?? [];
    list.push(node);
    subsByCategory.set(key, list);
  }

  const categories: CategoryNode[] = rows
    .filter((r) => r.level === "category")
    .map((row) => {
      const externalId = row.categoryExternalId ?? "";
      const subcategories = subsByCategory.get(externalId) ?? [];
      return {
        ...toNode(row, externalId),
        subcategories,
        mirrorsCategory: subcategories.length === 1
          && subcategories[0].externalId === externalId,
      };
    });

  const stateCounts = emptyStateCounts();
  for (const cat of categories) {
    for (const sub of cat.subcategories) stateCounts[sub.state] += 1;
  }

  // Distinct across the framework — the same control under three subcategories is ONE
  // policy that this framework covers, and reporting three would inflate every count on
  // the header.
  const distinct = new Map<string, boolean>();
  for (const p of policies) {
    if (p.frameworkId !== frameworkId) continue;
    distinct.set(p.policyId, (distinct.get(p.policyId) ?? false) || p.failCount > 0);
  }

  return {
    frameworkId,
    name: frameworkRow?.title ?? catalogue?.name ?? frameworkId,
    description: frameworkRow?.description ?? catalogue?.description,
    posturePct: frameworkRow?.posturePct ?? null,
    state: postureState(
      frameworkRow?.posturePct ?? null,
      frameworkRow?.emptyPostureReason ?? null,
    ),
    emptyPostureReason: frameworkRow?.emptyPostureReason ?? null,
    passSubCategoryCount: frameworkRow?.passSubCategoryCount ?? 0,
    failSubCategoryCount: frameworkRow?.failSubCategoryCount ?? 0,
    categories,
    stateCounts,
    policyCount: distinct.size,
    failingPolicyCount: [...distinct.values()].filter(Boolean).length,
  };
}

/** Every framework with stored posture, worst-scored first; unscored ones last. */
export function buildAllFrameworkTrees(
  posture: PostureRow[],
  policies: FrameworkPolicyRow[],
  frameworks: FrameworkRow[] = [],
): FrameworkTree[] {
  const ids: string[] = [];
  for (const p of posture) if (ids.indexOf(p.frameworkId) === -1) ids.push(p.frameworkId);
  const trees = ids
    .map((id) => buildFrameworkTree(id, posture, policies, frameworks))
    .filter((t): t is FrameworkTree => t !== null);
  // Worst first, because the page's job is to say what needs attention. A framework with
  // no posture sorts LAST rather than as a zero — it is not the worst, it is unknown.
  trees.sort((a, b) => {
    if (a.posturePct === null && b.posturePct === null) return a.name < b.name ? -1 : 1;
    if (a.posturePct === null) return 1;
    if (b.posturePct === null) return -1;
    return a.posturePct - b.posturePct || (a.name < b.name ? -1 : 1);
  });
  return trees;
}

/**
 * The estate-wide compliance figure the Wiz Scans page reports.
 *
 * `averagePosture` is the mean of the SCORED frameworks only, and `scoredFrameworks` says
 * how many that was — because a mean over three frameworks where one was never assessed is
 * a different claim from a mean over three that all were, and the page has to be able to
 * say which it is showing. Returns null rather than 0 when nothing scored.
 */
export function complianceKpis(
  posture: PostureRow[],
  policies: FrameworkPolicyRow[] = [],
): {
  frameworks: number;
  scoredFrameworks: number;
  averagePosture: number | null;
  failingSubcategories: number;
  failingPolicies: number;
} {
  const frameworkRows = posture.filter((p) => p.level === "framework");
  const scored = frameworkRows.filter(
    (p) => postureState(p.posturePct, p.emptyPostureReason) === "scored",
  );
  const averagePosture = scored.length
    ? Math.round(scored.reduce((sum, p) => sum + (p.posturePct ?? 0), 0) / scored.length)
    : null;

  const failingSubcategories = posture.filter(
    (p) => p.level === "subcategory" && p.failCount > 0,
  ).length;

  // Distinct policies with a failing evaluation, across every framework. Deduped by policy
  // id for the same reason the per-framework count is: one control mapped to six
  // subcategories is one thing to fix, not six.
  const failing = new Set<string>();
  for (const p of policies) if (p.failCount > 0) failing.add(p.policyId);

  return {
    frameworks: frameworkRows.length,
    scoredFrameworks: scored.length,
    averagePosture,
    failingSubcategories,
    failingPolicies: failing.size,
  };
}
