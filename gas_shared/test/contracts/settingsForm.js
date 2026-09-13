// The settings kernel's rule, run against every registry that binds it.
//
// `gas_shared/ui/settingsForm.js` closes over an app's own `{tabs, fields}` registry and hands
// back `normalizeTab`/`changedFields`/`settingsPatch`/`changeSummary`/`changeCountText`/
// `tabStatus`/`sameValue` — eight functions that were duplicated, near-verbatim, across gas/,
// gas_ai/ and gas_devsecops/ before this package. Two things can go wrong with a REGISTRY that
// cannot go wrong with the KERNEL ITSELF (`settingsForm()` throws at construction if a field's
// tab is not in `tabs`, or `defaultTab` is not — see that module's own header), and two things
// can go wrong with the kernel's BEHAVIOUR on any registry at all. This factory holds both:
// `registerSettingsFormContract`'s first half checks THIS app's own registry is well-formed by
// construction (which the throw already guarantees, so this half is a second, independent
// reader of the same claim — the throw is exercised by actually importing the app's
// settingsModel.js, which is the load-bearing check); the second half runs the kernel's fixed
// behaviour against a small SYNTHETIC registry defined in this file, so the assertions are
// identical for every app rather than each hand-deriving them from its own field names.
//
// THE DIRECT-IMPORT-PATH RULE IS ASSERTED HERE TOO, as a specifier regex against the app's own
// source rather than trusted from the module header alone. `settingsForm.js` is DOM-free and
// deliberately NOT in `ui/index.js` — a settings-model test has no reason to pull in the other
// 33 component modules (`dom.js`'s `el()` included) to reach eight pure functions, and every
// app's own `settingsModel.js`-equivalent file runs under plain Node with no jsdom. Read as
// source text rather than exercised by import: the FAILURE this guards is a future edit that
// adds `settingsForm` to the barrel and re-points an app at `ui.js`/`ui/index.js` instead of
// the direct path — which would still resolve and pass every other assertion here, so nothing
// but a text check on the import line would ever notice.
//
// THE PERTURBATION IS IN THIS FILE, not in a comment. `tabStatus`'s `invalid` flag is read by
// KEY PRESENCE (`Object.prototype.hasOwnProperty`), never truthiness, because a caller's
// contract is to DELETE an error key once that field clears rather than set it to a falsy
// placeholder. The tempting rewrite — `if (errors[field])` instead of `field in errors` — is
// reproduced inline below and shown silently un-invalidating a tab whose field carries an
// empty-string error, the way `hubUrl.js` reproduces the unsafe `safeHubUrl`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { settingsForm } from "../../ui/settingsForm.js";

