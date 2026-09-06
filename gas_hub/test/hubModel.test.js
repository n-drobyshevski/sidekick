// What the launcher draws, decided without a document: `src/client/js/pages/hubModel.js`.
//
// The page module beside it (`pages/hub.js`) only appends what this returns, so every
// decision worth testing is here — which tiles, in what order, in which of the three states,
// and which of them may carry an href at all. DOM-free by construction, so this runs in plain
// node with no stub.

import { describe, expect, it } from "vitest";

import { TILE_ORDER, tileModel, tileState } from "../src/client/js/pages/hubModel.js";

/** `src/server/api.ts`'s bootstrap payload, in the shape the server really sends it. */
const BOOT = {
  product: "Wiz Sidekick",
  buildId: "abc123",
  canEditAccess: true,
  canEditUrls: true,
  tiles: [
    {
      key: "os",
      productName: "Wiz Sidekick OS",
      headline: "OS Patching",
      scope: "Host CVEs · MTTR · SLA",
      url: "https://script.google.com/a/macros/example.com/s/OS/exec",
    },
    {
      key: "ai",
      productName: "Wiz Sidekick AI",
      headline: "AI security",
      scope: "Agents · models · posture",
      url: "http://localhost:8788/",
    },
    {
      key: "devsecops",
      productName: "Wiz Sidekick DevSecOps",
      headline: "DevSecOps",
      scope: "SAST · SCA · Secrets",
      url: null,
    },
    {
      key: "soon",
      productName: "Wiz Sidekick",
      headline: "Coming soon (maybe)",
      scope: "Not yet built",
      url: null,
    },
  ],
};

const withTile = (key, patch) => ({
  ...BOOT,
  tiles: BOOT.tiles.map((t) => (t.key === key ? { ...t, ...patch } : t)),
});

describe("TILE_ORDER", () => {
  it("is fixed, and it is the order the grid draws", () => {
    expect(TILE_ORDER).toEqual(["os", "ai", "devsecops", "soon"]);
  });

  it("is not derived from the payload — a reshuffled server answer moves nothing", () => {
    // A launcher whose 2x2 grid reflowed between reloads would be a worse product than the
    // bookmark it replaces: the reader's muscle memory for "top left is OS Patching" is most
    // of what a hub is for.
    const reversed = { ...BOOT, tiles: [...BOOT.tiles].reverse() };
    expect(tileModel(reversed).map((t) => t.key)).toEqual(TILE_ORDER);
  });
});

describe("tileState", () => {
  it("is \"link\" for a sibling with a URL", () => {
    expect(tileState(BOOT.tiles[0])).toBe("link");
  });

  it("is \"unset\" for a sibling with none — null and \"\" alike", () => {
    // The server sends `null`; a hand-edited property or an older payload could send "".
    // Both mean the same thing and neither may become an href.
    expect(tileState({ key: "devsecops", url: null })).toBe("unset");
    expect(tileState({ key: "devsecops", url: "" })).toBe("unset");
    expect(tileState({ key: "devsecops" })).toBe("unset");
  });

  it("is \"soon\" for the unbuilt fourth EVEN WHEN HANDED A URL", () => {
    // The model does not trust `url: null` from a distance. api.ts builds that tile with no
    // URL_PROP entry, so today the value is always already null — but a tile whose own KEY
    // says "not built yet" must never become clickable because of a stray value arriving from
    // an upstream change this file cannot see.
    expect(tileState({ key: "soon", url: "https://script.google.com/x/exec" })).toBe("soon");
  });

  it("answers \"soon\" rather than throwing on nothing at all", () => {
    expect(tileState(null)).toBe("soon");
    expect(tileState(undefined)).toBe("soon");
  });
});

describe("tileModel", () => {
  it("carries each tile's own copy through untouched", () => {
    const os = tileModel(BOOT)[0];
    expect(os).toEqual({
      key: "os",
      productName: "Wiz Sidekick OS",
      headline: "OS Patching",
      scope: "Host CVEs · MTTR · SLA",
      url: "https://script.google.com/a/macros/example.com/s/OS/exec",
      state: "link",
    });
  });

  it("gives a linkable tile its href and every other tile NULL", () => {
    const byKey = Object.fromEntries(tileModel(BOOT).map((t) => [t.key, t]));
    expect(byKey["os"].state).toBe("link");
    expect(byKey["ai"].state).toBe("link");
    expect(byKey["devsecops"]).toMatchObject({ state: "unset", url: null });
    expect(byKey["soon"]).toMatchObject({ state: "soon", url: null });
  });

  it("strips the href from a \"soon\" tile the server somehow sent one for", () => {
    const boot = withTile("soon", { url: "https://script.google.com/x/exec" });
    const soon = tileModel(boot).filter((t) => t.key === "soon")[0];
    expect(soon.state).toBe("soon");
    expect(soon.url, "the unbuilt fourth became clickable").toBeNull();
  });

  it("reads a blank URL as unset, not as a link to nowhere", () => {
    const boot = withTile("os", { url: "" });
    expect(tileModel(boot)[0]).toMatchObject({ state: "unset", url: null });
  });

  it("SKIPS a key the payload did not send rather than inventing copy for it", () => {
    // A differently-shaped payload produces a shorter grid, never a tile with made-up words
    // standing in for a fact nobody sent.
    const boot = { ...BOOT, tiles: BOOT.tiles.filter((t) => t.key !== "ai") };
    expect(tileModel(boot).map((t) => t.key)).toEqual(["os", "devsecops", "soon"]);
  });

  it("draws nothing at all rather than throwing on an empty or absent payload", () => {
    expect(tileModel({ ...BOOT, tiles: [] })).toEqual([]);
    expect(tileModel({})).toEqual([]);
    expect(tileModel(null)).toEqual([]);
  });
});

describe("the tile component's modifier map covers exactly these four keys", () => {
  it("names one CSS modifier per TILE_ORDER key and no others", async () => {
    // ui/tile.js's MODIFIER table is private, so this reads the module as text: a key in
    // TILE_ORDER with no modifier renders `class="tile undefined"` — an unstyled white
    // rectangle, which is the kind of failure that looks like a layout bug rather than a
    // missing entry.
    const { readFileSync } = await import("node:fs");
    const SRC = readFileSync(
      new URL("../src/client/js/ui/tile.js", import.meta.url), "utf8",
    );
    const table = SRC.slice(SRC.indexOf("const MODIFIER = {"), SRC.indexOf("};", SRC.indexOf("const MODIFIER = {")));
    const keys = [...table.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...TILE_ORDER].sort());
  });
});
