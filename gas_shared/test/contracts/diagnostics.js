// The Settings → System read-outs: what the shared renderer promises, and what each app is
// allowed to have asked it for.
//
// TWO HALVES, AND THEY GUARD DIFFERENT THINGS.
//
// The first half renders `ui/diagnostics.js` into `test/domStub.js` and asserts the tree. It is
// app-independent and therefore identical in all three registers — deliberately, because all
// three now draw with this module and each one should fail if it breaks.
//
// The second half reads that app's OWN `pages/settings.js` as source text and asserts the SET
// OF SECTIONS it passes. That is the assertion this package exists for: the three System tabs
// do not show the same things, the shared module makes every section optional so they need not,
// and the failure mode is a well-meaning drive-by giving one app a section a sibling has. gas
// has no credentials card, gas_ai has no error log, gas_devsecops has no storage meter, and
// none of that is an oversight to be tidied up.
//
// WHAT THIS CANNOT SEE. The stub has no layout and no CSS, so nothing here says a card LOOKS
// right; and `ctx.sections` is a registry, not a derivation — it is the list a human agreed to,
// and adding a section means changing this list on purpose.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  DIAGNOSTIC_SECTIONS, buildMismatch, describeStamp, diagnosticsPanel, errorCountBadge,
  errorLogBody, normalizeErrorLog, storageBody,
} from "../../ui/diagnostics.js";
import { classes, find, findAll, findTag, installDomStub, text } from "../domStub.js";

// Strips line comments and block comments, so a comment NAMING a section is not read as a call
// asking for one. Every one of these files explains what it deliberately does not draw.
function decomment(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
}

/**
 * The argument object of every `diagnosticsPanel(` call in a source file, by brace matching.
 * A regex cannot do this: the specs nest objects and carry strings full of braces.
 */
function panelCalls(src) {
  const out = [];
  const needle = "diagnosticsPanel(";
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at < 0) return out;
    from = at + needle.length;
    // Only a CALL, not the import line or a comment mentioning the name.
    let depth = 0;
    let i = at + needle.length;
    let start = -1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") { if (depth === 0) start = i; depth++; } else if (c === "}") {
        depth--;
        if (depth === 0) { out.push(src.slice(start, i + 1)); break; }
      } else if (c === ")" && depth === 0) break; // diagnosticsPanel() with no spec
    }
  }
}

/** The section keys a spec object names at its own top level. */
function sectionKeysOf(spec) {
  const found = [];
  for (const key of DIAGNOSTIC_SECTIONS) {
    if (new RegExp("(^|[{,\\s])" + key + "\\s*:").test(spec)) found.push(key);
  }
  return found;
}

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {Function} ctx.beforeAll
 * @param {Function} ctx.afterAll
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {string[]} ctx.sections        the diagnostic sections this app's Settings page draws,
 *                                       in no particular order — the whole set, and only it
 * @param {string}   [ctx.credentialsTone]  "neutral" | "bad", required iff `sections` has
 *                                       "credentials": whether a missing credential is a
 *                                       legitimate dry-run or a fault, in THIS register
 * @param {string}   [ctx.settingsPath]  default "src/client/js/pages/settings.js"
 */
