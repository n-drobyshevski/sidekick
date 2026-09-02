// Port of gas/test/lifecycle.test.ts, reshaped for findingKey(scope, node)'s rule 1: scope is
// part of the key, and secrets identity is (secretDataId, path, lineNumber) — never node.id or
// externalId. See src/domain/lifecycle.ts's header comment and
// gas_devsecops/src/server/sheetsDb.ts's TAB_HEADERS[TABS.ledger] comment (PROBE_FINDINGS.md
// §10.6/§10.7) for the full argument.

import { describe, expect, it } from "vitest";
import { findingKey, mttrFromLedger } from "../src/domain/lifecycle";
import { sha1Hex } from "../src/domain/sha1";
import { expectParity, fixture } from "./helpers";

describe("sha1Hex", () => {
  it("matches known digests", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex("ünïcode")).toBe(sha1Hex("ünïcode")); // stable
  });
});

// gas/'s vulnKey prefers node.id and falls back to a content hash only when id is absent.
// findingKey does not port that fallback — sca/sast nodes always carry a Wiz `id` (Q_SCA /
// Q_SAST both select it) — so only vuln_key.json's id-bearing cases apply here; the shim maps
// each surviving case's old "id:..." expectation onto the new scope-prefixed key.
describe("findingKey (vuln_key.json rename shim, sca)", () => {
  const { cases } = fixture("vuln_key");
  const withId = cases.filter(
    (c: any) => typeof c.input.id === "string" && c.input.id.trim().length > 0,
  );

  it("the fixture still carries at least one id-bearing case to shim", () => {
    expect(withId.length).toBeGreaterThan(0);
  });

  withId.forEach((c: any, i: number) => {
    it(`case ${i}: ${c.expected} -> sca:${c.expected}`, () => {
      expect(findingKey("sca", c.input)).toBe(`sca:${c.expected}`);
    });
  });
});

describe("findingKey — scope is part of the prefix (rule 1)", () => {
  it("sca and sast nodes with the same id produce different keys", () => {
    const node = { id: "shared-id-123" };
    expect(findingKey("sca", node)).toBe("sca:id:shared-id-123");
    expect(findingKey("sast", node)).toBe("sast:id:shared-id-123");
    expect(findingKey("sca", node)).not.toBe(findingKey("sast", node));
  });
});

// D9b task 3: a missing/blank id used to key as the EMPTY identity "sca:id:" (or "sast:id:"),
// so two id-less nodes in the same scan would silently collide into one ledger row —
// gas/test/fixtures/reconcile.json's `first_scan` carries exactly one such record (D2's
// finding; see test/reconcile.test.ts). findingKey now refuses instead of manufacturing that
// shared empty key.
describe("findingKey — refuses a node with no id (sca/sast)", () => {
  it("throws, naming the scope, when id is absent", () => {
    expect(() => findingKey("sca", {})).toThrow(/sca/);
    expect(() => findingKey("sast", {})).toThrow(/sast/);
  });

  it("throws on a blank or whitespace-only id, not just a missing one", () => {
    expect(() => findingKey("sca", { id: "" })).toThrow();
    expect(() => findingKey("sca", { id: "   " })).toThrow();
    expect(() => findingKey("sca", { id: null })).toThrow();
  });

  it("a present, non-blank id still keys normally (no regression)", () => {
    expect(findingKey("sca", { id: "sca-1" })).toBe("sca:id:sca-1");
    expect(findingKey("sast", { id: "sast-1" })).toBe("sast:id:sast-1");
  });
});

describe("findingKey — refuses a secrets node with no secretDataId", () => {
  const shared = { path: "src/config/secrets.yml", lineNumber: 42 };

  it("throws, naming the scope, when secretDataId is absent or blank", () => {
    expect(() => findingKey("secrets", { ...shared })).toThrow(/secrets/);
    expect(() => findingKey("secrets", { ...shared, secretDataId: "" })).toThrow(/secrets/);
    expect(() => findingKey("secrets", { ...shared, secretDataId: "   " })).toThrow(/secrets/);
  });

  it("the thrown message never echoes the node's own fields (a secret may be live in them)", () => {
    const node = { ...shared, secretDataId: "" };
    let caught: Error | null = null;
    try {
      findingKey("secrets", node);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain(shared.path);
    expect(caught!.message).not.toContain(String(shared.lineNumber));
  });

  it("a present secretDataId still keys normally (no regression)", () => {
    expect(findingKey("secrets", { ...shared, secretDataId: "secret-data-abc" })).toMatch(
      /^secrets:h:[0-9a-f]{16}$/,
    );
  });
});

describe("findingKey — secrets identity is (secretDataId, path, lineNumber)", () => {
  const shared = {
    secretDataId: "secret-data-abc",
    path: "src/config/secrets.yml",
    lineNumber: 42,
  };

  it("REPOSITORY and REPOSITORY_BRANCH twins of the same secret share a key even though id, externalId and resource.type all differ (PROBE_FINDINGS.md §10.6/§10.7)", () => {
    const repository = {
      ...shared,
      id: "wiz-id-repository",
      externalId: "github.com##org/repo##src/config/secrets.yml##hash##42",
      resource: { type: "REPOSITORY" },
    };
    const repositoryBranch = {
      ...shared,
      id: "wiz-id-repository-branch",
      externalId: "github.com##org/repo##main##src/config/secrets.yml##hash##42",
      resource: { type: "REPOSITORY_BRANCH" },
    };
    expect(findingKey("secrets", repository)).toBe(findingKey("secrets", repositoryBranch));
  });

  it("a different lineNumber produces a different key (a line move reads as a new finding)", () => {
    const moved = { ...shared, id: "wiz-id", lineNumber: 43 };
    const original = { ...shared, id: "wiz-id" };
    expect(findingKey("secrets", moved)).not.toBe(findingKey("secrets", original));
  });

  it("never keys on node.id or externalId", () => {
    const a = { ...shared, id: "id-A", externalId: "ext-A" };
    const b = { ...shared, id: "id-B", externalId: "ext-B" };
    expect(findingKey("secrets", a)).toBe(findingKey("secrets", b));
  });
});

describe("mttrFromLedger (fixture parity)", () => {
  const fx = fixture("mttr_from_ledger");
  it("matches the ledger-derived summary", () => {
    const { perSev, overall } = mttrFromLedger(fx.rows, { now: Date.parse(fx.now) });
    expectParity(perSev, fx.expected.per_sev);
    expectParity(overall, fx.expected.overall);
  });
  it("returns empty for no rows", () => {
    expect(mttrFromLedger([])).toEqual({ perSev: {}, overall: {} });
  });
});
