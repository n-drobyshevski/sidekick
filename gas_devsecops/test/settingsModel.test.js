// The settings draft: what the save bar says, which tab wears the dirty dot, and the three
// consequences worth stopping a reader for.
//
// The warnings are the part that matters. Each one is grounded in something this register
// measured or decided, and each describes an edit that is LEGAL — the server will take it —
// and almost always a mistake.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAB, SETTINGS_TABS, SETTING_FIELDS, changeCountText, changeSummary, changedFields,
  draftWarnings, dirtyTabs, normalizeTab, settingsDraft, settingsPatch, validateDraft,
} from "../src/client/js/settingsModel.js";
import { SCOPES, SCOPE_LABELS, SEVERITY_ORDER, SLA_TARGETS } from "../src/domain/config";

/** What api_bootstrap ships, which is where the page gets these rather than duplicating them. */
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

describe("what the save bar says", () => {
  it("counts nothing when nothing moved", () => {
    const changed = changedFields(settingsDraft(settings, ctx), settingsDraft(settings, ctx));
    expect(changed).toEqual([]);
    expect(changeCountText(changed)).toBe("0 unsaved changes");
  });

  it("does not call a reordering an edit", () => {
    // Re-picking the same severities in another order is not a change, and treating it as one
    // would arm the save bar over a no-op.
    const a = settingsDraft(settings, ctx);
    const b = settingsDraft(settings, ctx);
    b.fetchSeverities.sca = ["HIGH", "CRITICAL"];
    expect(changedFields(a, b)).toEqual([]);
  });

  it("names the tab that owns each change, so a hidden control is findable", () => {
    const saved = settingsDraft(settings, ctx);
    const draft = draftOf({ slaTargets: { ...saved.slaTargets, HIGH: 21 }, scopes: ["sca"] });
    const changed = changedFields(saved, draft);
    expect(changed.sort()).toEqual(["scopes", "slaTargets"]);
    expect(changeCountText(changed)).toBe("2 unsaved changes");
    expect(changeSummary(changed).map((c) => c.tab).sort()).toEqual(["deadlines", "register"]);
    expect(dirtyTabs(changed)).toEqual(["register", "deadlines"]); // tablist order
  });

  it("sends only the fields that moved", () => {
    const saved = settingsDraft(settings, ctx);
    const draft = draftOf({ scopes: ["sca", "sast"] });
    expect(Object.keys(settingsPatch(saved, draft))).toEqual(["scopes"]);
  });

  it("puts every batched field on a real tab", () => {
    // The bar names the owning tab and the tablist wears the dot; both read SETTING_FIELDS, so
    // a field pointing at a tab that does not exist would be listed nowhere.
    const keys = SETTINGS_TABS.map((t) => t.key);
    for (const f of Object.values(SETTING_FIELDS)) expect(keys).toContain(f.tab);
  });

  it("owns nothing on System, which is why that tab never goes dirty", () => {
    expect(Object.values(SETTING_FIELDS).some((f) => f.tab === "system")).toBe(false);
    expect(Object.values(SETTING_FIELDS).some((f) => f.tab === "access")).toBe(false);
  });
});

describe("the tab in the hash", () => {
  it("falls back when Access is not drawn for this reader", () => {
    // renderAccessPanel answers null for a non-editor, so a stale ?tab=access bookmark must
    // land somewhere real rather than selecting a tab that was never built.
    expect(normalizeTab("access", ["register", "deadlines", "system"])).toBe(DEFAULT_TAB);
    expect(normalizeTab("access", ["register", "deadlines", "access", "system"])).toBe("access");
  });

  it("falls back on junk", () => {
    expect(normalizeTab("../etc/passwd", null)).toBe(DEFAULT_TAB);
    expect(normalizeTab(undefined, null)).toBe(DEFAULT_TAB);
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
    // SLA_TARGETS is byte-identical across gas/, gas_ai/, brick/devsecops and this register on
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
