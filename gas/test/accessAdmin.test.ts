// The Settings → Access panel's authorization, which is a privilege surface: whoever passes
// these checks can grant other people access to the register.
//
// ONE SPEC HERE MATTERS MORE THAN THE REST — "an admin cannot edit the admins list". If that
// ever passes, the tier is cosmetic: an admin could promote anyone, including making their own
// standing permanent, and delegating day-to-day additions would be indistinguishable from
// handing over ownership. Everything else in this file is ordinary validation; that one is the
// boundary the whole two-tier design rests on.
//
// The other thing pinned here is that the client is never the authority. getAccess() reports
// canEditUsers so the panel knows whether to draw itself, but every save re-checks server-side,
// because google.script.run reaches these endpoints directly from a page console.

import { beforeEach, describe, expect, it, vi } from "vitest";

let activeEmail = "";
const OWNER = "owner@example.com";
const props: Record<string, string> = {};

vi.stubGlobal("Session", {
  getActiveUser: () => ({ getEmail: () => activeEmail }),
  getEffectiveUser: () => ({ getEmail: () => OWNER }),
});
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => props[k] ?? null,
    setProperty: (k: string, v: string) => { props[k] = v; },
    deleteProperty: (k: string) => { delete props[k]; },
  }),
});
vi.spyOn(console, "log").mockImplementation(() => {});

// The ledger side of api.ts is irrelevant here and drags in Sheets/Drive on import.
vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: { name: "scans", headers: [] }, settings: { name: "settings", headers: [] } },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  readAll: () => [], readTail: () => [], overwrite: () => {}, appendRows: () => {},
  cellUsage: () => ({}), ensureTabs: () => {},
}));

async function load() {
  return import("../src/server/api");
}

beforeEach(() => {
  for (const k of Object.keys(props)) delete props[k];
  props.ALLOWED_USERS = "listed@example.com";
  props.ALLOWED_ADMINS = "admin@example.com";
  activeEmail = OWNER;
  vi.resetModules();
});

describe("the tier stops where it has to", () => {
  it("REFUSES an admin editing the admins list", () => {
    // The spec this file exists for. An admin who can promote admins is not a second tier.
    activeEmail = "admin@example.com";
    return load().then(({ saveAdmins }) => {
      const res = saveAdmins({ admins: "admin@example.com, sneaky@example.com" });
      expect(res.ok).toBe(false);
      expect(props.ALLOWED_ADMINS).toBe("admin@example.com"); // unchanged on disk
    });
  });

  it("lets the owner edit the admins list", async () => {
    const { saveAdmins } = await load();
    const res = saveAdmins({ admins: "admin@example.com, second@example.com" });
    expect(res.ok).toBe(true);
    expect(props.ALLOWED_ADMINS).toContain("second@example.com");
  });

  it("lets an admin edit the people list — that is the delegation", async () => {
    activeEmail = "admin@example.com";
    const { saveAccess } = await load();
    const res = saveAccess({ users: "listed@example.com, newperson@example.com" });
    expect(res.ok).toBe(true);
    expect(props.ALLOWED_USERS).toContain("newperson@example.com");
  });

  it("refuses a merely-listed user editing either list", async () => {
    activeEmail = "listed@example.com";
    const { saveAccess, saveAdmins } = await load();
    expect(saveAccess({ users: "listed@example.com, friend@example.com" }).ok).toBe(false);
    expect(saveAdmins({ admins: "listed@example.com" }).ok).toBe(false);
    expect(props.ALLOWED_USERS).toBe("listed@example.com");
  });

  it("refuses a caller the allowlist does not admit at all", async () => {
    activeEmail = "stranger@example.com";
    const { saveAccess } = await load();
    expect(saveAccess({ users: "stranger@example.com" }).ok).toBe(false);
  });
});

describe("getAccess tells the panel whether to exist, and nothing more", () => {
  it("hands a non-editor no roster whatsoever", async () => {
    // "No panel at all" has to mean nothing on the wire, not just nothing in the DOM — the
    // endpoint is reachable from any allowed caller's browser console.
    activeEmail = "listed@example.com";
    const { getAccess } = await load();
    const data = getAccess().data as Record<string, unknown>;
    expect(data["canEditUsers"]).toBe(false);
    expect(data["users"]).toBeUndefined();
    expect(data["admins"]).toBeUndefined();
    expect(data["owner"]).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("@example.com");
  });

  it("gives an admin the roster but not the power to promote", async () => {
    activeEmail = "admin@example.com";
    const { getAccess } = await load();
    const data = getAccess().data as Record<string, unknown>;
    expect(data["canEditUsers"]).toBe(true);
    expect(data["canEditAdmins"]).toBe(false);
    expect(data["users"]).toBeTruthy();
  });

  it("gives the owner both", async () => {
    const { getAccess } = await load();
    const data = getAccess().data as Record<string, unknown>;
    expect(data["canEditUsers"]).toBe(true);
    expect(data["canEditAdmins"]).toBe(true);
    expect(data["domain"]).toBe("example.com");
  });
});

describe("a save cannot strand the owner or store junk", () => {
  it("keeps the owner in the list even when the save omits them", async () => {
    // Belt to the identity rule's braces: the owner is admitted by identity regardless, but a
    // property that does not name them reads, to whoever opens Project Settings, as though
    // they had been removed.
    const { saveAccess } = await load();
    saveAccess({ users: "someone@example.com" });
    expect(props.ALLOWED_USERS).toContain(OWNER);
  });

  it("rejects an entry that is not an address", async () => {
    const { saveAccess } = await load();
    const res = saveAccess({ users: "fine@example.com, notanemail" });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("notanemail");
    expect(props.ALLOWED_USERS).toBe("listed@example.com"); // nothing written
  });

  it("rejects a list too large for the property before writing it", async () => {
    // Script Properties cap at ~9KB per value; without this the caller gets GAS's raw storage
    // quota exception with their edit already gone.
    const { saveAccess } = await load();
    const many = Array.from({ length: 400 }, (_, i) => `person${i}@averylongdomainname.example.com`);
    const res = saveAccess({ users: many.join(", ") });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/too long|Too many/);
  });

  it("accepts a list pasted in any of the shapes people paste", async () => {
    const { saveAccess } = await load();
    expect(saveAccess({ users: "A@x.com\nb@x.com; c@x.com, d@x.com" }).ok).toBe(true);
    expect(props.ALLOWED_USERS).toContain("a@x.com");
    expect(props.ALLOWED_USERS).toContain("d@x.com");
  });
});
