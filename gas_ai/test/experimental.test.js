// The "show experimental content" preference, which decides whether the Scoring Models page
// and its vocabulary exist for a reader at all.
//
// Worth its own spec for one reason: EVERY WAY OF NOT KNOWING HAS TO READ AS OFF. The flag
// guards models that are under calibration, so an absent key, an unparseable value and a GAS
// iframe that denies web storage outright must all answer no — which is the inverse of the
// `!== "0"` idiom the collapsed rail uses, and exactly the kind of inversion that gets
// "simplified" back the wrong way by someone matching the neighbouring code.
//
// The module reads localStorage once at import and caches, so each case re-imports against
// its own stub (vi.resetModules + dynamic import) rather than sharing one instance.

import { afterEach, describe, expect, it, vi } from "vitest";

const MODULE = "../src/client/js/experimental.js";

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

async function load() {
  vi.resetModules();
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