// ------------------------------------------------------------------ the synthetic registry
//
// Three fields across two owning tabs, plus a THIRD tab (gamma) that owns nothing at all —
// which is what lets "never mentions a tab owning no batched field" be an assertion rather than
// an assumption. Nothing here echoes any real app's field names on purpose: this half of the
// contract is testing the KERNEL, not any one registry.
const TABS = [
  { key: "alpha", label: "Alpha" },
  { key: "beta", label: "Beta" },
  { key: "gamma", label: "Gamma" },
];
const FIELDS = {
  one: { tab: "alpha", label: "One" },
  two: { tab: "alpha", label: "Two" },
  three: { tab: "beta", label: "Three" },
};
const KERNEL = settingsForm({ tabs: TABS, fields: FIELDS, defaultTab: "alpha" });

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {{key: string, label: string}[]} ctx.tabs    this app's own tablist (e.g. its
 *   settingsModel.js's `SETTINGS_TABS`)
 * @param {object}   ctx.fields   this app's own `{fieldName: {tab, label}}` registry (e.g. its
 *   settingsModel.js's `SETTING_FIELDS`)
 * @param {string}   [ctx.settingsModelPath]  path (relative to appRoot) of the file that
 *   imports `settingsForm` — default `"src/client/js/settingsModel.js"`. gas_hub has no such
 *   file (its registry lives inline in `pages/settings.js`, see that file's own header) and
 *   passes `"src/client/js/pages/settings.js"` instead.
 * @param {boolean}  [ctx.spine]  Opt-in, the same shape `ctx.localSheets` in parity.js uses:
 *   pass `true` to also check `ctx.tabs` against the canonical spine (Register first, Access
 *   then System last, `ctx.defaultTab === "register"`) — the settings-unification wave's own
 *   shape for gas/gas_ai/gas_devsecops, meant to stop a future drive-by quietly moving one
 *   register's tablist back to something else (gas_ai opened on Graph before that wave).
 *   Omitted or `false`, the check is a NAMED `it.skip` rather than a silent absence — pass
 *   `false` explicitly (the way `syncCaption.js`'s `railHasSyncZone: false` does) for an app
 *   whose `ctx.tabs` is not this spine at all, the way `gas_hub`'s single-tab URL registry
 *   isn't.
 * @param {string}   [ctx.defaultTab]  this app's own `DEFAULT_TAB` (e.g. its settingsModel.js's
 *   export of the same name) — required when `ctx.spine` is `true`.
 */
export function registerSettingsFormContract(ctx) {
  const { describe, it, expect, app, tabs, fields } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const modelPath = ctx.settingsModelPath || "src/client/js/settingsModel.js";

  // ---------------------------------------------------------------- this app's own registry
  describe(app + ": the settings registry is well-formed", () => {
    it("names a real tab for every field", () => {
      const tabKeys = tabs.map((t) => t.key);
      for (const [field, meta] of Object.entries(fields)) {
        expect(tabKeys, field + " names a tab that does not exist").toContain(meta.tab);
      }
    });

    it("has no two tabs sharing a key", () => {
      const keys = tabs.map((t) => t.key);
      expect(new Set(keys).size, app + "'s tablist has a duplicate key").toBe(keys.length);
    });

    it("gives every tab and every field a non-empty label", () => {
      for (const t of tabs) {
        expect(typeof t.label, t.key + "'s tab label").toBe("string");
        expect(t.label.length, t.key + "'s tab label is empty").toBeGreaterThan(0);
      }
      for (const [field, meta] of Object.entries(fields)) {
        expect(typeof meta.label, field + "'s label").toBe("string");
        expect(meta.label.length, field + "'s label is empty").toBeGreaterThan(0);
      }
    });

    it("actually throws on the malformed shapes above — the throw, not just this describe "
      + "block, is what a hand-edit has to get past", () => {
      const tabKeys = tabs.map((t) => t.key);
      expect(() => settingsForm({ tabs, fields: { ...fields, __bogus: { tab: "nope-not-real", label: "x" } }, defaultTab: tabKeys[0] }))
        .toThrow(/names tab/);
      expect(() => settingsForm({ tabs, fields, defaultTab: "nope-not-real" }))
        .toThrow(/defaultTab/);
    });
  });

  // ---------------------------------------------------------------- the direct-import rule
  describe(app + ": settingsForm is reached by direct path, never through the barrel", () => {
    const src = readFileSync(resolve(root, modelPath), "utf8");

    it("imports settingsForm from gas_shared/ui/settingsForm.js by specifier", () => {
      expect(src).toMatch(/from\s+["'][./]*gas_shared\/ui\/settingsForm\.js["']/);
    });

    it("does not reach settingsForm through ui/index.js or an app's own ui.js barrel", () => {
      // The failure this catches: someone adds settingsForm to the barrel and switches this
      // import to "../ui.js" or ".../gas_shared/ui/index.js" because it "already has
      // everything else." Both resolve and every assertion above still passes — only a text
      // check on the import line notices.
      expect(src).not.toMatch(/settingsForm[\s\S]{0,80}from\s+["'][./]*gas_shared\/ui\/index\.js["']/);
      expect(src).not.toMatch(/settingsForm[\s\S]{0,80}from\s+["'][./]*ui\.js["']/);
    });
  });

  // ---------------------------------------------------------------- the kernel's own behaviour
  describe(app + ": the settings kernel's behaviour, against a synthetic registry", () => {
    it("changedFields is order-insensitive for arrays — re-picking a set is not an edit", () => {
      const saved = { one: ["a", "b"], two: 1, three: "x" };
      const draft = { one: ["b", "a"], two: 1, three: "x" };
      expect(KERNEL.changedFields(saved, draft)).toEqual([]);
    });

    it("changedFields reports what actually moved, in registry order", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      const draft = { one: ["a"], two: 2, three: "y" };
      expect(KERNEL.changedFields(saved, draft)).toEqual(["two", "three"]);
    });

    it("settingsPatch carries only the changed keys, with their draft values", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      const draft = { one: ["a"], two: 5, three: "x" };
      expect(KERNEL.settingsPatch(saved, draft)).toEqual({ two: 5 });
    });

    it("settingsPatch is empty when nothing moved", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      expect(KERNEL.settingsPatch(saved, { ...saved })).toEqual({});
    });

    it("changeSummary names the owning tab and its label for each change", () => {
      expect(KERNEL.changeSummary(["two", "three"])).toEqual([
        { field: "two", label: "Two", tab: "alpha", tabLabel: "Alpha" },
        { field: "three", label: "Three", tab: "beta", tabLabel: "Beta" },
      ]);
    });

    it("changeSummary silently drops a key the registry does not own", () => {
      // Defensive rather than vacuous — see settingsForm.js's own header for the app this
      // matters to (gas_devsecops's `showExperimental`, part of its draft but no batched tab).
      expect(KERNEL.changeSummary(["two", "not-a-real-field"])).toEqual([
        { field: "two", label: "Two", tab: "alpha", tabLabel: "Alpha" },
      ]);
    });

    it("changeCountText takes the array and pluralizes on its length", () => {
      expect(KERNEL.changeCountText([])).toBe("0 unsaved changes");
      expect(KERNEL.changeCountText(["one"])).toBe("1 unsaved change");
      expect(KERNEL.changeCountText(["one", "two"])).toBe("2 unsaved changes");
    });

    it("tabStatus marks dirty and invalid independently", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      const dirtyOnly = KERNEL.tabStatus({ ...saved, two: 2 }, saved, {}, KERNEL.TAB_FIELDS);
      expect(dirtyOnly.alpha).toEqual({ dirty: true, invalid: false });
      const invalidOnly = KERNEL.tabStatus(saved, saved, { two: "bad" }, KERNEL.TAB_FIELDS);
      expect(invalidOnly.alpha).toEqual({ dirty: false, invalid: true });
    });

    it("tabStatus never mentions a tab owning no batched field", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      const status = KERNEL.tabStatus(saved, saved, {}, KERNEL.TAB_FIELDS);
      expect(status.gamma).toBeUndefined();
    });

    it("normalizeTab falls back to the default for a tab that does not exist", () => {
      expect(KERNEL.normalizeTab("nonsense")).toBe("alpha");
      expect(KERNEL.normalizeTab(undefined)).toBe("alpha");
    });

    it("normalizeTab's two-argument form rejects a tab the caller did not build", () => {
      expect(KERNEL.normalizeTab("beta", ["alpha", "gamma"])).toBe("alpha");
      expect(KERNEL.normalizeTab("beta", ["alpha", "beta"])).toBe("beta");
    });

    it("sameValue treats two NaN fields as unchanged, and a NaN against null as changed", () => {
      // THE LEAF THIS KERNEL RESOLVES TO, over the three predecessors' three different wrong
      // answers — see settingsForm.js's own header for gas_ai's reachable `Number("1e400")`
      // case. `JSON.stringify(NaN)`/`JSON.stringify(Infinity)`/`JSON.stringify(null)` are all
      // `"null"`, so a JSON.stringify-fallback leaf (gas's/gas_ai's old sameValue) reads NaN
      // and null as equal; a bare `a === b` leaf (gas_devsecops's old sameFieldValue) reads two
      // matching NaNs as different. `Object.is` closes exactly the first gap without reopening
      // the second.
      expect(KERNEL.sameValue(Number.NaN, Number.NaN)).toBe(true);
      expect(KERNEL.sameValue(Number.NaN, null)).toBe(false);
      expect(KERNEL.sameValue(Number.NaN, Infinity)).toBe(false);
    });

    it("sameValue recurses into an object, order-insensitive on its nested arrays", () => {
      // gas's own sameValue never grew this branch (nothing it owns needed it — see
      // settingsForm.js's header); gas_ai's and gas_devsecops's `fiveRsPins`/`slaTargets`-shaped
      // fields do, so the kernel carries it for every app that binds it, not just the two that
      // exercise it today.
      const a = { in: ["p1", "p2"], out: ["p3"] };
      const b = { in: ["p2", "p1"], out: ["p3"] };
      expect(KERNEL.sameValue(a, b)).toBe(true);
      expect(KERNEL.sameValue(a, { in: ["p1"], out: ["p3"] })).toBe(false);
    });

    // ====================================================================== perturbation
    it("a truthiness read of errors instead of key presence silently un-invalidates a tab "
      + "whose field carries a falsy-but-present error", () => {
      const saved = { one: ["a"], two: 1, three: "x" };

      // THE WRONG VERSION, reproduced rather than described: `if (errors[field])` instead of
      // `Object.prototype.hasOwnProperty.call(errors, field)`. Everything else is copied from
      // settingsForm.js's own tabStatus so the only variable is the one line under test.
      function defectiveTabStatus(draft, savedSnapshot, errors, tabFields) {
        const out = {};
        for (const tab of new Set(Object.values(tabFields))) out[tab] = { dirty: false, invalid: false };
        for (const [field, tab] of Object.entries(tabFields)) {
          if (!out[tab]) continue;
          if (!KERNEL.sameValue(savedSnapshot[field], draft[field])) out[tab].dirty = true;
          if (errors[field]) out[tab].invalid = true; // THE BUG: truthiness, not presence
        }
        return out;
      }

      // A field "cleared" the way a caller is contractually forbidden to (a falsy placeholder
      // left in place instead of the key being deleted) — see tabStatus's own header.
      const errors = { two: "" };
      const defective = defectiveTabStatus(saved, saved, errors, KERNEL.TAB_FIELDS);
      expect(defective.alpha.invalid).toBe(false); // the bug: misses the present-but-falsy key

      const real = KERNEL.tabStatus(saved, saved, errors, KERNEL.TAB_FIELDS);
      expect(real.alpha.invalid).toBe(true); // the shipped implementation does not miss it
    });
  });

  // ---------------------------------------------------------------- the canonical tab spine
  // Register · <app lanes> · Access · System, DEFAULT_TAB === "register" — see ctx.spine's own
  // JSDoc above for what this guards and why gas_hub is the one app that names its way out.
  if (ctx.spine) {
    describe(app + ": the canonical settings tab spine (Register · … · Access · System)", () => {
      it("opens on Register", () => {
        expect(tabs[0] && tabs[0].key, app + "'s first tab is not \"register\"").toBe("register");
      });

      it("closes on Access, then System", () => {
        const keys = tabs.map((t) => t.key);
        expect(keys.slice(-2), app + "'s last two tabs are not [\"access\", \"system\"]")
          .toEqual(["access", "system"]);
      });

      it("defaults to the Register tab", () => {
        expect(ctx.defaultTab, app + "'s DEFAULT_TAB is not \"register\"").toBe("register");
      });
    });
  } else {
    it.skip(
      app + ": the canonical settings tab spine (Register · … · Access · System) — SKIPPED: "
      + (ctx.spine === false
        ? "this app's own registration call names why its tabs are not this spine."
        : "no ctx.spine given"),
      () => {},
    );
  }
}
