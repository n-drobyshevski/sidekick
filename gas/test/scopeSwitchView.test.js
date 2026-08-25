// What the header's scope switcher CLAIMS: its label, its caption, and whether the scope in
// force still exists.
//
// Plain .js for the reason navGroups.test.js writes out. scopeSwitch.js is split so this file
// can exist — `scopeSwitchView` is DOM-free, and every honesty rule the control carries is a
// return value here rather than a pixel.
//
// The failure mode this guards is not a crash. It is a caption that reads "31 findings" and
// leaves a reader unable to tell a small support group from a small register, or one that
// silently attributes every unclaimed finding to somewhere it was never assigned.

import { describe, expect, it } from "vitest";

import {
  BIZ_DOMAIN_PREFIX,
  SUPPORT_GROUP_PREFIX,
  bizDomainScopeOptions,
  domainScopeOptions,
  scopeSwitchView,
  supportScopeOptions,
} from "../src/client/js/scopeSwitch.js";
import { UI_ICON_NAMES } from "../src/client/js/uiIcons.js";

/** A bootstrap payload of the shape api.ts bootstrapCore() returns. */
function boot(over) {
  return {
    domainNames: ["Customer-facing", "Data & batch", "Unassigned"],
    filterOptions: { supportGroups: ["CS-CORE", "CS-ENMS"], bizDomains: ["CROSS", "SAP"] },
    domainTagKey: "Wiz/Domain",
    scopeCounts: {
      register: 161,
      domains: { "Customer-facing": 71, "Data & batch": 63, Unassigned: 27 },
      supportGroups: { "CS-CORE": 31, "CS-ENMS": 26 },
      bizDomains: { CROSS: 48, SAP: 30 },
      unassigned: 27,
      noSupportGroup: 104,
      noBizDomain: 83,
    },
    ...over,
  };
}

const none = { domain: "", supportGroup: "", bizDomain: "" };

describe("when there is nothing truthful to offer", () => {
  // An empty picker is a promise the register cannot keep, and the rail's scan zone already
  // says why it is empty.
  it("hides itself with no payload at all", () => {
    expect(scopeSwitchView(null, none).show).toBe(false);
  });

  it("hides itself before the first scan", () => {
    expect(scopeSwitchView({ domainNames: [], filterOptions: {} }, none).show).toBe(false);
  });

  it("hides itself when the register is empty", () => {
    const data = boot({ scopeCounts: { ...boot().scopeCounts, register: 0 } });
    expect(scopeSwitchView(data, none).show).toBe(false);
  });

  // The boundary is ONE CONFIGURED GROUP, not one entry in the list, and this test was
  // written the other way round first. `domainNames()` always appends Unassigned, so a
  // register with a single configured group arrives here as a list of TWO — and those two
  // are genuinely different populations (what the rule claimed, and what it did not), so
  // the switcher has something to offer. The `> 1` threshold reads on the returned array
  // and therefore already means "at least one configured group".
  it("hides itself when none of the three dimensions has anything to offer", () => {
    const data = boot({
      domainNames: ["Unassigned"],
      filterOptions: { supportGroups: [], bizDomains: [] },
    });
    expect(scopeSwitchView(data, none).show).toBe(false);
  });

  // THE GROUP IS ABSENT, NOT EMPTY, WHEN NOTHING IS TAGGED. The domain tag is optional and the
  // tenant's to write, so a "VC Domains" heading over nothing would say that nobody owns
  // anything — a claim about the tenant rather than about what we managed to read.
  it("omits the VC Domains group entirely when nothing carries the tag", () => {
    const data = boot({
      filterOptions: { supportGroups: ["CS-CORE"], bizDomains: [] },
      scopeCounts: { ...boot().scopeCounts, bizDomains: {}, noBizDomain: 161 },
    });
    const v = scopeSwitchView(data, none);
    expect(v.show).toBe(true);
    expect(v.options.map((o) => o.group)).not.toContain("VC Domains");
  });

  it("shows itself for VC Domains alone", () => {
    const data = boot({
      domainNames: ["Unassigned"],
      filterOptions: { supportGroups: [], bizDomains: ["CROSS", "SAP"] },
    });
    const v = scopeSwitchView(data, none);
    expect(v.show).toBe(true);
    expect(v.options.map((o) => o.label)).toEqual(["CROSS", "SAP"]);
  });

  it("shows itself for one configured group, because Unassigned is the other half of it", () => {
    const data = boot({
      domainNames: ["Everything", "Unassigned"],
      filterOptions: { supportGroups: [], bizDomains: [] },
    });
    const v = scopeSwitchView(data, none);
    expect(v.show).toBe(true);
    expect(v.options.map((o) => o.label)).toEqual(["Everything", "Unassigned"]);
  });

  it("shows itself for support groups alone, with no manual groups and no VC Domains", () => {
    const data = boot({
      domainNames: ["Unassigned"],
      filterOptions: { supportGroups: ["CS-CORE", "CS-ENMS"], bizDomains: [] },
    });
    const v = scopeSwitchView(data, none);
    expect(v.show).toBe(true);
    expect(v.options.map((o) => o.label)).toEqual(["CS-CORE", "CS-ENMS"]);
  });
});

