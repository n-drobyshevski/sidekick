// Pure settings semantics (defaults, clamping) over the settings dict the store
// loads from the `settings` tab. Kept out of the store so it is unit-testable
// without GAS globals.

import { DEPTH_DEFAULT, DEPTH_MAX, DEPTH_MIN, MAX_NODES_DEFAULT } from "./config";
import type { Rec } from "./util";

export function clampDepth(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEPTH_DEFAULT;
  return Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, n));
}

export function getDefaultDepth(settings: Rec): number {
  return clampDepth(settings["default_depth"] ?? DEPTH_DEFAULT);
}

export function withDefaultDepth(settings: Rec, depth: unknown): Rec {
  return { ...settings, default_depth: clampDepth(depth) };
}

/** Node budget for one graph payload; clamped so a bad value can't flood the client. */
export function clampMaxNodes(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return MAX_NODES_DEFAULT;
  return Math.min(400, Math.max(30, n));
}

export function getMaxNodes(settings: Rec): number {
  return clampMaxNodes(settings["max_nodes"] ?? MAX_NODES_DEFAULT);
}

export function withMaxNodes(settings: Rec, maxNodes: unknown): Rec {
  return { ...settings, max_nodes: clampMaxNodes(maxNodes) };
}
