// The repository → business-domain join: the query document, the entity parse, the identity
// match, and the fail-soft posture that keeps an unreachable map from taking down every page.
//
// `wizClient` and `sheetsDb` are mocked, so what is under test is the JOIN — which tokens a
// repository is indexed under, which tokens a finding is probed with, and what happens when
// neither overlaps — rather than the transport, which has its own suite.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rec } from "../src/domain/util";

const H = vi.hoisted(() => ({
  /** Pages `queryPage` will hand back, in order. */
  pages: [] as { nodes: Rec[]; hasNextPage: boolean; endCursor: string | null }[],
  /** Every (query, variables) that reached the transport. */
  calls: [] as { query: string; variables: Rec }[],
  /** The `domain_map` tab. */
  mapRows: [] as Rec[],
  /** The `repos` tab — one row per repository, what mapHealth joins against. */
  repoRows: [] as Rec[],
  /** Set to make reading the repos tab throw, independently of the map's own tab. */
  reposThrow: false,
  /** Set to make every sheetsDb read throw, as an unreachable spreadsheet does. */
  sheetsThrow: false,
  prop: null as string | null,
  bumped: 0,
}));

vi.mock("../src/server/wizClient", () => ({
  queryPage: (query: string, variables: Rec) => {
    H.calls.push({ query, variables });
    const page = H.pages.shift();
    if (!page) return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null }, totalCount: null, partialErrors: [] };
    return {
      nodes: page.nodes,
      pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
      totalCount: null,
      partialErrors: [],
    };
  },
}));

vi.mock("../src/server/sheetsDb", async (orig) => {
  const real = await orig<typeof import("../src/server/sheetsDb")>();
  return {
    TABS: real.TABS,
    TAB_HEADERS: real.TAB_HEADERS,
    ensureTab: () => {
      if (H.sheetsThrow) throw new Error("spreadsheet unavailable");
      return null;
    },
    readAll: (tab: string) => {
      if (tab === real.TABS.repos) {
        if (H.reposThrow) throw new Error("spreadsheet unavailable");
        return H.repoRows;
      }
      if (H.sheetsThrow) throw new Error("spreadsheet unavailable");
      return H.mapRows;
    },
    overwrite: (_tab: string, rows: Rec[]) => { H.mapRows = rows; },
  };
});

vi.mock("../src/server/props", () => ({
  PROP_KEYS: { wizDomainTagKey: "WIZ_DOMAIN_TAG_KEY" },
  getProp: () => H.prop,
}));

vi.mock("../src/server/serverCache", () => ({ bumpDataVersion: () => { H.bumped += 1; } }));

const {
  attachDomains, configuredDomainTagKey, fetchRepoDomains, foldToken, getDomainMap, mapHealth,
  parseRepoEntity, refreshRepoDomains, resetDomainMapMemo, resolveDomain, setDomainMap,
} = await import("../src/server/repoDomains");
const { isSafeTagKey, reposByTagQuery } = await import("../src/server/wizReposQuery");

beforeEach(() => {
  H.pages = [];
  H.calls = [];
  H.mapRows = [];
  H.repoRows = [];
  H.sheetsThrow = false;
  H.reposThrow = false;
  H.prop = null;
  H.bumped = 0;
  resetDomainMapMemo();
  vi.restoreAllMocks();
});

// =========================================================================================
//  The query document
// =========================================================================================

describe("reposByTagQuery", () => {
  it("inlines the tag key into the where literal, not as a $variable", () => {
    // gas_ai found a $variable inside a graphSearch `where` literal fragile against this
    // gateway; gas/ has shipped the inlined form since. Paging still rides $first/$after.
    const q = reposByTagQuery("Wiz/Domain");
    expect(q).toContain('where: { tags: { CONTAINS: [{ key: "Wiz/Domain" }] } }');
    expect(q).toContain("$first: Int");
    expect(q).toContain("$after: String");
  });

  it("asks for both repository entity types", () => {
    // SCA names a repository BRANCH and SAST/secrets a repository; the tenant may carry the
    // tag on either, and nothing here can verify which without the live tenant.
    expect(reposByTagQuery("Wiz/Domain")).toContain("type: [REPOSITORY, REPOSITORY_BRANCH]");
  });

  it("REFUSES an unsafe key rather than escaping it or falling back", () => {
    // A tag key is operator input that reaches a query document. Silently substituting a
    // different key would attribute the whole register to the wrong vocabulary.
    for (const bad of ['a" }] } } # ', "key with spaces", "back\\slash", "", "a".repeat(121)]) {
      expect(isSafeTagKey(bad), bad).toBe(false);
      expect(() => reposByTagQuery(bad)).toThrow(/Unsafe WIZ_DOMAIN_TAG_KEY/);
    }
  });

  it("accepts the shapes a real tag key takes", () => {
    for (const ok of ["Wiz/Domain", "org.team", "a:b", "a-b_c", "Domain"]) {
      expect(isSafeTagKey(ok), ok).toBe(true);
    }
  });
});

