// getGraph parameter resolution — pure, so seed handling and clamping are testable
// without GAS globals. Seeds resolve to: one asset, all assets of a toxic-combination
// group, every scored asset (AARS > 0), or (default) every asset participating in
// any toxic combination.

import { clampDepth, clampMaxNodes } from "./settingsLogic";
import { EDGE_BUDGET_RATIO, isUnresolvedIssue } from "./config";
import {
  DEFAULT_LAYOUT,
  GROUP_KEYS,
  LAYOUT_MODES,
  SORT_KEYS,
  type GroupKey,
  type LayoutMode,
  type SortKey,
} from "./graphLayout";
import type { IssueRow } from "./graphTypes";
import type { ProjectOptions } from "./graphProject";
import { comboGroupById } from "./toxicCombos";
import type { Rec } from "./util";

export interface GraphParamContext {
  defaultDepth: number;
  maxNodes: number;
  issues: IssueRow[]; // OPEN issues (seed resolution source)
  /**
   * Just enough of every node to resolve a `seedKind=domain` start set. Narrow on purpose
   * — this module stays free of the whole GNode surface, and a start set needs nothing
   * more than "which ids carry this domain".
   */
  nodes?: Array<{ id: string; domain?: string | null }>;
}

/**
 * Accepts arrays or comma-joined strings (hash params arrive as strings), dropping blanks
 * and collapsing duplicates.
 *
 * This used to skip the trim and the dedupe that assetTable's `list` does, so the two
 * halves of the app read the same URL differently: `?kinds= AI_AGENT ` filtered correctly
 * through the inventory and silently matched nothing on the graph, because the untrimmed
 * value never equals a node kind in `graphProject`'s `f.kinds.includes(node.kind)`.
 */
export function toList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? "").trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

function comboAssetIds(issues: IssueRow[], groupId?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (!isUnresolvedIssue(issue) || !issue.comboGroup) continue;
    if (groupId && issue.comboGroup !== groupId) continue;
    if (issue.assetId && !seen.has(issue.assetId)) {
      seen.add(issue.assetId);
      out.push(issue.assetId);
    }
  }
  return out;
}

