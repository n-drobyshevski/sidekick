// What the app-header switcher CLAIMS, from the bootstrap payload alone.
//
// DOM-free half of the control, tested the way syncProgressView is: the assembly is now
// `scopeControl` in `gas_shared/ui/scopeControl.js`, a handful of `el()` calls, but the
// wording, the denominator and the stale-scope detection are decisions, and a decision that
// can be wrong gets a test.

import { describe, expect, it } from "vitest";
import { projectScopeView, trendScopeView } from "../src/client/js/ui/projectScope.js";
import { UI_ICON_NAMES } from "../../gas_shared/ui/uiIcons.js";

const boot = (scope, projectList, domainList) => ({
  scope, filterOptions: { projectList, domainList },
});

const DOMAINS = [{ name: "CROSS", assets: 3 }, { name: "SAP", assets: 5 }];
/** 15 of 87 tagged, the seeded landscape's real ratio — see test/domainView.test.ts. */
const COVER = { key: "Wiz/Domain", tagged: 15, total: 87 };

const LIST = [
  { id: "p-unit", name: "VALUE-CHAIN", isFolder: true, assets: 826 },
  { id: "p-a", name: "CS-VALUECHAIN-SECURITY", isFolder: false, assets: 12 },
  { id: "p-b", name: "GITHUB-DKTUNITED", isFolder: false, assets: 1 },
];

describe("projectScopeView", () => {
  it("offers nothing when there is no register to slice", () => {
    // Including the boot-failure path, where renderAppbar is called with null.
    expect(projectScopeView(null).show).toBe(false);
    expect(projectScopeView(boot({ projectView: "", shown: 0, register: 0 }, [])).show).toBe(false);
  });

  it("names the whole register without calling it 'all' anything", () => {
    // The register holds what the last sync was SCOPED TO FETCH. On a tenant scoped to one
    // business unit, "All projects" would name a population this register does not contain.
    const v = projectScopeView(boot({ projectView: "", shown: 826, register: 826 }, LIST));
    // "Everything synced", not "All projects" and no longer "All synced projects". The row
    // means "no scope", and the scope has two kinds now — naming the reset after one of them
    // would describe half of what it clears. "Synced" is the part that was load-bearing:
    // the register holds what the last sync was scoped to fetch, never the tenant.
    expect(v.pinned[0].label).toBe("Everything synced");
    expect(v.caption).toBe("826 assets synced");
    expect(v.stale).toBe(false);
  });

  it("keeps the denominator beside the number", () => {
    // "826" alone cannot distinguish a small unit from a small register, and those call for
    // opposite reactions from whoever is reading.
    const v = projectScopeView(boot({ projectView: "p-a", shown: 12, register: 826 }, LIST));
    expect(v.caption).toBe("12 of 826 assets");
    expect(v.label).toBe("CS-VALUECHAIN-SECURITY");
  });

  it("says a stale scope is stale instead of showing a bare zero", () => {
    // A stored view outliving the register — re-synced scoped elsewhere. "0 of 826" with no
    // explanation reads as "this project is clean", which is the opposite of the truth.
    const v = projectScopeView(boot({ projectView: "p-gone", shown: 0, register: 826 }, LIST));
    expect(v.stale).toBe(true);
    expect(v.caption).toContain("Not in this register");
    expect(v.label).toBe("a project this register does not hold");
    // And every real project is still on offer, so the state is escapable.
    expect(v.options.map((o) => o.value)).toEqual(["p-unit", "p-a", "p-b"]);
  });

  it("declares folders in words, not by colour or icon alone", () => {
    const v = projectScopeView(boot({ projectView: "", shown: 826, register: 826 }, LIST));
    expect(v.options[0].hint).toBe("Business unit · 826 assets");
    expect(v.options[0].group).toBe("Business units");
    // CS-VALUECHAIN-SECURITY is a support group by the tenant's naming convention, and says
    // so in the same slot for the same reason.
    expect(v.options[1].hint).toBe("Support group · 12 assets");
    // Singular, because "1 assets" is the tell of a count nobody looked at.
    expect(v.options[2].hint).toBe("1 asset");
  });

  // The glyph on a row is the THIRD carrier, after the hint and the group heading. These two
  // tests are what stop it becoming the first: the moment a row's folder-ness is legible only
  // as one folder versus two at 14px, the hint above has quietly stopped being the answer.
  it("draws a mark beside the words, never instead of them", () => {
    const v = projectScopeView(boot({ projectView: "", shown: 826, register: 826 }, LIST));
    expect(v.options[0].icon).toBe("folders");   // a business unit: reaches a subtree
    expect(v.options[1].icon).toBe("folders");   // a support group: reaches its own subtree
    expect(v.options[2].icon).toBe("folder");    // a leaf project
    // …and every one of them still says which it is, in words, with no icon involved.
    for (const o of v.options) expect(o.hint).toBeTruthy();
    expect(v.pinned[0].icon).toBe("folders");
    expect(v.pinned[0].hint).toBe("826 assets");
  });

  // uiIcon falls back to a one-pixel dot on an unknown name rather than throwing, and
  // icons.test.js's chrome-icon sweep only sees literal `uiIcon("…")` calls in the client —
  // a name that travels as option data is invisible to it. This is that guard.
  it("names only glyphs the icon set actually draws", () => {
    const v = projectScopeView(boot({ projectView: "", shown: 826, register: 826 }, LIST));
    for (const o of [...v.pinned, ...v.options]) {
      expect(UI_ICON_NAMES, o.label + " asks for " + o.icon).toContain(o.icon);
    }
  });

  it("claims nothing about folders when the register has not recorded any", () => {
    // `isFolder` is tri-state: undefined means the row predates the field, which is every
    // asset already in the ledger. Grouping those under "Projects" would assert leaf-ness
    // of the whole register on the strength of a field nobody has filled in.
    const legacy = [
      { id: "p-a", name: "ALPHA", assets: 3 },
      { id: "p-b", name: "BETA", assets: 4 },
    ];
    const v = projectScopeView(boot({ projectView: "", shown: 7, register: 7 }, legacy));
    expect(v.options.every((o) => o.group === "")).toBe(true);

    // But a register that knows about SOME rows keeps the unknown ones out of both claims
    // rather than defaulting them to leaves.
    const mixed = [{ id: "p-u", name: "UNIT", isFolder: true, assets: 9 }, ...legacy];
    const w = projectScopeView(boot({ projectView: "", shown: 9, register: 9 }, mixed));
    expect(w.options.map((o) => o.group))
      .toEqual(["Business units", "Not yet recorded", "Not yet recorded"]);
  });
});

