// Settings → Access must never lose an edit silently (gas_shared/ui/accessSave.js).
//
// The bug this pins: an owner typed a new admin's address, clicked "Save access" without
// pressing Add, and was told "Access updated." — no RPC had run, and the address was gone on
// the next reload. Each app's accessEditor.js registers this contract against its own source,
// because the four editors are separate files and each one could regress on its own.

import { notKept } from "../../ui/accessSave.js";

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.editorSrc  this app's accessEditor.js, as text
 */
export function registerAccessSaveContract({ describe, it, expect, editorSrc }) {
  describe("access save — notKept names what the server did not keep", () => {
    it("is empty when every sent address came back", () => {
      expect(notKept(["a@x.com", "b@x.com"], ["b@x.com", "a@x.com", "c@x.com"])).toEqual([]);
      expect(notKept([], ["a@x.com"])).toEqual([]);
    });

    it("names each missing address, ignoring case and stray whitespace", () => {
      expect(notKept(["A@x.com ", "new@x.com"], ["a@x.com"])).toEqual(["new@x.com"]);
      expect(notKept(["new@x.com"], null)).toEqual(["new@x.com"]);
    });
  });

  describe("access save — the editor cannot drop an edit without saying so", () => {
    const fn = editorSrc.slice(editorSrc.indexOf("async function save("));

    it("flushes typed-but-not-added addresses before deciding whether anything changed", () => {
      const flush = fn.indexOf("addInputs.values()");
      expect(flush).toBeGreaterThan(-1);
      expect(flush).toBeLessThan(fn.indexOf("No changes to save."));
      // A bad address stops the save rather than being skipped over.
      expect(fn).toMatch(/if \(!commit\([^)]*\)\) return;/);
    });

    it("never claims a save that did nothing", () => {
      const noop = fn.slice(fn.indexOf("No changes to save."), fn.indexOf("No changes to save.") + 80);
      expect(noop).toMatch(/return;/);
      // "Access updated." is only said after the fresh read, on the all-kept branch.
      expect(fn.indexOf('toast("Access updated."')).toBeGreaterThan(fn.indexOf('call("api_getAccess")'));
      expect(fn).toContain("notKept(");
    });

    it("asks before a reload throws unsaved edits away", () => {
      expect(editorSrc).toMatch(/guardUnsaved\(\w+, \(\) => [^;]*typedButNotAdded\(\)\)/);
    });
  });
}