export interface GraphLayoutParams {
  mode: LayoutMode;
  /** One or two dimensions, outermost first. Two nests the second inside the first. */
  groupBy: GroupKey[];
  sort: SortKey;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/**
 * The grouping dimensions, outermost first: `groupBy=cloud,kind`.
 *
 * A list rather than a second param so one value stays a one-element list and every
 * link and saved view written before nesting existed keeps meaning what it meant.
 * Unknown names are dropped rather than defaulted, because a garbage SECOND level
 * should not silently become "combo" and draw a nesting nobody asked for.
 *
 * AN EMPTY LIST MEANS NO GROUPING, and is the default. Grouping and the arrangement are two
 * independent controls now, so "grouped by nothing" has to be expressible — it used to fall back
 * to `["combo"]`, which was harmless only because the arrangement `grouped` was the one thing
 * that read it. With every arrangement reading it, that fallback would group every default view
 * by toxic combo without being asked.
 *
 * "asset" is outermost-or-nothing: it has no key of its own to be subdivided BY — `ownGroupKey`
 * answers GROUP_NONE for it, which as a second level would file every node under one sub-box
 * labelled "Ungrouped".
 */
function pickList(v: unknown): GroupKey[] {
  const raw = typeof v === "string" ? v.split(",") : [];
  const out: GroupKey[] = [];
  for (const part of raw) {
    const s = part.trim().toLowerCase();
    if (!(GROUP_KEYS as readonly string[]).includes(s)) continue;
    const key = s as GroupKey;
    if (out.includes(key)) continue;          // grouping twice by one thing is one group
    if (key === "asset" && out.length) continue;
    out.push(key);
    if (key === "asset" || out.length === 2) break;
  }
  return out;
}

/**
 * Layout knobs (hash params `layout`, `groupBy`, `sort`): whitelisted, case-insensitive, garbage
 * falls back to defaults.
 *
 * `layout=grouped` IS AN OLD LINK, and it maps to the arrangement that draws what it drew.
 * Grouping used to be one of the arrangements, and it chose the interior itself: the compact grid
 * now called `grid` for every dimension EXCEPT `asset`, where it forced hub-and-spoke — which is
 * now `radial`. An absent `groupBy` takes the `["combo"]` grouped mode defaulted to internally.
 * So every saved view and shared link written before the split keeps drawing exactly what it
 * drew, `asset` included.
 */
export function resolveLayoutParams(p: Rec): GraphLayoutParams {
  const legacyGrouped = typeof p["layout"] === "string"
    && (p["layout"] as string).toLowerCase() === "grouped";
  const asked = pickList(p["groupBy"]);
  const groupBy = legacyGrouped && !asked.length ? (["combo"] as GroupKey[]) : asked;
  return {
    mode: legacyGrouped
      ? (groupBy[0] === "asset" ? "radial" : "grid")
      : pick(p["layout"], LAYOUT_MODES, DEFAULT_LAYOUT),
    groupBy,
    // `sort=aars` IS AN OLD LINK too, and it maps to `issues` rather than falling through
    // to `smart`. The two are the closest honest pair: the score's own ordering was driven
    // almost entirely by its issue pillar (tau-b 0.863 — ai/AARS_SCORING_ASSESSMENT.md §3,
    // pinned by test/scoreOrdinality.test.ts), so a reader who asked for "worst score
    // first" gets the ordering they were actually looking at. Falling back to `smart`
    // would silently answer a different question and give no sign it had.
    sort: pick(
      typeof p["sort"] === "string" && (p["sort"] as string).toLowerCase() === "aars"
        ? "issues"
        : p["sort"],
      SORT_KEYS,
      "smart",
    ),
  };
}

export function resolveGraphParams(p: Rec, ctx: GraphParamContext): ProjectOptions {
  const seed = typeof p["seed"] === "string" ? (p["seed"] as string) : "";
  const seedKind = typeof p["seedKind"] === "string" ? (p["seedKind"] as string) : "";

  let seedIds: string[];
  // "Every asset carrying an open issue", which is what this start set was always FOR.
  // It used to be "every asset with an AARS above zero" and read from a `scoredAssetIds`
  // list the caller had to assemble — a set defined by a scoring model's coverage rather
  // than by anything about the landscape, so an asset dropped out of the graph's default
  // view because a rule stopped pricing it. Derived here from `ctx.issues`, which
  // resolveGraphParams already holds for the combo seeds, so the caller passes nothing.
  //
  // `scored` stays accepted as the param value: it is in shared links, saved views and
  // the graph page's own start-set control, and "issues" is the same question answered
  // honestly rather than a different one.
  if (seedKind === "scored" || seedKind === "issues") {
    const withIssues: string[] = [];
    const seen: Record<string, true> = {};
    for (const issue of ctx.issues) {
      if (!issue.assetId || seen[issue.assetId]) continue;
      seen[issue.assetId] = true;
      withIssues.push(issue.assetId);
    }
    seedIds = withIssues;
  } else if (seed && (seedKind === "combo" || comboGroupById(seed))) {
    seedIds = comboAssetIds(ctx.issues, seed);
  } else if (seed && seedKind === "domain") {
    // Explicit seedKind, and it has to be: a bare `?seed=CROSS` still means "the asset
    // whose id is CROSS", which is what every existing link means. Ordered after the
    // combo branch and before the bare-seed fallthrough for that reason.
    seedIds = (ctx.nodes ?? []).filter((n) => n.domain === seed).map((n) => n.id);
  } else if (seed) {
    seedIds = [seed];
  } else {
    seedIds = comboAssetIds(ctx.issues);
  }

  const filters = {
    severities: toList(p["severities"]),
    kinds: toList(p["kinds"]),
    projects: toList(p["projects"]),
    clouds: toList(p["clouds"]),
    domains: toList(p["domains"]),
  };
  const hasFilters =
    filters.severities.length || filters.kinds.length ||
    filters.projects.length || filters.clouds.length || filters.domains.length;

  // "" depth means "use the configured default" (the client sends the raw hash
  // value); clampDepth alone would coerce "" to the minimum. `maxNodes` reads the same
  // way — absent or "" is the configured budget, a number is this view's own budget,
  // which is how "Load more" asks for the next slice.
  const rawDepth = p["depth"];
  const rawMaxNodes = p["maxNodes"];
  const maxNodes = clampMaxNodes(
    rawMaxNodes == null || rawMaxNodes === "" ? ctx.maxNodes : rawMaxNodes,
  );

  return {
    seedIds,
    depth: clampDepth(rawDepth == null || rawDepth === "" ? ctx.defaultDepth : rawDepth),
    expandIds: toList(p["expand"]),
    filters: hasFilters ? filters : undefined,
    maxNodes,
    maxEdges: Math.round(maxNodes * EDGE_BUDGET_RATIO),
    ...(seedKind === "scored" || seedKind === "issues" ? { filterSeeds: true } : {}),
  };
}

/**
 * Normalized RAW request — the getGraph cache key material. Everything the
 * resolved options depend on beyond these params (open issues for seed
 * resolution, settings for defaults) only changes when the data version bumps,
 * and the version is part of every cache key. Keying on the raw request lets a
 * cache hit skip ALL Sheets/Drive reads. List params are sorted: projection
 * treats them as sets, so either order shares one entry.
 */
export function graphCacheParams(p: Rec): Rec {
  const sorted = (v: unknown) => toList(v).sort();
  return {
    seed: typeof p["seed"] === "string" ? p["seed"] : "",
    seedKind: typeof p["seedKind"] === "string" ? p["seedKind"] : "",
    depth: p["depth"] == null || p["depth"] === "" ? "" : String(p["depth"]),
    maxNodes: p["maxNodes"] == null ? "" : String(p["maxNodes"]),
    expand: sorted(p["expand"]),
    severities: sorted(p["severities"]),
    kinds: sorted(p["kinds"]),
    projects: sorted(p["projects"]),
    clouds: sorted(p["clouds"]),
    domains: sorted(p["domains"]),
    view: resolveLayoutParams(p),
  };
}
