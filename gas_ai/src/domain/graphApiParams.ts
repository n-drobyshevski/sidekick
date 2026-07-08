// getGraph parameter resolution — pure, so seed handling and clamping are testable
// without GAS globals. Seeds resolve to: one asset, all assets of a toxic-combination
// group, or (default) every asset participating in any toxic combination.

import { clampDepth, clampMaxNodes } from "./settingsLogic";
import { MAX_EDGES_DEFAULT } from "./config";
import {
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
}

/** Accepts arrays or comma-joined strings (hash params arrive as strings). */
export function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string") return v.split(",").filter(Boolean);
  return [];
}

function comboAssetIds(issues: IssueRow[], groupId?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (issue.status !== "OPEN" || !issue.comboGroup) continue;
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
  groupBy: GroupKey;
  sort: SortKey;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Layout knobs (hash params `layout`, `groupBy`, `sort`): whitelisted,
 *  case-insensitive, garbage falls back to defaults. */
export function resolveLayoutParams(p: Rec): GraphLayoutParams {
  return {
    mode: pick(p["layout"], LAYOUT_MODES, "lanes"),
    groupBy: pick(p["groupBy"], GROUP_KEYS, "combo"),
    sort: pick(p["sort"], SORT_KEYS, "smart"),
  };
}

export function resolveGraphParams(p: Rec, ctx: GraphParamContext): ProjectOptions {
  const seed = typeof p["seed"] === "string" ? (p["seed"] as string) : "";
  const seedKind = typeof p["seedKind"] === "string" ? (p["seedKind"] as string) : "";

  let seedIds: string[];
  if (seed && (seedKind === "combo" || comboGroupById(seed))) {
    seedIds = comboAssetIds(ctx.issues, seed);
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
  };
  const hasFilters =
    filters.severities.length || filters.kinds.length ||
    filters.projects.length || filters.clouds.length;

  return {
    seedIds,
    depth: clampDepth(p["depth"] ?? ctx.defaultDepth),
    expandIds: toList(p["expand"]),
    filters: hasFilters ? filters : undefined,
    maxNodes: clampMaxNodes(p["maxNodes"] ?? ctx.maxNodes),
    maxEdges: MAX_EDGES_DEFAULT,
  };
}
