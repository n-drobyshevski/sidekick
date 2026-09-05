// What the header's scope switcher CLAIMS: its label, its caption, and whether the scope in
// force still exists.
//
// Plain .js for the reason navGroups.test.js writes out. scopeKinds.js is split so this file
// can exist — `scopeSwitchView` is DOM-free, and every honesty rule the control carries is a
// return value here rather than a pixel.
//
// THE MODULE MOVED AND NOT ONE ASSERTION DID. `scopeSwitch.js` became `scopeKinds.js` when the
// control and the assembly went to gas_shared (`ui/scopeControl.js`, `ui/scopeModel.js`); what
// is left here is this register's own vocabulary, and every claim below is about that. The
// option VALUES are byte-identical across the move — the domain is still the bare kind, the
// support group still carries `sg:` — which is the measurement that says the refactor changed
// no behaviour, not just that it compiled.
//
// The failure mode this guards is not a crash. It is a caption that reads "31 findings" and
// leaves a reader unable to tell a small support group from a small register, or one that
// silently attributes every unclaimed finding to somewhere it was never assigned.
//
// THIS FILE USED TO ASSERT A THIRD DIMENSION, and its removal is the change under test rather
// than lost coverage. `Wiz/Domain` shipped as its own "VC Domains" group beside the manual
// groups; both answered "which domain owns this", and the tag now RESOLVES into `_domain`
// (src/domain/resolveDomain.ts) instead of sitting beside it. Every claim those tests pinned
// still has a home below — a tag value is now a row in the Domains group, and the untagged
// count it used to caption is now Attribution's `bySource` — so the deletions are relocations.

import { describe, expect, it } from "vitest";

import {
  SUPPORT_GROUP_PREFIX,
  domainScopeOptions,
  scopeSwitchView,
  supportScopeOptions,
} from "../src/client/js/scopeKinds.js";
import { UI_ICON_NAMES } from "../src/client/js/uiIcons.js";

/**
 * A bootstrap payload of the shape api.ts bootstrapCore() returns.
 *
 * `domainNames` arrives RESOLVED: tag values first, then the manual groups in priority order,
 * then the two tails. `CROSS` and `SAP` are tag values here; `Customer-facing` and
 * `Data & batch` are manual groups — and the list deliberately gives no way to tell, because
 * the switcher does not offer one.
 */
function boot(over) {
  return {
    domainNames: [
      "CROSS", "SAP", "Customer-facing", "Data & batch", "Unassigned", "Not attributable",
    ],
    filterOptions: { supportGroups: ["CS-CORE", "CS-ENMS"] },
    domainTagKey: "Wiz/Domain",
    scopeCounts: {
      register: 161,
      domains: {
        CROSS: 48, SAP: 30, "Customer-facing": 41, "Data & batch": 15, Unassigned: 27,
      },
      supportGroups: { "CS-CORE": 31, "CS-ENMS": 26 },
      unassigned: 27,
      noSupportGroup: 104,
      noBizDomain: 83,
      // Over BASE ROWS, not the frame — no open finding can land there.
      baseRows: 640,
      notAttributable: 412,
    },
    ...over,
  };
}

const none = { domain: "", supportGroup: "" };