// The inventory trend's own scope claim — the last figure in the app that had to refuse the
// switcher, and the one whose note is easiest to get subtly wrong.
//
// A per-project series can only cover syncs recorded after the column shipped, so a project's
// line can be three points long against a ledger of forty. A chart that starts three points in
// looks exactly like a landscape that collapsed; "covers 3 of 40" is the difference between a
// short history and a catastrophe, and it is the whole reason this function exists rather than
// a bare `registerWideNote` call.

const trendScope = (over) => ({
  projectId: "p-a", scoped: true, points: 3, registerPoints: 40, ...over,
});

// The tenant's own vocabulary, which Wiz does not report: a project whose name begins CS, CE
// or LU is a SUPPORT GROUP, and a business unit is anything that is not one. Read off a name,
// which this codebase otherwise refuses to do — so these cases pin the three ways a name rule
// goes wrong, all three of them drawn from names the captures actually contain.
describe("support groups", () => {
  const named = (name, isFolder) => [{ id: `p-${name}`, name, isFolder, assets: 4 }];
  const groupOf = (name, isFolder) => projectScopeView(
    boot({ projectView: "", shown: 4, register: 4 }, named(name, isFolder)),
  ).options[0].group;

  it("files the three prefixes as support groups", () => {
    for (const name of ["CS-VALUECHAIN-SECURITY", "CE-DPCP-PORTAL", "LU-SOMETHING"]) {
      expect(groupOf(name, false), name).toBe("Support groups");
    }
  });

  // The rule beats isFolder, because the two answer different questions and only one of them
  // is about naming. CS-LOG-ZEN-ECOM is a folder in the captures AND a support group; calling
  // it a business unit would be the app overruling the tenant on the tenant's own vocabulary.
  it("beats isFolder — a support group that nests things is still a support group", () => {
    expect(groupOf("CS-LOG-ZEN-ECOM", true)).toBe("Support groups");
    expect(groupOf("VALUE-CHAIN", true)).toBe("Business units");
  });

  // The two ways a two-letter prefix misfires, both taken from real names.
  it("matches the first segment, not a bare prefix and not a substring", () => {
    // CENTRAL-OPS starts with the letters CE and is not a support group.
    expect(groupOf("CENTRAL-OPS", true)).toBe("Business units");
    // owner-CE-INDUS-SUPPLY-cloud is a captured name with CE in the middle.
    expect(groupOf("owner-CE-INDUS-SUPPLY-cloud", false)).toBe("Projects");
  });

  it("names support groups even on a register that records no folders at all", () => {
    // The folder half of the grouping is gated on isFolder having been recorded for someone;
    // this half is not, because it needs nothing from Wiz to be true.
    const legacy = [
      { id: "p-a", name: "CS-LOG-ZEN-ECOM", assets: 3 },
      { id: "p-b", name: "ALPHA", assets: 4 },
    ];
    const v = projectScopeView(boot({ projectView: "", shown: 7, register: 7 }, legacy));
    const groups = v.options.map((o) => o.group);
    expect(groups).toContain("Support groups");
    // …and still claims nothing about which of the rest are folders.
    expect(groups).toContain("");
    expect(groups).not.toContain("Business units");
  });

  // Headings are emitted when the group changes while walking the list in order, so a list
  // that did not sort by kind would print "Support groups" twice.
  it("keeps each kind contiguous, widest first", () => {
    const mixed = [
      { id: "p-1", name: "CS-ONE", isFolder: false, assets: 1 },
      { id: "p-2", name: "VALUE-CHAIN", isFolder: true, assets: 2 },
      { id: "p-3", name: "GITHUB-DKTUNITED", isFolder: false, assets: 3 },
      { id: "p-4", name: "CE-TWO", isFolder: true, assets: 4 },
    ];
    const groups = projectScopeView(boot({ projectView: "", shown: 10, register: 10 }, mixed))
      .options.map((o) => o.group);
    expect(groups).toEqual([
      "Business units", "Support groups", "Support groups", "Projects",
    ]);
  });
});

