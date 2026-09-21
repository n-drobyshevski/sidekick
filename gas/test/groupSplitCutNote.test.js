// The remediation split's cut note, tested where it is WRITTEN rather than only where it is
// read. `executiveView.test.js` pins the sentence the Executive page shows and `mttrByAsset`
// pins the numbers the server sends; this file pins the one function between them, because the
// two pages reach it by different routes — the Executive through `executiveByDomainView`'s
// `cutNote` field, the MTTR page by calling it directly in `renderByDomain` — and a sentence
// that drifted between those routes would be the exact failure the shared module exists to stop.

import { describe, expect, it } from "vitest";

import { groupCutNote } from "../src/client/js/pages/_groupSplit.js";

describe("groupCutNote", () => {
  it("names the assets and the findings they hold", () => {
    expect(groupCutNote({ groups: 7, open: 31, resolved: 12 }, "asset"))
      .toBe("7 more assets holding 31 open findings are not shown; the register lists"
        + " every open finding.");
  });

  // Both counts and the verb agree with themselves — a footnote that says "1 more assets ... are
  // not shown" undercuts the one thing it is there to do, which is be believed.
  it("agrees in number throughout for a single group and a single finding", () => {
    expect(groupCutNote({ groups: 1, open: 1, resolved: 0 }, "asset"))
      .toBe("1 more asset holding 1 open finding is not shown; the register lists"
        + " every open finding.");
  });

  it("pluralizes the two counts independently", () => {
    expect(groupCutNote({ groups: 1, open: 4, resolved: 0 }, "asset"))
      .toContain("1 more asset holding 4 open findings is");
    expect(groupCutNote({ groups: 3, open: 1, resolved: 0 }, "asset"))
      .toContain("3 more assets holding 1 open finding are");
  });

  // The noun is the caller's, because the cap is a property of the dimension rather than of this
  // sentence: nothing here should have to be edited to bound a fourth dimension one day.
  it("takes the dimension's noun from its caller", () => {
    expect(groupCutNote({ groups: 2, open: 5 }, "support group"))
      .toContain("2 more support groups holding 5 open findings");
  });

  // Silence, in all the shapes it arrives in. An uncapped dimension sends no `cut` at all; a
  // capped one that fit inside its cap sends zeroes; neither has anything to confess, and a
  // "0 more assets" line would be noise claiming to be honesty.
  it("says nothing when nothing was cut", () => {
    expect(groupCutNote(null, "asset")).toBeNull();
    expect(groupCutNote(undefined, "asset")).toBeNull();
    expect(groupCutNote({ groups: 0, open: 0, resolved: 0 }, "asset")).toBeNull();
  });

  // A cut group count with no open findings behind it is still a cut: those assets carry only
  // resolved history, and the table is still not the whole estate.
  it("still speaks when the cut assets hold no open findings", () => {
    expect(groupCutNote({ groups: 2, open: 0, resolved: 9 }, "asset"))
      .toContain("2 more assets holding 0 open findings are not shown");
  });
});
