// The app-header project switcher (P5) — the pure half (`projectScopeView`, `scopeOptions`,
// `isSupportGroup`) is DOM-free and tested directly; the DOM half (`projectScopeControl`,
// `app.js`'s wiring) is read as source text, the same split test/pagesSettings.test.js and
// test/shared.test.js already use in this repo (vitest.config.ts sets no `environment`, so
// there is no jsdom to boot a real combobox in).
//
// NO DOMAINS HERE. `gas_ai/src/client/js/ui/projectScope.js` fronts a second switcher axis
// (`Wiz/Domain`) this register does not have — `domain/maintenance.ts:256` says the tag never
// existed for source-repo findings — so every assertion below is single-axis: a bare slug, no
// `d:` prefix, no domain-coverage clause. The unattributed clause is what replaces it, for the
// analogous reason: scoped, "N of M findings" alone silently attributes the OTHER rows to some
// project, when some of them may carry none at all.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SUPPORT_GROUP_PREFIXES, isSupportGroup, projectKind, projectScopeView, scopeOptions,
} from "../src/client/js/ui/projectScope.js";
import { UI_ICON_NAMES } from "../../gas_shared/ui/uiIcons.js";

const SRC = readFileSync(new URL("../src/client/js/ui/projectScope.js", import.meta.url), "utf8");
const APP_SRC = readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8");
const UI_SRC = readFileSync(new URL("../src/client/js/ui.js", import.meta.url), "utf8");
const SHARED_UI_SRC = readFileSync(
  new URL("../../gas_shared/ui/index.js", import.meta.url), "utf8",
);

// =========================================================================================
//  isSupportGroup / SUPPORT_GROUP_PREFIXES — the first-segment rule
// =========================================================================================

describe("isSupportGroup matches the FIRST NAME SEGMENT, never a bare prefix or substring", () => {
  it("SUPPORT_GROUP_PREFIXES is exactly CS, CE, LU", () => {
    expect(SUPPORT_GROUP_PREFIXES).toEqual(["CS", "CE", "LU"]);
  });

  it("accepts CE-TRANSPORT — the prefix as the whole first segment", () => {
    expect(isSupportGroup("CE-TRANSPORT")).toBe(true);
  });

  it("accepts every declared prefix as a first segment", () => {
    expect(isSupportGroup("CS-LOG-ZEN-ECOM")).toBe(true);
    expect(isSupportGroup("LU-OPS")).toBe(true);
  });

  it("rejects CENTRAL-OPS — startsWith('CE') would wrongly match this", () => {
    expect(isSupportGroup("CENTRAL-OPS")).toBe(false);
  });

  it("rejects owner-CE-INDUS-cloud — includes('CE') would wrongly match this", () => {
    expect(isSupportGroup("owner-CE-INDUS-cloud")).toBe(false);
  });

  it("is case-insensitive on the segment itself", () => {
    expect(isSupportGroup("ce-transport")).toBe(true);
  });

  it("null/undefined/blank all read as false, never throw", () => {
    expect(isSupportGroup(null)).toBe(false);
    expect(isSupportGroup(undefined)).toBe(false);
    expect(isSupportGroup("")).toBe(false);
  });

  // PERTURBATION (recorded, then reverted): swapping the first-segment split for a bare
  // `.startsWith("CE")` check turned the CENTRAL-OPS rejection test above red (CENTRAL-OPS
  // starts with "CE") while every other test in this block stayed green — including the
  // owner-CE-INDUS-cloud rejection, which a `.startsWith` check happens to still get right.
  // Swapping instead for `.includes("CE")` turned BOTH the CENTRAL-OPS and the
  // owner-CE-INDUS-cloud rejections red, while the acceptance tests stayed green. Reverted
  // after confirming both failure modes actually fire.
});

// =========================================================================================
//  projectKind — the name rule beats isFolder
// =========================================================================================