// =========================================================================================
//  The entity parse
// =========================================================================================

describe("parseRepoEntity", () => {
  const entity = (props: Rec, over: Rec = {}): Rec =>
    ({ id: "ent-1", name: "dktunited/prodcom", properties: props, ...over });

  it("indexes a tagged repository under every identity token it carries", () => {
    // ALL OF THEM, because whether a graphSearch entity's `id` is the same identifier a
    // finding's `repo_id` holds is not verifiable from here. Any one overlap is enough.
    const { domain, tokens } = parseRepoEntity(
      entity({ tags: [{ key: "Wiz/Domain", value: "SAP" }], id: "r-1", externalId: "EXT-1", name: "svc-api" }),
      "Wiz/Domain",
    );
    expect(domain).toBe("SAP");
    expect(tokens).toContain("r-1");
    expect(tokens).toContain("ext-1");
    expect(tokens).toContain("svc-api");
    expect(tokens).toContain("ent-1");
    expect(tokens).toContain("dktunited/prodcom");
  });

  it("yields NO TOKENS for an untagged repository, so it cannot pollute the map", () => {
    const { domain, tokens } = parseRepoEntity(entity({ id: "r-1", tags: [] }), "Wiz/Domain");
    expect(domain).toBeNull();
    expect(tokens).toEqual([]);
  });

  it("accepts properties as a JSON string, which some tenants return", () => {
    const { domain } = parseRepoEntity(
      entity({} as Rec, { properties: JSON.stringify({ "tag:Wiz/Domain": "CROSS" }) }),
      "Wiz/Domain",
    );
    expect(domain).toBe("CROSS");
  });

  it("never throws on a properties blob it cannot read — the layout is tenant-dependent", () => {
    for (const p of [null, undefined, "not json", 42, []]) {
      expect(() => parseRepoEntity(entity({} as Rec, { properties: p }), "Wiz/Domain")).not.toThrow();
      expect(parseRepoEntity(entity({} as Rec, { properties: p }), "Wiz/Domain").domain).toBeNull();
    }
  });
});

// =========================================================================================
//  The fetch
// =========================================================================================

describe("fetchRepoDomains", () => {
  const tagged = (id: string, domain: string): Rec =>
    ({ id, name: id, properties: { id, tags: [{ key: "Wiz/Domain", value: domain }] } });

  it("walks every page via endCursor and folds them into one map", () => {
    H.pages = [
      { nodes: [{ entities: [tagged("r-1", "SAP")] }], hasNextPage: true, endCursor: "c1" },
      { nodes: [{ entities: [tagged("r-2", "CROSS")] }], hasNextPage: false, endCursor: null },
    ];
    const { map, stats } = fetchRepoDomains();
    expect(map["r-1"]).toBe("SAP");
    expect(map["r-2"]).toBe("CROSS");
    expect(stats).toMatchObject({ repos: 2, domains: 2, tagKey: "Wiz/Domain" });
    expect(H.calls[1]!.variables.after).toBe("c1");
  });

  it("stops when a page reports no next cursor, even with hasNextPage set", () => {
    H.pages = [{ nodes: [{ entities: [tagged("r-1", "SAP")] }], hasNextPage: true, endCursor: null }];
    fetchRepoDomains();
    expect(H.calls).toHaveLength(1);
  });

  it("skips untagged entities without counting them", () => {
    H.pages = [{
      nodes: [{ entities: [tagged("r-1", "SAP"), { id: "r-2", properties: { id: "r-2" } }] }],
      hasNextPage: false, endCursor: null,
    }];
    const { map, stats } = fetchRepoDomains();
    expect(stats.repos).toBe(1);
    expect(map["r-2"]).toBeUndefined();
  });

  it("uses the configured tag key over the default", () => {
    H.prop = "Org/Team";
    expect(configuredDomainTagKey()).toBe("Org/Team");
    H.pages = [{ nodes: [], hasNextPage: false, endCursor: null }];
    expect(fetchRepoDomains().stats.tagKey).toBe("Org/Team");
    expect(H.calls[0]!.query).toContain('key: "Org/Team"');
  });
});

