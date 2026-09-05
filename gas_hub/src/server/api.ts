// The RPC surface.
//
// EVERY EXPORT HERE NEEDS A DELEGATOR IN dist/entry.js, and test/entryPoints.test.js holds
// the two together by reading both as text (esbuild.config.mjs fails the build on the same
// disagreement). The failure it catches is silent and production-only: a new endpoint ships,
// the client calls it, and google.script.run reports only that the function does not exist.
//
// WHAT THIS FILE IS. Six endpoints, and no figure is computed in any of them. The hub reads
// no register, holds no ledger and runs no scan; the whole server surface is "what are the
// four tiles" plus the two admin panels that edit the properties behind them. `mutate()` and
// the script lock are ABSENT rather than trimmed to a no-op: there is no multi-row write to
// serialize, and a lock wrapper nobody needs is a lock wrapper somebody will later assume is
// doing something.
//
// THE COPY LIVES HERE, ON THE SERVER, and that is a decision rather than an accident. Tile
// names, headlines and scope lines are the product's own words about its own registers — one
// table, in the bundle that also decides which of them is reachable, rather than a client
// literal that can disagree with the URL it is drawn next to.

import { BUILD_ID } from "./buildInfo";
import * as access from "./access";
import { PROP_KEYS, setProp } from "./props";
import { readUrls, writeUrls, type TileKey } from "./urls";

/**
 * THE ENVELOPE, and it lives here rather than in dist/entry.js.
 *
 * google.script.run has no error channel that carries a message, so every RPC returns a
 * result object instead of throwing. Building it here rather than in the delegator is what
 * lets the dev harness dispatch straight into Server.api and still see exactly what the
 * deployed client sees — dev/boot.js's shim never runs entry.js.
 */
export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: string;
}

/**
 * ONE KIND, ALWAYS "error" — the sibling registers mint `busy` (the ledger lock) and
 * `not-authorized` (Apps Script refusing an outbound call before one was made) because they
 * have a lock and a tenant. This app has neither, so a second kind here would be a
 * vocabulary the client would have to branch on and could never see. `forbidden` still
 * exists and is still minted where it always was — by `access.denyResult` in entry.js,
 * before run() is ever reached.
 */
function run<T>(fn: () => T): ApiResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: "error" };
  }
}

/** One tile of the launcher: the words are fixed here, the address is not. */
export interface TileSpec {
  key: string;
  /** The eyebrow — what the sidekick is called. */
  productName: string;
  /** The headline — the job it does, which is what a reader is actually looking for. */
  headline: string;
  /** The footer — the three things that register measures. */
  scope: string;
  /** Where it lives, or null when nobody has configured it (and for the unbuilt fourth). */
  url: string | null;
}

export interface Bootstrap {
  product: string;
  buildId: string;
  tiles: TileSpec[];
  canEditAccess: boolean;
  canEditUrls: boolean;
}

/**
 * The four tiles' words, frozen in the server bundle.
 *
 * `soon` is in this table and has NO entry in `urls.ts`'s `URL_PROP`, which is what makes
 * "there is no fourth register yet" a fact about the data rather than a branch somebody can
 * forget: it cannot be handed a URL, so it cannot be rendered as a link, whatever a later
 * client does with the payload.
 */
const TILE_COPY: Array<{ key: string; productName: string; headline: string; scope: string }> = [
  {
    key: "os",
    productName: "Wiz Sidekick OS",
    headline: "OS Patching",
    scope: "Host CVEs · MTTR · SLA",
  },
  {
    key: "ai",
    productName: "Wiz Sidekick AI",
    headline: "AI",
    scope: "Agents · models · posture",
  },
  {
    key: "devsecops",
    productName: "Wiz Sidekick DevSecOps",
    headline: "DevSecOps",
    scope: "SAST · SCA · Secrets",
  },
  {
    key: "soon",
    productName: "Wiz Sidekick",
    headline: "Coming soon",
    scope: "Not yet built",
  },
];

/**
 * Everything the launcher needs before it can draw: the four tiles, and whether this caller
 * is allowed to edit either of the two things Settings edits. One round trip, because the
 * shell blocks on it.
 *
 * A blank URL becomes `null` rather than "": the client's three states are link / unset /
 * soon, and `null` is the one value that cannot be mistaken for an href.
 */
export function bootstrap(_p?: unknown): ApiResult<Bootstrap> {
  return run(() => {
    // Read as Record<string, string> deliberately: `soon` has no key in it, so the lookup
    // returns undefined and the tile gets `null`. That is the whole mechanism by which the
    // unbuilt fourth register cannot be handed an address — no branch, nothing to forget.
    const urls: Record<string, string> = readUrls();
    const tiles: TileSpec[] = TILE_COPY.map((t) => ({
      key: t.key,
      productName: t.productName,
      headline: t.headline,
      scope: t.scope,
      url: urls[t.key] || null,
    }));
    return {
      product: access.PRODUCT,
      buildId: BUILD_ID,
      tiles,
      canEditAccess: access.canEditUsers(),
      canEditUrls: access.canEditUsers(),
    };
  });
}

