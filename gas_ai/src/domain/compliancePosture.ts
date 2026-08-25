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
//
// WHAT THE TREE LISTS vs. WHAT IT COUNTS. The register is a worklist, and a row nothing was
// ever evaluated against is not work — so the tree LISTS only what Wiz actually assessed:
// scored subcategories (`categories[].subcategories`) and, under them, only policies that
// evaluated something (`isAssessedPolicy`). Categories left with no listed subcategory drop
// out with them.
//
// That is a filter on the LIST, never on the ARITHMETIC, and the difference is the whole
// reason the two are separated below. `stateCounts` is still computed over EVERY
// subcategory Wiz reported, before anything is dropped, and `unassessedPolicyCount` still
// counts the policies that went — because a page that silently lists fewer rows than the
// landscape has is the implied confidence PRODUCT.md forbids, just wearing a tidier face. The
// header states what was left out; the register just doesn't rank it as work.

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
    blurb: "nothing in this landscape the checks apply to",
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
 * How a posture PERCENTAGE reads, as four bands — the classification that tints every
 * posture bar on the page.
 *
 * Hue tracks the number, not the severity of what is failing under it, and the two are
 * genuinely different claims: a subcategory can score 100% with a CRITICAL rule failing
 * somewhere beneath it (Wiz's posture is its own aggregate, not a function of the policy
 * counts). Tinting the bar by severity made a full bar red; tinting it by the number makes
 * the colour say exactly what the number beside it says, which is the honest reading of a
 * progress bar. Severity is still reported — by the badges beside the hero and the rail
 * row, where it is a separate fact rather than a competing encoding on the same mark.
 *
 * That redundancy is also what satisfies the accessibility bar: the percentage IS the
 * non-colour cue, exact and already in the cell, so the ramp adds emphasis without ever
 * being the only carrier of meaning.
 *
 * THE BREAKS ARE A PRODUCT CHOICE, not a derivation — 90 and 70 are the common compliance
 * reading of "clean", "work to do" and "not clean", and 50 splits that last one. They live
 * here rather than in CSS so they are stated once, tested, and shipped with the row; the
 * view owns only the colour it paints for each.
 *
 * THE FOURTH BREAK, AT 50, IS WHY THERE ARE FOUR OF THEM. This scale used to have three
 * steps and its own palette — the semantic status triad, --ok/--warn/--bad washed toward
 * white — while the Scoring Models page drew a posture tier on the four-step ordinal ramp
 * (--rank-1..4 in tokens.css). Two ordinal readings of the same word, in two palettes, so
 * a reader had to learn "posture colour" twice. Cutting the failing band in two lets this
 * one ride the ramp that already exists rather than minting a second.
 *
 * Which is also why 90 and 70 did NOT move to make room: they are the product reading, and
 * the number of colours available is not a reason to restate it. Only the bottom band
 * splits, and "Materially failing" stays attached to the bottom where it was.
 */
export const POSTURE_BANDS = {
  strong: { min: 90, label: "Strong" },
  fair: { min: 70, label: "Work to do" },
  poor: { min: 50, label: "Falling short" },
  weak: { min: 0, label: "Materially failing" },
} as const;

export type PostureBand = keyof typeof POSTURE_BANDS;

/**
 * The band a percentage falls in, or null when there is no percentage at all.
 *
 * Null, never "weak", for an absent score — the file's governing rule applied to one more
 * derived field. An unscored row painted the failing colour would be `posture ?? 0` again,
 * wearing a different coat.
 */
export function postureBandOf(posturePct: number | null): PostureBand | null {
  if (posturePct === null || posturePct === undefined) return null;
  if (posturePct >= POSTURE_BANDS.strong.min) return "strong";
  if (posturePct >= POSTURE_BANDS.fair.min) return "fair";
  if (posturePct >= POSTURE_BANDS.poor.min) return "poor";
  return "weak";
}

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
  /**
   * Which band `posturePct` falls in — what tints this row's bar. Null when unscored.
   *
   * Shipped rather than derived in the browser, for the reason complianceShared.js gives
   * about `state`: labels and colours belong to the view, the classification itself always
   * comes from the server, so the four bars on this page cannot end up drawing four
   * opinions of where 90 sits.
   */
  postureBand: PostureBand | null;
  /**
   * Worst severity among the FAILING policies under this node. Null when none are failing.
   *
   * NOT a render field at category or subcategory level — no cell draws it, and nothing
   * should start: the bar's colour is the posture band above, and a second severity
   * encoding on the same row is what this page just moved away from. It exists because the
   * framework's own `worstFailingSeverity` (which the hero and the rail DO draw, as a
   * badge) folds up through these, so the three levels cannot disagree.
   */
  worstFailingSeverity: Severity | null;
}

