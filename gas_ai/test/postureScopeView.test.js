// What the Compliance page CLAIMS about the population its percentages describe.
//
// The DOM-free half of postureScopeNote, tested the way projectScopeView is: the note is
// four `el()` calls, but WHICH of three things it says is a decision, and this page has
// exactly one job — never to let a figure be read as answering a question it does not.
//
// The regression this file exists for is a specific sentence. The page used to say, whenever
// a project was picked: "Wiz scores these tenant-wide and a posture row carries no asset to
// filter by". The second clause is true. The first was not: the sync sends its fetch scope
// as `analyticsSelection.projectId`, so on a scoped tenant those percentages already
// described one business unit, not the tenant. Every branch below is asserted NOT to say
// "tenant" for that reason.

import { describe, expect, it } from "vitest";
import { postureScopeView } from "../src/client/js/pages/complianceShared.js";

const live = (over = {}) => ({
  postureScope: {
    projectId: "p-a",
    source: "live",
    fetchedAt: "2026-08-21T16:05:00.000Z",
    frameworkCount: 4,
    reason: null,
    detail: null,
    ...over,
  },
});

const stored = (reason, detail = null) => ({
  postureScope: {
    projectId: "p-a",
    source: "stored",
    fetchedAt: null,
    frameworkCount: 0,
    reason,
    detail,
  },
});

describe("postureScopeView", () => {
  it("says nothing at all when no project is in view", () => {
    // A permanent "register-wide" badge on a register-wide page is noise, not honesty.
    expect(postureScopeView(null).show).toBe(false);
    expect(postureScopeView({}).show).toBe(false);
    expect(postureScopeView(live({ projectId: "" })).show).toBe(false);
  });

  it("states the scope AND its own clock when Wiz re-scored the project", () => {
    const v = postureScopeView(live());
    expect(v.show).toBe(true);
    expect(v.live).toBe(true);
    expect(v.tag).toBe("This project");
    expect(v.text).toContain("4 frameworks");
    // Two clocks in one app have to be legible as two: this page's figures are minutes old,
    // everything else the reader will click into is as old as the last sync.
    expect(v.text).toContain("this page alone is live");
    expect(v.text).toContain("as of the last sync");
  });

  it("falls back to the register-wide claim, naming the reason", () => {
    expect(postureScopeView(stored("noCredentials")).tag).toBe("Whole register");
    expect(postureScopeView(stored("noCredentials")).live).toBe(false);
    expect(postureScopeView(stored("noCredentials")).text).toContain("credentials");
    expect(postureScopeView(stored("tooManyFrameworks")).text).toContain("too many frameworks");
    expect(postureScopeView(stored("fetchFailed")).text).toContain("could not re-score");
  });

  it("prints Wiz's refusal, capped and cut on a word boundary", () => {
    // Shipped and ignored, `detail` would be the "dead indirection that reads like a
    // feature" this codebase names elsewhere. An operator seeing "could not re-score" needs
    // the HTTP code to know whether to retry or fix a permission.
    const short = postureScopeView(stored("fetchFailed", "Wiz query failed (HTTP 403)."));
    expect(short.text).toContain("Wiz query failed (HTTP 403)");
    // One sentence, not two: the detail is folded in and the full stop is not doubled.
    expect(short.text).not.toContain("..");
    expect(short.text.endsWith(".")).toBe(true);

    // Distinguishable words, so "cut on a word boundary" can actually be checked rather
    // than assumed: every word that survives the clip has to be a whole word from the input.
    const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima "
      + "mike november oscar papa quebec romeo sierra tango";
    const long = postureScopeView(stored("fetchFailed", `HTTP 500: ${words}`));
    expect(long.text.length).toBeLessThan(300);
    expect(long.text).toContain("…");
    const kept = long.text.slice(long.text.indexOf("— ") + 2).replace("…", "").split(" ");
    for (const word of kept) {
      expect(`HTTP 500: ${words}`.split(" "), `"${word}" was cut mid-word`).toContain(word);
    }
    // An ellipsis ends the sentence; it must not also collect a full stop.
    expect(long.text.endsWith("…")).toBe(true);

    // The other reasons carry no detail and must not grow an empty dash.
    expect(postureScopeView(stored("noCredentials", "ignored")).text).not.toContain("—");
  });

  it("still says something when the reason is one it does not know", () => {
    // A code this build has no copy for — an older client against a newer server, which SWR
    // makes an ordinary state rather than an exotic one. It must degrade to the general
    // truth, not to an empty sentence or the word "undefined".
    const v = postureScopeView(stored("somethingNewer"));
    expect(v.tag).toBe("Whole register");
    expect(v.text).toContain("the scope the sync fetched");
    expect(v.text).not.toContain("undefined");
  });

  it("never calls the stored figure tenant-wide, in any branch", () => {
    // THE FIX, pinned. The register is whatever the sync was scoped to fetch — on this
    // tenant a business unit — so "tenant-wide" trades one wrong population for another.
    const branches = [
      postureScopeView(live()),
      postureScopeView(stored("noCredentials")),
      postureScopeView(stored("tooManyFrameworks")),
      postureScopeView(stored("fetchFailed")),
      postureScopeView(stored(null)),
    ];
    for (const v of branches) {
      expect(v.text.toLowerCase(), v.tag).not.toContain("tenant");
    }
  });

  it("ends every sentence, so the note reads as prose rather than a label", () => {
    for (const reason of ["noCredentials", "tooManyFrameworks", "fetchFailed", null]) {
      expect(postureScopeView(stored(reason)).text.endsWith(".")).toBe(true);
    }
    expect(postureScopeView(live()).text.endsWith(".")).toBe(true);
    // A detail that ends itself is not given a second ending.
    expect(postureScopeView(stored("fetchFailed", "HTTP 403.")).text.endsWith("..")).toBe(false);
  });
});
