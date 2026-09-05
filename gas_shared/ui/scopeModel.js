// ONE SCOPE CONTROL, THREE REGISTERS — and the half of it that has no DOM.
//
// All three sidekicks had grown the same header control independently: gas's
// `scopeSwitch.js` (363 lines, domains + support groups), gas_ai's `ui/projectScope.js`
// (427, projects + domains) and gas_devsecops's `ui/projectScope.js` (264, projects only).
// The three agreed on everything a reader can see — one combobox in the appbar, option
// groups by kind, a value prefixed so two kinds can share a name, one caption below it, one
// reset row that clears every kind at once, a `.scoped` state on the trigger — and they
// agreed by copying, which is the condition `test/contracts/parity.js` exists to end.
//
// WHAT IS ACTUALLY SHARED, AND WHAT IS NOT. What differs between the three is not the
// control, it is the REGISTER'S VOCABULARY: which dimensions exist, what a row of each says
// about itself, what the caption has to admit (gas's `Not attributable` bucket is measured
// over base rows and can never appear in the live frame; gas_ai's domain caption carries a
// coverage figure because only some assets are tagged; devsecops's carries the count nobody
// could attribute to a project). None of that generalises, and flattening it would be the
// comfortable lie each of those clauses was written to refuse. So the app keeps its
// vocabulary as DATA — a `scopeKinds` array, the manifest field `appConfig.js` already
// reserved — and this module assembles it.
//
// THE PAYLOAD FUNCTION IS THE POINT OF THE SEAM. Each app's server contract is fixed and
// different: gas holds `{domain, supportGroup}` client-side and passes it into every page's
// own RPC; gas_ai writes `{domainView}` or `{projectView}` through `api_setSettings`;
// devsecops writes `{projectView}` through `api_setProjectView`. A shared control that tried
// to unify those would have to change a persisted settings schema in two apps to save a line
// in one. Instead a kind carries `payload(id)`, the exact object the app already sent, and
// `test/contracts/scope.js` pins each app's table of them against what the deleted
// implementation produced.
//
// NO HEADINGS ARE SYNTHESISED HERE. A kind's `options(data)` returns rows that already carry
// their own `group`, because the grouping a reader sees is not the kind — gas_ai and
// devsecops both split ONE kind (projects) into "Business units" / "Support groups" /
// "Projects" — and a kind-level heading layered over that would give devsecops's single-kind
// list a heading it does not have today. The list is the concatenation of the kinds' own
// rows, in the order the app declares them.

/** The separator between a kind's prefix and its id. A colon, as all three apps already
 *  spelled it (`d:` for gas_ai's domains, `sg:` for gas's support groups). */
const SEP = ":";

/**
 * A kind's prefix and an id, as one opaque option value.
 *
 * ONE OF THE KINDS HAS TO CARRY A PREFIX OR TWO OF THEM COLLIDE: a domain and a support group
 * both named `Payments` are one row in the list and one value on the wire. All three apps had
 * reached that conclusion separately and all three solved it the same way — leave the FIRST
 * kind bare and prefix the rest (`sg:` in gas, `d:` in gas_ai). That asymmetry is kept rather
 * than tidied away, and the reason is not sentiment: the option value is what a stored scope
 * and a `test/scopeSwitchView.test.js` assertion are written in, so prefixing the bare kind
 * would rewrite three apps' emitted values to buy nothing a reader can see.
 *
 * So `prefix: ""` is legal and means "this kind's values are the ids themselves". AT MOST ONE
 * KIND MAY BE BARE — two would make the encoding ambiguous in exactly the way it exists to
 * prevent — and `assertKinds` below refuses a list with two.
 *
 * An empty id is the reset and encodes as "", never as `"d:"`: the combobox's pinned row
 * carries value "" and resolves it to the reset row rather than to a kind.
 */
export function encodeScope(prefix, id) {
  const key = prefix === null || prefix === undefined ? "" : String(prefix);
  const value = id === null || id === undefined ? "" : String(id);
  if (!value) return "";
  return key ? key + SEP + value : value;
}

/**
 * The inverse, resolved against the kinds that produced it.
 *
 * `kinds` is optional only so a caller holding a value it already knows the shape of can ask
 * the cheap question. WITHOUT IT A BARE VALUE IS UNREADABLE — `"Payments"` is a domain in gas
 * and a project slug in devsecops, and neither is inferable from the string. With it, the
 * answer is exact: a value whose head matches a kind's prefix belongs to that kind; anything
 * else belongs to the bare kind if there is one, and is the reset if there is not.
 *
 * Splitting on the FIRST separator only, because an id may legitimately contain one — a
 * domain named `eu:payments` is a tag value someone typed.
 *
 * An unrecognised prefix on an app WITH a bare kind reads as a bare id, which is the honest
 * answer: `sg:Payments` restored into a build that has dropped the support-group dimension is
 * a scope nothing can serve, and `scopeView` will mark it stale and say so, rather than this
 * function silently discarding it.
 */
