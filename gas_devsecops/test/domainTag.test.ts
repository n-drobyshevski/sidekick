// The pure half of the business-domain axis: reading a `domain` tag out of every shape this
// register carries tags in, and the catalogue/predicate/coverage trio built on it.
//
// Both modules under test are DOM-free and Sheets-free by construction (domainTag.ts and
// domainScope.ts import nothing from src/server/), which is the whole reason the axis can be
// held here rather than behind a spreadsheet mock. The join itself — repository identity →
// domain — is src/server/repoTags.ts and is covered in repoTags.test.ts.

import { describe, expect, it } from "vitest";
import {
  carriedTags,
  DEFAULT_DOMAIN_TAG_KEY,
  domainOf,
  domainOfTags,
  recordTags,
  resolveDomainTagKey,
} from "../src/domain/domainTag";
import {
  domainCatalogue,
  domainOfRow,
  inDomain,
  noDomainCount,
} from "../src/domain/domainScope";
import type { Rec } from "../src/domain/util";

describe("resolveDomainTagKey", () => {
  it("the default is a BARE WORD, the lifecycle key's twin rather than gas/'s namespaced one", () => {
    // Both of this register's tags describe a REPOSITORY and reach Wiz from the tenant's own
    // catalogue, so both defaults are that catalogue's vocabulary. See DEFAULT_DOMAIN_TAG_KEY.
    expect(DEFAULT_DOMAIN_TAG_KEY).toBe("domain");
  });

  it("falls back to the default for every shape of 'not configured'", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(resolveDomainTagKey(v)).toBe(DEFAULT_DOMAIN_TAG_KEY);
    }
  });

  it("keeps a configured key, trimmed", () => {
    expect(resolveDomainTagKey("  Org/Team  ")).toBe("Org/Team");
  });
});

describe("domainOfTags", () => {
  it("matches the key case-insensitively", () => {
    // A tenant's catalogue writes `Domain` or `domain` as its own conventions had it, and the
    // operator typing the Script Property need not have guessed which.
    expect(domainOfTags({ Domain: "SAP" }, "domain")).toBe("SAP");
    expect(domainOfTags({ domain: "SAP" }, "Domain")).toBe("SAP");
    // The namespaced spelling an operator may configure folds the same way.
    expect(domainOfTags({ "Wiz/Domain": "SAP" }, "wiz/domain")).toBe("SAP");
  });

  it("returns the value as written, only trimmed", () => {
    // A label a person chose. Folding its case would print something the Wiz console does not.
    expect(domainOfTags({ domain: "  Value Chain  " })).toBe("Value Chain");
  });

  it("is null for a tag present with a blank value", () => {
    // An empty string is not an owner, and a switcher row with no name is not a scope.
    for (const v of ["", "   ", null, undefined]) {
      expect(domainOfTags({ domain: v })).toBeNull();
    }
  });

  it("is null for no tags, no key and no match", () => {
    expect(domainOfTags(null)).toBeNull();
    expect(domainOfTags(undefined)).toBeNull();
    expect(domainOfTags({ domain: "SAP" }, "")).toBeNull();
    expect(domainOfTags({ env: "prod" })).toBeNull();
  });
});

