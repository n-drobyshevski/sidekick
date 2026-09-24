// Client state: the bootstrap payload cache and hash-based routing with query
// params (#/graph?seed=agent-a&depth=2) — shareable filtered views.

import { appConfig } from "./appConfig.js";
import { call } from "./api.js";

let bootstrapData = null;
let inlineTaken = false;

/**
 * The bootstrap envelope doGet rendered into the page (gas_shared/server/inlineBoot.ts), read
 * ONCE and then removed from the DOM: it is the state of the world at page load, so it may
 * answer the first bootstrap() only — a forced refresh after a mutation must ask the server.
 * Anything short of an `{ok:true}` envelope (no block, an empty slot, the dev harness's
 * unrendered scriptlet) returns null and the caller falls back to the RPC.
 */
function takeInlineBootstrap() {
  if (inlineTaken || typeof document === "undefined") return null;
  inlineTaken = true;
  const node = document.getElementById("boot-data");
  if (!node) return null;
  if (node.parentNode) node.parentNode.removeChild(node);
  try {
    const env = JSON.parse(node.textContent);
    return env && env.ok === true ? env.data : null;
  } catch {
    return null;
  }
}

export async function bootstrap(force) {
  const inline = takeInlineBootstrap();
  if (!bootstrapData && !force && inline) bootstrapData = inline;
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

/**
 * One page payload fetched as PARALLEL parts, merged back into one object.
 *
 * WHY. Apps Script runs each `google.script.run` call as its own server execution, and
 * separate calls run CONCURRENTLY. A page whose endpoint composes several independent
 * read-models one after another pays their SUM on a cold cache; asked for part by part, it
 * pays roughly the slowest part plus one round trip. The Executive page is the case: a cold
 * load was measured at 146 s, serial.
 *
 * Each part is its own `swrCall` (params plus `{part}`), so each is session-cached and
 * revalidated on its own. The merge is a shallow `Object.assign` in `parts` order, so the parts
 * must name disjoint keys — the server's part table guarantees it.
 *
 * ALL OR NOTHING, as the single call was: any part failing rejects, so a page never paints a
 * payload missing a block it would read as "empty". `onFresh(merged)` fires when a background
 * revalidation of any part changed it, with every part's latest value merged in.
 *
 * @param {string}   name    the RPC, e.g. "api_getExecutivePage"
 * @param {string[]} parts   the part names the server's endpoint knows
 * @param {object}   params  shared params for every part
 * @param {(merged: object) => void} [onFresh]
 * @returns {Promise<object>} the merged payload
 */
export function swrParts(name, parts, params, onFresh) {
  const latest = new Array(parts.length).fill(null);
  const merge = () => Object.assign({}, ...latest);
  const calls = parts.map((part, i) => swrCall(name, { ...(params || {}), part }, (fresh) => {
    latest[i] = fresh;
    if (onFresh && latest.every((v) => v !== null)) onFresh(merge());
  }).then((data) => {
    latest[i] = data;
    return data;
  }));
  return Promise.all(calls).then(merge);
}

// ------------------------------------------------------------------- hash routing

const ROUTE_ALIASES = {};

/**
 * The app's front door, in ONE place.
 *
 * This used to be a bare "problems" literal here and a separate `|| PAGES.graph` in app.js's
 * route(), left over from when the graph was the landing route. The two disagreed, and the
 * disagreement was reachable: parseHash falls back only for an EMPTY path, so an unknown path
 * passed straight through and route() then resolved it against its own stale default. A stale
 * or mistyped deep link like #/overview rendered the HIDDEN Security Graph, titled the
 * document "Security Graph", and left no nav item marked current.
 *
 * app.js hands this over in the manifest (appConfig.js) rather than repeating it, so a
 * future change to the first PAGES key cannot leave a second answer behind.
 *
 * A FUNCTION, NOT A CONSTANT, and that is forced rather than stylistic: this module is
 * shared, so the answer differs per host and cannot be read at module load — see
 * appConfig.js's rule 2. `parseHash()` calls it; so do app.js and navFlyout.js.
 */
export function defaultRoute() {
  return appConfig().defaultRoute;
}

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
  return { route: ROUTE_ALIASES[pathPart] || pathPart || defaultRoute(), params };
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
