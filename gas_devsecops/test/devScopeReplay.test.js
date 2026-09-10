// dev/boot.js's project-scope replay — read as source text, because it is the HARNESS and
// there is nothing here to execute it against.
//
// WHAT THIS IS FOR. The view-project scope is server state, and in a deployed build it
// survives a reload because it is a row on the settings tab (pinned by
// test/projectView.test.ts's "the project view survives a new execution" block). The dev
// harness keeps the whole fake platform in the page — dev/gas-shims.js's own header says
// "everything is in-memory and resets on reload" — so a scope picked locally vanished on
// F5, which reads as the product losing it. Measured on the harness before the fix:
// api_setProjectView -> "platform" -> reload -> bootstrap().scope.projectView === "".
//
// The replay closes that, and the two things worth holding are the two ways it could quietly
// become a lie: remembering the pick in the CLIENT (a second source of truth for the one
// value the control exists to keep singular), and replaying a slug the seed does not hold
// (an empty register with nothing on screen saying why).
//
// Not executed: `dev/boot.js` is an IIFE that reaches for `PropertiesService`, `Server`,
// `location` and `window.localStorage` at module scope, and this project's vitest run sets no
// `environment`. Same split test/popoverDismiss.test.js and test/chartTable.test.js use.
//
// ALL THREE GUARDS WERE PERTURBED (2026-09-07, each reverted before the next), one edit at a
// time in dev/boot.js:
//
//   the catalogue check -> `if (true)`         x replays a stored slug ONLY if this seed's
//                                                catalogue holds it              (1 failed | 6)
//   the `result.ok` condition dropped          x stores the slug at the PLATFORM seam
//                                              x remembers a pick only when the RPC said ok
//                                                                                (2 failed | 5)
//   the `else removeItem` branch deleted       x stores an empty slug as a REMOVAL, so
//                                                unscoping sticks across a reload (1 failed | 6)
//
// The runtime behaviour behind each was checked in the browser rather than only in text: a
// planted "no-such-project" was dropped with the console saying so, clearing the scope then
// reloading stayed unscoped, and `?dry&noscope` cleared a stored "growth".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BOOT = readFileSync(fileURLToPath(new URL("../dev/boot.js", import.meta.url)), "utf8");
const APP = readFileSync(
  fileURLToPath(new URL("../src/client/js/app.js", import.meta.url)), "utf8");

describe("the dev harness replays the last project scope", () => {
  it("stores the slug at the PLATFORM seam, not in the client app", () => {
    // The rule this protects is app.js's own, quoted in dev/boot.js: pickProjectScope
    // "STORES NOTHING CLIENT-SIDE — the scope is server state". A dev-only client cache would
    // be exactly the second source of truth that comment forbids, so the harness remembers it
    // where it already stands between the client and Server.api.
    expect(BOOT).toMatch(/if \(prop === "api_setProjectView" && result && result\.ok\)/);
    expect(APP).not.toMatch(/localStorage|sessionStorage/);
  });

  it("remembers a pick only when the RPC said ok", () => {
    // A refused pick must not become the next boot's starting scope.
    expect(BOOT).toMatch(/result && result\.ok\) \{\s*\n\s*writeStoredScope\(/);
  });

  it("stores an empty slug as a REMOVAL, so unscoping sticks across a reload", () => {
    // The direction a naive "remember the last non-empty pick" gets wrong: clearing the scope
    // would then be undone by the next reload.
    expect(BOOT).toMatch(/if \(slug\) window\.localStorage\.setItem\(SCOPE_KEY, slug\);/);
    expect(BOOT).toMatch(/else window\.localStorage\.removeItem\(SCOPE_KEY\);/);
  });

  it("replays a stored slug ONLY if this seed's catalogue holds it", () => {
    // `setProjectView` accepts any string on purpose (test/api.test.ts: "a slug the register
    // does not hold yields 0 rows and is NOT an error"), so a stale slug — the fixture
    // changed, or it was picked under ?live — would open the harness on an empty register.
    // Measured on the harness with a planted "no-such-project": dropped, register opened
    // unscoped, and the console said so ("... is not in this seed's catalogue (8 project(s))").
    expect(BOOT).toMatch(/list\.some\(\(p\) => p && p\.slug === stored\)/);
    expect(BOOT).toMatch(/Server\.api\.setProjectView\(\{ projectView: stored \}\)/);
    // and the rejected slug is cleared rather than left to be re-checked every load
    expect(BOOT).toMatch(/is not in this seed's catalogue/);
  });

  it("reads the catalogue rather than trusting the seed's own return value", () => {
    // The projectList is built from the ledger the seed just wrote; asking bootstrap is the
    // only way to know what the CATALOGUE ended up holding.
    expect(BOOT).toMatch(/const boot = Server\.api\.bootstrap\(\{\}\);/);
    expect(BOOT).toMatch(/filterOptions\s*\n?\s*&& boot\.data\.filterOptions\.projectList/);
  });

  it("offers ?noscope, the way ?nohub and ?noseed reach their own other state", () => {
    // A register nobody has scoped yet is the normal first condition, and with a slug in
    // storage there would otherwise be no way back to it without clearing site data by hand.
    for (const flag of ["nohub", "noseed", "noscope"]) {
      expect(BOOT, `?${flag} is not offered`).toContain(`query.has("${flag}")`);
    }
  });

  it("survives a browser with site data blocked rather than failing to boot", () => {
    // localStorage THROWS on access in a browser set to block site data — not returns null.
    // A harness that died there would be a worse failure than the one being fixed.
    expect(BOOT).toMatch(/function readStoredScope\(\) \{\s*\n\s*try \{/);
    expect(BOOT).toMatch(/function writeStoredScope\(slug\) \{\s*\n\s*try \{/);
  });
});
