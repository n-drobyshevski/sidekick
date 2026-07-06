import { describe, it } from "vitest";
import { trendFromFrames } from "../src/domain/trend";
import { expectParity, fixture } from "./helpers";

describe("trendFromFrames (fixture parity)", () => {
  const fx = fixture("trend");
  it("matches the unscoped Python trend", () => {
    expectParity(trendFromFrames(fx.scans, fx.base), fx.expected.all);
  });
  it("matches the CRITICAL+HIGH scoped trend", () => {
    expectParity(
      trendFromFrames(fx.scans, fx.base, ["CRITICAL", "HIGH"]),
      fx.expected.scoped_critical_high,
    );
  });
  it("returns [] for empty inputs", () => {
    expectParity(trendFromFrames([], fx.base), []);
    expectParity(trendFromFrames(fx.scans, []), []);
  });
});