export interface SubcategoryNode extends PostureNode {
  assessmentScope?: string;
  mappingRationale?: string;
  /**
   * Distinct policies mapped to this subcategory that ACTUALLY EVALUATED SOMETHING, worst
   * severity first. Mapped-but-unassessed policies are excluded — see isAssessedPolicy.
   */
  policies: FrameworkPolicyRow[];
  /** Policies with at least one failing evaluation — the unit of work. */
  failingPolicyCount: number;
  /**
   * How many mapped policies `policies` leaves out because Wiz evaluated them against
   * nothing. Reported rather than swallowed: the detail panel states the number, so a
   * reader can tell "three rules, all passing" from "three rules, none of which ran".
   */
  unassessedPolicyCount: number;
}

export interface CategoryNode extends PostureNode {
  /** Only the SCORED subcategories — see the file header. Never empty: a category left
   *  with none is dropped from the tree rather than drawn as an expander over nothing. */
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
  /** Which band `posturePct` falls in — what tints the hero meter and the rail bar. */
  postureBand: PostureBand | null;
  emptyPostureReason: EmptyPostureReason | null;
  passSubCategoryCount: number;
  failSubCategoryCount: number;
  /** Categories with at least one scored subcategory, in Wiz's order. */
  categories: CategoryNode[];
  /**
   * Every subcategory Wiz reported, by state — INCLUDING the unscored ones `categories`
   * no longer lists. Counted before the filter runs, so this stays the honest denominator:
   * the header reads "12 scored of 20" against a register showing twelve rows, and the
   * eight that are missing are named rather than merely absent.
   */
  stateCounts: Record<PostureState, number>;
  /**
   * Distinct policies LISTED across the whole framework. Deduped: the same control maps
   * many times. Counts what the register shows, which is why it is rolled up from the
   * built nodes rather than re-walked off the raw rows — two walks over two differently
   * filtered sets is exactly how a header and its table come to disagree.
   */
  policyCount: number;
  failingPolicyCount: number;
  /** Distinct policies dropped from every subcategory for having evaluated nothing. */
  unassessedPolicyCount: number;
  /** Worst severity among this framework's FAILING policies. Null when none are failing. */
  worstFailingSeverity: Severity | null;
}

function severityRank(s: Severity): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/**
 * The worse of two severities, either of which may be absent.
 *
 * Every level's `worstFailingSeverity` is folded up with this rather than computed by its
 * own walk over the policy rows. A category asking its subcategories, and a framework
 * asking its categories, cannot disagree with the leaf that actually holds the policy —
 * three independent walks over three differently filtered sets is exactly how a header
 * comes to name a severity its own rows do not show.
 */
function worstOf(a: Severity | null, b: Severity | null): Severity | null {
  if (a === null) return b;
  if (b === null) return a;
  return severityRank(b) < severityRank(a) ? b : a;
}

/**
 * The worst severity among the FAILING policies of `policies`, or null when none fail.
 *
 * Failing is the whole filter: a CRITICAL control that passes describes the landscape's good
 * news, and letting it set this field would paint a clean row with an alarm. Null means
 * "nothing here is failing", never "nothing here is severe".
 */
function worstFailingSeverityOf(policies: readonly FrameworkPolicyRow[]): Severity | null {
  let worst: Severity | null = null;
  for (const p of policies) if (p.failCount > 0) worst = worstOf(worst, p.severity);
  return worst;
}

function emptyStateCounts(): Record<PostureState, number> {
  return { scored: 0, noResources: 0, noPolicies: 0, unknown: 0 };
}

/**
 * Whether Wiz actually ran this policy against anything.
 *
 * The predicate is ANY NON-ZERO COUNT rather than `!noResourceToAssess`, and that choice is
 * deliberately conservative in one direction: a row carrying a real number is never hidden,
 * whatever its flag says. Wiz's own signal for "nothing to evaluate" is `noResourceToAsses`
 * (its spelling, one 's') beside four null counts — the two agree on every row of the
 * tenant capture — but where they DISAGREE, the number is the harder fact. A policy
 * reporting ten failures must reach the register even if the flag claims there was nothing
 * to assess; the reverse mistake only costs a row nobody could act on.
 *
 * `rejectedCount` counts too: a rule whose findings were all exempted still ran, and
 * dropping it would hide the exemption rather than the evaluation.
 */
export function isAssessedPolicy(p: FrameworkPolicyRow): boolean {
  return p.assessedCount > 0 || p.passCount > 0 || p.failCount > 0 || p.rejectedCount > 0;
}

/**
 * The fields a node reads off its own posture row. `worstFailingSeverity` is NOT one of
 * them — it is a fact about the policies underneath, which a row does not carry — so every
 * caller folds it in afterwards from the level below.
 */