describe("projectKind: the name rule wins over isFolder", () => {
  it("a folder named CS-… is a support group, not a business unit", () => {
    expect(projectKind({ name: "CS-LOG-ZEN-ECOM", isFolder: true })).toBe("support");
  });

  it("isFolder: true (and not a support name) is a business unit", () => {
    expect(projectKind({ name: "VALUE-CHAIN", isFolder: true })).toBe("unit");
  });

  it("isFolder: false (and not a support name) is a project (leaf)", () => {
    expect(projectKind({ name: "product-tattoo-idp", isFolder: false })).toBe("project");
  });

  it("isFolder: undefined (and not a support name) is unknown — never coerced to leaf", () => {
    expect(projectKind({ name: "GITHUB-DKTUNITED" })).toBe("unknown");
  });
});

// =========================================================================================
//  scopeOptions — the anyRecorded gate, grouping, ordering, icons
// =========================================================================================

const P_UNIT = { slug: "value-chain", name: "VALUE-CHAIN", isFolder: true, findings: 826 };
const P_LEAF = { slug: "product-tattoo-idp", name: "product-tattoo-idp", isFolder: false, findings: 40 };
const P_SUPPORT = { slug: "ce-transport", name: "CE-TRANSPORT", isFolder: true, findings: 12 };
const P_UNKNOWN = { slug: "github-dktunited", name: "GITHUB-DKTUNITED", findings: 5 }; // no isFolder at all

describe("scopeOptions: the anyRecorded gate", () => {
  it("isFolder: undefined across the WHOLE list claims no folder group at all — flat, not "
    + "asserted as leaves", () => {
    const rows = scopeOptions([P_UNKNOWN, { ...P_UNKNOWN, slug: "b", name: "OTHER-THING" }]);
    for (const r of rows) expect(r.group).toBe("");
  });

  it("support groups still group even when NOTHING in the register has recorded isFolder", () => {
    // Neither row here carries isFolder at all, so anyRecorded is false for this list —
    // unlike P_SUPPORT above, which sets isFolder: true and would trip the gate on its own.
    const supportNoFlag = { slug: "ce-transport", name: "CE-TRANSPORT", findings: 12 };
    const rows = scopeOptions([supportNoFlag, P_UNKNOWN]);
    const support = rows.find((r) => r.value === "ce-transport");
    expect(support.group).toBe("Support groups");
    const unknown = rows.find((r) => r.value === "github-dktunited");
    expect(unknown.group).toBe(""); // still flat: nobody recorded isFolder
  });

  it("once ANY row has recorded isFolder, the folder groups appear for the rows that have it", () => {
    const rows = scopeOptions([P_UNIT, P_LEAF, P_UNKNOWN]);
    expect(rows.find((r) => r.value === "value-chain").group).toBe("Business units");
    expect(rows.find((r) => r.value === "product-tattoo-idp").group).toBe("Projects");
    // unknown still gets its own bucket rather than being folded into Projects or Business units
    expect(rows.find((r) => r.value === "github-dktunited").group).toBe("Not yet recorded");
  });
});

describe("scopeOptions: ordering emits each heading once", () => {
  it("sorts units, then support groups, then projects, then unknowns — never interleaved", () => {
    const rows = scopeOptions([P_LEAF, P_SUPPORT, P_UNKNOWN, P_UNIT]);
    const seenGroups = [];
    for (const r of rows) {
      if (r.group && seenGroups[seenGroups.length - 1] !== r.group) seenGroups.push(r.group);
    }
    // Every group name appears exactly once in the walk order — a fragmented heading would
    // show the same name twice, non-adjacently.
    expect(new Set(seenGroups).size).toBe(seenGroups.length);
    expect(seenGroups).toEqual(["Business units", "Support groups", "Projects", "Not yet recorded"]);
  });

  it("is stable within a kind (keeps the server's incoming order for ties)", () => {
    const a = { slug: "a", name: "A-PROJECT", isFolder: false, findings: 1 };
    const b = { slug: "b", name: "B-PROJECT", isFolder: false, findings: 1 };
    expect(scopeOptions([b, a]).map((r) => r.value)).toEqual(["b", "a"]);
  });

  it("a folder named CS-… sorts as a support group, not with the business units", () => {
    const rows = scopeOptions([P_UNIT, P_SUPPORT]);
    expect(rows.map((r) => r.value)).toEqual(["value-chain", "ce-transport"]);
  });
});