describe("the list", () => {
  const v = scopeSwitchView(boot(), none);

  // Sorted by kind so the combobox emits each heading once — it walks the list in order and
  // starts a new heading whenever the group changes, so a list that did not sort by kind would
  // fragment its own headings.
  it("groups the three dimensions under their own headings, in a fixed order", () => {
    expect(v.options.map((o) => o.group)).toEqual([
      "Manual groups", "Manual groups", "Manual groups",
      "VC Domains", "VC Domains",
      "Support groups", "Support groups",
    ]);
  });

  // A manual group named `Payments` and a support group named `Payments` must never be one row
  // or one value. The control strips the prefix again on pick.
  it("prefixes two of the three kinds so the values can never collide", () => {
    const collide = boot({
      domainNames: ["Payments", "Unassigned"],
      filterOptions: { supportGroups: ["Payments"], bizDomains: ["Payments"] },
    });
    const values = scopeSwitchView(collide, none).options.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("Payments");
    expect(values).toContain(SUPPORT_GROUP_PREFIX + "Payments");
    expect(values).toContain(BIZ_DOMAIN_PREFIX + "Payments");
  });

  it("says in words which kind each row is, and how much it covers", () => {
    expect(v.options[0].hint).toBe("Manual group · 71 findings");
    expect(v.options[3].hint).toBe("VC Domain · 48 findings");
    expect(v.options[5].hint).toBe("Support group · 31 findings");
  });

  // Unassigned is a real, selectable bucket — domainNames() appends it — but calling it a
  // manual group would be wrong: it is the absence of one.
  it("names Unassigned for what it is", () => {
    expect(v.options[2].label).toBe("Unassigned");
    expect(v.options[2].hint).toBe("No manual group · 27 findings");
  });

  // The row means "no scope", so naming it after one of the three kinds describes a third of what
  // it does — and the register holds what the last scan was scoped to fetch, so "everything"
  // never stands alone.
  it("offers one reset row that names the register", () => {
    expect(v.pinned).toEqual([
      { value: "", label: "Everything in the register", hint: "161 findings", icon: "folders" },
    ]);
  });

  it("asks only for glyphs the icon set actually draws", () => {
    for (const row of [...v.options, ...v.pinned]) {
      expect(UI_ICON_NAMES, row.icon + " is not a glyph uiIcons.js draws").toContain(row.icon);
    }
  });

  it("counts a row the register has no tally for as zero rather than throwing", () => {
    const data = boot({ scopeCounts: { ...boot().scopeCounts, domains: {} } });
    expect(scopeSwitchView(data, none).options[0].hint).toBe("Manual group · 0 findings");
  });

  it("says finding, not findings, for one", () => {
    const data = boot({ scopeCounts: { ...boot().scopeCounts, domains: { "Customer-facing": 1 } } });
    expect(scopeSwitchView(data, none).options[0].hint).toBe("Manual group · 1 finding");
  });
});