/** The same payload with nothing compacted yet — the common case on a young register. */
function unattributableNone(over) {
  const b = boot(over);
  return {
    ...b,
    domainNames: b.domainNames.filter((n) => n !== "Not attributable"),
    scopeCounts: { ...b.scopeCounts, notAttributable: 0 },
  };
}

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

  // The boundary is ONE REAL BUCKET, not one entry in the list, and this test was written the
  // other way round first. `domainNames()` always appends Unassigned, so a register with a
  // single configured group arrives here as a list of TWO — and those two are genuinely
  // different populations (what the rule claimed, and what it did not), so the switcher has
  // something to offer.
  it("hides itself when neither dimension has anything to offer", () => {
    const data = unattributableNone({
      domainNames: ["Unassigned", "Not attributable"],
      filterOptions: { supportGroups: [] },
    });
    expect(scopeSwitchView(data, none).show).toBe(false);
  });

  it("shows itself for tag values alone, with no manual groups configured", () => {
    // The tag-only register — the one the tag-first model is FOR. A switcher that listed only
    // manual groups here would offer nothing at all.
    const data = unattributableNone({
      domainNames: ["CROSS", "SAP", "Unassigned"],
      filterOptions: { supportGroups: [] },
    });
    const v = scopeSwitchView(data, none);
    expect(v.show).toBe(true);
    expect(v.options.map((o) => o.label)).toEqual(["CROSS", "SAP", "Unassigned"]);
  });

  it("shows itself for one configured group, because Unassigned is the other half of it", () => {
    const data = unattributableNone({
      domainNames: ["Everything", "Unassigned"],
      filterOptions: { supportGroups: [] },
    });
    const v = scopeSwitchView(data, none);
    expect(v.show).toBe(true);
    expect(v.options.map((o) => o.label)).toEqual(["Everything", "Unassigned"]);
  });

  it("shows itself for support groups alone, with no domains at all", () => {
    const data = unattributableNone({
      domainNames: ["Unassigned"],
      filterOptions: { supportGroups: ["CS-CORE", "CS-ENMS"] },
    });
    const v = scopeSwitchView(data, none);
    expect(v.show).toBe(true);
    expect(v.options.map((o) => o.label)).toEqual(["CS-CORE", "CS-ENMS"]);
  });
});

describe("Not attributable", () => {
  // A scope holding nothing at all is the empty promise this control refuses to make, and on a
  // register that has never compacted that is exactly what this row would be.
  it("is dropped from the list when nothing has landed there", () => {
    const v = scopeSwitchView(unattributableNone(), none);
    expect(v.options.map((o) => o.label)).not.toContain("Not attributable");
  });

  it("is offered, last, once something has", () => {
    const v = scopeSwitchView(boot(), none);
    const domains = v.options.filter((o) => o.group === "Domains").map((o) => o.label);
    expect(domains[domains.length - 1]).toBe("Not attributable");
  });

  // No open finding can land there, so a hint drawn from the frame would read "0 findings" over
  // a bucket that may hold thousands of resolved lifecycles.
  it("is measured against base rows, not the frame", () => {
    const v = scopeSwitchView(boot(), none);
    const row = v.options.find((o) => o.label === "Not attributable");
    expect(row.hint).toBe("No attribution input · 412 resolved");
  });

  it("states its own zero rather than hiding it when picked", () => {
    // An operator who picks this row and finds every open-findings page empty should read why
    // on the control they picked it from, not conclude the app is broken.
    const v = scopeSwitchView(boot(), { domain: "Not attributable" });
    expect(v.stale).toBe(false);
    expect(v.caption).toBe("0 open findings · 412 resolved with no attribution input");
  });

  // The historical charts are built from base rows, where this is a real bucket; every other
  // figure in the caption is about the live frame, where it cannot be. Saying so once, up
  // front, is what stops a reader meeting it for the first time inside an MTTR breakdown.
  it("joins the unscoped caption, and only when non-zero", () => {
    expect(scopeSwitchView(boot(), none).caption)
      .toBe("161 findings in the register · 412 resolved with no attribution input");
    expect(scopeSwitchView(unattributableNone(), none).caption)
      .toBe("161 findings in the register");
  });
});