describe("scopeOptions: hints declare folder-ness in words, and the icon is decoration only", () => {
  it("a business unit's hint names the kind and the finding count", () => {
    const row = scopeOptions([P_UNIT])[0];
    expect(row.hint).toBe("Business unit · 826 findings");
  });

  it("a support group's hint names the kind and the finding count", () => {
    const row = scopeOptions([P_SUPPORT])[0];
    expect(row.hint).toBe("Support group · 12 findings");
  });

  it("a leaf project's hint is just the finding count, no kind prefix", () => {
    const row = scopeOptions([P_LEAF])[0];
    expect(row.hint).toBe("40 findings");
  });

  it("singular finding count is grammatical", () => {
    const row = scopeOptions([{ ...P_LEAF, findings: 1 }])[0];
    expect(row.hint).toBe("1 finding");
  });

  it("units and support groups draw the two-folder glyph; leaves and unknowns draw one", () => {
    const rows = scopeOptions([P_UNIT, P_SUPPORT, P_LEAF, P_UNKNOWN]);
    expect(rows.find((r) => r.value === "value-chain").icon).toBe("folders");
    expect(rows.find((r) => r.value === "ce-transport").icon).toBe("folders");
    expect(rows.find((r) => r.value === "product-tattoo-idp").icon).toBe("folder");
    expect(rows.find((r) => r.value === "github-dktunited").icon).toBe("folder");
  });
});

// =========================================================================================
//  Every icon name this module reaches for is real
// =========================================================================================

