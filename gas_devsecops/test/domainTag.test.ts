// The pure half of the business-domain axis: reading a `Wiz/Domain` tag out of every shape this
// register carries tags in, and the catalogue/predicate/coverage trio built on it.
//
// Both modules under test are DOM-free and Sheets-free by construction (domainTag.ts and
// domainScope.ts import nothing from src/server/), which is the whole reason the axis can be
// held here rather than behind a spreadsheet mock. The join itself — repository identity →
// domain — is src/server/repoDomains.ts and is covered in repoDomains.test.ts.

import { describe, expect, it } from "vitest";
import {
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
    // The captures spell it `Wiz/Domain`; everyone writing about it says `Wiz/domain`. An
    // operator who types the latter into the Script Property must not silently select nothing.
    expect(domainOfTags({ "Wiz/Domain": "SAP" }, "wiz/domain")).toBe("SAP");
    expect(domainOfTags({ "wiz/domain": "SAP" }, "Wiz/Domain")).toBe("SAP");
  });

  it("returns the value as written, only trimmed", () => {
    // A label a person chose. Folding its case would print something the Wiz console does not.
    expect(domainOfTags({ "Wiz/Domain": "  Value Chain  " })).toBe("Value Chain");
  });

  it("is null for a tag present with a blank value", () => {
    // An empty string is not an owner, and a switcher row with no name is not a scope.
    for (const v of ["", "   ", null, undefined]) {
      expect(domainOfTags({ "Wiz/Domain": v })).toBeNull();
    }
  });

  it("is null for no tags, no key and no match", () => {
    expect(domainOfTags(null)).toBeNull();
    expect(domainOfTags(undefined)).toBeNull();
    expect(domainOfTags({ "Wiz/Domain": "SAP" }, "")).toBeNull();
    expect(domainOfTags({ env: "prod" })).toBeNull();
  });
});

describe("recordTags — one normaliser, four shapes", () => {
  it("reads the ledger's tags_json column", () => {
    expect(recordTags({ tags_json: '{"Wiz/Domain": "SAP"}' })).toEqual({ "Wiz/Domain": "SAP" });
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
    expect(recordTags({ vulnerableAsset: { tags: { "Wiz/Domain": "A" } } }))
      .toEqual({ "Wiz/Domain": "A" });
    expect(recordTags({ resource: { tags: { "Wiz/Domain": "B" } } }))
      .toEqual({ "Wiz/Domain": "B" });
  });

  it("reads a flattened frame record's dotted columns", () => {
    expect(recordTags({ "vulnerableAsset.tags.Wiz/Domain": "SAP" }))
      .toEqual({ "Wiz/Domain": "SAP" });
  });

  it("reads a graphSearch entity's [{key, value}] array", () => {
    // THE SHAPE THAT ACTUALLY MATTERS in this register: repoDomains.ts reads repository
    // entities, and this is how their `properties.tags` comes back.
    expect(recordTags({ tags: [{ key: "Wiz/Domain", value: "SAP" }, { key: "env", value: "prod" }] }))
      .toEqual({ "Wiz/Domain": "SAP", env: "prod" });
  });

  it("reads flat `tag:<key>` properties", () => {
    expect(recordTags({ "tag:Wiz/Domain": "SAP" })).toEqual({ "Wiz/Domain": "SAP" });
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

  it("THE PROJECTS-MAP TRAP: tags_json usually holds projects, and no default key can collide", () => {
    // reconcile.ts writes `tags_json: projectsJson(rec) ?? tagsJson(rec)` and every node carries
    // projects[], so in practice this column holds `{slug: name}`. That is documented rather
    // than corrected (see recordTags' own comment). What must hold is that the DEFAULT key
    // cannot read a project as a domain: slugs carry no "/", the default key does.
    const row = { tags_json: '{"value-chain": "VALUE-CHAIN", "ce-transport": "CE-TRANSPORT"}' };
    expect(recordTags(row)).toEqual({
      "value-chain": "VALUE-CHAIN", "ce-transport": "CE-TRANSPORT",
    });
    expect(domainOf(row)).toBeNull();
    // And the documented residual risk is real, which is why it is written down: an operator
    // who overrides the key to a bare word CAN collide with a slug.
    expect(domainOf(row, "value-chain")).toBe("VALUE-CHAIN");
  });
});

describe("domainOf", () => {
  it("resolves through recordTags, so every shape reaches the same answer", () => {
    expect(domainOf({ tags_json: '{"Wiz/Domain": "SAP"}' })).toBe("SAP");
    expect(domainOf({ resource: { tags: { "Wiz/Domain": "SAP" } } })).toBe("SAP");
    expect(domainOf({ tags: [{ key: "Wiz/Domain", value: "SAP" }] })).toBe("SAP");
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