/**
 * A change to who may reach the app or edit access, logged with actor + before/after — never
 * the current value alone, which says who has access and nothing about who let them in or
 * when.
 */
function logAccessChange(what: string, actor: string, before: string[], after: string[]): void {
  const added = after.filter((e) => before.indexOf(e) < 0);
  const removed = before.filter((e) => after.indexOf(e) < 0);
  console.log(JSON.stringify({ access: "changed", what, actor, added, removed }));
}

/**
 * What the Access panel needs to draw itself.
 *
 * Callable by any allowed caller — the client has to ask whether to render the panel at all —
 * but THE ROSTER IS ONLY INCLUDED FOR SOMEONE WHO MAY EDIT IT. "No panel at all" has to mean
 * nothing on the wire, not just nothing in the DOM: a payload the client chose not to draw is
 * still a payload sitting in the browser's network log.
 */
export function getAccess(_p?: unknown): ApiResult<Record<string, unknown>> {
  return run(() => {
    if (!access.canEditUsers()) return { canEditUsers: false, canEditAdmins: false };
    return {
      canEditUsers: true,
      canEditAdmins: access.canEditAdmins(),
      owner: access.ownerEmail(),
      domain: access.ownerDomain(),
      users: access.currentUsers(),
      admins: access.currentAdmins(),
    };
  });
}

/**
 * Add or remove people. Owner or admin.
 *
 * THE PANEL IS NOT THE BOUNDARY — this re-checks, because `google.script.run` reaches
 * `api_saveAccess` directly from any allowed caller's browser console. Whatever the client
 * decided to draw has no bearing here.
 */
export function saveAccess(p?: { users?: unknown }): ApiResult<{ users: string[] }> {
  return run(() => {
    if (!access.canEditUsers()) throw new Error("Only the owner or an admin can change access.");
    const before = access.currentUsers();
    const list = access.validateAddresses(p?.users);
    // The owner is always written in. Redundant with the identity rule that admits them, but
    // it keeps the property self-documenting for whoever reads it in Project Settings — one
    // rule instead of a branch for "were they there before".
    const owner = access.ownerEmail().trim().toLowerCase();
    const withOwner = owner && list.indexOf(owner) < 0 ? [owner].concat(list) : list;
    setProp(PROP_KEYS.allowedUsers, withOwner.join(", "));
    logAccessChange("users", access.check().email, before, withOwner);
    return { users: withOwner };
  });
}

/**
 * Add or remove admins. OWNER ONLY — and this line is what keeps the tier real.
 *
 * An admin who could edit this could promote anyone, including making their own standing
 * permanent, and the delegation would be indistinguishable from handing over ownership. The
 * whole difference between a real second tier and a cosmetic one is this check.
 */
export function saveAdmins(p?: { admins?: unknown }): ApiResult<{ admins: string[] }> {
  return run(() => {
    if (!access.canEditAdmins()) throw new Error("Only the owner can change admins.");
    const before = access.currentAdmins();
    const list = access.validateAddresses(p?.admins);
    setProp(PROP_KEYS.allowedAdmins, list.join(", "));
    logAccessChange("admins", access.check().email, before, list);
    return { admins: list };
  });
}

/**
 * The three sibling URLs, for the Settings panel that edits them.
 *
 * Shaped like `getAccess` and for the same reason: a caller who may not edit them gets the
 * flag and NOT the values. The addresses are not secret — every allowed caller can read them
 * off the tiles — but a payload shaped "here is the editable state" for someone who cannot
 * edit it is an invitation to draw a form that will be refused on save.
 */
export function getUrls(_p?: unknown): ApiResult<Record<string, unknown>> {
  return run(() => {
    if (!access.canEditUsers()) return { canEditUrls: false };
    return { canEditUrls: true, urls: readUrls() };
  });
}

/**
 * Save whichever of the three the panel sent. Owner or admin.
 *
 * RE-CHECKS, exactly as `saveAccess` does and for the same reason — `api_saveUrls` is
 * reachable from any allowed caller's console, and what this writes becomes an anchor href
 * on the front page for everybody. `writeUrls` normalizes each field, so a value that is not
 * an Apps Script URL is refused here rather than stored and rendered.
 */
export function saveUrls(p?: { urls?: Partial<Record<TileKey, unknown>> }): ApiResult<Record<string, string>> {
  return run(() => {
    if (!access.canEditUsers()) throw new Error("Only the owner or an admin can change these.");
    const before = readUrls();
    const after = writeUrls(p?.urls || {});
    // Same shape as logAccessChange, and for the same reason: the value alone says where the
    // tiles point and nothing about who pointed them there.
    const changed = (Object.keys(after) as TileKey[]).filter((k) => after[k] !== before[k]);
    if (changed.length) {
      console.log(JSON.stringify({ urls: "changed", actor: access.check().email, changed }));
    }
    return after;
  });
}