describe("recordTags — one normaliser, four shapes", () => {
  it("reads the ledger's tags_json column", () => {
    expect(recordTags({ tags_json: '{"domain": "SAP"}' })).toEqual({ "domain": "SAP" });
  });

  it("never throws on a tags_json cell that is not JSON", () => {
    // A hand-edited cell is a missing tag bag, not a broken page.
    expect(recordTags({ tags_json: "not json" })).toEqual({});
    expect(recordTags({ tags_json: "[1,2,3]" })).toEqual({});
    expect(recordTags({ tags_json: "" })).toEqual({});
  });

  it("reads a nested asset bag under either spelling", () => {
    // SCA's node calls it `vulnerableAsset`; SAST's and secrets' call it `resource` —
    // reconcile.ts's `attributes` dispatch is the same asymmetry.
    expect(recordTags({ vulnerableAsset: { tags: { "domain": "A" } } }))
      .toEqual({ "domain": "A" });
    expect(recordTags({ resource: { tags: { "domain": "B" } } }))
      .toEqual({ "domain": "B" });
  });

  it("reads a flattened frame record's dotted columns", () => {
    expect(recordTags({ "vulnerableAsset.tags.domain": "SAP" }))
      .toEqual({ "domain": "SAP" });
  });

  it("reads a graphSearch entity's [{key, value}] array", () => {
    // THE SHAPE THAT ACTUALLY MATTERS in this register: repoTags.ts reads repository
    // entities, and this is how their `properties.tags` comes back.
    expect(recordTags({ tags: [{ key: "domain", value: "SAP" }, { key: "env", value: "prod" }] }))
      .toEqual({ "domain": "SAP", env: "prod" });
  });

  it("reads flat `tag:<key>` properties", () => {
    expect(recordTags({ "tag:domain": "SAP" })).toEqual({ "domain": "SAP" });
  });

  it("skips array entries with no key rather than indexing them under 'undefined'", () => {
    expect(recordTags({ tags: [{ value: "orphan" }, null, "nope", { key: "ok", value: 1 }] }))
      .toEqual({ ok: 1 });
  });

  it("is {} for null, undefined and a record carrying no tags at all", () => {
    expect(recordTags(null)).toEqual({});
    expect(recordTags(undefined)).toEqual({});
    expect(recordTags({ repo_name: "svc" })).toEqual({});
  });

  it("THE PROJECTS-MAP TRAP: tags_json holds projects here, and recordTags still reads it", () => {
    // reconcile.ts writes `tags_json: projectsJson(rec) ?? tagsJson(rec)` and every node carries
    // projects[], so this column holds `{slug: name}`. The column is documented rather than
    // corrected (a persisted schema, pinned byte-for-byte by test/reconcile.test.ts), and
    // `recordTags` is still the function that reads every shape the NAME promises.
    const row = { tags_json: '{"value-chain": "VALUE-CHAIN", "domain": "CE-TRANSPORT"}' };
    expect(recordTags(row)).toEqual({
      "value-chain": "VALUE-CHAIN", domain: "CE-TRANSPORT",
    });
    // Which is why a project SLUG spelled like the key reads as a domain through THIS door —
    // the whole reason the join uses `carriedTags` instead. See `carriedTags` below and
    // repoTags.test.ts's "A PROJECT SLUG IS NOT A TAG KEY".
    expect(domainOf(row)).toBe("CE-TRANSPORT");
    expect(carriedTags(row)).toEqual({});
  });
});

describe("carriedTags — recordTags minus the tags_json COLUMN, and nothing else", () => {
  // THE CLAIM IS "SAME FOLD, ONE SOURCE FEWER" — which is why `carriedTags` IS the body and
  // `recordTags` composes it, rather than the two carrying a shape list each. So the
  // perturbation is the split the module header warns about: run and reverted, giving
  // `carriedTags` its own fold that omits the `tag:` shape while `recordTags` keeps all four
  // fails this case with `expected {} to deeply equal { domain: 'SAP' }` on the fifth record.
  // (Simply deleting a shape from `carriedTags` does NOT fail it — `recordTags` loses the
  // same shape and they still agree. That is the composition working, not the test passing
  // for free, and the two other cases below are what catch it.)
  it("agrees with recordTags on every record that carries no tags_json column", () => {
    for (const r of [
      { vulnerableAsset: { tags: { domain: "A" } } },
      { "vulnerableAsset.tags.domain": "SAP" },
      { resource: { tags: { domain: "B" } } },
      { tags: [{ key: "domain", value: "SAP" }] },
      { "tag:domain": "SAP" },
      { repo_name: "svc" },
    ]) expect(carriedTags(r)).toEqual(recordTags(r));
  });

  // Perturbation, run and reverted: having `carriedTags` fold `tagsJsonColumn` too fails this
  // case with `expected { a: '1', b: '2' } to deeply equal { b: '2' }`.
  it("DROPS THE COLUMN AND ONLY THE COLUMN", () => {
    const row = { tags_json: '{"a": "1"}', "tag:b": "2" };
    expect(recordTags(row)).toEqual({ a: "1", b: "2" });
    expect(carriedTags(row)).toEqual({ b: "2" });
  });

  it("is {} for null and undefined, like its parent", () => {
    expect(carriedTags(null)).toEqual({});
    expect(carriedTags(undefined)).toEqual({});
  });

  // Perturbation, run and reverted: composing `recordTags` the other way round —
  // `{ ...carriedTags(record), ...tagsJsonColumn(record) }` — fails this case with
  // `expected { domain: 'COLUMN' } to deeply equal { domain: 'CARRIED' }`.
  it("recordTags keeps the COLUMN at lowest precedence, as the single fold always did", () => {
    // The four shapes wrote into one bag in order and later ones overwrote earlier ones.
    // Splitting the fold must not quietly reverse that for a row carrying both.
    const row = { tags_json: '{"domain": "COLUMN"}', "tag:domain": "CARRIED" };
    expect(recordTags(row)).toEqual({ domain: "CARRIED" });
  });
});

