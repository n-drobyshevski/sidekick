// The inline bootstrap: doGet renders the api_bootstrap envelope into the page
// (gas_shared/server/inlineBoot.ts) and store.js reads it once instead of a first RPC.
import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineBootJson, inlineJson } from "../../gas_shared/server/inlineBoot";

describe("inlineJson", () => {
  const hostile = {
    close: "</script><script>alert(1)</script>",
    comment: "<!-- x -->",
    amp: "a&b",
    url: "https:" + "/" + "/example.com/a",
    quote: "don't",
    tick: String.fromCharCode(96),
    seps: "\u2028\u2029",
  };

  it("round-trips through JSON.parse unchanged", () => {
    expect(JSON.parse(inlineJson(hostile))).toEqual(hostile);
  });

  it("cannot close the script block or open a comment", () => {
    const out = inlineJson(hostile);
    expect(out).not.toMatch(/[<>&]/);
  });

  it("gives the middlebox nothing to misread", () => {
    const out = inlineJson(hostile);
    expect(out).not.toContain("/" + "/");
    expect(out).not.toContain("'");
    expect(out).not.toContain(String.fromCharCode(96));
    expect(out).not.toMatch(/[\u2028\u2029]/);
  });
});

describe("inlineBootJson", () => {
  afterEach(() => vi.restoreAllMocks());

  it("inlines an ok envelope", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const out = inlineBootJson(() => ({ ok: true, data: { buildId: "x" } }) as { ok: boolean });
    expect(JSON.parse(out)).toEqual({ ok: true, data: { buildId: "x" } });
  });

  it("renders nothing for a failed envelope or a throw, so the client asks instead", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(inlineBootJson(() => ({ ok: false }))).toBe("");
    expect(inlineBootJson(() => { throw new Error("boom"); })).toBe("");
  });
});