describe("the list", () => {
  const v = scopeSwitchView(boot(), none);

  // Sorted by kind so the combobox emits each heading once — it walks the list in order and
  // starts a new heading whenever the group changes, so a list that did not sort by kind would
  // fragment its own headings.
  it("groups the two dimensions under their own headings, in a fixed order", () => {
    expect(v.options.map((o) => o.group)).toEqual([
      "Domains", "Domains", "Domains", "Domains", "Domains", "Domains",
      "Support groups", "Support groups",
    ]);
  });

  // ONE LIST, TWO MECHANISMS, AND THE ROW DOES NOT SAY WHICH. A name may be a tag value or a
  // manual group; the resolved domain is one answer either way, and splitting the heading would
  // ask the reader to know which mechanism claimed a bucket before they can pick it.
  it("lists tag values and manual groups under one heading, indistinguishably", () => {
    // `CROSS` is a Wiz/Domain tag value and `Customer-facing` a manual group. Same heading,
    // same mark, same wording — only the count differs.
    const row = (label) => v.options.find((o) => o.label === label);
    expect(row("CROSS").hint).toBe("Domain · 48 findings");
    expect(row("Customer-facing").hint).toBe("Domain · 41 findings");
    expect(row("CROSS").icon).toBe(row("Customer-facing").icon);
    expect(row("CROSS").value).toBe("CROSS"); // no prefix on either
    expect(row("Customer-facing").value).toBe("Customer-facing");
  });

  // A domain named `Payments` and a support group named `Payments` must never be one row or one
  // value. The control strips the prefix again on pick.
  it("prefixes the support group so the values can never collide", () => {
    const collide = unattributableNone({
      domainNames: ["Payments", "Unassigned"],
      filterOptions: { supportGroups: ["Payments"] },
    });
    const values = scopeSwitchView(collide, none).options.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("Payments");
    expect(values).toContain(SUPPORT_GROUP_PREFIX + "Payments");
  });

  it("says in words which kind each row is, and how much it covers", () => {
    expect(v.options[0].hint).toBe("Domain · 48 findings");
    expect(v.options[6].hint).toBe("Support group · 31 findings");
  });

  // Unassigned is a real, selectable bucket — it is the queue nobody has claimed — but calling
  // it a domain would be wrong: it is the absence of one, and now the absence of BOTH
  // mechanisms rather than of a rule.
  it("names Unassigned for what it is", () => {
    const row = v.options.find((o) => o.label === "Unassigned");
    expect(row.hint).toBe("No domain · 27 findings");
  });

  // The row means "no scope", so naming it after one of the kinds describes half of what it
  // does — and the register holds what the last scan was scoped to fetch, so "everything"
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

  // The two tails are the absence of a domain, not a domain — same dimension, no value — so
  // they carry the struck-through mark rather than the tag.
  it("marks the two tails apart from the domains they sit under", () => {
    const mark = (label) => v.options.find((o) => o.label === label).icon;
    expect(mark("CROSS")).toBe("tag");
    expect(mark("Unassigned")).toBe("noTag");
    expect(mark("Not attributable")).toBe("noTag");
  });

  it("counts a row the register has no tally for as zero rather than throwing", () => {
    const data = boot({ scopeCounts: { ...boot().scopeCounts, domains: {} } });
    expect(scopeSwitchView(data, none).options[0].hint).toBe("Domain · 0 findings");
  });

  it("says finding, not findings, for one", () => {
    const data = boot({ scopeCounts: { ...boot().scopeCounts, domains: { CROSS: 1 } } });
    expect(scopeSwitchView(data, none).options[0].hint).toBe("Domain · 1 finding");
  });
});