describe("domainOf", () => {
  it("resolves through recordTags, so every shape reaches the same answer", () => {
    expect(domainOf({ tags_json: '{"domain": "SAP"}' })).toBe("SAP");
    expect(domainOf({ resource: { tags: { domain: "SAP" } } })).toBe("SAP");
    expect(domainOf({ tags: [{ key: "domain", value: "SAP" }] })).toBe("SAP");
  });
});

// =========================================================================================
//  domainScope — the catalogue, the predicate, the coverage figure
// =========================================================================================

const row = (domain?: string | null): Rec =>
  (domain === undefined ? {} : { _domain: domain }) as Rec;

describe("domainOfRow", () => {
  it("trims, and reads every absence as ''", () => {
    expect(domainOfRow({ _domain: "  SAP  " })).toBe("SAP");
    expect(domainOfRow({ _domain: null })).toBe("");
    expect(domainOfRow({})).toBe("");
    expect(domainOfRow(null)).toBe("");
    expect(domainOfRow(undefined)).toBe("");
  });
});

describe("domainCatalogue", () => {
  it("counts rows per domain and sorts by name", () => {
    const cat = domainCatalogue([row("SAP"), row("CROSS"), row("SAP"), row("SAP")]);
    expect(cat).toEqual([
      { name: "CROSS", findings: 1 },
      { name: "SAP", findings: 3 },
    ]);
  });

  it("omits rows carrying no domain entirely — they are noDomainCount's population", () => {
    // A domain nothing in the CURRENT register carries must be ABSENT from the picker rather
    // than present and answering zero: a zero meaning "nothing here" and a zero meaning "never
    // synced" look identical on screen and call for opposite reactions.
    expect(domainCatalogue([row("SAP"), row(null), row(), row("")])).toEqual([
      { name: "SAP", findings: 1 },
    ]);
  });

  it("is [] for an empty register", () => {
    expect(domainCatalogue([])).toEqual([]);
  });
});

describe("inDomain", () => {
  it("matches exactly, never folded", () => {
    // Two tenants' `SAP` and `sap` are two labels a person typed; collapsing them here would
    // merge buckets the Wiz console shows apart.
    expect(inDomain(row("SAP"), "SAP")).toBe(true);
    expect(inDomain(row("SAP"), "sap")).toBe(false);
  });

  it("FAILS CLOSED on an empty name — there is no 'everything' domain", () => {
    // A caller that forgot to resolve a selection into a real name must match nothing, not
    // every row.
    expect(inDomain(row("SAP"), "")).toBe(false);
    expect(inDomain(row(null), "")).toBe(false);
  });

  it("is false for a row carrying no domain", () => {
    expect(inDomain(row(null), "SAP")).toBe(false);
    expect(inDomain(row(), "SAP")).toBe(false);
  });
});

describe("noDomainCount", () => {
  it("counts every row no domain could be attached to", () => {
    expect(noDomainCount([row("SAP"), row(null), row(), row(""), row("CROSS")])).toBe(3);
  });

  it("equals the register when the join has never run — 'we never learned', not 'nobody owns'", () => {
    const rows = [row(), row(), row()];
    expect(noDomainCount(rows)).toBe(rows.length);
    expect(domainCatalogue(rows)).toEqual([]);
  });
});
