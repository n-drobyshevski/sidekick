// gas_shared/store.js `swrParts`: one page payload fetched as PARALLEL parts, merged back.
//
// THE CLAIM THAT MATTERS is "parallel": every part is issued before any has answered. Apps
// Script runs each google.script.run call as its own execution, so that is what turns a cold
// Executive load from the sum of its read-models into roughly the slowest one.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateRpcCache, swrParts } from "../../gas_shared/store.js";

let issued;
let pending;

function installRun(respond) {
  issued = [];
  pending = [];
  const runner = (ok, fail) => new Proxy({}, {
    get(_t, prop) {
      if (prop === "withSuccessHandler") return (fn) => runner(fn, fail);
      if (prop === "withFailureHandler") return (fn) => runner(ok, fn);
      return (params) => {
        issued.push({ name: prop, params });
        pending.push(() => respond(prop, params, ok, fail));
      };
    },
  });
  globalThis.google = { script: { run: runner(null, null) } };
}

const flush = () => { const fns = pending.splice(0); fns.forEach((f) => f()); };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => invalidateRpcCache());
afterEach(() => { delete globalThis.google; });

describe("swrParts", () => {
  it("issues every part before any answers, then merges them in order", async () => {
    installRun((_name, p, ok) => ok({ ok: true, data: { [p.part]: p.part.toUpperCase() } }));
    const done = swrParts("api_getExecutivePage", ["a", "b", "c"], { scope: "x" });
    // Nothing has answered yet, and all three are already on the wire.
    expect(issued.map((c) => c.params.part)).toEqual(["a", "b", "c"]);
    expect(issued.every((c) => c.name === "api_getExecutivePage" && c.params.scope === "x")).toBe(true);
    flush();
    expect(await done).toEqual({ a: "A", b: "B", c: "C" });
  });

  it("rejects when any part fails — never a payload missing a block", async () => {
    installRun((_name, p, ok) => ok(p.part === "b"
      ? { ok: false, error: "boom", errorKind: "error" }
      : { ok: true, data: { [p.part]: 1 } }));
    const done = swrParts("api_getExecutivePage", ["a", "b"], {});
    flush();
    await expect(done).rejects.toThrow("boom");
  });

  it("serves a revisit from the session cache and repaints with the merged fresh payload", async () => {
    let version = 1;
    installRun((_name, p, ok) => ok({ ok: true, data: { [p.part]: p.part + version } }));
    const first = swrParts("api_getExecutivePage", ["a", "b"], {});
    flush();
    expect(await first).toEqual({ a: "a1", b: "b1" });

    version = 2;
    let fresh = null;
    const again = swrParts("api_getExecutivePage", ["a", "b"], {}, (m) => { fresh = m; });
    expect(await again).toEqual({ a: "a1", b: "b1" }); // stale, instantly
    flush();
    await tick();
    expect(fresh).toEqual({ a: "a2", b: "b2" });
  });
});
