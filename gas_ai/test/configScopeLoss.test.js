// What a scope costs the Cloud Configuration register, as a sentence.
//
// Plain .js for the reason helpContent.test.js writes out: tsconfig has no allowJs and
// includes test/**/*.ts, so a .ts test importing a client .js module fails `tsc --noEmit`.
//
// The wording IS the decision here, which is why it is a pure function with a test rather
// than four `el()` calls in the page. A scoped register is shorter than an unscoped one for
// two unrelated reasons — findings on assets in another project or domain, and findings on no
// AI asset at all — and a reader given one number for both would read a short list as a clean
// landscape. That is the failure this file exists to stop.

import { describe, expect, it } from "vitest";
import { configScopeLossView } from "../src/client/js/pages/configView.js";

const loss = (o) => ({ outOfView: 0, register: 7, unattributed: 0, ...o });

describe("configScopeLossView", () => {
  it("says nothing when the scope costs nothing", () => {
    expect(configScopeLossView(null, {})).toBeNull();
    expect(configScopeLossView(loss({ outOfView: 0 }), { projectView: "p" })).toBeNull();
  });

  it("counts what is outside the view against the whole register", () => {
    const v = configScopeLossView(loss({ outOfView: 6, unattributed: 3 }), { projectView: "p" });
    expect(v.tag).toBe("Whole register");
    expect(v.text).toContain("6 of 7 findings are outside this view.");
  });

  // "7 of 7 are outside this view" is true and reads like an arithmetic error — and it is
  // exactly the case where the sentence matters most, since the table above it is empty.
  it("states a wholly excluded register as a fact, not as arithmetic", () => {
    const v = configScopeLossView(loss({ outOfView: 7, unattributed: 3 }), { domainView: "SAP" });
    expect(v.text).toContain("None of the 7 findings are in this view.");
    expect(v.text).not.toContain("7 of 7");
  });

  // THE TWO SCOPES GET TWO DIFFERENT REASONS, because the absences are different. A project
  // can be on the finding's own resource; a domain never is — `configurationFindings` selects
  // no tags at all, so a domain is joined off the AI asset the finding names or there is none.
  it("names the project reason under a project", () => {
    const v = configScopeLossView(loss({ outOfView: 6 }), { projectView: "p" });
    expect(v.text).toContain("belongs to no project");
    expect(v.text).not.toContain("domain");
  });

  it("names the domain reason under a domain", () => {
    const v = configScopeLossView(loss({ outOfView: 6 }), { domainView: "SAP" });
    expect(v.text).toContain("its domain is joined from the AI asset it names");
    expect(v.text).not.toContain("belongs to no project");
  });

  // The group that can never be in ANY view is the honest half of the number: it is a fact
  // about this register, not about the scope, and it does not come back when the scope does.
  it("separates the rows no view can ever hold, and counts them", () => {
    const v = configScopeLossView(loss({ outOfView: 6, unattributed: 3 }), { projectView: "p" });
    expect(v.text).toContain("3 name no AI asset at all, and can be in no view.");
  });

  it("says nothing about orphans when there are none", () => {
    const v = configScopeLossView(loss({ outOfView: 6, unattributed: 0 }), { projectView: "p" });
    expect(v.text).not.toContain("no AI asset at all");
  });

  it("agrees with itself on singular and plural", () => {
    const one = configScopeLossView(
      { outOfView: 1, register: 1, unattributed: 1 }, { projectView: "p" },
    );
    expect(one.text).toContain("The one finding on this register is not in this view.");
    expect(one.text).toContain("1 names no AI asset at all");
  });
});
