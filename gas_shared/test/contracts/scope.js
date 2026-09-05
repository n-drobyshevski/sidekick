// The scope seam: an app declares its dimensions, and this holds them to the contract.
//
// `gas_shared/ui/scopeModel.js` assembles a register's scope control out of a `scopeKinds`
// array the app supplies. That array is DATA, and data is the kind of thing that grows a
// fourth entry two years from now with nobody left who remembers what a `payload` was for. So
// the shape is checked here rather than in each app's own file, and the parts that ARE each
// app's — which kinds, what each one sends on the wire — arrive as arguments.
//
// THE PAYLOAD TABLE IS THE POINT OF THIS FILE. Everything else here is shape-checking that a
// type system would do; `payloads` is the one assertion that could not be derived from the
// code, because it is a claim about what the DELETED implementation used to send. Each app
// writes down, per kind, the exact object its old control produced for a chosen id — gas's
// `{domain, supportGroup}`, gas_ai's `{projectView}` / `{domainView}`, devsecops's
// `{projectView}` — and this asserts the new one produces it byte for byte. Without that,
// "the refactor changed nothing" is a hope: a scope control that silently sent
// `{project: "x"}` where the server reads `projectView` renders a page of zeroes, which is
// exactly what an empty project looks like.
//
// A GUARD THAT FIRES ON NOTHING IS A FINDING. This one was perturbed by swapping a kind's
// payload key (`projectView` -> `project`) in each of the three apps; each perturbation failed
// the "sends exactly what this register's server takes" spec for that app and nothing else,
// which is what makes the table a check rather than a restatement.

