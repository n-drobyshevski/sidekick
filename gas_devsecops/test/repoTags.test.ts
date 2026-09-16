// The repository → tags join: the query document, the entity parse, the identity match, the
// two-pass fetch, and the fail-soft posture that keeps an unreachable map from taking down
// every page.
//
// TWO TAGS ON ONE ROAD. A business domain (`Wiz/Domain`) and a lifecycle (`lifecycle`) are both
// carried by a REPOSITORY and by no finding, so both are graphSearched and joined by identity
// through this one module. What that buys — and what these cases are mostly about — is that a
// repository carrying only one of the two is still reached: the fetch pages once per key and
// reads BOTH tags off every entity either pass returns.
//
// `wizClient` and `sheetsDb` are mocked, so what is under test is the JOIN — which tokens a
// repository is indexed under, which tokens a finding is probed with, and what happens when
// neither overlaps — rather than the transport, which has its own suite.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rec } from "../src/domain/util";

const H = vi.hoisted(() => ({
  /** Pages `queryPage` will hand back, in order, ACROSS BOTH PASSES. */
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
  lifecycleProp: null as string | null,
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
  PROP_KEYS: { wizDomainTagKey: "WIZ_DOMAIN_TAG_KEY", wizLifecycleTagKey: "WIZ_LIFECYCLE_TAG_KEY" },
  getProp: (key: string) => (key === "WIZ_LIFECYCLE_TAG_KEY" ? H.lifecycleProp : H.prop),
}));

vi.mock("../src/server/serverCache", () => ({ bumpDataVersion: () => { H.bumped += 1; } }));

const {
  attachRepoTags, configuredDomainTagKey, configuredLifecycleTagKey, fetchRepoTags, foldToken,
  getRepoTagMap, mapHealth, parseRepoEntity, refreshRepoTags, resetRepoTagMapMemo, resolveDomain,
  resolveLifecycle, resolveRepoTags, setRepoTagMap,
} = await import("../src/server/repoTags");
const { isSafeTagKey, reposByTagQuery } = await import("../src/server/wizReposQuery");

/** The default pair, spelled once — every `resolve*` case below probes with it. */
const KEYS = { domain: "Wiz/Domain", lifecycle: "lifecycle" };

beforeEach(() => {
  H.pages = [];
  H.calls = [];
  H.mapRows = [];
  H.repoRows = [];
  H.sheetsThrow = false;
  H.reposThrow = false;
  H.prop = null;
  H.lifecycleProp = null;
  H.bumped = 0;
  resetRepoTagMapMemo();
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

  it("is ONE KEY PER DOCUMENT — the caller pages it twice rather than widening the where", () => {
    // Whether `CONTAINS: [{key: a}, {key: b}]` reads as AND or as OR is not establishable from
    // here, and the two readings differ by an entire estate. The document keeps the shape that
    // has been in production since it shipped.
    const q = reposByTagQuery("lifecycle");
    expect(q).toContain('CONTAINS: [{ key: "lifecycle" }]');
    expect(q).not.toContain("Wiz/Domain");
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
      expect(() => reposByTagQuery(bad)).toThrow(/Unsafe repository tag key/);
    }
  });

  it("accepts the shapes a real tag key takes", () => {
    for (const ok of ["Wiz/Domain", "org.team", "a:b", "a-b_c", "Domain", "lifecycle"]) {
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
      KEYS,
    );
    expect(domain).toBe("SAP");
    expect(tokens).toContain("r-1");
    expect(tokens).toContain("ext-1");
    expect(tokens).toContain("svc-api");
    expect(tokens).toContain("ent-1");
    expect(tokens).toContain("dktunited/prodcom");
  });

  it("reads BOTH tags off one entity, whichever pass returned it", () => {
    const parsed = parseRepoEntity(
      entity({
        id: "r-1",
        tags: [{ key: "Wiz/Domain", value: "SAP" }, { key: "lifecycle", value: "END_OF_LIFE" }],
      }),
      KEYS,
    );
    expect(parsed.domain).toBe("SAP");
    expect(parsed.lifecycle).toBe("END_OF_LIFE");
  });

  // Perturbation, run and reverted: gating the token list on `if (domain)` rather than on
  // `if (domain || lifecycle)` fails this case with `expected [] to contain 'r-1'` — and with
  // it the whole reason the lifecycle pass exists.
  it("INDEXES A REPOSITORY THAT CARRIES ONLY THE LIFECYCLE TAG", () => {
    // The population the second pass is FOR: a repository the tenant retired and never gave a
    // domain. Gating tokens on the domain would drop exactly these, so the cold zone's
    // exclusion would silently miss the repositories it exists to remove.
    const { domain, lifecycle, tokens } = parseRepoEntity(
      entity({ id: "r-9", tags: [{ key: "lifecycle", value: "END_OF_LIFE" }] }),
      KEYS,
    );
    expect(domain).toBeNull();
    expect(lifecycle).toBe("END_OF_LIFE");
    expect(tokens).toContain("r-9");
  });

  it("yields NO TOKENS for an entity carrying neither tag, so it cannot pollute the map", () => {
    const { domain, lifecycle, tokens } = parseRepoEntity(entity({ id: "r-1", tags: [] }), KEYS);
    expect(domain).toBeNull();
    expect(lifecycle).toBeNull();
    expect(tokens).toEqual([]);
  });

  it("accepts properties as a JSON string, which some tenants return", () => {
    const { domain } = parseRepoEntity(
      entity({} as Rec, { properties: JSON.stringify({ "tag:Wiz/Domain": "CROSS" }) }),
      KEYS,
    );
    expect(domain).toBe("CROSS");
  });

  it("never throws on a properties blob it cannot read — the layout is tenant-dependent", () => {
    for (const p of [null, undefined, "not json", 42, []]) {
      expect(() => parseRepoEntity(entity({} as Rec, { properties: p }), KEYS)).not.toThrow();
      const parsed = parseRepoEntity(entity({} as Rec, { properties: p }), KEYS);
      expect(parsed.domain).toBeNull();
      expect(parsed.lifecycle).toBeNull();
    }
  });
});

