// settingsDraft / validateDraft / draftWarnings — prepared, not yet wired.
//
// This used to be 21 test cases over a settings model that was TWO models at once: a real one
// (`settingsDraft`/`validateDraft`/`draftWarnings`, over this register's real `scopes`/
// `fetchSeverities`/`slaTargets` fields) with no caller, plus the diff/dirty mechanics
// (`normalizeTab`/`changedFields`/`settingsPatch`/`changeSummary`/`changeCountText`/`dirtyTabs`)
// that `pages/settings.js` had already forked its OWN copies of. The diff mechanics are gone
// from here: they are `gas_shared/ui/settingsForm.js`'s kernel now, bound to the real six-field
// registry in `../src/client/js/settingsModel.js`, and already exercised against that live
// registry by `test/pagesSettings.test.js` (`changedFields`/`changeSummary`/`changeCountText`/
// `normalizeTab`, through the page's own re-exports) and `test/settingsLogic.test.js`
// (`tabStatus`/`TAB_FIELDS`, with two recorded perturbations) — testing them a third time here,
// against a registry this file does not itself register, would be false coverage in the other
// direction. `test/contracts/settingsForm.js` (registered from `test/shared.test.js`) covers the
// kernel's own behaviour generically, for every app that registers it.
//
// WHAT STAYS: `settingsDraft`/`validateDraft`/`draftWarnings` really are correct, real logic —
// see `../src/client/js/settingsModel.js`'s own header for why nothing has called them yet.
// `draftWarnings` in particular is scheduled to be wired into the live page in a later package,
// the same three-warnings shape gas_ai's Settings page already shows; deleting its coverage now
// would be deleting real behaviour for having no caller yet, not deleting dead code.

import { describe, expect, it } from "vitest";
import {
  SETTING_FIELDS, TAB_FIELDS, draftWarnings, settingsDraft, tabStatus, validateDraft,
} from "../src/client/js/settingsModel.js";
import { SCOPES, SCOPE_LABELS, SEVERITY_ORDER, SLA_TARGETS } from "../src/domain/config";

/** What api_bootstrap ships, which is where a future caller would get these rather than
 *  duplicating them. */
const ctx = {
  scopes: [...SCOPES],
  scopeLabels: SCOPE_LABELS,
  severityOrder: [...SEVERITY_ORDER],
  sharedSlaTargets: SLA_TARGETS,
};

const settings = {
  scopes: ["sca", "sast", "secrets"],
  fetchSeverities: { sca: ["CRITICAL", "HIGH"], sast: ["CRITICAL", "HIGH"], secrets: [] },
  slaTargets: { ...SLA_TARGETS },
};

const draftOf = (over = {}) => ({ ...settingsDraft(settings, ctx), ...over });

describe("the draft is a copy, not a view", () => {
  it("never lets an edit reach the payload the rest of the page is reading", () => {
    const d = settingsDraft(settings, ctx);
    d.scopes.push("nonsense");
    d.fetchSeverities.sca.push("LOW");
    d.slaTargets.CRITICAL = 999;
    expect(settings.scopes).toEqual(["sca", "sast", "secrets"]);
    expect(settings.fetchSeverities.sca).toEqual(["CRITICAL", "HIGH"]);
    expect(settings.slaTargets.CRITICAL).toBe(SLA_TARGETS.CRITICAL);
  });

  it("keeps an empty severity list as empty — it means EVERY severity", () => {
    // The settled answer for secrets after two wrong ones. A draft that turned [] into the
    // full list would make the first save look like a narrowing of nothing.
    expect(settingsDraft(settings, ctx).fetchSeverities.secrets).toEqual([]);
  });
});