import { UI_ICON_NAMES } from "../../ui/uiIcons.js";

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {Function} ctx.scopeKinds   (data) => the app's kinds array
 * @param {Function} ctx.scopeChrome  (data) => the app's chrome object
 * @param {object}   ctx.data         a bootstrap fixture rich enough that every kind yields
 *                                    at least one option
 * @param {object}   ctx.model        the shared module's exports: `{scopeView, scopePayload,
 *                                    encodeScope, parseScope}`
 * @param {Array}    ctx.payloads     `[{ kind, id, payload }]` — one row per kind, `payload`
 *                                    being the exact object the app's server contract takes.
 *                                    Written down from the DELETED implementation.
 * @param {object}   ctx.resetPayload what the reset row sends
 * @param {string[]} [ctx.emptyKinds] kinds that legitimately yield zero options on `data`
 *                                    (gas_ai's domains when nothing is tagged). Named rather
 *                                    than tolerated, so a kind that silently stopped
 *                                    producing rows is a failure and not a shrug.
 */
export function registerScopeContract(ctx) {
  const { describe, it, expect, app, model } = ctx;
  const { scopeView, scopePayload, encodeScope, parseScope } = model;
  const kinds = ctx.scopeKinds(ctx.data);
  const chrome = ctx.scopeChrome(ctx.data);
  const emptyKinds = ctx.emptyKinds || [];

  describe(app + ": the scope kinds this register declares", () => {
    it("gives every kind a key, a glyph, and the four functions the model calls", () => {
      expect(kinds.length).toBeGreaterThan(0);
      for (const k of kinds) {
        expect(typeof k.key, "a kind with no key cannot be named by app.js").toBe("string");
        expect(k.key.length).toBeGreaterThan(0);
        expect(typeof k.prefix).toBe("string");
        // The trigger draws this and `uiIcon()` falls back to a dot for a name it does not
        // hold — silently, which is the defect that kept gas's combobox forked for a whole
        // pass. A kind with no glyph would draw the reset row's, which is a different claim.
        expect(typeof k.icon, k.key + " has no trigger glyph").toBe("string");
        expect(k.icon.length).toBeGreaterThan(0);
      }
    });

    it("names only glyphs the shared icon set actually holds", () => {
      // THE EXACT DEFECT THAT COST A PACKAGE. `gas/src/client/js/ui/combobox.js` stayed forked
      // for a whole pass because `users` and `noTag` were not in `gas_shared/ui/uiIcons.js`,
      // and `uiIcon()` answers an unknown name with a 1px dot and no error — so the swap would
      // have blanked the glyph on every support-group row and both no-domain rows with nothing
      // failing anywhere. The glyphs are in the set now, but the SHAPE of the failure is what
      // this holds: a name checked against the set fails here, in a test, rather than on a
      // screen nobody is looking at.
      const names = new Set(UI_ICON_NAMES);
      for (const k of kinds) {
        expect(names.has(k.icon), k.key + " draws the fallback dot: no glyph named " + k.icon)
          .toBe(true);
        for (const row of k.options(ctx.data)) {
          if (!row.icon) continue;
          expect(names.has(row.icon),
            k.key + " row " + row.id + " draws the fallback dot: no glyph named " + row.icon)
            .toBe(true);
        }
      }
      const resetIcon = (chrome.reset && chrome.reset.icon) || "";
      expect(names.has(resetIcon), "the reset row draws the fallback dot: " + resetIcon)
        .toBe(true);
    });

    // A SECOND, RENDER-BASED FORM OF THE CHECK ABOVE WAS WRITTEN AND DELETED, and the reason
    // is worth keeping. It called `uiIcon()` on every name and then asserted
    // `missingUiIcons()` was empty — reading what the function DID rather than what the app
    // DECLARED. It passed a normal `vitest run` and failed `GAS_TEST_FULL_ISOLATION=1` with
    // `ReferenceError: document is not defined`: these suites set no vitest `environment`, so
    // there is no jsdom, and `uiIcon` builds real SVG nodes. It had only ever passed because
    // some other file in the shared module registry had left a `document` global behind —
    // which is precisely the cross-file leak full isolation exists to expose. The name check
    // above is DOM-free, tests the same claim, and is the one that bites: removing `users`
    // from `PATHS` fails it.
    it("gives every kind the four functions the model calls", () => {
      for (const k of kinds) {
        for (const fn of ["options", "label", "caption", "payload"]) {
          expect(typeof k[fn], k.key + "." + fn + " is not a function").toBe("function");
        }
      }
    });

    it("keeps at most one kind bare, so two ids sharing a name cannot collide", () => {
      // The model throws on a second bare kind; this states the app's own list satisfies it
      // without waiting for a render to find out.
      expect(kinds.filter((k) => !k.prefix).length).toBeLessThanOrEqual(1);
      const prefixes = kinds.filter((k) => k.prefix).map((k) => k.prefix);
      expect(new Set(prefixes).size, "two kinds share a prefix").toBe(prefixes.length);
    });

    it("yields options for every kind, and names the ones that are legitimately empty", () => {
      for (const k of kinds) {
        const rows = k.options(ctx.data);
        expect(Array.isArray(rows), k.key + ".options did not return an array").toBe(true);
        if (emptyKinds.indexOf(k.key) >= 0) continue;
        expect(rows.length, k.key + " produced no options on the contract fixture")
          .toBeGreaterThan(0);
        for (const row of rows) {
          expect(typeof row.id, k.key + " produced a row with no id").toBe("string");
          expect(row.id.length).toBeGreaterThan(0);
          expect(typeof row.label).toBe("string");
        }
      }
    });

    it("survives an empty payload without throwing — boot failure is a state, not a crash", () => {
      // Every app's control is asked to render before the first sync and on the boot-failure
      // path, and `show: false` is how it declines. Throwing there blanks the shell.
      for (const empty of [null, {}, { filterOptions: {} }]) {
        const view = scopeView({
          kinds: ctx.scopeKinds(empty),
          chrome: ctx.scopeChrome(empty),
          data: empty,
          active: null,
        });
        expect(typeof view.show).toBe("boolean");
        expect(Array.isArray(view.options)).toBe(true);
      }
    });
  });

  describe(app + ": a scope value round-trips, and the reset is not a scope", () => {
    it("encodes and parses every kind back to itself", () => {
      for (const k of kinds) {
        const value = encodeScope(k.prefix, "SOME-ID");
        const back = parseScope(value, kinds);
        expect(back.id, k.key + " did not round-trip its id").toBe("SOME-ID");
        expect(back.kind).toBe(k.prefix);
      }
    });

    it("treats the empty value as the reset rather than as a kind", () => {
      const view = scopeView({ kinds, chrome, data: ctx.data, active: null });
      expect(view.scoped).toBe(false);
      expect(view.active).toBe("");
      expect(view.kind).toBe("");
      // The pinned reset row is what the combobox draws above the list; a control without one
      // is a scope you can enter and not leave.
      expect(view.pinned.length).toBe(1);
      expect(view.pinned[0].value).toBe("");
      expect(view.pinned[0].label.length).toBeGreaterThan(0);
    });

    it("says a scope it cannot find is stale rather than pretending it resolved", () => {
      const k = kinds[0];
      const view = scopeView({
        kinds, chrome, data: ctx.data,
        active: { kind: k.key, id: "a-scope-this-register-does-not-hold" },
      });
      expect(view.scoped).toBe(true);
      expect(view.stale).toBe(true);
      // AND IT STILL OFFERS EVERY REAL ROW. A stale scope that emptied the list would be a
      // dead end the reader could only leave by editing settings by hand.
      expect(view.options.length).toBeGreaterThan(0);
      expect(view.caption.length).toBeGreaterThan(0);
    });
  });

  describe(app + ": what a pick sends is exactly what this register's server takes", () => {
    for (const row of ctx.payloads) {
      it("kind " + row.kind + " sends " + JSON.stringify(row.payload), () => {
        const k = kinds.find((x) => x.key === row.kind);
        expect(k, "no kind named " + row.kind).toBeTruthy();
        // Both directions, because they are two code paths that must not disagree: the kind's
        // own payload(), and `scopePayload` decoding the value the CONTROL emits.
        expect(k.payload(row.id)).toEqual(row.payload);
        expect(scopePayload(kinds, chrome, encodeScope(k.prefix, row.id))).toEqual(row.payload);
        // And the view carries the same object for the scope in force, so a caller that reads
        // it rather than waiting for a click gets the same answer.
        const view = scopeView({
          kinds, chrome, data: ctx.data, active: { kind: row.kind, id: row.id },
        });
        expect(view.payload).toEqual(row.payload);
      });
    }

    it("the reset sends " + JSON.stringify(ctx.resetPayload), () => {
      expect(scopePayload(kinds, chrome, "")).toEqual(ctx.resetPayload);
      const view = scopeView({ kinds, chrome, data: ctx.data, active: null });
      expect(view.payload).toEqual(ctx.resetPayload);
    });
  });
}