// =========================================================================================
//  The join
// =========================================================================================

describe("resolveDomain", () => {
  const map = { "r-1": "SAP", "svc-api": "CROSS" };

  it("matches a ledger row on repo_id", () => {
    expect(resolveDomain({ repo_id: "r-1" }, map, "Wiz/Domain")).toBe("SAP");
  });

  it("matches on repo_name when the id does not overlap", () => {
    // The whole point of indexing under several tokens: the id spaces may not line up, and a
    // join that depended on one of them would silently match nothing.
    expect(resolveDomain({ repo_id: "unknown", repo_name: "svc-api" }, map, "Wiz/Domain")).toBe("CROSS");
  });

  it("folds case and whitespace on both sides", () => {
    expect(foldToken("  R-1  ")).toBe("r-1");
    expect(resolveDomain({ repo_id: "  R-1  " }, map, "Wiz/Domain")).toBe("SAP");
  });

  it("matches a frame record's nested and dotted asset identity", () => {
    expect(resolveDomain({ resource: { id: "r-1" } }, map, "Wiz/Domain")).toBe("SAP");
    expect(resolveDomain({ "vulnerableAsset.id": "r-1" }, map, "Wiz/Domain")).toBe("SAP");
  });

  it("PREFERS A TAG THE ROW ALREADY CARRIES over the join", () => {
    // Nothing produces such a row today — that is why the map exists — but a register that
    // later learns to fetch the tag per finding must not keep answering from a stale join.
    const row = { repo_id: "r-1", tags_json: '{"Wiz/Domain": "DIRECT"}' };
    expect(resolveDomain(row, map, "Wiz/Domain")).toBe("DIRECT");
  });

  it("is null when no token overlaps — degrades to 'no domain', never to a wrong one", () => {
    expect(resolveDomain({ repo_id: "nope", repo_name: "also-nope" }, map, "Wiz/Domain")).toBeNull();
    expect(resolveDomain({}, map, "Wiz/Domain")).toBeNull();
  });
});

describe("attachDomains", () => {
  it("attaches _domain in place to the rows it can place", () => {
    H.mapRows = [{ token: "r-1", domain: "SAP" }];
    const rows: Rec[] = [{ repo_id: "r-1" }, { repo_id: "r-2" }];
    attachDomains(rows);
    expect(rows[0]!._domain).toBe("SAP");
    // Left UNSET rather than given a placeholder: an untagged repository contributes nothing
    // to a facet, and a synthetic bucket would offer the rows we know least about as an owner.
    expect("_domain" in rows[1]!).toBe(false);
  });

  it("is a NO-OP on an empty map, so every domain figure is inert rather than wrong", () => {
    H.mapRows = [];
    const rows: Rec[] = [{ repo_id: "r-1" }];
    attachDomains(rows);
    expect("_domain" in rows[0]!).toBe(false);
  });
});

// =========================================================================================
//  Persistence, and the fail-soft posture
// =========================================================================================