describe("what the page refuses outright", () => {
  it("refuses collecting no register at all", () => {
    const v = validateDraft(draftOf({ scopes: [] }));
    expect(v.ok).toBe(false);
    expect(v.tab).toBe("register"); // so the caller can switch to the offending control
  });

  it("refuses a non-positive SLA window", () => {
    const v = validateDraft(draftOf({ slaTargets: { CRITICAL: 0 } }));
    expect(v.ok).toBe(false);
    expect(v.tab).toBe("deadlines");
    expect(validateDraft(draftOf({ slaTargets: { HIGH: -3 } })).ok).toBe(false);
  });

  it("accepts the shipped defaults", () => {
    expect(validateDraft(settingsDraft(settings, ctx)).ok).toBe(true);
  });
});

describe("the three consequences worth a confirm", () => {
  const saved = settingsDraft(settings, ctx);

  it("warns that dropping a register FREEZES its open findings", () => {
    // Resolution by absence needs a scan that looked. Stop scanning and nothing in that
    // register can ever close — the rows age forever inside every open count.
    const w = draftWarnings(saved, draftOf({ scopes: ["sca", "sast"] }), ctx);
    expect(w).toHaveLength(1);
    expect(w[0].tab).toBe("register");
    expect(w[0].title).toContain("Secrets");
    expect(w[0].body).toMatch(/FREEZES/);
    // Singular pronoun and singular register/verb for the one-dropped case — the P0 wave's own
    // fix made these depend on `dropped.length`, so this pins the branch that was already
    // correct against a regression that made both branches read the same.
    expect(w[0].body).toMatch(/in it FREEZES/);
    expect(w[0].body).toMatch(/register is collected again/);
  });

  it("agrees in number when TWO registers are dropped in the same save — 'them'/'registers "
    + "are', not 'it'/'register is'", () => {
    // Found while wiring draftWarnings into the live save path (P0): the body used to read "in
    // it FREEZES ... until the register is collected again" even with two registers dropped at
    // once, disagreeing with its own plural "Stop collecting two registers?" title. Three
    // registers dropped at once cannot reach here — validateDraft refuses an empty scopes list
    // before draftWarnings ever runs — so two is the only reachable plural case.
    const w = draftWarnings(saved, draftOf({ scopes: ["sca"] }), ctx);
    expect(w).toHaveLength(1);
    expect(w[0].title).toBe("Stop collecting two registers?");
    expect(w[0].body).toMatch(/in them FREEZES/);
    expect(w[0].body).not.toMatch(/in it FREEZES/);
    expect(w[0].body).toMatch(/registers are collected again/);
    expect(w[0].body).not.toMatch(/register is collected again/);
  });

  it("warns that narrowing a gate strands what is already in the ledger", () => {
    // Same guard, seen from the other side: the rule that stops an unrequested severity
    // mass-resolving also stops it ever closing.
    const draft = draftOf({
      fetchSeverities: { ...saved.fetchSeverities, sca: ["CRITICAL"] },
    });
    const w = draftWarnings(saved, draft, ctx);
    expect(w).toHaveLength(1);
    expect(w[0].title).toContain("HIGH");
    expect(w[0].title).toContain("Dependencies");
  });

  it("names the narrowing warning's two antecedents distinctly — the severities no longer "
    + "requested, and the findings that cannot resolve without them", () => {
    // Found in the same P0 wording review: the body used "them" twice in one sentence for two
    // different things (the severities being un-requested, then the findings that cannot
    // resolve) — grammatically legal, but a reader has to guess which "them" is which. Fixed to
    // name the findings explicitly, and to say "from mass-resolving" / "from ever closing"
    // rather than the bare gerunds this codebase's own prose is otherwise careful not to use.
    const draft = draftOf({
      fetchSeverities: { ...saved.fetchSeverities, sca: ["CRITICAL"] },
    });
    const w = draftWarnings(saved, draft, ctx);
    expect(w).toHaveLength(1);
    expect(w[0].body).toMatch(/resolve those findings by absence/);
    expect(w[0].body).toMatch(/stops an unrequested severity from mass-resolving/);
    expect(w[0].body).toMatch(/stops it from ever closing/);
  });

  it("treats an empty gate as WIDENING, never as narrowing to nothing", () => {
    // The inversion this guard exists to prevent: [] means every severity, so moving to it
    // strands nothing and must raise no warning at all.
    const draft = draftOf({ fetchSeverities: { ...saved.fetchSeverities, sca: [] } });
    expect(draftWarnings(saved, draft, ctx)).toEqual([]);
  });

  it("warns when a gate narrows AWAY from everything", () => {
    // The other direction of the same rule: secrets currently collects every severity, so
    // gating it to CRITICAL/HIGH strands the rest — which is exactly what §9.2 measured
    // (CERTIFICATE 0 of 160, PASSWORD 107 of 208).
    const draft = draftOf({
      fetchSeverities: { ...saved.fetchSeverities, secrets: ["CRITICAL", "HIGH"] },
    });
    const w = draftWarnings(saved, draft, ctx);
    expect(w).toHaveLength(1);
    expect(w[0].title).toContain("Secrets");
    expect(w[0].title).toMatch(/MEDIUM|LOW|INFO/);
  });

  it("warns that a changed SLA window diverges from the other three sidekicks", () => {
    // SLA_TARGETS is byte-identical across gas/, gas_ai/, brick/ and this register on
    // purpose: they measure the same estate, so the same finding must not be inside its
    // deadline on one dashboard and past it on another.
    const w = draftWarnings(saved, draftOf({
      slaTargets: { ...saved.slaTargets, CRITICAL: 30 },
    }), ctx);
    expect(w).toHaveLength(1);
    expect(w[0].tab).toBe("deadlines");
    expect(w[0].body).toContain("CRITICAL");
  });

  it("says nothing about an unchanged draft", () => {
    expect(draftWarnings(saved, settingsDraft(settings, ctx), ctx)).toEqual([]);
  });

  it("does not warn about a register that was already not collected", () => {
    const partial = settingsDraft({ ...settings, scopes: ["sca"] }, ctx);
    expect(draftWarnings(partial, { ...partial, scopes: ["sca"] }, ctx)).toEqual([]);
  });

  it("survives no context at all rather than throwing mid-save", () => {
    expect(draftWarnings(saved, draftOf({ scopes: ["sca"] }), null)).toHaveLength(1);
  });
});

