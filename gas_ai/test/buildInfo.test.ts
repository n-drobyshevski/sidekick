// The build stamp exists to answer "which build is live?" from the running app, so its
// failure modes matter more than its happy path: under vitest (no esbuild define) it must
// be stable rather than depend on how the test was started, and it must say "unknown"
// rather than present the absence of a stamp as if it were one.
//
// The stamp is a content hash of src/, not a commit SHA. buildStamp.mjs explains why —
// a SHA inside a committed artifact can only ever name its own parent, which churned
// dist/ on every commit. buildStamp.test.mjs pins the stability property that replaced it.

import { describe, expect, it } from "vitest";
import { BUILD_ID, buildInfo } from "../src/server/buildInfo";
// @ts-expect-error — client module is plain JS, no d.ts (same as syncProgress.test.ts)
import { clientBuild, describeBuild } from "../src/client/js/buildInfo.js";

describe("the stamp falls back safely without a define step", () => {
  it("server: a stable dev stamp, not undefined", () => {
    expect(BUILD_ID).toBe("dev");
    expect(buildInfo()).toEqual({ id: "dev" });
  });

  it("client: the same, so the two agree under test", () => {
    expect(clientBuild()).toEqual({ id: "dev" });
  });

  it("carries no commit or date, which is the whole point", () => {
    // Guards the regression directly: reintroducing either field here would reintroduce
    // the dist churn, because neither can be derived without naming a commit.
    expect(Object.keys(buildInfo())).toEqual(["id"]);
  });
});

describe("describeBuild", () => {
  it("shows the hash, which is what which-build takes", () => {
    expect(describeBuild({ id: "abc123def456" })).toBe("abc123def456");
  });

  it("says unknown rather than 'dev' or blank", () => {
    // "dev" is the absence of a stamp, not the name of a build.
    expect(describeBuild({ id: "dev" })).toBe("unknown");
    expect(describeBuild({ id: "" })).toBe("unknown");
    expect(describeBuild({})).toBe("unknown");
    expect(describeBuild(null)).toBe("unknown");
    expect(describeBuild(undefined)).toBe("unknown");
  });
});