// =========================================================================================
//  The fetch — two passes, one map
// =========================================================================================

describe("fetchRepoTags", () => {
  const tagged = (id: string, tags: Rec[]): Rec => ({ id, name: id, properties: { id, tags } });
  const domainOf = (id: string, domain: string): Rec =>
    tagged(id, [{ key: "Wiz/Domain", value: domain }]);
  const lifeOf = (id: string, lifecycle: string): Rec =>
    tagged(id, [{ key: "lifecycle", value: lifecycle }]);
  /** One page, terminal. */
  const page = (entities: Rec[]) => ({ nodes: [{ entities }], hasNextPage: false, endCursor: null });

  it("walks every page via endCursor and folds them into one map", () => {
    H.pages = [
      { nodes: [{ entities: [domainOf("r-1", "SAP")] }], hasNextPage: true, endCursor: "c1" },
      { nodes: [{ entities: [domainOf("r-2", "CROSS")] }], hasNextPage: false, endCursor: null },
    ];
    const { map, stats } = fetchRepoTags();
    expect(map["r-1"]!.domain).toBe("SAP");
    expect(map["r-2"]!.domain).toBe("CROSS");
    expect(stats).toMatchObject({ repos: 2, domains: 2, tagKey: "Wiz/Domain" });
    expect(H.calls[1]!.variables.after).toBe("c1");
  });

  // Perturbation, run and reverted: dropping the lifecycle key from `passKeys` — one pass
  // again — fails this case with `expected undefined to be 'END_OF_LIFE'`, because `r-9` is
  // returned by no domain-tag query.
  it("RUNS A SECOND PASS ON THE LIFECYCLE KEY, and merges it into the same map", () => {
    H.pages = [
      page([domainOf("r-1", "SAP")]),     // the domain pass
      page([lifeOf("r-9", "END_OF_LIFE")]), // the lifecycle pass
    ];
    const { map, stats } = fetchRepoTags();
    expect(H.calls).toHaveLength(2);
    expect(H.calls[0]!.query).toContain('key: "Wiz/Domain"');
    expect(H.calls[1]!.query).toContain('key: "lifecycle"');
    expect(map["r-1"]!.domain).toBe("SAP");
    expect(map["r-9"]!.lifecycle).toBe("END_OF_LIFE");
    // Two repositories, counted once each across both passes.
    expect(stats).toMatchObject({ repos: 2, domains: 1, lifecycles: 1, lifecycleTagKey: "lifecycle" });
  });

  // Perturbation, run and reverted: writing `{ domain, lifecycle }` flat instead of falling
  // back to `prev` fails this case with `expected null to be 'SAP'` — the second pass erasing
  // what the first learned.
  it("LATEST NON-NULL WINS ACROSS PASSES — the second pass never erases the first", () => {
    // The same repository, returned by both passes, each entity carrying only its own tag.
    H.pages = [page([domainOf("r-1", "SAP")]), page([lifeOf("r-1", "IN_PRODUCTION")])];
    const { map, stats } = fetchRepoTags();
    expect(map["r-1"]).toEqual({ domain: "SAP", lifecycle: "IN_PRODUCTION" });
    // ONE repository, not two: `repos` counts repositories, not entities seen.
    expect(stats.repos).toBe(1);
  });

  it("runs ONE pass when both keys resolve to the same tag", () => {
    H.prop = "lifecycle";
    H.lifecycleProp = "lifecycle";
    H.pages = [page([lifeOf("r-1", "END_OF_LIFE")])];
    fetchRepoTags();
    expect(H.calls).toHaveLength(1);
  });

  it("stops a pass when a page reports no next cursor, even with hasNextPage set", () => {
    H.pages = [{ nodes: [{ entities: [domainOf("r-1", "SAP")] }], hasNextPage: true, endCursor: null }];
    fetchRepoTags();
    // One call for the domain pass (which stopped), one for the lifecycle pass.
    expect(H.calls).toHaveLength(2);
  });

  it("skips entities carrying neither tag without counting them", () => {
    H.pages = [page([domainOf("r-1", "SAP"), { id: "r-2", properties: { id: "r-2" } }])];
    const { map, stats } = fetchRepoTags();
    expect(stats.repos).toBe(1);
    expect(map["r-2"]).toBeUndefined();
  });

  it("uses the configured keys over the defaults, independently", () => {
    H.prop = "Org/Team";
    H.lifecycleProp = "Repo/Stage";
    expect(configuredDomainTagKey()).toBe("Org/Team");
    expect(configuredLifecycleTagKey()).toBe("Repo/Stage");
    H.pages = [page([]), page([])];
    const { stats } = fetchRepoTags();
    expect(stats).toMatchObject({ tagKey: "Org/Team", lifecycleTagKey: "Repo/Stage" });
    expect(H.calls[0]!.query).toContain('key: "Org/Team"');
    expect(H.calls[1]!.query).toContain('key: "Repo/Stage"');
  });

  it("the lifecycle key defaults to `lifecycle` when nothing is configured", () => {
    expect(configuredLifecycleTagKey()).toBe("lifecycle");
  });
});