export function parseScope(value, kinds) {
  const s = value === null || value === undefined ? "" : String(value);
  if (!s) return { kind: "", id: "" };
  const at = s.indexOf(SEP);
  const head = at > 0 ? s.slice(0, at) : "";
  const list = kinds || [];
  if (head && list.some((k) => k.prefix === head)) {
    return { kind: head, id: s.slice(at + 1) };
  }
  // No kinds given: fall back to the shape of the string alone.
  if (!list.length) {
    return at > 0 && at < s.length - 1 ? { kind: head, id: s.slice(at + 1) } : { kind: "", id: s };
  }
  const bare = list.find((k) => !k.prefix);
  return bare ? { kind: "", id: s } : { kind: "", id: "" };
}

/**
 * At most one bare kind. A LIST WITH TWO IS THE COLLISION THE PREFIX EXISTS TO PREVENT, and
 * it fails silently: both kinds' ids land in the same namespace, the first match wins, and a
 * domain named `Payments` quietly selects a support group of the same name. Nothing on screen
 * would say so — the label comes from the option that matched. So it throws.
 */
function assertKinds(kinds) {
  let bare = 0;
  const seen = new Set();
  for (const k of kinds) {
    if (!k.prefix) bare++;
    else if (seen.has(k.prefix)) {
      throw new Error("gas_shared/ui/scopeModel.js: two scope kinds share the prefix " + k.prefix);
    } else seen.add(k.prefix);
  }
  if (bare > 1) {
    throw new Error(
      "gas_shared/ui/scopeModel.js: " + bare + " scope kinds have no prefix — at most one may "
      + "be bare, or two ids sharing a name select the wrong dimension with nothing to show it",
    );
  }
}

/**
 * Everything the control asserts, from the app's kinds and its bootstrap payload alone.
 *
 * DOM-free on purpose, the way all three implementations already were: the label, the
 * caption and whether a stored scope has gone stale are CLAIMS, and a claim is the half that
 * can be wrong. `scopeControl.js` only assembles what this decides.
 *
 * @param {object} spec
 * @param {Array}  spec.kinds  the register's dimensions, in list order. Each:
 *   `{ key, prefix, icon, options(data), label(opt, data, ctx), caption(opt, data, ctx),
 *      payload(id) }`
 *   - `options(data)` -> `[{ id, label, hint, group, icon }]`; `group` is the heading the row
 *     sits under, "" for none. The kind may split its own rows across several.
 *   - `label(opt, data, {stale})` -> what the trigger's accessible name calls this scope.
 *   - `caption(opt, data, {stale})` -> the sentence under the control.
 *   - `payload(id)` -> the object the app sends. Never called for the reset.
 * @param {object} spec.chrome  the parts that are not a kind:
 *   `{ show, label, caption(data), reset: {label, hint(data), icon}, resetPayload(),
 *      defaultLabel, fallbackLabel, ariaLabel(label), searchPlaceholder, header, popClass }`
 * @param {object|null} spec.data  the bootstrap payload, or null when boot failed
 * @param {{kind: string, id: string}|string|null} spec.active  the scope in force: either
 *   `{kind: <a kind KEY>, id}` (what an app holds) or an encoded value (what the combobox
 *   emits). Both are accepted so a caller never has to encode just to ask a question.
 * @returns {{show, kind, active, label, caption, stale, scoped, options, pinned, payload}}
 */