describe("the caption", () => {
  it("names the register when nothing is scoped", () => {
    const v = scopeSwitchView(unattributableNone(), none);
    expect(v.caption).toBe("161 findings in the register");
    expect(v.label).toBe("the whole register");
    expect(v.current).toBe("");
    expect(v.kind).toBe("");
  });

  // THE DENOMINATOR TRAVELS WITH THE NUMBER: "41" alone cannot tell a small domain from a
  // small register, and those two call for opposite reactions.
  //
  // AND A SCOPED CAPTION CARRIES A SECOND FIGURE. Without it, "41 of 161" quietly attributes
  // the other 120 to some other domain, when for 27 of them the truth is that neither the tag
  // nor a rule claimed them at all.
  it("carries the denominator and the unassigned tail under a domain", () => {
    const v = scopeSwitchView(boot(), { domain: "Customer-facing" });
    expect(v.caption).toBe("41 of 161 findings · 27 unassigned");
    expect(v.kind).toBe("domain");
    expect(v.current).toBe("Customer-facing");
    expect(v.label).toBe("Customer-facing");
  });

  it("captions a tag-derived domain exactly as a manual group, because it is one field", () => {
    const v = scopeSwitchView(boot(), { domain: "CROSS" });
    expect(v.caption).toBe("48 of 161 findings · 27 unassigned");
    expect(v.kind).toBe("domain");
    expect(v.current).toBe("CROSS");
  });

  it("carries the denominator and the ungrouped tail under a support group", () => {
    const v = scopeSwitchView(boot(), { supportGroup: "CS-CORE" });
    expect(v.caption).toBe("31 of 161 findings · 104 carry no support group");
    // WAS `"support"`, AND THE CHANGE IS THE POINT. The deleted scopeSwitch.js spelled this
    // ONE dimension three ways: the view said `kind: "support"` (so `SCOPE_KIND_ICON` could
    // look up its glyph), `onPick` said `kind: "supportGroup"` (the field app.js sets), and the
    // option value said `sg:`. Two of the three were internal aliases nothing outside the file
    // could reconcile — a caller reading `view.kind` and writing it back was simply wrong.
    // gas_shared/ui/scopeModel.js gives a kind ONE key and hangs the glyph off the kind itself,
    // so the lookup table and its third spelling are gone. This is the wire name, which is the
    // one that was already load-bearing.
    expect(v.kind).toBe("supportGroup");
    // Unchanged, and that is the measurement: the encoded value a stored scope is written in
    // survived the move to the shared model byte for byte.
    expect(v.current).toBe(SUPPORT_GROUP_PREFIX + "CS-CORE");
  });

  // The second figure would be the first one again — these ARE the unassigned findings — and a
  // caption that says the same number twice reads as a bug.
  it("does not restate the count under Unassigned", () => {
    const v = scopeSwitchView(boot(), { domain: "Unassigned" });
    expect(v.caption).toBe("27 of 161 findings · claimed by no tag and no rule");
  });
});

describe("a scope the register no longer holds", () => {
  // A manual group deleted from Settings, a support group that fell out after a scan scoped
  // elsewhere, or a tag value that vanished when WIZ_DOMAIN_TAG_KEY was corrected under it.
  // The control keeps it in force and says so, rather than silently widening back to the
  // register — a silent reset looks exactly like never having scoped at all.
  it("says so, in words, with the count it is actually showing", () => {
    const v = scopeSwitchView(boot(), { domain: "Deleted group" });
    expect(v.stale).toBe(true);
    expect(v.caption).toBe("Not in this register — showing 0 of 161");
    expect(v.label).toBe("Deleted group — not in this register");
  });

  it("catches a stale support group the same way", () => {
    const v = scopeSwitchView(boot(), { supportGroup: "CS-GONE" });
    expect(v.stale).toBe(true);
    expect(v.current).toBe(SUPPORT_GROUP_PREFIX + "CS-GONE");
  });

  // A tag value has its own way of going stale that a manual group does not: correcting
  // WIZ_DOMAIN_TAG_KEY re-reads every row off a different tag, and the domain in force may
  // simply not exist under the new key.
  it("catches a tag value that vanished when the tag key changed", () => {
    const v = scopeSwitchView(boot(), { domain: "GONE" });
    expect(v.stale).toBe(true);
    expect(v.current).toBe("GONE");
    expect(v.caption).toBe("Not in this register — showing 0 of 161");
  });

  // The row is dropped from the list when empty, so a scope naming it has to read as stale
  // rather than as a live scope over nothing.
  it("calls a Not attributable scope stale on a register that has never compacted", () => {
    expect(scopeSwitchView(unattributableNone(), { domain: "Not attributable" }).stale).toBe(true);
  });

  it("calls a live scope fresh", () => {
    expect(scopeSwitchView(boot(), { domain: "Data & batch" }).stale).toBe(false);
    expect(scopeSwitchView(boot(), { domain: "SAP" }).stale).toBe(false);
    expect(scopeSwitchView(boot(), none).stale).toBe(false);
  });
});

