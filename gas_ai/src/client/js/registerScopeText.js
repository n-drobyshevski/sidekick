// How a person reads a register-scope signature.
//
// A MIRROR of `formatRegisterScope`/`describeRegisterScope` in src/domain/registerScope.ts,
// not an import: this bundle cannot reach the domain layer (every client module that needs a
// domain rule mirrors it — assetQuery.js, decideMirror.js, egoLayout.js all say so in their
// own headers), and `test/registerScopeText.test.js` runs both implementations over the same
// signatures and requires them to agree. A second answer to "what does this stamp say" is
// exactly the kind of drift that mirror test exists to make impossible.
//
// WHY IT IS WORTH A MODULE. The signature is `wct-id-1998|wct-id-3` with `#tenant` glued to
// the END when the sync applied no project filter — see registerScopeSignature for why only
// the widening is stamped. A reader that splits on `|` alone therefore prints a category
// called `wct-id-3#tenant`, which is not a category at all, and TWO surfaces show a
// signature to a person: the issue sheet's Register scope row and the scope-drift notice.
// One parser, so neither can learn the suffix without the other.

/** Must match TENANT_SUFFIX in src/domain/registerScope.ts. */
const TENANT_SUFFIX = "#tenant";

/** A signature apart: `{ categories, tenantWide }`. Refuses a non-string before the split. */
export function describeRegisterScope(signature) {
  const raw = typeof signature === "string" ? signature : "";
  const tenantWide = raw.slice(-TENANT_SUFFIX.length) === TENANT_SUFFIX;
  const body = tenantWide ? raw.slice(0, -TENANT_SUFFIX.length) : raw;
  return { categories: body ? body.split("|") : [], tenantWide };
}

/**
 * The signature as prose: the categories, and the perimeter note when there is one.
 *
 * SILENT about the perimeter in the project case, and deliberately. An unsuffixed token says
 * that SOME project filter applied and never which one, so naming a project here would be a
 * claim the stamp cannot support — and every row written before the perimeter was a setting
 * carries exactly that token.
 */
export function formatRegisterScope(signature) {
  const { categories, tenantWide } = describeRegisterScope(signature);
  const list = categories.join(", ");
  if (!tenantWide) return list;
  return list ? list + " (all perimeters)" : "all perimeters";
}
