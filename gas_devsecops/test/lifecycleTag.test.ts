// src/domain/lifecycleTag.ts — where a repository is in its life, and which words end it.
//
// The rules that can be wrong here are small and there are only three of them: which key is
// read when nothing overrides it, that a VALUE comes back as the tenant wrote it, and that
// exactly one word — however it was punctuated — means the repository is finished. The last
// one is the one the cold zone ACTS on, so it is the one with the most cases.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIFECYCLE_TAG_KEY,
  END_OF_LIFE_VALUES,
  isEndOfLife,
  LIFECYCLE_FIELD,
  lifecycleOf,
  lifecycleOfTags,
  resolveLifecycleTagKey,
} from "../src/domain/lifecycleTag";

describe("resolveLifecycleTagKey", () => {
  it("the default is a bare word, and it is what nothing-configured means", () => {
    expect(DEFAULT_LIFECYCLE_TAG_KEY).toBe("lifecycle");
    for (const v of [null, undefined, "", "   "]) {
      expect(resolveLifecycleTagKey(v)).toBe(DEFAULT_LIFECYCLE_TAG_KEY);
    }
  });

  it("a configured key wins, trimmed", () => {
    expect(resolveLifecycleTagKey("  Repo/Lifecycle  ")).toBe("Repo/Lifecycle");
  });

  it("the attached field is spelled once", () => {
    expect(LIFECYCLE_FIELD).toBe("_lifecycle");
  });
});

// --------------------------------------------------------------------------- #
//  reading the tag — the rules are `tagValue`'s, and these pin that this module uses them
// --------------------------------------------------------------------------- #

describe("lifecycleOfTags", () => {
  it("reads the value under the key, case-insensitively on the KEY", () => {
    expect(lifecycleOfTags({ lifecycle: "END_OF_LIFE" })).toBe("END_OF_LIFE");
    expect(lifecycleOfTags({ LifeCycle: "IN_PRODUCTION" })).toBe("IN_PRODUCTION");
  });

  it("the VALUE comes back as written, only trimmed — a label is printed, not folded", () => {
    // The Wiz console shows `End of life`; so must this register.
    expect(lifecycleOfTags({ lifecycle: "  End of life  " })).toBe("End of life");
  });

  it("another key's value is not a lifecycle", () => {
    expect(lifecycleOfTags({ "Wiz/Domain": "SAP" })).toBeNull();
    expect(lifecycleOfTags({ lifecycle: "RETIRED" }, "Repo/Lifecycle")).toBeNull();
  });

  it("present-but-blank is no lifecycle, never a lifecycle named the empty string", () => {
    expect(lifecycleOfTags({ lifecycle: "" })).toBeNull();
    expect(lifecycleOfTags({ lifecycle: "   " })).toBeNull();
    expect(lifecycleOfTags({ lifecycle: null })).toBeNull();
    expect(lifecycleOfTags(null)).toBeNull();
    expect(lifecycleOfTags({})).toBeNull();
  });

  it("lifecycleOf reads the graphSearch entity shape through the shared normaliser", () => {
    // `[{key, value}]` under `tags` — the ONE shape a repository entity actually carries, and
    // the reason this module does not own a second tag normaliser.
    expect(lifecycleOf({ tags: [{ key: "lifecycle", value: "END_OF_LIFE" }] })).toBe("END_OF_LIFE");
    expect(lifecycleOf({ "tag:lifecycle": "IN_PRODUCTION" })).toBe("IN_PRODUCTION");
    expect(lifecycleOf({})).toBeNull();
  });
});

// --------------------------------------------------------------------------- #
//  isEndOfLife — the one judgement in this module, and the only one anything acts on
// --------------------------------------------------------------------------- #

describe("isEndOfLife", () => {
  it("the tenant's word, and the list is exactly that one word", () => {
    expect(END_OF_LIFE_VALUES).toEqual(["END_OF_LIFE"]);
    expect(isEndOfLife("END_OF_LIFE")).toBe(true);
  });

  // Perturbation, run and reverted: dropping the `replace(/[^a-z0-9]+/g, "")` from
  // `foldLifecycle` fails this case with `expected false to be true` on the second spelling,
  // and takes the coldZone exclusion case that uses `end-of-life` with it.
  it("SPELLING IS ABSORBED, so four punctuations of one word are one value", () => {
    expect(isEndOfLife("end_of_life")).toBe(true);
    expect(isEndOfLife("end-of-life")).toBe(true);
    expect(isEndOfLife("End Of Life")).toBe(true);
    expect(isEndOfLife("EndOfLife")).toBe(true);
    expect(isEndOfLife("  END_OF_LIFE  ")).toBe(true);
  });

  it("BUT NO NEW VALUE IS ADMITTED — folding punctuation is not guessing at meaning", () => {
    // The distinction the module header draws against a prefix rule: `end-of-life-pending` is
    // a repository somebody still owns, and a `startsWith` reading would retire it.
    expect(isEndOfLife("end-of-life-pending")).toBe(false);
    expect(isEndOfLife("END_OF_LIFE_PLANNED")).toBe(false);
    expect(isEndOfLife("NEARLY_END_OF_LIFE")).toBe(false);
  });

  it("every live lifecycle is false, and so is a word this register has never seen", () => {
    expect(isEndOfLife("IN_PRODUCTION")).toBe(false);
    expect(isEndOfLife("IN_DEVELOPMENT")).toBe(false);
    expect(isEndOfLife("DECOMMISSIONED")).toBe(false);
  });

  it("ABSENCE IS NEVER END OF LIFE — the refusal the exclusion rests on", () => {
    // A repository nobody tagged must never be deleted from the cold zone by that silence.
    expect(isEndOfLife(null)).toBe(false);
    expect(isEndOfLife(undefined)).toBe(false);
    expect(isEndOfLife("")).toBe(false);
    expect(isEndOfLife("   ")).toBe(false);
  });

  it("REFUSES ANYTHING THAT IS NOT ALREADY A STRING, before any cast", () => {
    // `String({})` is "[object Object]" and `String(null)` is "null" — none of them is in the
    // list today, which is "happens to be safe", not "cannot be wrong".
    expect(isEndOfLife({} as unknown)).toBe(false);
    expect(isEndOfLife(0 as unknown)).toBe(false);
    expect(isEndOfLife(["END_OF_LIFE"] as unknown)).toBe(false);
    expect(isEndOfLife(true as unknown)).toBe(false);
  });
});