describe("the persisted map", () => {
  it("round-trips through the tab, sorted by token", () => {
    setDomainMap({ "z-1": "SAP", "a-1": "CROSS" });
    expect(H.mapRows).toEqual([
      { token: "a-1", domain: "CROSS" },
      { token: "z-1", domain: "SAP" },
    ]);
    resetDomainMapMemo();
    expect(getDomainMap()).toEqual({ "a-1": "CROSS", "z-1": "SAP" });
  });

  it("BUMPS THE DATA VERSION, or every cached domain figure answers from the old attribution", () => {
    setDomainMap({ "r-1": "SAP" });
    expect(H.bumped).toBe(1);
  });

  it("refreshRepoDomains fetches, persists and reports in one step", () => {
    H.pages = [{
      nodes: [{ entities: [{ id: "r-1", properties: { id: "r-1", tags: [{ key: "Wiz/Domain", value: "SAP" }] } }] }],
      hasNextPage: false, endCursor: null,
    }];
    expect(refreshRepoDomains()).toMatchObject({ repos: 1, domains: 1 });
    resetDomainMapMemo();
    expect(getDomainMap()["r-1"]).toBe("SAP");
  });

  it("drops rows with a blank token or domain rather than indexing an empty key", () => {
    H.mapRows = [{ token: "", domain: "SAP" }, { token: "r-1", domain: "" }, { token: "r-2", domain: "X" }];
    expect(getDomainMap()).toEqual({ "r-2": "X" });
  });

  it("FAILS SOFT when the spreadsheet is unreachable — an additive axis must not take pages down", () => {
    // Every read model takes its rows from readModels.baseSnapshot, which attaches domains. A
    // throw here would take down six pages over a lookup table that only decorates them. An
    // unreadable map is the SAME STATE as an unrefreshed one: no domains known.
    H.sheetsThrow = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getDomainMap()).toEqual({});
    // Logged, not swallowed: the readout alone cannot tell "never refreshed" from "unreachable".
    expect(warn).toHaveBeenCalledOnce();
    const rows: Rec[] = [{ repo_id: "r-1" }];
    expect(() => attachDomains(rows)).not.toThrow();
    expect("_domain" in rows[0]!).toBe(false);
  });

  it("memoizes a failed read too, so a broken tab costs one read per execution, not one per model", () => {
    H.sheetsThrow = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getDomainMap();
    getDomainMap();
    getDomainMap();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("mapHealth — the three states, and why it measures the join", () => {
  it("reports zero keys before the first refresh — 'never refreshed', not 'nothing tagged'", () => {
    expect(mapHealth()).toMatchObject({ keys: 0, domains: 0, placed: 0 });
    expect(H.calls).toHaveLength(0); // reads the stored map; never touches Wiz
  });

  it("MEASURES what the map places, not just what it holds", () => {
    H.mapRows = [
      { token: "r-1", domain: "SAP" },
      { token: "ext-1", domain: "SAP" },
      { token: "r-2", domain: "CROSS" },
    ];
    H.repoRows = [
      { repo_id: "r-1", repo_name: "svc-api" },
      { repo_id: "r-2", repo_name: "svc-web" },
      { repo_id: "r-3", repo_name: "svc-jobs" },
    ];
    const h = mapHealth();
    // Three keys, two domains: the map indexes a repository under several tokens, so keys
    // outrunning domains is the healthy shape rather than a sign of anything.
    expect(h).toMatchObject({ keys: 3, domains: 2, tagKey: "Wiz/Domain", repos: 3, placed: 2 });
    expect(h.sampleUnplaced).toEqual(["svc-jobs"]);
    expect(H.calls).toHaveLength(0);
  });

  it("THE STATE A KEY COUNT HIDES: a full map that places nothing", () => {
    // The failure this register can actually have — the identity a repository ENTITY carries
    // in Wiz's graph need not be the one a FINDING carries. Reported as keys alone this reads
    // as perfect health while every domain figure in the app is empty.
    H.mapRows = [
      { token: "wiz-vertex-aaa", domain: "SAP" },
      { token: "wiz-vertex-bbb", domain: "CROSS" },
    ];
    H.repoRows = [
      { repo_id: "r-1", repo_name: "dktunited/svc-api" },
      { repo_id: "r-2", repo_name: "dktunited/svc-web" },
    ];
    const h = mapHealth();
    expect(h.domains).toBe(2);
    expect(h.keys).toBe(2);
    // The figure that tells the truth about it.
    expect(h.placed).toBe(0);
    // And BOTH SIDES of the mismatch, so the card can print them side by side.
    expect(h.sampleTokens).toEqual(["wiz-vertex-aaa", "wiz-vertex-bbb"]);
    expect(h.sampleUnplaced).toEqual(["dktunited/svc-api", "dktunited/svc-web"]);
  });

  it("caps both samples rather than carrying a whole tenant back to a settings card", () => {
    H.mapRows = Array.from({ length: 40 }, (_, i) => ({ token: `t-${i}`, domain: "SAP" }));
    H.repoRows = Array.from({ length: 40 }, (_, i) => ({ repo_id: `r-${i}`, repo_name: `n-${i}` }));
    const h = mapHealth();
    expect(h.keys).toBe(40);
    expect(h.repos).toBe(40);
    expect(h.sampleTokens).toHaveLength(5);
    expect(h.sampleUnplaced).toHaveLength(5);
  });

  it("reports what it knows when the repos tab is unreadable, rather than throwing", () => {
    // Same posture as getDomainMap: a diagnostic must not take the Settings page down.
    H.mapRows = [{ token: "r-1", domain: "SAP" }];
    H.reposThrow = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mapHealth();
    expect(h).toMatchObject({ keys: 1, domains: 1, repos: 0, placed: 0 });
    expect(warn).toHaveBeenCalledOnce();
  });
});