export function registerDiagnosticsContract(ctx) {
  const { describe, it, expect, beforeAll, afterAll, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const settingsPath = resolve(root, ctx.settingsPath || "src/client/js/pages/settings.js");

  // ===================================================================== the shared renderer
  describe(app + ": the shared diagnostics renderer", () => {
    let uninstall;
    beforeAll(() => { uninstall = installDomStub(); });
    afterAll(() => uninstall());

    // --------------------------------------------------------------- every section optional
    it("draws an empty grid and no sections when handed nothing", () => {
      const d = diagnosticsPanel();
      expect(d.node).toBe(d.grid);
      expect(d.grid.childNodes).toEqual([]);
      expect(Object.keys(d.sections)).toEqual([]);
    });

    it("draws ONLY the sections it was handed — an omitted one leaves no empty state behind", () => {
      // The gas_ai case in miniature: no error log at all means NO CARD, because an empty
      // "Recent errors" card claims a log exists and happens to be quiet.
      const d = diagnosticsPanel({ credentials: { present: true, missingTone: "neutral" } });
      expect(Object.keys(d.sections)).toEqual(["credentials"]);
      expect(findAll(d.grid, "health-item")).toHaveLength(1);
      expect(text(d.grid)).not.toMatch(/recorded|Storage|Last sync/);
    });

    it("treats null, undefined and false alike as ABSENT rather than coercing them", () => {
      const d = diagnosticsPanel({ storage: null, errors: undefined, product: false });
      expect(Object.keys(d.sections)).toEqual([]);
    });

    it("orders the cards by DIAGNOSTIC_SECTIONS, whatever order the spec named them in", () => {
      const d = diagnosticsPanel({
        lastSync: { value: "then" },
        build: { server: "abc" },
        storage: { body: null },
        credentials: { present: false, missingTone: "bad" },
        product: { value: "P" },
        errors: {},
      });
      const drawn = findAll(d.grid, "health-item").map((n) => n.getAttribute("data-diag"));
      expect(drawn).toEqual([...DIAGNOSTIC_SECTIONS]);
    });

    it("keeps both grid-drawing apps' existing orders as SUBSEQUENCES of that one order", () => {
      // Which is why a single canonical order was possible at all: gas draws storage → errors →
      // build and gas_devsecops product → build → credentials → lastSync. If a future section
      // were inserted in the wrong place here, one of these two apps would silently reorder.
      const subsequence = (want) => {
        let i = 0;
        for (const key of DIAGNOSTIC_SECTIONS) if (key === want[i]) i++;
        return i === want.length;
      };
      expect(subsequence(["storage", "errors", "build"])).toBe(true);
      expect(subsequence(["product", "build", "credentials", "lastSync"])).toBe(true);
    });

    it("names the same nodes in `sections` that it put in the grid", () => {
      const d = diagnosticsPanel({ product: { value: "P" }, build: { server: "abc" } });
      expect(d.grid.childNodes).toEqual([d.sections.product, d.sections.build]);
    });

    // --------------------------------------------------------------------- the card and head
    it("draws a heading only when one was asked for, and never invents one", () => {
      const bare = diagnosticsPanel({ product: { value: "P" } });
      expect(findTag(bare.node, "h2")).toHaveLength(0);
      const headed = diagnosticsPanel({ heading: "System health", product: { value: "P" } });
      const h2s = findTag(headed.node, "h2");
      expect(h2s).toHaveLength(1);
      expect(text(h2s[0])).toBe("System health");
      expect(classes(h2s[0]).has("section-label")).toBe(true);
    });

    it("labels a card with a span by default and with the caller's tag when asked", () => {
      // The heading COUNT of each app's System tab is what this protects: gas has one h2 above
      // its whole grid and spans on the cards, gas_ai had an h2 per panel and keeps them.
      const span = diagnosticsPanel({ product: { value: "P" } });
      expect(findTag(span.grid, "h2")).toHaveLength(0);
      expect(findTag(span.grid, "span").some((n) => text(n) === "Product")).toBe(true);
      const h2 = diagnosticsPanel({ titleTag: "h2", product: { value: "P" } });
      expect(findTag(h2.grid, "h2").map(text)).toEqual(["Product"]);
    });

    // -------------------------------------------------- absent is never zero, and never blank
    it("renders a blank one-line fact as the shared em dash, not as an empty slot", () => {
      for (const value of [null, undefined, "", "   "]) {
        const d = diagnosticsPanel({ product: { value } });
        expect(find(d.grid, "health-value")).not.toBeNull();
        expect(text(find(d.grid, "health-value")).trim()).toBe("—");
      }
    });

    it("renders a blank one-line fact as the caller's sentence when it supplied one", () => {
      const d = diagnosticsPanel({ lastSync: { value: null, emptyText: "No sync recorded yet." } });
      expect(text(find(d.grid, "health-value"))).toBe("No sync recorded yet.");
    });

    it("lets 0 and false through, because they are answers and not absences", () => {
      expect(text(find(diagnosticsPanel({ product: { value: 0 } }).grid, "health-value"))).toBe("0");
      expect(text(find(diagnosticsPanel({ product: { value: false } }).grid, "health-value")))
        .toBe("false");
    });

    // ------------------------------------------------------------------------- the build card
    it("prints ONE stamp verbatim, dev included, and never compares it to anything", () => {
      for (const id of ["abc123", "dev"]) {
        const d = diagnosticsPanel({ build: { server: id } });
        expect(text(find(d.grid, "health-value"))).toBe(id);
        expect(findTag(d.grid, "dl")).toHaveLength(0);
        expect(text(d.grid)).not.toMatch(/different builds/);
      }
    });

    it("accepts a stamp as the bare string two apps publish or the {id} gas_ai does", () => {
      expect(text(find(diagnosticsPanel({ build: { server: "abc" } }).grid, "health-value")))
        .toBe("abc");
      expect(text(find(diagnosticsPanel({ build: { server: { id: "abc" } } }).grid, "health-value")))
        .toBe("abc");
    });

    it("reads a missing single stamp as absent, which is the whole point of the card", () => {
      const d = diagnosticsPanel({ build: { server: null } });
      expect(text(find(d.grid, "health-value")).trim()).toBe("—");
    });

    it("draws the Client/Server comparison ONLY for a caller that passed a client stamp", () => {
      const d = diagnosticsPanel({ build: { client: { id: "aaa" }, server: { id: "aaa" } } });
      const dl = findTag(d.grid, "dl");
      expect(dl).toHaveLength(1);
      expect(findTag(dl[0], "dt").map(text)).toEqual(["Client", "Server"]);
      expect(findTag(dl[0], "dd").map(text)).toEqual(["aaa", "aaa"]);
    });

    it("says `unavailable` for a server that answered nothing, and `unknown` for an unstamped one", () => {
      const none = diagnosticsPanel({ build: { client: { id: "aaa" }, server: null } });
      expect(findTag(findTag(none.grid, "dl")[0], "dd").map(text)).toEqual(["aaa", "unavailable"]);
      const dev = diagnosticsPanel({ build: { client: { id: "aaa" }, server: { id: "dev" } } });
      expect(findTag(findTag(dev.grid, "dl")[0], "dd").map(text)).toEqual(["aaa", "unknown"]);
    });

    it("warns on a real disagreement and stays quiet on every other pairing", () => {
      const warned = (spec) => text(diagnosticsPanel({
        build: { ...spec, mismatchNote: "MISMATCH" },
      }).grid).includes("MISMATCH");
      expect(warned({ client: { id: "aaa" }, server: { id: "bbb" } })).toBe(true);
      expect(warned({ client: { id: "aaa" }, server: { id: "aaa" } })).toBe(false);
      // "dev" is the ABSENCE of a stamp, not the name of a build. Comparing it reported a
      // deployment fault on every local run.
      expect(warned({ client: { id: "dev" }, server: { id: "bbb" } })).toBe(false);
      expect(warned({ client: { id: "aaa" }, server: { id: "dev" } })).toBe(false);
      expect(warned({ client: { id: "aaa" }, server: null })).toBe(false);
    });

    it("exposes the two build rules on their own, because they are the half that can be WRONG", () => {
      expect(describeStamp("abc")).toBe("abc");
      expect(describeStamp({ id: "abc" })).toBe("abc");
      for (const nothing of [null, undefined, "", "   ", {}, { id: null }, { id: "" }, "dev"]) {
        expect(describeStamp(nothing)).toBe("unknown");
      }
      expect(buildMismatch("aaa", "bbb")).toBe(true);
      expect(buildMismatch("aaa", "aaa")).toBe(false);
      for (const pair of [["dev", "bbb"], ["aaa", "dev"], [null, "bbb"], ["aaa", undefined], ["", "b"]]) {
        expect(buildMismatch(pair[0], pair[1]), pair.join(" vs ")).toBe(false);
      }
    });

    // ------------------------------------------------------------------- the credentials card
    it("REFUSES to guess whether a missing credential is a dry-run or a fault", () => {
      // gas_ai draws it neutral, gas_devsecops bad. A default would silently give one app the
      // other's claim about the same boolean.
      for (const tone of [undefined, null, "", "warn", "ok", true]) {
        expect(() => diagnosticsPanel({ credentials: { present: false, missingTone: tone } }))
          .toThrow(/missingTone/);
      }
    });

    it("draws the ok pill when present and the register's own tone when not", () => {
      const ok = diagnosticsPanel({
        credentials: { present: true, missingTone: "bad", okLabel: "Connected" },
      });
      expect([...classes(find(ok.grid, "pill"))]).toContain("ok");
      expect(text(find(ok.grid, "pill"))).toBe("Connected");
      for (const tone of ["neutral", "bad"]) {
        const miss = diagnosticsPanel({
          credentials: { present: false, missingTone: tone, missingLabel: "No credentials" },
        });
        expect([...classes(find(miss.grid, "pill"))]).toContain(tone);
      }
    });

    it("reads anything but a literal true as NOT present — an unanswered flag is not a yes", () => {
      for (const junk of [undefined, null, 0, "", "true", 1, "yes"]) {
        const d = diagnosticsPanel({ credentials: { present: junk, missingTone: "bad" } });
        expect([...classes(find(d.grid, "pill"))]).toContain("bad");
      }
    });

    // ----------------------------------------------------------------------- the storage body
    it("puts the meter first and one muted line per sentence the register supplied", () => {
      const nodes = storageBody({
        used: 500, total: 1000, label: "Cells", state: "warn", note: "getting full",
        lines: ["3 scan(s).", "1 unknown severity."],
      });
      expect(nodes).toHaveLength(3);
      expect([...classes(nodes[0])]).toContain("usage-meter");
      expect(nodes.slice(1).map(text)).toEqual(["3 scan(s).", "1 unknown severity."]);
    });

    it("drops a blank line rather than printing an empty paragraph", () => {
      const nodes = storageBody({ used: 1, total: 2, lines: [null, "", "  ", undefined, "real"] });
      expect(nodes).toHaveLength(2);
      expect(text(nodes[1])).toBe("real");
    });

    it("survives a caller with no lines at all", () => {
      expect(storageBody({ used: 1, total: 2 })).toHaveLength(1);
      expect(storageBody({ used: 1, total: 2, lines: "not a list" })).toHaveLength(1);
    });

    // ------------------------------------------------------------------------- the error log
    it("unwraps a bare array and a {errors, covers, note} envelope alike", () => {
      const bare = normalizeErrorLog([{ ts: "T", op: "scan", kind: "error", message: "boom" }]);
      expect(bare.items).toEqual([{ at: "T", op: "scan", kind: "error", message: "boom" }]);
      expect(bare.covers).toBeNull();
      expect(bare.note).toBeNull();

      const wrapped = normalizeErrorLog({
        errors: [{ at: "T2", error: "nope" }], covers: "jobs", note: "Job failures only.",
      });
      expect(wrapped.items).toEqual([{ at: "T2", op: null, kind: null, message: "nope" }]);
      expect(wrapped.covers).toBe("jobs");
      expect(wrapped.note).toBe("Job failures only.");
    });

    it("answers an EMPTY log for anything that was never a list — which is not the same as a "
      + "failed read, and is why the caller catches before calling", () => {
      for (const junk of [null, undefined, {}, 0, "", { errors: "nope" }]) {
        expect(normalizeErrorLog(junk).items).toEqual([]);
      }
    });

    it("lets a caller whose `kind` is not a severity supply its own mapper", () => {
      // gas's `kind` is the error's severity ("error" / "warn"); gas_devsecops's is the JOB's
      // kind ("sync", "compact"), and the default mapper would feed that straight to the pill.
      const rows = [{ job_id: "j1", kind: "sync", phase: "fetch", at: "T", error: "nope" }];
      const mine = normalizeErrorLog({ errors: rows }, (r) => ({
        at: r.at, op: r.job_id, kind: "error", message: r.error,
      }));
      expect(mine.items[0]).toEqual({ at: "T", op: "j1", kind: "error", message: "nope" });
    });

    it("counts an empty log as a sentence, never as the number 0", () => {
      expect(text(errorCountBadge([]))).toBe("None recorded.");
      expect(text(errorCountBadge(null))).toBe("None recorded.");
      expect(text(errorCountBadge([1, 2]))).toBe("2 recorded");
      expect([...classes(errorCountBadge([1]))]).toContain("bad");
    });

    it("offers a Clear control only to a caller that has somewhere to send it", () => {
      // gas has api_clearRecentErrors; gas_devsecops has no clear RPC at all, and a disabled
      // button would offer an operation that does not exist.
      const withClear = errorLogBody({ items: [{ at: "T" }], onRefresh() {}, onClear() {} });
      expect(findTag(withClear[0], "button").map(text)).toEqual(["Refresh", "Clear log"]);
      const without = errorLogBody({ items: [{ at: "T" }], onRefresh() {} });
      expect(findTag(without[0], "button").map(text)).toEqual(["Refresh"]);
      const neither = errorLogBody({ items: [{ at: "T" }] });
      expect(findTag(neither[0], "button")).toHaveLength(0);
    });

    it("disables Clear while there is nothing to clear, which is a different statement", () => {
      const empty = errorLogBody({ items: [], onClear() {} });
      expect(findTag(empty[0], "button")[0].getAttribute("disabled")).toBe("");
      const full = errorLogBody({ items: [{ at: "T" }], onClear() {} });
      expect(findTag(full[0], "button")[0].getAttribute("disabled")).toBeNull();
    });

    it("says what a narrower log does not cover, and says nothing when it covers everything", () => {
      const narrow = errorLogBody({ items: [], covers: "jobs", note: "Job failures only." });
      const said = narrow.map(text).join(" ");
      expect(said).toMatch(/Covers\s*jobs\s*only/);
      expect(said).toMatch(/Job failures only\./);
      const whole = errorLogBody({ items: [] }).map(text).join(" ");
      expect(whole).not.toMatch(/Covers/);
    });

    it("draws an empty state for an empty log and a row per error otherwise", () => {
      const empty = errorLogBody({ items: [] });
      expect(empty.map(text).join(" ")).toMatch(/No errors recorded\./);
      expect(findTag(empty[empty.length - 1], "table")).toHaveLength(0);

      const rows = errorLogBody({
        items: [
          { at: "2026-01-01", op: "scan", kind: "error", message: "boom" },
          { at: "2026-01-02", op: null, kind: null, message: null },
        ],
        fmtDateTime: (v) => "@" + v,
      });
      const table = findTag(rows[rows.length - 1], "table")[0];
      expect(findTag(table, "th").map(text)).toEqual(["When", "Operation", "Kind", "Message"]);
      const body = findTag(table, "tr").slice(1);
      expect(body).toHaveLength(2);
      expect(text(body[0])).toMatch(/@2026-01-01/);
      expect(text(body[0])).toMatch(/scan/);
      // A gap in the record is the shared em dash and NOT a value — an unnamed operation
      // printed in the same weight as a real one would claim there was one.
      expect(text(body[1])).toMatch(/—/);
      expect(text(body[1])).not.toMatch(/error/);
    });
  });

  // ================================================================ what THIS app asked for
  describe(app + ": the System tab asks for exactly the diagnostics it has", () => {
    const SRC = readFileSync(settingsPath, "utf8");
    const CODE = decomment(SRC);

    it("passes exactly the registered set of sections, and no others", () => {
      const asked = new Set();
      for (const spec of panelCalls(CODE)) for (const key of sectionKeysOf(spec)) asked.add(key);
      expect([...asked].sort(), app + " gained or lost a diagnostics section")
        .toEqual([...ctx.sections].sort());
    });

    it("draws its diagnostics through the shared module rather than rebuilding the chrome", () => {
      expect(CODE).toMatch(/\bdiagnosticsPanel\(/);
      // The card classes belong to gas_shared/ui/diagnostics.js. A page writing them itself is
      // the fork starting, one tier below where the parity contract looks.
      expect(CODE).not.toMatch(/["']health-(grid|item|head|row|value)/);
    });

    if (ctx.sections.includes("credentials")) {
      it("STATES whether a missing credential is a dry-run or a fault, rather than inheriting one", () => {
        expect(["neutral", "bad"]).toContain(ctx.credentialsTone);
        expect(CODE).toMatch(new RegExp('missingTone:\\s*"' + ctx.credentialsTone + '"'));
      });
    } else {
      it("asks for no credential card at all", () => {
        expect(CODE).not.toMatch(/missingTone/);
      });
    }

    it("keeps the page free of any domain or server import, which the shared module also is", () => {
      // True of all three settings pages before this package and stated outright in
      // gas_devsecops's own module header. Moving rendering into gas_shared must not be the
      // thing that first drags a domain type across the seam.
      expect(CODE).not.toMatch(/from\s+["'][^"']*src\/domain\//);
      expect(CODE).not.toMatch(/from\s+["'][^"']*src\/server\//);
      expect(CODE).not.toMatch(/from\s+["'][^"']*\.\.\/\.\.\/\.\.\/domain\//);
    });
  });
}
