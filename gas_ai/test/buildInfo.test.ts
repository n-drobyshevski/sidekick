// The build stamp exists to answer "which build is live?" from the running app, so its
// failure modes matter more than its happy path: outside a git checkout it must say
// "unknown" rather than invent a version, and under vitest (no esbuild define) it must be
// stable rather than depend on how the test was started.

import { describe, expect, it } from "vitest";
import { BUILD_COMMIT, BUILD_DATE, BUILD_ID, buildInfo } from "../src/server/buildInfo";
// @ts-expect-error — client module is plain JS, no d.ts (same as syncProgress.test.ts)
import { clientBuild, describeBuild } from "../src/client/js/buildInfo.js";

describe("the stamp falls back safely without a define step", () => {
  it("server: a stable dev stamp, not undefined", () => {
    expect(BUILD_ID).toBe("dev");
    expect(BUILD_COMMIT).toBe("");
    expect(BUILD_DATE).toBe("");
    expect(buildInfo()).toEqual({ id: "dev", commit: "", date: "" });
  });

  it("client: the same, so the two agree under test", () => {
    expect(clientBuild()).toEqual({ id: "dev", commit: "", date: "" });
  });
});

describe("describeBuild", () => {
  it("names the commit and its date", () => {
    expect(describeBuild({ id: "abc123def456", commit: "9a87d94", date: "2026-08-12T18:38:46Z" }))
      .toBe("9a87d94 · 12 Aug 2026");
  });

  it("shows the commit alone when the date is missing", () => {
    expect(describeBuild({ id: "abc123def456", commit: "9a87d94", date: "" })).toBe("9a87d94");
  });

  it("falls back to the content hash when there is no commit", () => {
    // A release tarball or a machine with no git: the hash still distinguishes builds.
    expect(describeBuild({ id: "abc123def456", commit: "", date: "" })).toBe("abc123def456");
  });

  it("says unknown rather than 'dev' or blank", () => {
    expect(describeBuild({ id: "dev", commit: "", date: "" })).toBe("unknown");
    expect(describeBuild({})).toBe("unknown");
    expect(describeBuild(null)).toBe("unknown");
  });

  it("ignores an unparseable date instead of rendering Invalid Date", () => {
    expect(describeBuild({ id: "x", commit: "9a87d94", date: "not a date" })).toBe("9a87d94");
  });

  it("marks a dirty tree, because the SHA then names something the bundle is not", () => {
    expect(describeBuild({ id: "x", commit: "4dd2acb-dirty", date: "" })).toBe("4dd2acb-dirty");
  });
});
