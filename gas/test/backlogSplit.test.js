// `pages/_backlog.js` — the present/unobserved split, ported into words once for every page
// that shows an open count (Executive's hero, MTTR's hero, Overview's open-count strip, and
// the two "open findings by age" charts). Real numbers throughout: the register measured on
// the live ledger had 2,532 present, 2,630 unobserved across 113 assets, last seen 2026-08-12.

import { describe, expect, it } from "vitest";

import { backlogSplitView, oldestUnobservedNote } from "../src/client/js/pages/_backlog.js";

const MEASURED = {
  observed: 2532, unobserved: 2630, unobservedAssets: 113, unobservedSince: "2026-08-12",
};

describe("backlogSplitView — present", () => {
  it("builds the fixed line, with the register's own date formatter", () => {
    const view = backlogSplitView(MEASURED);
    expect(view.show).toBe(true);
    expect(view.observed).toBe(2532);
    expect(view.unobserved).toBe(2630);
    expect(view.assets).toBe(113);
    expect(view.line).toBe("2,532 present · 2,630 unobserved since 2026-08-12");
  });

  it("builds the shared caption verbatim, fixed at plan time", () => {
    const view = backlogSplitView(MEASURED);
    expect(view.caption).toBe(
      "2,630 findings on 113 assets have not been in a scan since 2026-08-12. Counted apart: "
      + "the scanner has not answered for them, which is not the same as nobody fixing them.",
    );
  });

  it("singularises a one-finding, one-asset blind spot", () => {
    const view = backlogSplitView({
      observed: 4, unobserved: 1, unobservedAssets: 1, unobservedSince: "2026-08-12",
    });
    expect(view.line).toBe("4 present · 1 unobserved since 2026-08-12");
    expect(view.caption).toBe(
      "1 finding on 1 asset has not been in a scan since 2026-08-12. Counted apart: the "
      + "scanner has not answered for them, which is not the same as nobody fixing them.",
    );
  });

  it("drops the \"since\" clause rather than printing an unparseable date", () => {
    const view = backlogSplitView({
      observed: 4, unobserved: 2, unobservedAssets: 1, unobservedSince: null,
    });
    expect(view.line).toBe("4 present · 2 unobserved");
    expect(view.caption).toBe(
      "2 findings on 1 asset have not been in a scan. Counted apart: the scanner has not "
      + "answered for them, which is not the same as nobody fixing them.",
    );
  });
});

describe("backlogSplitView — absent (nothing unobserved) hides cleanly", () => {
  it("shows nothing when unobserved is 0, even with a healthy open backlog", () => {
    const view = backlogSplitView({
      observed: 5174, unobserved: 0, unobservedAssets: 0, unobservedSince: null,
    });
    expect(view.show).toBe(false);
    expect(view.line).toBeNull();
    expect(view.caption).toBeNull();
  });
});

describe("backlogSplitView — zero / absent payload", () => {
  it("refuses rather than crashes on a payload with no backlog block at all", () => {
    for (const input of [null, undefined, {}]) {
      const view = backlogSplitView(input);
      expect(view.show).toBe(false);
      expect(view.observed).toBe(0);
      expect(view.unobserved).toBe(0);
      expect(view.line).toBeNull();
      expect(view.caption).toBeNull();
    }
  });
});

describe("oldestUnobservedNote — present / absent / zero", () => {
  it("names the count and pluralises", () => {
    expect(oldestUnobservedNote(2630))
      .toBe("2,630 more open findings are unobserved and not ranked here.");
  });

  it("singularises one", () => {
    expect(oldestUnobservedNote(1))
      .toBe("1 more open finding is unobserved and not ranked here.");
  });

  it("is null for zero or an absent count, so the panel draws nothing", () => {
    expect(oldestUnobservedNote(0)).toBeNull();
    expect(oldestUnobservedNote(null)).toBeNull();
    expect(oldestUnobservedNote(undefined)).toBeNull();
  });
});