function toNode(
  row: PostureRow,
  externalId: string,
): Omit<PostureNode, "worstFailingSeverity"> {
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
    // Read off the state, not off the number: a row carrying both a percentage and an
    // emptyPostureReason is one postureState declines to score, and banding the number it
    // just disowned would put a colour back on a row that has no posture.
    postureBand: postureState(row.posturePct, row.emptyPostureReason) === "scored"
      ? postureBandOf(row.posturePct)
      : null,
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

  // Counted over every subcategory row, INSIDE the same loop that then drops the unscored
  // ones from the list. One walk, so the count and the omission can never describe
  // different sets — a second pass over an already-filtered array is how "12 of 20"
  // quietly becomes "12 of 12".
  const stateCounts = emptyStateCounts();
  const unassessedIds = new Set<string>();
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
    // Filtered AFTER the dedupe, never before: the dedupe's scope is the subcategory (see
    // this function's own doc comment), and a policy listed twice under one subcategory —
    // once assessed, once not — must collapse to one row before either is judged.
    const assessed: FrameworkPolicyRow[] = [];
    for (const p of deduped) {
      if (isAssessedPolicy(p)) assessed.push(p);
      else unassessedIds.add(p.policyId);
    }
    const node: SubcategoryNode = {
      ...toNode(row, externalId),
      assessmentScope: row.assessmentScope,
      mappingRationale: row.mappingRationale,
      policies: assessed,
      failingPolicyCount: assessed.filter((p) => p.failCount > 0).length,
      unassessedPolicyCount: deduped.length - assessed.length,
      // From the LISTED policies, so the tint on this row and the rules the row expands to
      // show can never name different severities.
      worstFailingSeverity: worstFailingSeverityOf(assessed),
    };
    stateCounts[node.state] += 1;
    // The list keeps only what Wiz scored. An unscored subcategory is not a low score and
    // not a fixed one — there is nothing under it to act on, and ranking it beside rows
    // that ARE work is what the header's state counts exist to say instead.
    if (node.state !== "scored") continue;
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
        worstFailingSeverity: subcategories.reduce(
          (worst: Severity | null, sub) => worstOf(worst, sub.worstFailingSeverity),
          null,
        ),
      };
    })
    // A category whose every subcategory was dropped goes with them. Kept, it would draw a
    // disclosure control that expands to nothing — and mirrorsCategory's own branch in the
    // register reads `subcategories[0]` unguarded, because this filter is what guarantees
    // there is one.
    .filter((cat) => cat.subcategories.length > 0);

  // Distinct across the framework — the same control under three subcategories is ONE
  // policy that this framework covers, and reporting three would inflate every count on
  // the header.
  //
  // worstFailingSeverity is NOT computed here. It folds up from the categories, which
  // folded it up from their subcategories, which read it off the policies this same walk
  // is counting — one source, three levels, and the hero can no longer name a severity the
  // register below it does not show.
  const distinct = new Map<string, boolean>();
  for (const cat of categories) {
    for (const sub of cat.subcategories) {
      for (const p of sub.policies) {
        distinct.set(p.policyId, (distinct.get(p.policyId) ?? false) || p.failCount > 0);
      }
    }
  }
  const worstFailingSeverity = categories.reduce(
    (worst: Severity | null, cat) => worstOf(worst, cat.worstFailingSeverity),
    null,
  );

  const frameworkState = postureState(
    frameworkRow?.posturePct ?? null,
    frameworkRow?.emptyPostureReason ?? null,
  );

  return {
    frameworkId,
    name: frameworkRow?.title ?? catalogue?.name ?? frameworkId,
    description: frameworkRow?.description ?? catalogue?.description,
    posturePct: frameworkRow?.posturePct ?? null,
    state: frameworkState,
    // Same guard toNode applies one level down: only a row that actually scored gets a
    // band, so an unscored framework's hero draws no bar rather than a failing-coloured one.
    postureBand: frameworkState === "scored"
      ? postureBandOf(frameworkRow?.posturePct ?? null)
      : null,
    emptyPostureReason: frameworkRow?.emptyPostureReason ?? null,
    passSubCategoryCount: frameworkRow?.passSubCategoryCount ?? 0,
    failSubCategoryCount: frameworkRow?.failSubCategoryCount ?? 0,
    categories,
    stateCounts,
    policyCount: distinct.size,
    failingPolicyCount: [...distinct.values()].filter(Boolean).length,
    // Only ids that appear NOWHERE in the listed tree. A control mapped under six
    // subcategories and evaluated under one of them is a listed policy, not a dropped one,
    // and counting it in both places would describe the same rule twice.
    unassessedPolicyCount: [...unassessedIds].filter((id) => !distinct.has(id)).length,
    worstFailingSeverity,
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
 * The landscape-wide compliance figure the Wiz Scans page reports.
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
  /**
   * The band `averagePosture` falls in, banded HERE rather than in the browser.
   *
   * This is the one posture figure on the page with no node behind it — it is derived, not
   * reported — so without this field the overview's hero would be the single mark applying
   * the 90/70 breaks client-side, and a threshold edit would move every bar but that one.
   */
  averagePostureBand: PostureBand | null;
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
    averagePostureBand: postureBandOf(averagePosture),
    failingSubcategories,
    failingPolicies: failing.size,
  };
}
