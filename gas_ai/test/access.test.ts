// The allowlist that narrows the deployment's domain fence to a named set of accounts.
//
// TWO FAILURE DIRECTIONS, AND THEY ARE NOT SYMMETRIC. Failing open admits the whole Workspace
// to a security register — silently, because an admitted user looks exactly like an intended
// one. Failing closed locks the owner out of the only place the allowlist can be edited. So
// the specs below pin BOTH: every path that must deny, and the one identity that must never
// be deniable.
//
// The sharpest of them is "" === "": Session.getActiveUser().getEmail() returns the empty
// string for a caller the app cannot identify, and getEffectiveUser() could in principle
// return the same, and two blank strings compare equal. An owner check written as a bare
// equality would therefore admit precisely the unidentified caller the anonymous branch
// exists to refuse. That is the one line in access.ts that could fail open, so it gets its
// own spec.
//
// This file calls vi.resetModules(), which is how vitest.config.ts routes it into the
// isolated "stateful" project — see statefulFiles() there. It does NOT go through
// test/gasEnv.ts: the globals it needs are two stubs, and driving the whole server to
// exercise a pure decision table would hide the table behind it.

import { beforeEach, describe, expect, it, vi } from "vitest";

let activeEmail = "";
let ownerAddress = "";
const props: Record<string, string> = {};
let propReads = 0;

vi.stubGlobal("Session", {
  getActiveUser: () => ({ getEmail: () => activeEmail }),
  getEffectiveUser: () => ({ getEmail: () => ownerAddress }),
});
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => {
      propReads++;
      return props[k] ?? null;
    },
    setProperty: (k: string, v: string) => { props[k] = v; },
    deleteProperty: (k: string) => { delete props[k]; },
  }),
});

// Denials log to Stackdriver by design; silence it so a failing assertion is the only thing
// in the test output.
vi.spyOn(console, "log").mockImplementation(() => {});

/** Fresh import per spec, so access.ts's per-execution memo starts cold as it does in GAS. */
async function load() {
  return import("../src/server/access");
}

beforeEach(() => {
  for (const k of Object.keys(props)) delete props[k];
  activeEmail = "";
  ownerAddress = "owner@example.com";
  propReads = 0;
  vi.resetModules();
});