describe("projectScopeView, scoped by domain", () => {
  const withDomains = (scope) => boot({ ...scope, domainCoverage: COVER }, LIST, DOMAINS);

  it("offers domains as their own group, never nested under a project", () => {
    const v = projectScopeView(withDomains({ projectView: "", shown: 826, register: 826 }));
    const domainRows = v.options.filter((o) => o.group === "Domains");
    expect(domainRows.map((o) => o.label)).toEqual(["CROSS", "SAP"]);
    // Prefixed, so a project whose id is "SAP" and the domain "SAP" can never be one row.
    expect(domainRows.map((o) => o.value)).toEqual(["d:CROSS", "d:SAP"]);
    // …and the projects are still all there, in their own groups, unmoved.
    expect(v.options.filter((o) => o.group !== "Domains").map((o) => o.value))
      .toEqual(["p-unit", "p-a", "p-b"]);
  });

  // THE CAPTION'S SECOND FIGURE IS THE HONEST ONE. Only 15 of 87 assets carry the tag, so
  // "5 of 87" alone tells a reader the other 82 are in some other domain, when the truth is
  // that nobody said. This is the same distinction domainCoverage exists to publish.
  it("separates 'in another domain' from 'carries no domain'", () => {
    const v = projectScopeView(withDomains({ domainView: "SAP", shown: 5, register: 87 }));
    expect(v.kind).toBe("domain");
    expect(v.label).toBe("SAP");
    expect(v.caption).toBe("5 of 87 assets · 72 carry no domain");
  });

  it("keeps the project caption exactly as it was", () => {
    const v = projectScopeView(withDomains({ projectView: "p-a", shown: 12, register: 826 }));
    expect(v.kind).toBe("project");
    expect(v.caption).toBe("12 of 826 assets");
  });

  // An empty picker is a promise the register cannot keep. AI_ASSET_PROPERTIES is optional
  // and swallows an HTTP 400, so a tenant that rejected it has no domain data at all — and a
  // "Domains" heading over nothing would say nobody owns anything, which is a claim about
  // the tenant rather than about what we managed to ask.
  it("offers no Domains group at all when nothing is tagged", () => {
    const none = boot(
      { projectView: "", shown: 826, register: 826, domainCoverage: { key: "Wiz/Domain", tagged: 0, total: 826 } },
      LIST, [],
    );
    expect(projectScopeView(none).options.some((o) => o.group === "Domains")).toBe(false);
  });

  it("says a stale domain is stale instead of showing a bare zero", () => {
    const v = projectScopeView(withDomains({ domainView: "GONE", shown: 0, register: 87 }));
    expect(v.stale).toBe(true);
    expect(v.label).toBe("a domain this register does not hold");
    expect(v.caption).toContain("Not in this register");
    // Every real domain stays on offer, so the state is escapable.
    expect(v.options.filter((o) => o.group === "Domains")).toHaveLength(2);
  });

  it("names glyphs the icon set draws, for domain rows too", () => {
    const v = projectScopeView(withDomains({ projectView: "", shown: 826, register: 826 }));
    for (const o of [...v.pinned, ...v.options]) {
      expect(UI_ICON_NAMES, o.label + " asks for " + o.icon).toContain(o.icon);
    }
  });
});