describe("the caption", () => {
  it("names the register when nothing is scoped", () => {
    const v = scopeSwitchView(boot(), none);
    expect(v.caption).toBe("161 findings in the register");
    expect(v.label).toBe("the whole register");
    expect(v.current).toBe("");
    expect(v.kind).toBe("");
  });

  // THE DENOMINATOR TRAVELS WITH THE NUMBER: "71" alone cannot tell a small value chain from
  // a small register, and those two call for opposite reactions.
  //
  // AND A SCOPED CAPTION CARRIES A SECOND FIGURE. Without it, "71 of 161" quietly attributes
  // the other 90 to some other chain, when for 27 of them the truth is that no rule claimed
  // them at all.
  it("carries the denominator and the unassigned tail under a value chain", () => {
    const v = scopeSwitchView(boot(), { domain: "Customer-facing" });
    expect(v.caption).toBe("71 of 161 findings · 27 unassigned");
    expect(v.kind).toBe("domain");
    expect(v.current).toBe("Customer-facing");
    expect(v.label).toBe("Customer-facing");
  });

  // The domain's second figure is the one that works hardest: the tag is the tenant's to write
  // and most tenants have not finished writing it, so a bare "48 of 161" reads as a small domain
  // in a big register when what it says is that 83 resources are unattributed. It names the tag,
  // too — an operator who mistyped WIZ_DOMAIN_TAG_KEY would otherwise read a tenant-wide tagging
  // failure off their own typo.
  it("carries the denominator and the untagged tail under a VC Domain", () => {
    const v = scopeSwitchView(boot(), { bizDomain: "CROSS" });
    expect(v.caption).toBe("48 of 161 findings · 83 carry no Wiz/Domain tag");
    expect(v.kind).toBe("bizDomain");
    expect(v.current).toBe(BIZ_DOMAIN_PREFIX + "CROSS");
    expect(v.label).toBe("CROSS");
  });

  it("falls back to the word domain when the payload names no tag key", () => {
    const v = scopeSwitchView(boot({ domainTagKey: "" }), { bizDomain: "CROSS" });
    expect(v.caption).toBe("48 of 161 findings · 83 carry no domain tag");
  });

  it("names a non-default tag key, because the figure is a fact about that key", () => {
    const v = scopeSwitchView(boot({ domainTagKey: "cost-centre" }), { bizDomain: "CROSS" });
    expect(v.caption).toBe("48 of 161 findings · 83 carry no cost-centre tag");
  });

  it("carries the denominator and the ungrouped tail under a support group", () => {
    const v = scopeSwitchView(boot(), { supportGroup: "CS-CORE" });
    expect(v.caption).toBe("31 of 161 findings · 104 carry no support group");
    expect(v.kind).toBe("support");
    expect(v.current).toBe(SUPPORT_GROUP_PREFIX + "CS-CORE");
  });

  // The second figure would be the first one again — these ARE the unassigned findings — and a
  // caption that says the same number twice reads as a bug.
  it("does not restate the count under Unassigned", () => {
    const v = scopeSwitchView(boot(), { domain: "Unassigned" });
    expect(v.caption).toBe("27 of 161 findings · claimed by no rule");
  });
});

describe("a scope the register no longer holds", () => {
  // A value chain deleted from Settings, or a support group that fell out after a scan scoped
  // elsewhere. The control keeps it in force and says so, rather than silently widening back
  // to the register — a silent reset looks exactly like never having scoped at all.
  it("says so, in words, with the count it is actually showing", () => {
    const v = scopeSwitchView(boot(), { domain: "Deleted chain" });
    expect(v.stale).toBe(true);
    expect(v.caption).toBe("Not in this register — showing 0 of 161");
    expect(v.label).toBe("Deleted chain — not in this register");
  });

  it("catches a stale support group the same way", () => {
    const v = scopeSwitchView(boot(), { supportGroup: "CS-GONE" });
    expect(v.stale).toBe(true);
    expect(v.current).toBe(SUPPORT_GROUP_PREFIX + "CS-GONE");
  });

  // The VC Domain has its own way of going stale that the other two do not: correcting
  // WIZ_DOMAIN_TAG_KEY re-reads every row off a different tag, and the domain in force may
  // simply not exist under the new key.
  it("catches a VC Domain that vanished when the tag key changed", () => {
    const v = scopeSwitchView(boot(), { bizDomain: "GONE" });
    expect(v.stale).toBe(true);
    expect(v.current).toBe(BIZ_DOMAIN_PREFIX + "GONE");
    expect(v.caption).toBe("Not in this register — showing 0 of 161");
  });

  it("calls a live scope fresh", () => {
    expect(scopeSwitchView(boot(), { domain: "Data & batch" }).stale).toBe(false);
    expect(scopeSwitchView(boot(), { bizDomain: "SAP" }).stale).toBe(false);
    expect(scopeSwitchView(boot(), none).stale).toBe(false);
  });
});

describe("the row builders", () => {
  it("tolerate an absent list and an absent tally", () => {
    expect(domainScopeOptions(null, null)).toEqual([]);
    expect(supportScopeOptions(undefined, undefined)).toEqual([]);
    expect(bizDomainScopeOptions(null, null)).toEqual([]);
  });

  // An untagged resource contributes nothing to a facet, exactly as a blank cloud already does.
  // A synthetic row here would offer the resources we know least about as though they were an
  // owner — the coverage figure in the caption is what answers that instead.
  it("offer no synthetic Untagged row among the VC Domains", () => {
    const labels = bizDomainScopeOptions(["CROSS", "SAP"], { CROSS: 1, SAP: 2 })
      .map((o) => o.label);
    expect(labels).toEqual(["CROSS", "SAP"]);
  });
});