describe("every uiIcon name projectScope.js uses resolves in UI_ICON_NAMES", () => {
  it("found the real icon set", () => {
    expect(UI_ICON_NAMES.length).toBeGreaterThan(5);
  });

  it("scopeOptions never emits an icon name outside UI_ICON_NAMES", () => {
    const rows = scopeOptions([P_UNIT, P_LEAF, P_SUPPORT, P_UNKNOWN]);
    for (const r of rows) expect(UI_ICON_NAMES).toContain(r.icon);
  });

  it("the pinned reset row's icon (folders) and every literal uiIcon(...) call in the source "
    + "name a real icon", () => {
    expect(UI_ICON_NAMES).toContain("folders");
    expect(UI_ICON_NAMES).toContain("folder");
    for (const m of SRC.matchAll(/uiIcon\(([a-zA-Z0-9_.]+)/g)) {
      // Skip the one call whose argument is a variable (v.current ? "folder" : "folders"),
      // already covered by the two literal names checked above.
      if (!/^"/.test(m[1])) continue;
      const name = m[1].slice(1, -1);
      expect(UI_ICON_NAMES).toContain(name);
    }
  });
});

// =========================================================================================
//  projectScopeView — show:false, wording, denominator, unattributed clause, staleness
// =========================================================================================

const PROJECT_LIST = [P_UNIT, P_LEAF, P_SUPPORT];

function boot(scopeOverrides, listOverride) {
  return {
    filterOptions: { projectList: listOverride === undefined ? PROJECT_LIST : listOverride },
    scope: {
      projectView: "",
      shown: 878,
      register: 878,
      unattributed: 0,
      syncProjectId: null,
      ...scopeOverrides,
    },
  };
}

describe("projectScopeView: show:false when there is nothing truthful to offer", () => {
  it("no bootstrap payload at all", () => {
    expect(projectScopeView(null).show).toBe(false);
  });

  it("no scope block", () => {
    expect(projectScopeView({ filterOptions: { projectList: PROJECT_LIST } }).show).toBe(false);
  });

  it("an empty projectList, even with a real scope block", () => {
    const v = projectScopeView(boot({}, []));
    expect(v.show).toBe(false);
    expect(v.options).toEqual([]);
    expect(v.pinned).toEqual([]);
  });
});

describe("projectScopeView: the 'Everything synced' resting state", () => {
  it("labels the reset state 'everything synced', not 'All projects'", () => {
    const v = projectScopeView(boot({}));
    expect(v.show).toBe(true);
    expect(v.current).toBe("");
    expect(v.label).toBe("everything synced");
  });

  it("the pinned row reads 'Everything synced' with an 'N findings' hint", () => {
    const v = projectScopeView(boot({ register: 1204 }));
    expect(v.pinned).toEqual([
      { value: "", label: "Everything synced", hint: "1,204 findings", icon: "folders" },
    ]);
  });

  it("never calls it 'All projects' anywhere in the pinned row or the caption", () => {
    const v = projectScopeView(boot({ register: 1204 }));
    expect(v.pinned[0].label).not.toMatch(/all projects/i);
    expect(v.caption).not.toMatch(/all projects/i);
  });
});

describe("projectScopeView: the denominator always travels beside the number", () => {
  it("unscoped: the register's own total, synced", () => {
    const v = projectScopeView(boot({ register: 1204, shown: 1204 }));
    expect(v.caption).toBe("1,204 findings synced");
  });

  it("scoped: N of M findings, exactly the quoted example shape", () => {
    const v = projectScopeView(boot({ projectView: "product-tattoo-idp", shown: 12, register: 1204 }));
    expect(v.caption).toBe("12 of 1,204 findings");
  });

  it("a bare count never appears without its register-wide denominator", () => {
    const v = projectScopeView(boot({ projectView: "product-tattoo-idp", shown: 12, register: 1204 }));
    expect(v.caption).toMatch(/12 of 1,204/);
  });
});

describe("projectScopeView: the unattributed clause", () => {
  it("is absent when unattributed is 0", () => {
    const v = projectScopeView(boot({ projectView: "product-tattoo-idp", shown: 12, register: 1204, unattributed: 0 }));
    expect(v.caption).not.toMatch(/have no project/);
  });

  it("appears, with its own count, when unattributed > 0 and a project is in view", () => {
    const v = projectScopeView(boot({ projectView: "product-tattoo-idp", shown: 12, register: 1204, unattributed: 47 }));
    expect(v.caption).toBe("12 of 1,204 findings · 47 have no project");
  });

  it("also appears on the unscoped caption when the register carries unattributed rows", () => {
    const v = projectScopeView(boot({ register: 1204, shown: 1204, unattributed: 47 }));
    expect(v.caption).toBe("1,204 findings synced · 47 have no project");
  });

  it("a negative or junk unattributed value never renders as a clause", () => {
    const v = projectScopeView(boot({ register: 1204, shown: 1204, unattributed: "not-a-number" }));
    expect(v.caption).not.toMatch(/have no project/);
  });

  // PERTURBATION (recorded, then reverted): removing the `unattributed > 0` guard (always
  // appending the clause) turned the "is absent when unattributed is 0" test red — the caption
  // read "12 of 1,204 findings · 0 have no project" — while every other test in this block
  // stayed green, since they all set a truthy unattributed value.
});

describe("projectScopeView: staleness — every project stays on offer, the state is escapable", () => {
  it("a stored slug absent from the list is stale", () => {
    const v = projectScopeView(boot({ projectView: "retired-project", shown: 0, register: 1204 }));
    expect(v.stale).toBe(true);
    expect(v.label).toBe("a project this register does not hold");
  });

  it("the stale caption names the register total and says the count is zero", () => {
    const v = projectScopeView(boot({ projectView: "retired-project", shown: 0, register: 1204 }));
    expect(v.caption).toBe("Not in this register — showing 0 of 1,204");
  });

  it("every real project is STILL in options while stale — nothing is hidden", () => {
    const v = projectScopeView(boot({ projectView: "retired-project", shown: 0, register: 1204 }));
    expect(v.options.map((o) => o.value).sort()).toEqual(
      PROJECT_LIST.map((p) => p.slug).sort(),
    );
  });

  it("a real, current slug is not stale, and resolves to that project's own name", () => {
    const v = projectScopeView(boot({ projectView: "value-chain", shown: 826, register: 1204 }));
    expect(v.stale).toBe(false);
    expect(v.label).toBe("VALUE-CHAIN");
  });

  // PERTURBATION (recorded, then reverted): dropping the `!chosen` half of the stale
  // predicate (leaving `stale = Boolean(projectView)`, i.e. "any scope at all is stale") made
  // the last test above ("a real, current slug is not stale") fail while the two genuinely
  // stale tests stayed green — confirming the guard actually distinguishes the two cases
  // rather than one of them being vacuous.
});

// =========================================================================================
//  The DOM half — source-text assertions (no jsdom in this suite)
// =========================================================================================

describe("projectScopeControl wiring, read as source", () => {
  it("returns null rather than an element when the view says show:false", () => {
    expect(SRC).toMatch(/if \(!v\.show\) return null;/);
  });

  it("marks the trigger .scoped only while a project is actually selected", () => {
    expect(SRC).toMatch(/if \(v\.current\) combo\.classList\.add\("scoped"\);/);
  });

  it("uses checkSelected and the scope popover class, not colour/weight alone", () => {
    expect(SRC).toMatch(/checkSelected:\s*true/);
    expect(SRC).toMatch(/popClass:\s*"combobox-pop--scope"/);
  });

  it("the caption is announced (aria-live) rather than silent on change", () => {
    expect(SRC).toMatch(/"aria-live":\s*"polite"/);
  });
});

describe("app.js: the header mounts the scope control and owns the pick round-trip", () => {
  it("imports projectScopeControl and mounts it in renderAppbar", () => {
    expect(APP_SRC).toMatch(/import \{ projectScopeControl \} from ".\/ui\/projectScope\.js";/);
    const fn = APP_SRC.slice(APP_SRC.indexOf("function renderAppbar"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/projectScopeControl\(data, pickProjectScope\)/);
  });

  it("pickProjectScope calls api_setProjectView, then refresh() — nothing else, and stores "
    + "nothing client-side", () => {
    const fn = APP_SRC.slice(APP_SRC.indexOf("async function pickProjectScope"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/call\("api_setProjectView",\s*\{\s*projectView:\s*slug\s*\}\)/);
    expect(body).toMatch(/await refresh\(\)/);
    // No bootstrapData/settings mutation held on a module-level variable inside this function.
    expect(body).not.toMatch(/bootstrapData\s*=/);
  });

  it("guards re-entry so a fast double-pick cannot fire two setProjectView calls at once", () => {
    const fn = APP_SRC.slice(APP_SRC.indexOf("async function pickProjectScope"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/if \(scopePickInFlight\) return;/);
    expect(body).toMatch(/scopePickInFlight = true;/);
    expect(body).toMatch(/scopePickInFlight = false;/);
  });

  it("toasts on failure rather than failing silently", () => {
    const fn = APP_SRC.slice(APP_SRC.indexOf("async function pickProjectScope"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/catch \(e\)/);
    expect(body).toMatch(/toast\(/);
  });

  // PERTURBATION (recorded, then reverted): removing the `if (scopePickInFlight) return;`
  // guard line left the rest of the source-text assertions in this block green (the call
  // still fires, still refreshes, still toasts on failure) while the re-entry-guard test above
  // went red on its own — confirming that assertion is the one actually pinning the guard
  // rather than being redundant with the others.
});

describe("ui.js barrel: the new module is exported the same way every other ui/*.js is", () => {
  it("re-exports the control and the pure view functions", () => {
    expect(UI_SRC).toMatch(/from "\.\/ui\/projectScope\.js";/);
    expect(UI_SRC).toMatch(/projectScopeControl/);
    expect(UI_SRC).toMatch(/projectScopeView/);
  });

  it("re-exports registerWideNote from dom.js", () => {
    // TWO HOPS NOW, and the claim is unchanged. `registerWideNote` used to be named in
    // ui.js's own export list; the 26 shared modules moved to gas_shared/ and ui.js became
    // `export * from` the shared barrel, so the name is no longer literally in this file
    // while still being reachable through it — which is what this test was ever about. The
    // assertion follows the hop rather than being relaxed: the barrel must re-export it
    // from dom.js, and ui.js must re-export the barrel.
    expect(UI_SRC).toMatch(/export \* from "[./]*gas_shared\/ui\/index\.js";/);
    expect(SHARED_UI_SRC).toMatch(/registerWideNote[^;]*from "\.\/dom\.js";/);
  });
});
