// The recent-errors log (`gas_shared/server/errorLog.ts`), run against each register's own
// binding of it — the app's `src/server/errorLog.ts`, which wires the shared factory to that
// app's Script Properties and re-exports the API every call site imports.
//
// MERGED FROM TWO APP-LOCAL SPECS. gas/ and gas_devsecops/ each had a `test/errorLog.test.ts`
// over its own copy of the module; the devsecops one was the gas one plus `markRecorded`. The
// cases below are their union, so gas gains the record-once cases with the behaviour.
//
// THE BINDING IS UNDER TEST, NOT ONLY THE FACTORY. Every case reaches the log through the
// app's module and a stubbed `PropertiesService`, and reads the stored blob back off the
// `RECENT_ERRORS` property — so an app that bound the wrong accessor, or a renamed key that
// would orphan every deployed log, fails here rather than in production. The stub is
// installed on `globalThis` and the previous value put back after each case (not through
// `vi.unstubAllGlobals`, which would also undo stubs the registering file made itself).
//
// What stays in the apps: the call-site specs — which operation records what, and that a
// failed job hop is listed once — because those are each register's own wiring.

const KEY = "RECENT_ERRORS";

/** UTF-8 length through the platform encoder, the oracle `utf8ByteLength` must agree with. */
const encodedBytes = (s) => new TextEncoder().encode(s).length;

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {Function} ctx.beforeEach
 * @param {Function} ctx.afterEach
 * @param {string}   ctx.app
 * @param {object}   ctx.log  the app's `src/server/errorLog` module namespace — handed over
 *   rather than imported, because this contract is registered from more than one package.
 */
export function registerErrorLogContract(ctx) {
  const { describe, it, expect, beforeEach, afterEach, app, log } = ctx;
  const { clearErrors, markRecorded, recentErrors, recordError, utf8ByteLength } = log;

  describe(app + ": errorLog — the recent-errors ring buffer over Script Properties", () => {
    const propStore = new Map();
    let previous;
    /** Install a PropertiesService whose setProperty is `set` (default: a plain store). */
    const stubProps = (set = (k, v) => { propStore.set(k, v); }) => {
      globalThis.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: (k) => propStore.get(k) ?? null,
          setProperty: set,
          deleteProperty: (k) => { propStore.delete(k); },
        }),
      };
    };

    beforeEach(() => {
      previous = globalThis.PropertiesService;
      propStore.clear();
      stubProps();
    });
    afterEach(() => {
      globalThis.PropertiesService = previous;
    });

    it("returns [] when nothing is recorded", () => {
      expect(recentErrors()).toEqual([]);
    });

    it("records newest-first with op / kind / message, under the RECENT_ERRORS property", () => {
      recordError("scan", new Error("boom"), "error", 1000);
      recordError("supportGroupRefresh", "input exceeded", "warning", 2000);
      const out = recentErrors();
      expect(out.map((e) => e.op)).toEqual(["supportGroupRefresh", "scan"]);
      expect(out[0]).toEqual({
        ts: "1970-01-01T00:00:02Z", op: "supportGroupRefresh", kind: "warning", message: "input exceeded",
      });
      expect(out[1].message).toBe("boom");
      expect(JSON.parse(propStore.get(KEY))).toEqual(out);
    });

    it("prefers an Error's message over String(err)", () => {
      recordError("api", new Error("the message"));
      expect(recentErrors()[0].message).toBe("the message");
      expect(recentErrors()[0].kind).toBe("error"); // the default kind
    });

    it("caps at 25 entries, keeping the newest", () => {
      for (let i = 0; i < 30; i++) recordError("api", `err ${i}`, "error", i);
      const out = recentErrors();
      expect(out).toHaveLength(25);
      expect(out[0].message).toBe("err 29"); // newest
      expect(out[24].message).toBe("err 5"); // oldest kept
    });

    it("truncates a long message", () => {
      recordError("api", "x".repeat(600));
      const msg = recentErrors()[0].message;
      expect(msg.length).toBe(501); // 500 chars + the ellipsis
      expect(msg.endsWith("…")).toBe(true);
    });

    it("keeps the stored blob under the Script Property size cap", () => {
      for (let i = 0; i < 25; i++) recordError("supportGroupRefresh", "x".repeat(500), "error", i);
      expect(propStore.get(KEY).length).toBeLessThanOrEqual(8500);
      // Even after trimming, the just-added (newest) entry is always retained.
      expect(recentErrors()[0].message.startsWith("x")).toBe(true);
    });

    // The quota counts UTF-8 bytes. Localized exception text is two bytes a character, so a
    // character ceiling let the blob reach nearly twice the quota: setProperty threw, the throw
    // was swallowed, and the log silently stopped recording.
    it("keeps a localized (Cyrillic) blob under the cap in BYTES, and keeps recording", () => {
      const QUOTA = 9 * 1024;
      stubProps((k, v) => {
        if (encodedBytes(k + v) > QUOTA) throw new Error("Argument too large");
        propStore.set(k, v);
      });
      for (let i = 0; i < 25; i++) recordError("api", `Ошибка ${i}: ` + "ж".repeat(480), "error", i);
      expect(encodedBytes(propStore.get(KEY))).toBeLessThanOrEqual(8500);
      expect(recentErrors()[0].message.startsWith("Ошибка 24:")).toBe(true);
    });

    it("utf8ByteLength agrees with the encoder", () => {
      for (const s of ["", "ascii", "Ошибка", "日本語", "emoji 😀 pair", "lone \ud800 high", "lone \udc00 low", "end \ud83d"]) {
        expect(utf8ByteLength(s)).toBe(encodedBytes(s));
      }
    });

    it("clearErrors empties the log", () => {
      recordError("api", "one");
      expect(recentErrors()).toHaveLength(1);
      clearErrors();
      expect(recentErrors()).toEqual([]);
      expect(propStore.has(KEY)).toBe(false);
    });

    it("tolerates a malformed stored blob", () => {
      propStore.set(KEY, "{not json");
      expect(recentErrors()).toEqual([]);
      propStore.set(KEY, JSON.stringify({ not: "an array" }));
      expect(recentErrors()).toEqual([]);
    });

    it("never throws even if the store is unavailable", () => {
      globalThis.PropertiesService = {
        getScriptProperties: () => {
          throw new Error("quota");
        },
      };
      expect(() => recordError("api", "boom")).not.toThrow();
    });

    // --- recorded once per thrown value -------------------------------------------------

    it("records the same thrown value once, however many catches it passes through", () => {
      const e = new Error("once");
      recordError("scan", e);
      recordError("api", e);
      expect(recentErrors().map((x) => x.op)).toEqual(["scan"]);
    });

    it("skips a value marked recorded elsewhere (a failed job's own row)", () => {
      const e = new Error("on the job row");
      markRecorded(e);
      recordError("api", e);
      expect(recentErrors()).toEqual([]);
      // A different Error with the same message is a different failure and is recorded.
      recordError("api", new Error("on the job row"));
      expect(recentErrors()).toHaveLength(1);
    });

    it("records repeated string messages every time — a primitive cannot be deduplicated", () => {
      recordError("daily", "skipped");
      recordError("daily", "skipped");
      expect(recentErrors()).toHaveLength(2);
    });

    it("markRecorded never throws, whatever it is handed", () => {
      for (const v of [null, undefined, 0, "x", {}, new Error("e")]) {
        expect(() => markRecorded(v)).not.toThrow();
      }
    });
  });
}
