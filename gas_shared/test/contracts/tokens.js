// The design tokens that are NOT an app's to change, and the one set that is.
//
// Two different jobs in one contract because they are two halves of the same rule
// (PRODUCT.md): a severity means the same thing in every sidekick, and the brand
// deliberately does not.
//
// The accent assertions are not decoration. gas_devsecops's #ffcb13 was chosen KNOWING it
// fails every contrast floor on its own — 1.52:1 on white, 1.30:1 on the meter track — so
// the design is only legal while the five-token split holds. A later edit that "simplified"
// a focus ring back onto var(--accent) would look tidy and would be unreadable. The same
// arithmetic decides the other two brands, which is why this moved out of one app's test
// file: gas's blue and gas_ai's rose need the identical checks against different numbers.
//
// A SPEC FACTORY, not a test file. `vitest.config.ts` in each app collects only that app's
// `test/` directory, so a shared contract cannot BE a test — it has to be a function the
// app's own test file calls, handing over its describe/it/expect and its specifics.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ------------------------------------------------------------------ colour arithmetic

/** WCAG 2.1 relative luminance contrast between two #rrggbb strings. */
export function ratio(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * `rgba(r, g, b, a)` painted over an opaque #rrggbb ground, as a new #rrggbb.
 *
 * WITHOUT THIS THE WASH CHECK IS UNTESTABLE. `--accent-wash` is a translucent fill and
 * `--accent-text` is read ON it; `ratio()` takes opaque hex on both sides, so the only way
 * to ask the real question is to resolve the composite first. Straight source-over:
 * result = fg*a + bg*(1-a), per channel, which is what the browser does for a solid
 * background under an rgba() one.
 */
export function composite(rgba, groundHex) {
  const m = String(rgba).match(
    /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/,
  );
  if (!m) throw new Error("composite(): not an rgb/rgba value: " + rgba);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const bg = [1, 3, 5].map((i) => parseInt(groundHex.slice(i, i + 2), 16));
  const out = [1, 2, 3].map((i) => Math.round(Number(m[i]) * a + bg[i - 1] * (1 - a)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ stylesheet closure

/**
 * Every stylesheet the app's index pulls in, in @import order, as [label, source].
 *
 * FOLLOWS THE INDEX rather than listing filenames, and that is the whole point: the sheets
 * live in two places now (gas_shared/styles/ and the app's own styles/), and a hand-kept
 * list would quietly stop covering a sheet the moment one was added. Whatever the build
 * ships is what gets checked.
 */
export function stylesheetClosure(indexPath) {
  const src = readFileSync(indexPath, "utf8");
  const base = dirname(indexPath);
  const out = [];
  for (const m of src.matchAll(/@import\s+"([^"]+)"/g)) {
    const full = resolve(base, m[1]);
    out.push([m[1], readFileSync(full, "utf8"), full]);
  }
  if (!out.length) throw new Error("stylesheetClosure(): no @import found in " + indexPath);
  return out;
}

/**
 * Register the token contract.
 *
 * @param {object} ctx
 * @param {Function} ctx.describe  vitest's describe
 * @param {Function} ctx.it        vitest's it
 * @param {Function} ctx.expect    vitest's expect
 * @param {URL}      ctx.appRoot   the app package root (trailing slash)
 * @param {string}   ctx.app       the app's short name, for failure messages
 * @param {object}   ctx.severity  { SEVERITY_COLORS, SEVERITY_TEXT, SLA_TARGETS } from the
 *                                 app's own src/domain/config.ts
 * @param {string}   [ctx.brandTokensPath]  path (relative to appRoot) of the brand token
 *                                 block. Default "src/client/styles/tokens.css".
 * @param {string[]} [ctx.hexAllow] extra sheets allowed to spell a colour literally, on top
 *                                 of the two token files, keyed by @import specifier.
 */
export function registerTokenContract(ctx) {
  const { describe, it, expect, app, severity } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const brandPath = resolve(root, ctx.brandTokensPath || "src/client/styles/tokens.css");
  const TOKENS = readFileSync(brandPath, "utf8");
  const SHEETS = stylesheetClosure(resolve(root, "src/client/styles.css"));

  const tokenValue = (name) => {
    const m = TOKENS.match(new RegExp("--" + name + ":\\s*([^;]+);"));
    if (!m) throw new Error(app + ": no --" + name + " in " + brandPath);
    return m[1].trim();
  };

  describe(app + ": severity is shared, not branded", () => {
    // Byte-identical to gas/src/domain/config.ts and gas_ai/src/domain/config.ts.
    it("keeps the six fills every sidekick agrees on", () => {
      expect(severity.SEVERITY_COLORS).toEqual({
        CRITICAL: "#dc2626", HIGH: "#ea580c", MEDIUM: "#d97706",
        LOW: "#2563eb", INFO: "#64748b", UNKNOWN: "#475569",
      });
    });

    it("keeps the darkened text twins, and they really are darker", () => {
      expect(severity.SEVERITY_TEXT).toEqual({
        CRITICAL: "#b91c1c", HIGH: "#c2410c", MEDIUM: "#b45309",
        LOW: "#1d4ed8", INFO: "#475569", UNKNOWN: "#334155",
      });
      for (const sev of Object.keys(severity.SEVERITY_COLORS)) {
        if (sev === "INFO" || sev === "UNKNOWN") continue;
        expect(
          ratio(severity.SEVERITY_TEXT[sev], "#ffffff"),
          sev + " text is not darker than its fill",
        ).toBeGreaterThan(ratio(severity.SEVERITY_COLORS[sev], "#ffffff"));
      }
    });

    it("clears 3:1 on white for every fill, since a fill is a graphical mark", () => {
      for (const [sev, hex] of Object.entries(severity.SEVERITY_COLORS)) {
        expect(ratio(hex, "#ffffff"), sev + " fill").toBeGreaterThanOrEqual(3);
      }
    });

    // charts.js (severityBar, stackedAgeBar, severityTrendLines) draws these same six fills
    // straight from SEVERITY_COLORS as canvas ink (borderColor/backgroundColor on a line or
    // point, not just a bar swatch) — a fill clearing only the 3:1 graphical-mark floor above
    // is not enough there; TEXT usage needs 4.5:1, and every severity's LABEL (the coloured
    // word beside its dot, e.g. `.sev-CRITICAL`) is real text on white/near-white. All six
    // pairs, by name, so a seventh level or a renamed key fails loudly here rather than
    // silently missing this check.
    it("clears 4.5:1 on white for all six text tokens, named individually", () => {
      const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
      expect(Object.keys(severity.SEVERITY_TEXT).sort()).toEqual([...SEVERITIES].sort());
      for (const sev of SEVERITIES) {
        expect(severity.SEVERITY_TEXT[sev], sev + " has no text token").toBeTruthy();
        expect(
          ratio(severity.SEVERITY_TEXT[sev], "#ffffff"),
          sev + " text (" + severity.SEVERITY_TEXT[sev] + ") on white",
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("keeps the remediation windows the other three surfaces use", () => {
      expect(severity.SLA_TARGETS)
        .toEqual({ CRITICAL: 7, HIGH: 14, MEDIUM: 30, LOW: 90, INFO: 180 });
    });
  });

  describe(app + ": the accent, and the split that makes it legal", () => {
    // THE FIVE-TOKEN CONTRACT, stated as arithmetic rather than as three literal hexes.
    // The old per-app test asserted `--accent === "#ffcb13"`, which pins one brand and says
    // nothing about the next; these four assertions are what actually has to be true of any
    // brand, and every one of them is a floor a real palette can fail.
    it("keeps a text token that can actually carry text", () => {
      expect(ratio(tokenValue("accent-text"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps that text token readable on the accent's own wash", () => {
      // The wash is translucent, so the question is only answerable after compositing —
      // see composite() above. This is the state a filter option and a deep-linked glossary
      // entry wear, and the word on it is real text.
      const ground = composite(tokenValue("accent-wash"), "#ffffff");
      expect(ratio(tokenValue("accent-text"), ground)).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps ink that can sit ON an accent fill", () => {
      // --on-accent exists BECAUSE this answer differs per brand: near-black clears 11.78:1
      // on gas_devsecops's yellow and 1.62:1 on gas's blue, so a rule painting --ink on an
      // accent fill is only correct in one of the three apps. The token is what makes the
      // rule portable; this is what makes the token honest.
      expect(ratio(tokenValue("on-accent"), tokenValue("accent")))
        .toBeGreaterThanOrEqual(4.5);
    });

    it("either clears 3:1 as a graphical mark, or carries a mandatory edge", () => {
      // A fill is a graphical mark and owes 3:1. An accent too pale to pay that is still
      // allowed — but only with --accent-edge under every one of its fills, which is what
      // lifts gas_devsecops's 1.52:1 yellow to 3.49:1. `transparent` means "no edge", and
      // an app declaring that has to have earned it on the fill alone.
      const edge = tokenValue("accent-edge");
      const fillRatio = ratio(tokenValue("accent"), "#ffffff");
      expect(
        fillRatio >= 3 || edge !== "transparent",
        "--accent is " + fillRatio.toFixed(2) + ":1 on white and --accent-edge is "
          + edge + " — a fill that pale needs an edge",
      ).toBe(true);
    });

    it("never lets the identity token carry text or a focus ring", () => {
      for (const [label, css] of SHEETS) {
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
        expect(stripped, label + " sets colour from --accent")
          .not.toMatch(/[^-]color:\s*var\(--accent\)\s*[;}]/);
        expect(stripped, label + " draws a focus ring in --accent")
          .not.toMatch(/outline:\s*[^;]*var\(--accent\)\s*[;}]/);
      }
    });

    it("keeps the primary button graphite — white on a pale accent is unreadable", () => {
      // `endsWith("base.css")` would match tokens.base.css, which is imported FIRST and
      // contains no button rule at all — the slice came back empty and the assertion read
      // as a missing declaration rather than as a lookup that found the wrong file.
      const base = SHEETS.find(([label]) => /(^|\/)base\.css$/.test(label));
      expect(base, "the index imports no base.css").toBeTruthy();
      const src = base[1];
      const block = src.slice(src.indexOf("button.primary {"), src.indexOf("button.danger"));
      expect(block).toContain("background: var(--graphite)");
      expect(block).not.toContain("var(--accent)");
    });

    it("draws the chart series in the text token, since canvas cannot read a CSS var", () => {
      const charts = readFileSync(resolve(root, "src/client/js/charts.js"), "utf8");
      expect(charts).toContain('export const ACCENT = "' + tokenValue("accent-text") + '"');
    });
  });

  // The two token files are the only ones allowed to spell a colour literally. Everything
  // else has to name a --token instead, or a future hand-edit reintroduces the drift this
  // rule closed (the #f1f1f4/#d9d9de hover pair and the #3f2d04/#450a0a toast pair, all now
  // --surface-2/--hairline-strong/--toast-warn-bg/--toast-error-bg).
  describe(app + ": colour lives in the token files, not scattered through the tree", () => {
    // The one exemption: base.css's conic-gradient mask uses #000 as an ALPHA STOP inside
    // `-webkit-mask`/`mask` (transparent -> #000 = "fully masked"), not as a colour — there
    // is no surface it could be a token for, and CSS masks don't take a var() there
    // meaningfully the way a paint property does.
    const ALLOW = Object.assign({ "base.css": ["#000"] }, ctx.hexAllow || {});
    const TOKEN_FILES = ["tokens.base.css", "tokens.css"];

    it("has no hex literal outside the token files and the allowlisted mask stops", () => {
      for (const [label, css] of SHEETS) {
        const file = label.split("/").pop();
        if (TOKEN_FILES.includes(file)) continue;
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
        const found = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
        const allowed = ALLOW[file] || [];
        const offenders = found.filter((hex) => !allowed.includes(hex));
        expect(offenders, file + " has a hex literal outside the token files: "
          + offenders.join(", ")).toEqual([]);
      }
    });

    it("is not a vacuous sweep — the token files really do carry the literals", () => {
      // Without this the check above would pass on a tree with no colours in it at all.
      for (const name of TOKEN_FILES) {
        const sheet = SHEETS.find(([label]) => label.endsWith(name));
        expect(sheet, "the index imports no " + name).toBeTruthy();
        expect((sheet[1].match(/#[0-9a-fA-F]{3,8}\b/g) || []).length,
          name + " defines no colour").toBeGreaterThan(0);
      }
    });
  });
}