describe("trendScopeView", () => {
  // A DOMAIN VIEW IS NOT A SHORT SERIES, IT IS NO SERIES. sync_history records per-project
  // totals beside its register-wide ones and has no per-domain column, and one cannot be
  // backfilled because the ledger never held the dimension. Without this branch the note
  // would be silent and the chart would sit under a header naming a domain while charting
  // the register — the failure the "never silence" rule beside registerWideNote exists for.
  it("says the series is the register's when the scope is a domain", () => {
    const v = trendScopeView({ domainId: "SAP", scoped: false, points: 0, registerPoints: 40 });
    expect(v.show).toBe(true);
    expect(v.live).toBe(false);
    expect(v.tag).toBe("Whole register");
    expect(v.text).toContain("recorded per project");
    expect(v.text).toContain("never held the dimension");
  });

  it("stays silent when there is no scope at all", () => {
    // Unscoped there is nothing to disambiguate, and a permanent badge is noise.
    expect(trendScopeView({ domainId: "", scoped: false, points: 0, registerPoints: 40 }).show)
      .toBe(false);
  });

  it("says nothing when no project is in view", () => {
    expect(trendScopeView(null).show).toBe(false);
    expect(trendScopeView(trendScope({ scoped: false, projectId: "" })).show).toBe(false);
  });

  it("names the coverage when the series is shorter than the ledger", () => {
    const v = trendScopeView(trendScope());
    expect(v.show).toBe(true);
    expect(v.live).toBe(true);
    expect(v.tag).toBe("This project");
    expect(v.text).toContain("3 of the 40");
    // The earlier points are not coming: the ledger never held the dimension, so the note
    // must not imply a later sync will fill them in.
    expect(v.text).toContain("register-wide totals only");
  });

  it("drops the coverage clause once the series covers the whole ledger", () => {
    const v = trendScopeView(trendScope({ points: 40 }));
    expect(v.live).toBe(true);
    expect(v.text).not.toContain(" of the ");
    expect(v.text).toContain("Every recorded sync");
  });

  it("does not claim to show the project when it has no points at all", () => {
    // The chart is EMPTY here. "This project" would label a series that is not on screen, and
    // "Whole register" would label one that is not on screen either.
    const v = trendScopeView(trendScope({ points: 0 }));
    expect(v.tag).toBe("Not yet recorded");
    expect(v.live).toBe(false);
    expect(v.text).toContain("next sync");
    expect(v.text).toContain("cannot be broken down after the fact");
  });

  it("does not blame history that does not exist yet", () => {
    // A brand-new ledger: no points for this project because there are no syncs at all, not
    // because the syncs predate the column. Saying "0 recorded syncs hold register-wide
    // totals only" would be a sentence about nothing.
    const v = trendScopeView(trendScope({ points: 0, registerPoints: 0 }));
    expect(v.text).toBe("Per-project totals start with the first sync.");
  });

  it("treats a series longer than the register as covered, not as a contradiction", () => {
    // Cannot happen from the server, which counts both off one history read — but a stale SWR
    // payload can pair a new series with an old count, and the honest answer to "4 of 3" is
    // not to print it.
    expect(trendScopeView(trendScope({ points: 4, registerPoints: 3 })).text)
      .toContain("Every recorded sync");
  });
});
