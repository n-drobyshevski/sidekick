// Precedence + presence logic for Wiz auth mode selection. Pure — imports only the
// GAS-global-free resolveWizAuthMode from the server props module.

import { describe, expect, it } from "vitest";
import { resolveWizAuthMode } from "../src/server/props";

describe("resolveWizAuthMode", () => {
  it("uses the raw token when present", () => {
    expect(resolveWizAuthMode("tok", null, null)).toBe("token");
  });

  it("uses OAuth when only client id + secret are present", () => {
    expect(resolveWizAuthMode(null, "id", "secret")).toBe("oauth");
  });

  it("prefers the token when both are configured", () => {
    expect(resolveWizAuthMode("tok", "id", "secret")).toBe("token");
  });

  it("ignores a blank/whitespace token and falls back to OAuth", () => {
    expect(resolveWizAuthMode("   ", "id", "secret")).toBe("oauth");
    expect(resolveWizAuthMode("", "id", "secret")).toBe("oauth");
  });

  it("is null when nothing usable is set", () => {
    expect(resolveWizAuthMode(null, null, null)).toBeNull();
    expect(resolveWizAuthMode("", null, null)).toBeNull();
  });

  it("needs both halves of the OAuth pair", () => {
    expect(resolveWizAuthMode(null, "id", null)).toBeNull();
    expect(resolveWizAuthMode(null, null, "secret")).toBeNull();
  });
});