export function scopeView(spec) {
  const kinds = (spec && spec.kinds) || [];
  const chrome = (spec && spec.chrome) || {};
  const data = (spec && spec.data) || null;

  // The active scope, normalised to `{key, id}` where `key` is the kind's KEY.
  assertKinds(kinds);
  const chosen = normalizeActive(spec && spec.active, kinds);

  const hidden = {
    show: false, kind: "", active: "", label: "", caption: "",
    stale: false, scoped: false, options: [], pinned: [], payload: null,
  };
  // AN EMPTY PICKER IS A PROMISE THE REGISTER CANNOT KEEP. `chrome.show` is the app's own
  // answer to "is there anything to slice this register by" — nothing synced, boot failed,
  // one bucket and therefore no choice. Every one of the three had its own version of that
  // test and none of them generalises, so it stays the app's.
  if (chrome.show === false) return hidden;

  const options = [];
  for (const kind of kinds) {
    const rows = (typeof kind.options === "function" ? kind.options(data) : []) || [];
    for (const row of rows) {
      options.push({
        value: encodeScope(kind.prefix, row.id),
        kind: kind.key,
        id: row.id,
        label: row.label,
        hint: row.hint || "",
        // Straight through: see the module header for why nothing is synthesised.
        group: row.group || "",
        icon: row.icon || "",
      });
    }
  }

  const activeKind = chosen.key ? kinds.find((k) => k.key === chosen.key) || null : null;
  const active = activeKind ? encodeScope(activeKind.prefix, chosen.id) : "";
  const scoped = Boolean(active);
  const opt = scoped ? options.find((o) => o.value === active) || null : null;
  // A stored scope naming something the register no longer holds — a project that fell out
  // after a re-sync scoped elsewhere, a manual group deleted from settings, a tag value that
  // vanished when the tag key was corrected under it. NOT an error: the control still offers
  // every real row, so the state is escapable rather than a dead end.
  const stale = scoped && !opt;
  // `id` IS IN HERE BECAUSE A STALE SCOPE HAS NO OPTION TO READ ITS NAME OFF, and that is
  // precisely when the label has to name it: "Payments — not in this register" tells the
  // reader which scope went, where "not in this register" alone tells them only that one did.
  // `opt` is null on that path by construction, so without the raw id the two apps that carry
  // a stale caption would each need a copy of the active scope smuggled in beside the call.
  const ctx = { stale, id: chosen.id };

  const label = scoped && activeKind
    ? String(activeKind.label(opt, data, ctx))
    : String(chrome.label || "");
  const caption = scoped && activeKind
    ? String(activeKind.caption(opt, data, ctx))
    : String(typeof chrome.caption === "function" ? chrome.caption(data) : chrome.caption || "");

  const reset = chrome.reset || {};
  return {
    show: true,
    kind: activeKind ? activeKind.key : "",
    active,
    label,
    caption,
    stale,
    scoped,
    options,
    // "Everything …", never "All <one kind>": the row clears EVERY kind, and naming it after
    // one of them describes a fraction of what it does.
    pinned: [{
      value: "",
      label: reset.label || "",
      hint: typeof reset.hint === "function" ? reset.hint(data) : (reset.hint || ""),
      icon: reset.icon || "",
    }],
    // What the app sends for the scope in force. Computed here rather than at the pick, so a
    // test can assert the wire object without a DOM and without a click.
    payload: scoped && activeKind
      ? activeKind.payload(chosen.id)
      : (typeof chrome.resetPayload === "function" ? chrome.resetPayload() : null),
  };
}

/**
 * The payload for a value the CONTROL emitted, which is the other direction.
 *
 * `scopeView().payload` answers "what is in force"; this answers "what did they just pick",
 * and the two must never disagree — they are the same function of the same kinds, so it is
 * the same code path with the value parsed first.
 */
export function scopePayload(kinds, chrome, value) {
  const list = kinds || [];
  const parsed = parseScope(value, list);
  if (!parsed.id) {
    return typeof chrome?.resetPayload === "function" ? chrome.resetPayload() : null;
  }
  const kind = parsed.kind
    ? list.find((k) => k.prefix === parsed.kind)
    : list.find((k) => !k.prefix);
  if (!kind) {
    return typeof chrome?.resetPayload === "function" ? chrome.resetPayload() : null;
  }
  return kind.payload(parsed.id);
}

/**
 * `{kind, id}` from either accepted shape, resolved against the kind KEYS.
 *
 * A caller passing `{kind: "domain", id: "Payments"}` names a kind's key; a caller passing
 * the encoded `"d:Payments"` names its prefix. Keys and prefixes are deliberately different
 * strings (`domain` / `d`), so the two namespaces cannot be confused for one another and the
 * check below can be exact rather than a guess.
 */
function normalizeActive(active, kinds) {
  if (!active) return { key: "", id: "" };
  if (typeof active === "string") {
    const parsed = parseScope(active, kinds);
    if (!parsed.id) return { key: "", id: "" };
    const kind = parsed.kind
      ? kinds.find((k) => k.prefix === parsed.kind)
      : kinds.find((k) => !k.prefix);
    return kind ? { key: kind.key, id: parsed.id } : { key: "", id: "" };
  }
  const id = active.id === null || active.id === undefined ? "" : String(active.id);
  if (!id) return { key: "", id: "" };
  const kind = kinds.find((k) => k.key === active.kind);
  return kind ? { key: kind.key, id } : { key: "", id: "" };
}
