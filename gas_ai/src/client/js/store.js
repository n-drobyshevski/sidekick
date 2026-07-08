// Client state: the bootstrap payload cache and hash-based routing with query
// params (#/graph?seed=agent-a&depth=2) — shareable filtered views.

import { call } from "./api.js";

let bootstrapData = null;

export async function bootstrap(force) {
  if (!bootstrapData || force) bootstrapData = await call("api_bootstrap");
  return bootstrapData;
}

export function bootstrapCached() {
  return bootstrapData;
}

export function invalidateBootstrap() {
  bootstrapData = null;
}

// -------------------------------------------------------- RPC session cache + SWR

const rpcCache = new Map();

function rpcKey(name, params) {
  return name + ":" + JSON.stringify(params || {});
}

/** Cleared from the same seam as invalidateBootstrap (app.refresh after mutations). */
export function invalidateRpcCache() {
  rpcCache.clear();
}

/**
 * Stale-while-revalidate call: a revisit resolves instantly from the session cache
 * while the RPC refetches in the background — onFresh fires only when the
 * revalidated payload actually differs, so pages repaint on real changes and stay
 * put otherwise. First visit is just a plain call. A hit whose first fetch is
 * still in flight IS fresh: it's shared instead of firing a duplicate RPC (this
 * is what lets a page prefetch a call and then await the same one later).
 */
export function swrCall(name, params, onFresh) {
  const key = rpcKey(name, params);
  const fetchFresh = () =>
    call(name, params).then((data) => {
      rpcCache.set(key, { p: Promise.resolve(data), pending: false });
      return data;
    });
  const hit = rpcCache.get(key);
  if (!hit) {
    const p = fetchFresh().catch((e) => {
      rpcCache.delete(key);
      throw e;
    });
    rpcCache.set(key, { p, pending: true });
    return p;
  }
  if (hit.pending) return hit.p;
  Promise.all([hit.p, fetchFresh()])
    .then(([stale, fresh]) => {
      if (onFresh && JSON.stringify(stale) !== JSON.stringify(fresh)) onFresh(fresh);
    })
    .catch(() => {}); // a failed background revalidation keeps the stale view
  return hit.p;
}

// ------------------------------------------------------------------- hash routing

const ROUTE_ALIASES = {};

export function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = hash.split("?");
  const params = {};
  if (queryPart) {
    for (const pair of queryPart.split("&")) {
      if (!pair) continue;
      const [k, v] = pair.split("=");
      params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
  }
  return { route: ROUTE_ALIASES[pathPart] || pathPart || "graph", params };
}

export function buildHash(route, params) {
  const q = Object.entries(params || {})
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `#/${route}${q ? "?" + q : ""}`;
}

export function navigate(route, params) {
  location.hash = buildHash(route, params);
}

/** Update the current route's params without adding history entries per keystroke. */
export function setParams(params) {
  const { route } = parseHash();
  history.replaceState(null, "", buildHash(route, params));
}

export function listSplit(v) {
  return v ? String(v).split(",").filter(Boolean) : [];
}

export function listJoin(arr) {
  return (arr || []).join(",");
}
