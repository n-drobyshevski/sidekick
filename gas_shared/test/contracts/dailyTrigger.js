// The daily trigger reconcile (`gas_shared/server/dailyTrigger.ts`), run against each register's
// own binding of it — gas/'s daily scan and gas_devsecops's daily sync, each bound in that app's
// `src/server/setup.ts` to its handler, timezone and Script Property.
//
// THE BINDING IS UNDER TEST, NOT ONLY THE FUNCTION. Every case calls the app's `reconcile` with a
// stubbed `ScriptApp` and `PropertiesService`, and reads the signature back off the app's own
// property — so an app that bound the wrong handler, dropped `.inTimezone`, or stored the
// signature under another key fails here rather than in production, where a wrong daily trigger
// fails silently once a day. The stubs are installed on `globalThis` and the previous values put
// back after each case (not through `vi.unstubAllGlobals`, which would also undo stubs the
// registering file made itself).
//
// What stays in the apps: how setup() (and devsecops's settings save) reach it, and what the
// diagnostic says about the result.

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {Function} ctx.beforeEach
 * @param {Function} ctx.afterEach
 * @param {string}   ctx.app
 * @param {string}   ctx.handler    the trigger handler the app installs
 * @param {string}   ctx.tz         the timezone it pins
 * @param {number}   ctx.hour       the hour `reconcile` is expected to install
 * @param {string}   ctx.propKey    the Script Property holding the signature
 * @param {() => string} ctx.reconcile  the app's bound reconcile, at `hour`
 */
export function registerDailyTriggerContract(ctx) {
  const { describe, it, expect, beforeEach, afterEach, app, handler, tz, hour, propKey, reconcile } = ctx;
  const want = `${tz}|${hour}`;

  describe(app + ": the daily trigger reconcile (gas_shared/server/dailyTrigger.ts)", () => {
    const props = new Map();
    /** Installed triggers, in creation order: `{ handler, id }`. */
    let installed = [];
    /** Every builder that reached create(), with the schedule it carried. */
    let built = [];
    /** Every ScriptApp call, in order — create-before-delete is an ORDER. */
    let calls = [];
    let failCreate = false;
    let seq = 0;
    let previous;

    const add = (h) => { installed.push({ handler: h, id: ++seq }); };
    const mine = () => installed.filter((t) => t.handler === handler);

    beforeEach(() => {
      previous = { ScriptApp: globalThis.ScriptApp, PropertiesService: globalThis.PropertiesService };
      props.clear();
      installed = [];
      built = [];
      calls = [];
      failCreate = false;
      globalThis.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: (k) => props.get(k) ?? null,
          setProperty: (k, v) => { props.set(k, v); },
          deleteProperty: (k) => { props.delete(k); },
        }),
      };
      globalThis.ScriptApp = {
        getProjectTriggers: () => installed.map((t) => ({ getHandlerFunction: () => t.handler, t })),
        deleteTrigger: (x) => {
          calls.push("delete");
          installed = installed.filter((t) => t !== x.t);
        },
        newTrigger: (h) => {
          const rec = { handler: h };
          const b = {
            timeBased: () => b,
            everyDays: (n) => { rec.days = n; return b; },
            atHour: (n) => { rec.hour = n; return b; },
            inTimezone: (z) => { rec.tz = z; return b; },
            create: () => {
              if (failCreate) throw new Error("Too many triggers");
              calls.push("create");
              built.push(rec);
              add(h);
              return rec;
            },
          };
          return b;
        },
      };
    });
    afterEach(() => {
      globalThis.ScriptApp = previous.ScriptApp;
      globalThis.PropertiesService = previous.PropertiesService;
    });

    it("a fresh install creates one trigger, daily, at the hour, in the pinned timezone", () => {
      const line = reconcile();
      expect(built).toEqual([{ handler, days: 1, hour, tz }]);
      expect(mine()).toHaveLength(1);
      expect(props.get(propKey)).toBe(want);
      expect(line.endsWith(`installed (${hour}:00 ${tz})`)).toBe(true);
    });

    it("a second run is a no-op", () => {
      reconcile();
      calls = [];
      const line = reconcile();
      expect(calls).toEqual([]);
      expect(mine()).toHaveLength(1);
      expect(line).toMatch(/already installed/);
    });

    it("replaces a legacy trigger with no signature exactly once — created before deleted", () => {
      add(handler);
      const legacy = installed[0];
      const line = reconcile();
      expect(calls).toEqual(["create", "delete"]);
      expect(mine()).toHaveLength(1);
      expect(mine()[0]).not.toBe(legacy);
      expect(props.get(propKey)).toBe(want);
      expect(line).toMatch(/\(replaced 1\)$/);
      calls = [];
      reconcile();
      expect(calls).toEqual([]);
    });

    it("collapses duplicates to one, even under a matching signature", () => {
      add(handler);
      add(handler);
      props.set(propKey, want);
      reconcile();
      expect(mine()).toHaveLength(1);
      expect(calls).toEqual(["create", "delete", "delete"]);
    });

    it("reinstalls under a signature naming another hour or timezone", () => {
      add(handler);
      props.set(propKey, `${tz}|${(hour + 1) % 24}`);
      reconcile();
      expect(built).toHaveLength(1);
      expect(mine()).toHaveLength(1);
      expect(props.get(propKey)).toBe(want);
    });

    it("a failed create keeps the old trigger and leaves the signature unwritten", () => {
      add(handler);
      failCreate = true;
      expect(() => reconcile()).toThrow(/Too many triggers/);
      expect(mine()).toHaveLength(1);
      expect(calls).toEqual([]);
      expect(props.has(propKey)).toBe(false);
    });

    it("leaves every other handler's triggers alone", () => {
      add("trigger_warmReadModels");
      add("trigger_somethingElse");
      reconcile();
      expect(installed.map((t) => t.handler).sort())
        .toEqual([handler, "trigger_somethingElse", "trigger_warmReadModels"].sort());
    });
  });
}