// =========================================================================================
//  The registry itself: where a field lives, and which tab goes dirty when it moves
// =========================================================================================
//
// `SETTING_FIELDS` is the one registry both this module and `pages/settings.js` read (see the
// module header). `test/settingsLogic.test.js` holds the whole-map claims — every key is a real
// Settings field, every tab is a real tab, and the set matches the page's own BATCHED_KEYS. What
// is pinned here is the one field whose HOME is a judgement call rather than an obvious one.
describe("coldAfterDays lives on Deadlines", () => {
  it("is registered under the deadlines tab, with a reader-facing label", () => {
    // Deadlines, not System: it is a threshold a reader SETS, like the SLA windows beside it,
    // not a maintenance knob like the retention window. A registry entry under the wrong tab
    // is invisible in the worst way — the save bar offers "jump to" a tab the control is not on.
    expect(SETTING_FIELDS.coldAfterDays.tab).toBe("deadlines");
    expect(SETTING_FIELDS.coldAfterDays.label).toBe("cold-zone window");
  });

  it("marks ONLY Deadlines dirty when it is the one field that moved", () => {
    const saved = { slaTargets: { ...SLA_TARGETS }, coldAfterDays: 90, retentionDays: 180 };
    const draft = { ...saved, coldAfterDays: 120 };
    const status = tabStatus(draft, saved, {}, TAB_FIELDS);
    expect(status.deadlines.dirty).toBe(true);
    expect(status.system.dirty).toBe(false);
    expect(status.register.dirty).toBe(false);
    for (const tab of Object.keys(status)) expect(status[tab].invalid).toBe(false);
  });
});