describe("parseAllowlist accepts a list however it was pasted in", () => {
  it("splits on commas, semicolons, newlines and spaces alike", async () => {
    const { parseAllowlist } = await load();
    // No valid address contains any of these, so splitting on all of them cannot break one.
    expect(parseAllowlist("a@x.com, b@x.com;c@x.com\nd@x.com e@x.com")).toEqual([
      "a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com",
    ]);
  });

  it("trims, lowercases and dedupes", async () => {
    const { parseAllowlist } = await load();
    expect(parseAllowlist("  A@X.com , a@x.COM\n\n  b@x.com  ")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("reads nothing as an empty list rather than as a wildcard", async () => {
    const { parseAllowlist } = await load();
    for (const raw of [null, "", "   ", " , ; \n ,"]) {
      expect(parseAllowlist(raw), JSON.stringify(raw)).toEqual([]);
    }
  });
});

describe("decide denies by default", () => {
  it("denies a caller it cannot identify", async () => {
    const { decide } = await load();
    for (const active of [null, "", "   "]) {
      const d = decide(active, "owner@example.com", "a@x.com");
      expect(d.allowed, JSON.stringify(active)).toBe(false);
      expect(d.reason).toBe("anonymous");
      expect(d.email).toBe("");
    }
  });

  it("STILL denies when the active AND owner addresses are both blank", async () => {
    // The fail-open trap. "" === "" is true; if the owner check ran before (or without) the
    // non-empty guard, an unidentifiable caller would be admitted AS the owner.
    const { decide } = await load();
    const d = decide("", "", "a@x.com");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("anonymous");
  });

  it("denies an identified caller who is not on the list", async () => {
    const { decide } = await load();
    const d = decide("stranger@example.com", "owner@example.com", "a@x.com, b@x.com");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("not-listed");
    // Echoes what it saw: the denied page names this, which is what makes a wrong-account or
    // wrong-alias denial diagnosable instead of mysterious.
    expect(d.email).toBe("stranger@example.com");
  });

  it("denies a domain user when the property is unset — unset is not a wildcard", async () => {
    // The whole design turns on this: shipping the guard with no property configured must
    // restrict, not admit. If this spec ever flips, the feature is decorative.
    const { decide } = await load();
    expect(decide("someone@example.com", "owner@example.com", null).allowed).toBe(false);
  });
});

describe("decide never locks the owner out", () => {
  it("admits the owner with no list at all", async () => {
    const { decide } = await load();
    const d = decide("owner@example.com", "owner@example.com", null);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("owner");
  });

  it("admits the owner through a malformed list", async () => {
    // A typo in the property is the likeliest way this feature gets someone stuck, and the
    // owner is the only account that can fix it — so their access cannot depend on it parsing.
    const { decide } = await load();
    expect(decide("owner@example.com", "owner@example.com", " , ; ").allowed).toBe(true);
  });

  it("matches the owner regardless of case or padding", async () => {
    const { decide } = await load();
    expect(decide("  Owner@Example.com ", "owner@example.com", null).allowed).toBe(true);
  });
});

describe("decide admits a listed caller", () => {
  it("matches case-insensitively", async () => {
    const { decide } = await load();
    const d = decide("Listed@Example.com", "owner@example.com", "listed@example.com");
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("listed");
  });
});

describe("check reads the live configuration once per execution", () => {
  it("decides from Session and the Script Property", async () => {
    const { check } = await load();
    activeEmail = "listed@example.com";
    props["ALLOWED_USERS"] = "listed@example.com";
    expect(check().allowed).toBe(true);
  });

  it("memoizes, so doGet and its include() scriptlets add no property reads", async () => {
    // Asserted as "no FURTHER reads", not as a fixed count. The count is an implementation
    // detail that legitimately moves when a property is added; the claim worth pinning is that
    // repeat calls within one execution are free, which is what doGet plus its include()
    // scriptlets actually depend on.
    const { check } = await load();
    activeEmail = "listed@example.com";
    props["ALLOWED_USERS"] = "listed@example.com";
    check();
    const afterFirst = propReads;
    check();
    check();
    expect(propReads).toBe(afterFirst);
    expect(afterFirst).toBeGreaterThan(0); // it did actually read
  });

  it("__resetMemosForTest drops the decision, so the shared-fixture harness can reuse a boot", async () => {
    // NOT PRESENT IN THE SIBLING gas TOOL, which resets this memo only by re-importing the
    // module. gas_ai's test/gasEnv.ts boots one server per FILE and restores a snapshot per
    // test, so a decision taken in one test would otherwise answer in the next — which is why
    // access.ts joins the list resetServerMemos() sweeps.
    const mod = await load();
    activeEmail = "stranger@example.com";
    expect(mod.check().allowed).toBe(false);
    activeEmail = "owner@example.com";
    expect(mod.check().allowed, "still memoized").toBe(false);
    mod.__resetMemosForTest();
    expect(mod.check().allowed, "re-decided after the reset").toBe(true);
  });
});

describe("the guards hand back the shapes their call sites expect", () => {
  it("denyResult is null when allowed and a forbidden envelope when not", async () => {
    const { denyResult } = await load();
    activeEmail = "stranger@example.com";
    const denied = denyResult("bootstrap");
    expect(denied).not.toBeNull();
    expect(denied!.ok).toBe(false);
    expect(denied!.errorKind).toBe("forbidden");
    expect(String(denied!.error).length).toBeGreaterThan(0);
  });

  it("denyResult passes an allowed caller through", async () => {
    const { denyResult } = await load();
    activeEmail = "owner@example.com";
    expect(denyResult("bootstrap")).toBeNull();
  });

  it("carries the contact as fields, not baked into the message", async () => {
    // `error` is the Stackdriver denial line as much as it is user-facing text, so the address
    // rides beside it rather than inside it.
    const { denyResult } = await load();
    activeEmail = "stranger@example.com";
    const denied = denyResult("bootstrap")!;
    expect(denied.contact).toBe("owner@example.com");
    expect(denied.contactUrl).toContain("mailto:owner@example.com");
    expect(denied.error).not.toContain("owner@example.com");
  });

  it("omits the contact entirely when the owner cannot be resolved", async () => {
    // Rather than shipping `contact: ""` for the card to render as "contact ."
    const { denyResult } = await load();
    activeEmail = "stranger@example.com";
    ownerAddress = "";
    const denied = denyResult("bootstrap")!;
    expect(denied.contact).toBeUndefined();
    expect(denied.contactUrl).toBeUndefined();
  });

  it("offers the SAME mailto on the page and in the card", async () => {
    // Two surfaces, one locked-out person, one href. The prefilled subject is built in one
    // place precisely so it cannot drift between them; this fails if a second copy appears.
    const { denyResult, deniedHtml, contactMailto } = await load();
    activeEmail = "stranger@example.com";
    const fromCard = denyResult("bootstrap")!.contactUrl!;
    const html = deniedHtml(
      { allowed: false, email: "stranger@example.com", reason: "not-listed" },
      null,
      "owner@example.com",
    );
    expect(fromCard).toBe(contactMailto("owner@example.com"));
    expect(html).toContain(fromCard.replace(/&/g, "&amp;"));
    expect(fromCard).toContain("subject=");
  });

  it("names THIS product in the subject, not the sibling tool's", async () => {
    // PRODUCT is the one line access.ts changes between the two apps, and it reaches the user
    // through a prefilled mail subject — where getting it wrong sends "Access to Wiz Sidekick
    // OS" to the owner of a different dashboard.
    const { contactMailto, PRODUCT } = await load();
    expect(PRODUCT).toBe("Wiz SIDEKICK AI");
    expect(decodeURIComponent(contactMailto("owner@example.com"))).toContain("Wiz SIDEKICK AI");
  });

  it("assertAllowed throws for a denied caller and returns for an allowed one", async () => {
    const { assertAllowed } = await load();
    activeEmail = "stranger@example.com";
    expect(() => assertAllowed("setup")).toThrow();
  });

  it("deniedPage returns null for an allowed caller", async () => {
    // The null is what lets entry.js write `if (deniedPage()) return it` ahead of the app — a
    // truthy return for an allowed user would swallow the app.
    const { deniedPage } = await load();
    activeEmail = "owner@example.com";
    expect(deniedPage()).toBeNull();
  });
});

describe("the denied page explains without disclosing", () => {
  it("names the address it saw, escaped", async () => {
    const { deniedHtml } = await load();
    const html = deniedHtml({ allowed: false, email: 'a<b>&"@x.com', reason: "not-listed" });
    // The address originates with Google, not with the caller, but it is still interpolated
    // into markup — escaping it costs nothing and removes the question.
    expect(html).not.toContain("<b>");
    expect(html).toContain("a&lt;b&gt;&amp;&quot;@x.com");
  });

  it("discloses neither the allowlist nor the property name", async () => {
    // A denial must not double as a directory of who does have access. Note what is NOT
    // asserted here: the owner's own address. The roster and the property names are secrets;
    // one named contact is deliberately not — see the contact spec below.
    const { deniedHtml } = await load();
    const html = deniedHtml(
      { allowed: false, email: "stranger@example.com", reason: "not-listed" },
      null,
      "owner@example.com",
    );
    expect(html).not.toContain("listed@example.com");
    expect(html).not.toContain("ALLOWED_USERS");
    expect(html).not.toContain("ALLOWED_ADMINS");
  });

  it("names a contact the denied person can actually mail", async () => {
    // Deliberate disclosure, and the audience is what makes it safe: access is DOMAIN, so
    // Google refuses everyone outside the Workspace before doGet is reached. The only people
    // who see this page are colleagues who could look the owner up in the directory — which is
    // exactly what "ask whoever runs this dashboard" was asking them to go and do.
    const { deniedHtml } = await load();
    const html = deniedHtml(
      { allowed: false, email: "stranger@example.com", reason: "not-listed" },
      null,
      "owner@example.com",
    );
    expect(html).toContain("owner@example.com");
    expect(html).toContain("mailto:owner@example.com");
    expect(html).toContain("subject="); // the request arrives legible, not "hi, can I get access"
  });

  it("never renders a contact line with nobody in it", async () => {
    // ownerEmail() should always resolve under execute-as-me, but "contact ." is the kind of
    // thing that ships when it doesn't.
    const { deniedHtml } = await load();
    for (const contact of [undefined, null, "", "   "]) {
      const html = deniedHtml(
        { allowed: false, email: "stranger@example.com", reason: "not-listed" },
        null,
        contact,
      );
      expect(html, JSON.stringify(contact)).not.toContain("mailto:");
      expect(html).toContain("ask whoever runs this dashboard");
    }
  });

  it("explains the domain requirement when it saw no address at all", async () => {
    // The outside-the-domain case, which is otherwise completely baffling to the person
    // hitting it: they are signed in, and the app still cannot see them.
    const { deniedHtml } = await load();
    const html = deniedHtml({ allowed: false, email: "", reason: "anonymous" });
    expect(html).toMatch(/Workspace domain/);
  });

  it("offers the account switcher only when it has a URL to send them to", async () => {
    const { deniedHtml } = await load();
    const d = { allowed: false, email: "stranger@example.com", reason: "not-listed" as const };
    // On the label, not the tag: the markup lives in pageShell.ts and may move again, but
    // "is the switcher offered?" is the thing this spec is actually about.
    expect(deniedHtml(d, null)).not.toContain("Switch Google account");
    expect(deniedHtml(d, "https://accounts.google.com/AccountChooser")).toContain("Switch Google account");
  });

  it("carries no stylesheet link and no google.script.run — it stands alone", async () => {
    // The card ships its own inline CSS rather than the ~170KB `styles` partial. Shipping the
    // whole design system to someone being turned away is the specific thing that would be
    // absurd, and an <?!= include ?> scriptlet here would not even evaluate: this string is
    // handed to createHtmlOutput, not to a template.
    const { deniedHtml } = await load();
    const html = deniedHtml({ allowed: false, email: "a@x.com", reason: "not-listed" });
    expect(html).not.toContain("include(");
    expect(html).toContain("<style>");
  });
});