describe("the row builders", () => {
  it("tolerate an absent list and an absent tally", () => {
    expect(domainScopeOptions(null, null, 0)).toEqual([]);
    expect(supportScopeOptions(undefined, undefined)).toEqual([]);
  });

  // An untagged resource contributes nothing to a facet, exactly as a blank cloud already does.
  // A synthetic "Untagged" row would offer the resources we know least about as though they
  // were an owner — the coverage figures answer that instead, and `Unassigned` is a different
  // claim (neither mechanism claimed the row) that the resolver puts there deliberately.
  it("offer no synthetic Untagged row", () => {
    const labels = domainScopeOptions(["CROSS", "SAP"], { CROSS: 1, SAP: 2 }, 0)
      .map((o) => o.label);
    expect(labels).toEqual(["CROSS", "SAP"]);
  });
});

// ---------------------------------------------------------- the ledger's Unassigned
//
// THE BUG THIS PINS, in the words of the operator who hit it: "I recovered domain attribution
// and the scope picker shows 0 unattributed findings, but the MTTR breakdown still has an
// Unassigned bar." Both were telling the truth about different populations. The switcher
// counted the CURRENT SCAN, where the fix had landed; the by-domain split counts every
// lifecycle the register holds, including resolved history whose stored tag snapshot predates
// the rollout and which Wiz no longer re-lists. Nothing on screen reconciled the two.
//
// The frame count is left alone — it answers a real question — and the ledger figure now
// travels beside it, exactly as `notAttributable` already did for the other tail.

const withBase = (unassigned, unassignedBase) =>
  boot({ scopeCounts: { ...boot().scopeCounts, unassigned, domains: {
    ...boot().scopeCounts.domains, Unassigned: unassigned,
  }, unassignedBase } });

describe("scopeSwitchView — Unassigned over the ledger, not just the frame", () => {
  it("says so on the unscoped caption when history holds more than the frame", () => {
    const v = scopeSwitchView(withBase(0, 37), {});
    expect(v.caption).toContain("37 claimed by no tag or rule, including history");
  });

  it("stays quiet when the ledger agrees with the frame", () => {
    // Repeating the frame number in different words is not information; it reads as a bug and
    // sends the reader looking for a difference that is not there.
    const v = scopeSwitchView(withBase(27, 27), {});
    expect(v.caption).not.toContain("including history");
  });

  it("stays quiet when nothing is unassigned anywhere", () => {
    expect(scopeSwitchView(withBase(0, 0), {}).caption).not.toContain("including history");
  });

  it("offers the scope honestly instead of advertising an empty one", () => {
    // The exact reported case: the frame is clean, the ledger is not. A hint reading
    // "No domain · 0 findings" over a bucket the MTTR page draws a bar for is the lie.
    const v = scopeSwitchView(withBase(0, 37), {});
    const opt = v.options.find((o) => o.value === "Unassigned");
    expect(opt.hint).toBe("No domain · none open · 37 in history");
  });

  it("keeps the plain hint once the frame carries some too", () => {
    const v = scopeSwitchView(withBase(27, 37), {});
    expect(v.options.find((o) => o.value === "Unassigned").hint).toBe("No domain · 27 findings");
  });

  it("carries the ledger figure into the scoped caption", () => {
    const v = scopeSwitchView(withBase(0, 37), { domain: "Unassigned" });
    expect(v.caption).toContain("claimed by no tag and no rule");
    expect(v.caption).toContain("37 across all history");
  });

  it("does not restate the figure when the scope and the ledger agree", () => {
    const v = scopeSwitchView(withBase(27, 27), { domain: "Unassigned" });
    expect(v.caption).not.toContain("across all history");
  });
});