// =========================================================================================
//  The join
// =========================================================================================

describe("resolveRepoTags", () => {
  const map = {
    "r-1": { domain: "SAP", lifecycle: "END_OF_LIFE" },
    "svc-api": { domain: "CROSS", lifecycle: null },
    "r-9": { domain: null, lifecycle: "IN_PRODUCTION" },
  };

  it("matches a ledger row on repo_id, and answers both tags at once", () => {
    expect(resolveRepoTags({ repo_id: "r-1" }, map, KEYS))
      .toEqual({ domain: "SAP", lifecycle: "END_OF_LIFE" });
    expect(resolveDomain({ repo_id: "r-1" }, map, "Wiz/Domain")).toBe("SAP");
    expect(resolveLifecycle({ repo_id: "r-1" }, map, "lifecycle")).toBe("END_OF_LIFE");
  });

  it("matches on repo_name when the id does not overlap", () => {
    // The whole point of indexing under several tokens: the id spaces may not line up, and a
    // join that depended on one of them would silently match nothing.
    expect(resolveDomain({ repo_id: "unknown", repo_name: "svc-api" }, map, "Wiz/Domain")).toBe("CROSS");
  });

  it("EACH TAG IS ANSWERED INDEPENDENTLY — one being absent never suppresses the other", () => {
    expect(resolveRepoTags({ repo_id: "svc-api" }, map, KEYS))
      .toEqual({ domain: "CROSS", lifecycle: null });
    expect(resolveRepoTags({ repo_id: "r-9" }, map, KEYS))
      .toEqual({ domain: null, lifecycle: "IN_PRODUCTION" });
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

  // Perturbation, run and reverted: returning early when the bag answered EITHER tag — rather
  // than per tag — fails this case with `expected null to be 'END_OF_LIFE'`.
  it("the own-bag preference is PER TAG, so knowing one does not lose the other", () => {
    const row = { repo_id: "r-1", tags_json: '{"Wiz/Domain": "DIRECT"}' };
    expect(resolveRepoTags(row, map, KEYS))
      .toEqual({ domain: "DIRECT", lifecycle: "END_OF_LIFE" });
  });

  it("is null when no token overlaps — degrades to 'no tags', never to wrong ones", () => {
    expect(resolveRepoTags({ repo_id: "nope", repo_name: "also-nope" }, map, KEYS))
      .toEqual({ domain: null, lifecycle: null });
    expect(resolveRepoTags({}, map, KEYS)).toEqual({ domain: null, lifecycle: null });
  });
});

describe("attachRepoTags", () => {
  it("attaches _domain and _lifecycle in place to the rows it can place", () => {
    H.mapRows = [{ token: "r-1", domain: "SAP", lifecycle: "END_OF_LIFE" }];
    const rows: Rec[] = [{ repo_id: "r-1" }, { repo_id: "r-2" }];
    attachRepoTags(rows);
    expect(rows[0]!._domain).toBe("SAP");
    expect(rows[0]!._lifecycle).toBe("END_OF_LIFE");
    // Left UNSET rather than given a placeholder: an untagged repository contributes nothing
    // to a facet, and a synthetic bucket would offer the rows we know least about as an owner.
    expect("_domain" in rows[1]!).toBe(false);
    expect("_lifecycle" in rows[1]!).toBe(false);
  });

  it("attaches one field where the map holds one tag — neither implies the other", () => {
    H.mapRows = [{ token: "r-9", domain: "", lifecycle: "IN_PRODUCTION" }];
    const rows: Rec[] = [{ repo_id: "r-9" }];
    attachRepoTags(rows);
    expect("_domain" in rows[0]!).toBe(false);
    expect(rows[0]!._lifecycle).toBe("IN_PRODUCTION");
  });

  it("is a NO-OP on an empty map, so every tag figure is inert rather than wrong", () => {
    H.mapRows = [];
    const rows: Rec[] = [{ repo_id: "r-1" }];
    attachRepoTags(rows);
    expect("_domain" in rows[0]!).toBe(false);
    expect("_lifecycle" in rows[0]!).toBe(false);
  });
});

// =========================================================================================
//  Persistence, and the fail-soft posture
// =========================================================================================

describe("the persisted map", () => {
  it("round-trips through the tab, sorted by token", () => {
    setRepoTagMap({
      "z-1": { domain: "SAP", lifecycle: null },
      "a-1": { domain: "CROSS", lifecycle: "END_OF_LIFE" },
    });
    expect(H.mapRows).toEqual([
      { token: "a-1", domain: "CROSS", lifecycle: "END_OF_LIFE" },
      { token: "z-1", domain: "SAP", lifecycle: null },
    ]);
    resetRepoTagMapMemo();
    expect(getRepoTagMap()).toEqual({
      "a-1": { domain: "CROSS", lifecycle: "END_OF_LIFE" },
      "z-1": { domain: "SAP", lifecycle: null },
    });
  });

  // Perturbation, run and reverted: skipping a row on `!domain` rather than on
  // `!domain && !lifecycle` fails this case with `expected {} to have property 'r-9'` — every
  // repository the tenant retired and never gave a domain would vanish from the map on read.
  it("reads a row that carries ONLY a lifecycle, and drops only rows carrying neither", () => {
    H.mapRows = [
      { token: "", domain: "SAP", lifecycle: "" },
      { token: "r-1", domain: "", lifecycle: "" },
      { token: "r-2", domain: "X", lifecycle: "" },
      { token: "r-9", domain: "", lifecycle: "END_OF_LIFE" },
    ];
    expect(getRepoTagMap()).toEqual({
      "r-2": { domain: "X", lifecycle: null },
      "r-9": { domain: null, lifecycle: "END_OF_LIFE" },
    });
  });

  it("a map written before the lifecycle column existed still places every domain it held", () => {
    // `readAll` maps by header NAME, so the column a deployed tab lacks reads as absent —
    // which is why adding it needed no migration.
    H.mapRows = [{ token: "r-1", domain: "SAP" }];
    expect(getRepoTagMap()).toEqual({ "r-1": { domain: "SAP", lifecycle: null } });
  });

  it("BUMPS THE DATA VERSION, or every cached figure answers from the old attribution", () => {
    setRepoTagMap({ "r-1": { domain: "SAP", lifecycle: null } });
    expect(H.bumped).toBe(1);
  });

  it("refreshRepoTags fetches, persists and reports in one step", () => {
    H.pages = [{
      nodes: [{ entities: [{ id: "r-1", properties: { id: "r-1", tags: [{ key: "Wiz/Domain", value: "SAP" }] } }] }],
      hasNextPage: false, endCursor: null,
    }];
    expect(refreshRepoTags()).toMatchObject({ repos: 1, domains: 1 });
    resetRepoTagMapMemo();
    expect(getRepoTagMap()["r-1"]!.domain).toBe("SAP");
  });

  it("FAILS SOFT when the spreadsheet is unreachable — an additive axis must not take pages down", () => {
    // Every read model takes its rows from readModels.baseSnapshot, which attaches these tags.
    // A throw here would take down six pages over a lookup table that only decorates them. An
    // unreadable map is the SAME STATE as an unrefreshed one: no tags known.
    H.sheetsThrow = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getRepoTagMap()).toEqual({});
    // Logged, not swallowed: the readout alone cannot tell "never refreshed" from "unreachable".
    expect(warn).toHaveBeenCalledOnce();
    const rows: Rec[] = [{ repo_id: "r-1" }];
    expect(() => attachRepoTags(rows)).not.toThrow();
    expect("_domain" in rows[0]!).toBe(false);
  });

  it("memoizes a failed read too, so a broken tab costs one read per execution, not one per model", () => {
    H.sheetsThrow = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getRepoTagMap();
    getRepoTagMap();
    getRepoTagMap();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("mapHealth — the three states, and why it measures the join", () => {
  it("reports zero keys before the first refresh — 'never refreshed', not 'nothing tagged'", () => {
    expect(mapHealth()).toMatchObject({ keys: 0, domains: 0, placed: 0, lifecyclePlaced: 0 });
    expect(H.calls).toHaveLength(0); // reads the stored map; never touches Wiz
  });

  it("MEASURES what the map places, not just what it holds", () => {
    H.mapRows = [
      { token: "r-1", domain: "SAP", lifecycle: "END_OF_LIFE" },
      { token: "ext-1", domain: "SAP", lifecycle: "" },
      { token: "r-2", domain: "CROSS", lifecycle: "" },
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

  // Perturbation, run and reverted: reporting one `placed` for both tags fails this case with
  // `expected 2 to be 0` — the wrong-lifecycle-key state, which the default is explicitly
  // allowed to be in, would read as perfect health.
  it("THE TWO TAGS ARE MEASURED SEPARATELY, because they fail separately", () => {
    // The state a wrong `WIZ_LIFECYCLE_TAG_KEY` puts a tenant in: every domain places, no
    // lifecycle does, and one collapsed figure would hide it.
    H.mapRows = [
      { token: "r-1", domain: "SAP", lifecycle: "" },
      { token: "r-2", domain: "CROSS", lifecycle: "" },
    ];
    H.repoRows = [{ repo_id: "r-1" }, { repo_id: "r-2" }];
    const h = mapHealth();
    expect(h.placed).toBe(2);
    expect(h.lifecyclePlaced).toBe(0);
    expect(h.lifecycles).toBe(0);
    expect(h.lifecycleTagKey).toBe("lifecycle");
  });

  it("counts a lifecycle placed on a repository the domain half never reached", () => {
    H.mapRows = [{ token: "r-9", domain: "", lifecycle: "END_OF_LIFE" }];
    H.repoRows = [{ repo_id: "r-9", repo_name: "retired-mobile" }];
    const h = mapHealth();
    expect(h).toMatchObject({ placed: 0, lifecyclePlaced: 1, domains: 0, lifecycles: 1 });
    // It is still unplaced for the DOMAIN, and the sample says so — the two readings are
    // independent all the way through.
    expect(h.sampleUnplaced).toEqual(["retired-mobile"]);
  });

  it("THE STATE A KEY COUNT HIDES: a full map that places nothing", () => {
    // The failure this register can actually have — the identity a repository ENTITY carries
    // in Wiz's graph need not be the one a FINDING carries. Reported as keys alone this reads
    // as perfect health while every domain figure in the app is empty.
    H.mapRows = [
      { token: "wiz-vertex-aaa", domain: "SAP", lifecycle: "" },
      { token: "wiz-vertex-bbb", domain: "CROSS", lifecycle: "" },
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
    H.mapRows = Array.from({ length: 40 }, (_, i) => ({ token: `t-${i}`, domain: "SAP", lifecycle: "" }));
    H.repoRows = Array.from({ length: 40 }, (_, i) => ({ repo_id: `r-${i}`, repo_name: `n-${i}` }));
    const h = mapHealth();
    expect(h.keys).toBe(40);
    expect(h.repos).toBe(40);
    expect(h.sampleTokens).toHaveLength(5);
    expect(h.sampleUnplaced).toHaveLength(5);
  });

  it("reports what it knows when the repos tab is unreadable, rather than throwing", () => {
    // Same posture as getRepoTagMap: a diagnostic must not take the Settings page down.
    H.mapRows = [{ token: "r-1", domain: "SAP", lifecycle: "" }];
    H.reposThrow = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mapHealth();
    expect(h).toMatchObject({ keys: 1, domains: 1, repos: 0, placed: 0, lifecyclePlaced: 0 });
    expect(warn).toHaveBeenCalledOnce();
  });
});
