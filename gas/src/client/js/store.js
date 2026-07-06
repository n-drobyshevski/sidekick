// Client state: the bootstrap payload cache and hash-based routing with query
// params (#/route?sev=CRITICAL,HIGH&q=log4j) — shareable filtered views, the port
// of the Streamlit URL-param mirroring.

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

// ------------------------------------------------------------------- hash routing

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
  return { route: pathPart || "overview", params };
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
