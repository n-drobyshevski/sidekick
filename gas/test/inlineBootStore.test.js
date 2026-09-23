// store.js's half of the inline bootstrap (see inlineBoot.test.ts for the server half): the
// block doGet renders answers the first bootstrap() once, and everything else asks the server.
// A .js file because store.js ships no declarations for a .ts test to import.
import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineJson } from "../../gas_shared/server/inlineBoot";

describe("store.bootstrap() with an inline block", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubPage(text) {
    const parent = { removeChild: vi.fn() };
    const node = text === null ? null : { textContent: text, parentNode: parent };
    vi.stubGlobal("document", { getElementById: (id) => (id === "boot-data" ? node : null) });
    const rpc = vi.fn();
    const runner = {
      withSuccessHandler(ok) {
        return {
          withFailureHandler() {
            return { api_bootstrap: () => { rpc(); ok({ ok: true, data: { from: "rpc" } }); } };
          },
        };
      },
    };
    vi.stubGlobal("google", { script: { run: runner } });
    vi.stubGlobal("performance", { now: () => 0 });
    vi.spyOn(console, "debug").mockImplementation(() => {});
    return { rpc, parent };
  }

  it("answers the first call from the page and removes the block", async () => {
    const { rpc, parent } = stubPage(inlineJson({ ok: true, data: { from: "inline" } }));
    const store = await import("../../gas_shared/store.js");
    expect(await store.bootstrap()).toEqual({ from: "inline" });
    expect(rpc).not.toHaveBeenCalled();
    expect(parent.removeChild).toHaveBeenCalledTimes(1);
  });

  it("never answers a forced refresh from the page", async () => {
    const { rpc } = stubPage(inlineJson({ ok: true, data: { from: "inline" } }));
    const store = await import("../../gas_shared/store.js");
    await store.bootstrap();
    expect(await store.bootstrap(true)).toEqual({ from: "rpc" });
    store.invalidateBootstrap();
    expect(await store.bootstrap()).toEqual({ from: "rpc" });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["no block", null],
    ["an empty slot", ""],
    ["an unrendered scriptlet", "<?!= bootJson ?>"],
    ["a failed envelope", JSON.stringify({ ok: false, error: "x" })],
  ])("falls back to the RPC on %s", async (_label, text) => {
    const { rpc } = stubPage(text);
    const store = await import("../../gas_shared/store.js");
    expect(await store.bootstrap()).toEqual({ from: "rpc" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
