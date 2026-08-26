// The allowlist end to end, through the REAL dev shims rather than through inline stubs.
//
// access.test.ts and accessAdmin.test.ts pin the decision table and the tier with two-method
// fakes, which is the right instrument for a pure function and the wrong one for the question
// here: does setup() actually seed the property, and does a save survive a round trip through
// the same PropertiesService the dev harness and the browser share? Those are wiring claims,
// and wiring is what gasEnv.ts's booted server exists to exercise.
//
// It also pins the one thing that would otherwise only be caught by opening a browser: the
// dev Session shim makes dev@example.com BOTH the active and the effective user, so the dev
// operator is the owner. Every guarded entry point behaves in dev exactly as it does for the
// deployer in production — which is why `npm run dev` never shows the denial page, and why
// deniedHtml is a pure string with its own unit coverage instead.

import { afterEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";

const DEV_USER = "dev@example.com";

interface AccessData {
  canEditUsers: boolean;
  canEditAdmins: boolean;
  owner?: string;
  domain?: string;
  users?: string[];
  admins?: string[];
}

describe("setup() leaves the guard in a state an operator can see", () => {
  afterEach(() => teardownServer());

  it("seeds ALLOWED_USERS with the deploying account", async () => {
    const server = await bootServer();
    expect(PropertiesService.getScriptProperties().getProperty("ALLOWED_USERS")).toBeNull();
    server.setup();
    expect(PropertiesService.getScriptProperties().getProperty("ALLOWED_USERS")).toBe(DEV_USER);
  });

  it("never overwrites a list somebody has already edited", async () => {
    // The regression this stops: a second setup() run — which the README tells operators to do
    // after a schema addition — silently reverting an admin's additions.
    const server = await bootServer();
    PropertiesService.getScriptProperties()
      .setProperty("ALLOWED_USERS", "dev@example.com, colleague@example.com");
    server.setup();
    expect(PropertiesService.getScriptProperties().getProperty("ALLOWED_USERS"))
      .toContain("colleague@example.com");
  });

  it("leaves ALLOWED_ADMINS unset, because owner-only is the correct default", async () => {
    const server = await bootServer();
    server.setup();
    expect(PropertiesService.getScriptProperties().getProperty("ALLOWED_ADMINS")).toBeNull();
  });
});

describe("the dev operator is the owner, so the harness exercises the allowed path", () => {
  afterEach(() => teardownServer());

  it("admits the dev user by identity, before any list is consulted", async () => {
    const server = await bootServer();
    const d = server.access.check();
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("owner");
    expect(d.email).toBe(DEV_USER);
  });

  it("hands the guards their allowed-path answers", async () => {
    const server = await bootServer();
    expect(server.access.denyResult("bootstrap")).toBeNull();
    expect(() => server.access.assertAllowed("setup")).not.toThrow();
    expect(server.access.deniedPage()).toBeNull();
    expect(server.access.canEditAdmins()).toBe(true);
  });

  it("stands the entry screen aside in dev, rather than stranding anyone at it", async () => {
    // ScriptApp.getService() is not shimmed — deliberately, in both tools — so serviceUrl()
    // returns null through its try/catch and the gate declines to render a Continue button it
    // cannot point anywhere. Failing open is the contract; this is it being exercised.
    const server = await bootServer();
    expect(server.welcome.gate({ parameter: {} } as never)).toBeNull();
  });
});

describe("a roster edit survives the round trip", () => {
  afterEach(() => teardownServer());

  it("persists an addition and reads it back through getAccess", async () => {
    const server = await bootServer();
    server.setup();

    const before = server.api.getAccess({}).data as AccessData;
    expect(before.canEditUsers).toBe(true);
    expect(before.canEditAdmins).toBe(true);
    expect(before.owner).toBe(DEV_USER);
    expect(before.domain).toBe("example.com");

    const saved = server.api.saveAccess({ users: "colleague@example.com" });
    expect(saved.ok).toBe(true);

    const after = server.api.getAccess({}).data as AccessData;
    expect(after.users).toContain("colleague@example.com");
    // Written back in even though the save omitted them — the property stays
    // self-documenting for whoever opens Project Settings.
    expect(after.users).toContain(DEV_USER);
    expect(PropertiesService.getScriptProperties().getProperty("ALLOWED_USERS"))
      .toContain("colleague@example.com");
  });

  it("persists an admin and hands them the users list but not the admins list", async () => {
    const server = await bootServer();
    server.setup();
    expect(server.api.saveAdmins({ admins: "colleague@example.com" }).ok).toBe(true);

    const after = server.api.getAccess({}).data as AccessData;
    expect(after.admins).toEqual(["colleague@example.com"]);

    // An admin is admitted by BEING an admin, never by also appearing in ALLOWED_USERS —
    // which is what stops one admin demoting another by editing the users list.
    expect(after.users ?? []).not.toContain("colleague@example.com");
    const d = server.access.decide(
      "colleague@example.com",
      DEV_USER,
      PropertiesService.getScriptProperties().getProperty("ALLOWED_USERS"),
      PropertiesService.getScriptProperties().getProperty("ALLOWED_ADMINS"),
    );
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("admin");
  });

  it("refuses to store an entry that could never match a Google account", async () => {
    const server = await bootServer();
    server.setup();
    const res = server.api.saveAccess({ users: "colleague@example.com, notanemail" });
    expect(res.ok).toBe(false);
    expect(PropertiesService.getScriptProperties().getProperty("ALLOWED_USERS"))
      .not.toContain("notanemail");
  });
});
