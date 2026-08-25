import { describe, expect, it } from "vitest";
import { compileDomains, domainNames, UNASSIGNED } from "../src/domain/domainRules";
import {
  NOT_ATTRIBUTABLE,
  domainRank,
  resolveDomain,
  resolveDomainName,
  resolvedDomainNames,
} from "../src/domain/resolveDomain";

// One manual group that claims anything in the `payments` subscription. The fallback under
// test: it must win when there is no tag, and lose when there is one.
const ITEMS = [
  {
    name: "Payments",
    rules: [{ conditions: [{ type: "subscription", values: ["payments"] }] }],
  },
];
const COMPILED = compileDomains(ITEMS);

// A live frame record, flattened the way findings.ts hands it over.
function frame(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "vulnerableAsset.name": "web-01",
    "vulnerableAsset.subscriptionName": "payments",
    ...over,
  };
}

describe("resolveDomain — the precedence table", () => {
  it("takes the tag verbatim when one is present, over a rule that also matches", () => {
    // Both mechanisms have an answer here and they disagree. The tag is the tenant's own
    // statement about the resource, so it wins outright — that IS the model.
    const r = resolveDomain(frame({ "vulnerableAsset.tags.Wiz/Domain": "SAP" }), COMPILED);
    expect(r).toEqual({ name: "SAP", source: "tag" });
  });

  it("prefers an already-attached _bizDomain to re-parsing the tags", () => {
    // Every server path runs attachBizDomains first; re-reading tags_json per row would be the
    // same answer at a cost. The attached value is authoritative here.
    const r = resolveDomain(frame({ _bizDomain: "CROSS" }), COMPILED);
    expect(r).toEqual({ name: "CROSS", source: "tag" });
  });

  it("falls through to the rule verdict when there is no tag", () => {
    expect(resolveDomain(frame(), COMPILED)).toEqual({ name: "Payments", source: "rule" });
  });

  it("reports Unassigned as its own source when the row had inputs and matched nothing", () => {
    const r = resolveDomain(frame({ "vulnerableAsset.subscriptionName": "labs" }), COMPILED);
    expect(r).toEqual({ name: UNASSIGNED, source: "none" });
  });

  it("names a row with no attribution input at all rather than calling it Unassigned", () => {
    // A compacted episode: the placeholder asset name, no subscription, no tags. Nothing any
    // mechanism reads survives on it, so counting it as Unassigned would swamp that bucket
    // with a population no operator can act on.
    const episode = { asset_name: "(compacted)", tags_json: null };
    expect(resolveDomain(episode, COMPILED)).toEqual({
      name: NOT_ATTRIBUTABLE, source: "missing",
    });
  });

  it("still reads a tag off an input-less-looking row, because a tag IS an input", () => {
    // The order matters and this is the test that pins it: `hasDomainInputs` counts a present
    // tag among its inputs, so checking it BEFORE the tag would send a tagged compacted episode
    // — exactly what the tags_json backfill recovers — to Not attributable.
    const episode = { asset_name: "(compacted)", tags_json: JSON.stringify({ "Wiz/Domain": "SAP" }) };
    expect(resolveDomain(episode, COMPILED)).toEqual({ name: "SAP", source: "tag" });
  });

  it("lets a MANUAL RULE claim a compacted episode whose bag has no Wiz/Domain key", () => {
    // The leg the tag test above cannot cover, and the one that was silently impossible: a
    // recovered bag with no `Wiz/Domain` key falls past the tag stage into the rules, where
    // `assignDomain` used to pin every `(compacted)` row to Unassigned before evaluating a
    // single condition. Carrying the bag through compaction bought nothing for such a row
    // until that guard was narrowed to the name-regex pool it was written for.
    const items = [
      { name: "Payments", rules: [{ conditions: [{ type: "tag", key: "team", value: "payments" }] }] },
    ];
    const episode = { asset_name: "(compacted)", tags_json: JSON.stringify({ team: "payments" }) };
    expect(resolveDomain(episode, compileDomains(items))).toEqual({
      name: "Payments", source: "rule",
    });
  });

  it("honors a non-default tag key", () => {
    const rec = frame({ "vulnerableAsset.tags.cost-centre": "CC-9" });
    expect(resolveDomainName(rec, COMPILED, "cost-centre")).toBe("CC-9");
    // ...and reads nothing under the default key, falling back to the rule.
    expect(resolveDomainName(rec, COMPILED)).toBe("Payments");
  });

  it("keeps working with no manual groups configured at all", () => {
    // The tag-only register. An earlier draft short-circuited to Unassigned whenever the rule
    // list was empty, which threw away every tag on exactly the registers the tag serves best.
    expect(resolveDomainName(frame({ _bizDomain: "SAP" }), [])).toBe("SAP");
    expect(resolveDomainName(frame(), [])).toBe(UNASSIGNED);
  });

  it("resolveDomainName is resolveDomain's name", () => {
    const rec = frame({ _bizDomain: "SAP" });
    expect(resolveDomainName(rec, COMPILED)).toBe(resolveDomain(rec, COMPILED).name);
  });
});

describe("resolvedDomainNames — the ordered universe", () => {
  it("puts tag values first, then rules in priority order, then the two tails", () => {
    expect(resolvedDomainNames(["SAP", "CROSS"], domainNames(ITEMS))).toEqual([
      "CROSS", "SAP", "Payments", UNASSIGNED, NOT_ATTRIBUTABLE,
    ]);
  });

  it("sorts tag values but leaves rule order alone, because rule position IS priority", () => {
    const rules = ["Zeta", "Alpha"];
    expect(resolvedDomainNames(["b", "a"], rules)).toEqual([
      "a", "b", "Zeta", "Alpha", UNASSIGNED, NOT_ATTRIBUTABLE,
    ]);
  });

  it("emits each tail exactly once even though domainNames already appends Unassigned", () => {
    const out = resolvedDomainNames([], domainNames(ITEMS));
    expect(out.filter((n) => n === UNASSIGNED)).toHaveLength(1);
    expect(out.filter((n) => n === NOT_ATTRIBUTABLE)).toHaveLength(1);
  });

  it("dedupes a tag value that a manual group is also named after", () => {
    // Legitimate and common: an operator writes a rule to claim what the tag has not reached
    // yet, under the same name. One bucket, listed once, under the tag's position.
    expect(resolvedDomainNames(["Payments"], domainNames(ITEMS))).toEqual([
      "Payments", UNASSIGNED, NOT_ATTRIBUTABLE,
    ]);
  });

  it("drops blanks and accepts any iterable of tag values", () => {
    expect(resolvedDomainNames(new Set(["", "SAP"]), ["", "Payments"])).toEqual([
      "SAP", "Payments", UNASSIGNED, NOT_ATTRIBUTABLE,
    ]);
  });
});

describe("domainRank", () => {
  it("ranks a real domain above Unassigned above Not attributable", () => {
    expect(["Not attributable", "Unassigned", "SAP"].sort((a, b) => domainRank(a) - domainRank(b)))
      .toEqual(["SAP", UNASSIGNED, NOT_ATTRIBUTABLE]);
  });
});
