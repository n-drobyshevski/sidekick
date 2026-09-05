// The "show experimental content" preference, which decides whether the Scoring Models page
// and its vocabulary exist for a reader at all.
//
// Worth its own spec for one reason: EVERY WAY OF NOT KNOWING HAS TO READ AS OFF. The flag
// guards models that are under calibration, so an absent key, an unparseable value and a GAS
// iframe that denies web storage outright must all answer no — which is the inverse of the
// `!== "0"` idiom the collapsed rail uses, and exactly the kind of inversion that gets
// "simplified" back the wrong way by someone matching the neighbouring code.
//
// The module reads localStorage once and caches, so each case re-imports against its own stub
// (vi.resetModules + dynamic import) rather than sharing one instance.
//
// IT IS `gas_shared/shell/experimental.js` BEHIND THE SEAM NOW, and two things follow.
//
// First, `load()` configures the manifest. That is not a workaround for the test: the shared
// module composes its key from `MANIFEST.storagePrefix`, and `appConfig()` THROWS on an unset
// manifest by design (an unset one cannot be defaulted without silently giving one app another
// app's key). `vi.resetModules()` throws away the manifest along with everything else, so it
// has to be set inside `load()`, after the reset and before the first read.
//
// Second, that would make the key assertions below tautological on their own — the prefix
// this file hands over is the one they then check for. So `composes the key from the
// manifest's prefix` configures a DIFFERENT prefix and reads the key back: that is the case
// that actually holds the composition, and the `sidekickai.` ones hold the stored values
// against what this fork wrote before the promotion, i.e. that no reader loses the flag.
//
// The read caches LAZILY now rather than at import, which is forced rather than chosen:
// appConfig.js's rule 2 forbids a shared module reading the manifest at module top level,
// because under esbuild's bundling order that runs before app.js's configureApp().

import { afterEach, describe, expect, it, vi } from "vitest";

const MODULE = "../src/client/js/experimental.js";
/** gas_ai's real MANIFEST.storagePrefix — the value app.js hands over at runtime. */
const PREFIX = "sidekickai.";

/** A localStorage stand-in over a plain object — there is no jsdom in this suite. */
function stubStorage(initial) {
  const store = { ...initial };
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  globalThis.localStorage = storage;
  return store;
}

/** A localStorage that throws on every access, the way a sandboxed iframe does. */
function stubDeniedStorage() {
  globalThis.localStorage = {
    getItem() { throw new Error("The operation is insecure."); },
    setItem() { throw new Error("The operation is insecure."); },
  };
}

async function load(prefix) {
  vi.resetModules();
  // A LITERAL SPECIFIER, not a `const` holding the path: vite rewrote `import(CONFIG)` to an
  // absolute `/gas_shared/appConfig.js` and could not find it — a dynamic import outside this
  // package's root only resolves when the transform can see the string.
  const { configureApp } = await import("../../gas_shared/appConfig.js");
  configureApp({ storagePrefix: prefix === undefined ? PREFIX : prefix });
  return import(MODULE);
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe("showExperimental", () => {
  it("is off when nothing has been stored", async () => {
    stubStorage({});
    const { showExperimental } = await load();
    expect(showExperimental()).toBe(false);
  });

  it("is on only for the exact stored on-value", async () => {
    stubStorage({ "sidekickai.showExperimental": "1" });
    const { showExperimental } = await load();
    expect(showExperimental()).toBe(true);
  });

  it("is off for the stored off-value", async () => {
    stubStorage({ "sidekickai.showExperimental": "0" });
    const { showExperimental } = await load();
    expect(showExperimental()).toBe(false);
  });

  // The inversion this file exists to pin: `!== "0"` would read every one of these as ON.
  it("is off for any value it did not write", async () => {
    for (const junk of ["", "true", "yes", "on", "01", " 1"]) {
      stubStorage({ "sidekickai.showExperimental": junk });
      const { showExperimental } = await load();
      expect(showExperimental(), junk).toBe(false);
    }
  });

  it("is off when web storage is denied, rather than throwing", async () => {
    stubDeniedStorage();
    const { showExperimental } = await load();
    expect(showExperimental()).toBe(false);
  });

  it("is off when there is no localStorage at all", async () => {
    delete globalThis.localStorage;
    const { showExperimental } = await load();
    expect(showExperimental()).toBe(false);
  });

  // THE SEAM, AND THE ONLY CASE THAT IS NOT TAUTOLOGICAL. Every assertion above hands over
  // `sidekickai.` and then looks for `sidekickai.showExperimental`; this one hands over a
  // prefix no app uses and requires the key to follow it. The two forks this replaced wrote
  // the prefix out as a literal, which is exactly what MANIFEST.storagePrefix exists to stop:
  // "two sidekicks served from the same origin must not share a key".
  it("composes the key from the manifest's prefix, never from a literal", async () => {
    stubStorage({ "zz.showExperimental": "1", "sidekickai.showExperimental": "0" });
    const { showExperimental } = await load("zz.");
    expect(showExperimental(), "the shared gate is reading a hardcoded prefix").toBe(true);
  });

  it("writes back under the manifest's prefix too", async () => {
    const store = stubStorage({});
    const { setShowExperimental } = await load("zz.");
    setShowExperimental(true);
    expect(store["zz.showExperimental"]).toBe("1");
    expect(store["sidekickai.showExperimental"]).toBe(undefined);
  });
});

describe("setShowExperimental", () => {
  it("persists both states in the shape the getter reads back", async () => {
    const store = stubStorage({});
    const { setShowExperimental, showExperimental } = await load();

    setShowExperimental(true);
    expect(store["sidekickai.showExperimental"]).toBe("1");
    expect(showExperimental()).toBe(true);

    setShowExperimental(false);
    expect(store["sidekickai.showExperimental"]).toBe("0");
    expect(showExperimental()).toBe(false);
  });

  it("coerces to a real boolean rather than storing what it was handed", async () => {
    const store = stubStorage({});
    const { setShowExperimental, showExperimental } = await load();

    setShowExperimental("on");
    expect(showExperimental()).toBe(false);
    expect(store["sidekickai.showExperimental"]).toBe("0");
  });

  // A denied write still flips the flag for this session: the preference is honoured now and
  // forgotten on reload, which beats a control that visibly does nothing.
  it("still applies when the write is denied", async () => {
    stubDeniedStorage();
    const { setShowExperimental, showExperimental } = await load();

    expect(() => setShowExperimental(true)).not.toThrow();
    expect(showExperimental()).toBe(true);
  });
});

describe("onExperimentalChange", () => {
  it("notifies the rail with the new value", async () => {
    stubStorage({});
    const { onExperimentalChange, setShowExperimental } = await load();

    const seen = [];
    onExperimentalChange((v) => seen.push(v));

    setShowExperimental(true);
    setShowExperimental(false);
    expect(seen).toEqual([true, false]);
  });

  it("fires on a denied write too, so the rail matches the flag", async () => {
    stubDeniedStorage();
    const { onExperimentalChange, setShowExperimental } = await load();

    const seen = [];
    onExperimentalChange((v) => seen.push(v));
    setShowExperimental(true);
    expect(seen).toEqual([true]);
  });
});
