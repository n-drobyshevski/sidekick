// The three Register-lane pages, held to the reasons they are three pages.
//
// STRUCTURE, AND WHY IT IS THIS ONE. There is no jsdom in this project (vitest.config.ts sets
// no `environment`), so each page is written as a PURE VIEW MODEL plus a thin DOM layer, and
// this file tests the pure half directly plus the source of the thin half as text — the same
// bargain `test/shared.test.js` and `test/tableModel.test.js` already make. The three page
// modules import cleanly in Node: nothing in their graph touches `document` at module scope.
//
// WHAT IS ACTUALLY BEING GUARDED. Every assertion here corresponds to a way one of these
// three registers can quietly lie:
//
//   * blending SCA's two clocks into one average, which measures the vendor and the team at
//     once and names neither;
//   * rendering a signal Wiz never evaluated as a No, which makes an unassessed finding look
//     clean — the specific failure this register was built after;
//   * publishing a secrets rate without the denominator it was read against, when ~99.6% of
//     the tenant's instances were never validated;
//   * censoring a never-validated credential instead of excluding it, which asserts it was
//     alive at the cut-off on no evidence;
//   * segmenting secrets by severity, which grades a DETECTION and says nothing about whether
//     a credential is live;
//   * SAST reading near-zero and being taken for a fast team rather than for an absence of
//     observations;
//   * putting a secret's value on a page.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AGE_BUCKET_LABELS, RISK_TIER_LABELS, RISK_TIER_ORDER, boundedDays, concentrationModel,
  funnelModel, missingColumnsNote, pct1, scaModel, signalFigure, tierModel,
} from "../src/client/js/pages/sca.js";
import {
  DISAPPEARANCE_CAVEAT, SAST_RULE_CLAUSES, SAST_RULE_SENTENCE, sastModel,
} from "../src/client/js/pages/sast.js";
import { REMOVAL_CELLS, TWIN_NOTE, bucketTotals, secretsModel } from "../src/client/js/pages/secrets.js";

const SRC = (name) =>
  readFileSync(new URL(`../src/client/js/pages/${name}.js`, import.meta.url), "utf8");
const SCA_SRC = SRC("sca");
const SAST_SRC = SRC("sast");
const SECRETS_SRC = SRC("secrets");

/**
 * The file with its comments removed — string-aware, so a `//` inside a quoted string stays.
 *
 * THIS DISTINCTION IS THE WHOLE POINT OF SEVERAL ASSERTIONS BELOW. Each of these pages
 * EXPLAINS its own prohibitions in prose: secrets.js names `sevBadge`, `validationDetails`
 * and `api_getRegisterPage` in its header precisely to say it does not use them. A
 * must-not-appear check over the raw text would fail on the sentence that states the rule,
 * which is the opposite of what it is for. So the prohibitions are checked over the CODE and
 * the explanations are checked over the prose, separately.
 *
 * Mirrors `stripCommentsLikeMiddlebox` in esbuild.config.mjs; the build guard already proves
 * no bare `//` survives inside a string in these files, so the two agree by construction.
 */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    out += c;
    i++;
  }
  return out;
}
const SCA_CODE = code(SCA_SRC);
const SAST_CODE = code(SAST_SRC);
const SECRETS_CODE = code(SECRETS_SRC);
// `denomNote` moved out of sca.js into ui/figures.js in the figure-module consolidation (one
// `num`/`fmtCount`/`days1`/`pct1`/`denomNote`/`fmtDays` implementation instead of five drifting
// copies) — sca.js, sast.js and secrets.js all import it from there now. The case below reads
// FIGURES_CODE rather than SCA_CODE for exactly that reason.
const FIGURES_SRC = readFileSync(
  new URL("../../gas_shared/ui/figures.js", import.meta.url), "utf8",
);
const FIGURES_CODE = code(FIGURES_SRC);
const PROGRAM_TS = readFileSync(new URL("../src/domain/program.ts", import.meta.url), "utf8");
const CONFIG_TS = readFileSync(new URL("../src/domain/config.ts", import.meta.url), "utf8");
const INSIGHTS_TS = readFileSync(new URL("../src/domain/insights.ts", import.meta.url), "utf8");
const HELP_SRC = readFileSync(new URL("../src/client/js/helpContent.js", import.meta.url), "utf8");

// ========================================================================== the fixtures
//
// Hand-built rather than generated: each field below is one the page is expected to read,
// and a generated payload would let a page quietly stop reading one of them. The numbers are
// chosen so every guard has something to bite on — a partly-measured signal, a wholly
// unmeasured one, a non-empty removed-but-unrotated corner, a real excluded-unmeasured count.

/** `api_getRegisterPage({scope:"sca"})`. */
function scaPayload(over) {
  return {
    asOf: 1756900000000,
    scope: "sca",
    severities: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
    showNoFix: true,
    rowCount: 120,
    open: 90,
    resolved: 30,
    severityAxis: { supported: true },
    counts: { CRITICAL: 10, HIGH: 30, MEDIUM: 40, LOW: 10 },
    sevStats: {},
    previousCounts: null,
    segments: null,
    aging: {
      perSev: {
        CRITICAL: [1, 2, 3, 4],
        HIGH: [5, 6, 7, 8],
        MEDIUM: [9, 10, 11, 12],
        LOW: [1, 1, 1, 1],
      },
      totalOpen: 82,
    },
    oldest: {
      findings: [
        { identifier: "CVE-2021-44228", repo: "acme/api", ownerProject: "Platform", severity: "CRITICAL", ageDays: 412.5 },
        { identifier: "CVE-2023-1111", repo: "acme/web", ownerProject: "Web", severity: "HIGH", ageDays: 210.25 },
        { identifier: null, repo: null, ownerProject: null, severity: "MEDIUM", ageDays: 12 },
      ],
      byRepo: [
        { key: "acme/api", agedCount: 30, openCount: 55, oldestDays: 412.5, ownerProject: "Platform" },
        { key: "acme/web", agedCount: 8, openCount: 35, oldestDays: 210.25, ownerProject: "Web" },
      ],
    },
    movement: { newCount: 7, resolvedCount: 4, reopenedCount: 1, persisting: 79, hasPrevious: true },
    concentration: {
      perDim: {
        repo: [{ key: "acme/api", open: 55, repos: 1, kev: 6 }, { key: "acme/web", open: 35, repos: 1, kev: 1 }],
        language: [{ key: "java", open: 60, repos: 2, kev: 5 }, { key: "python", open: 30, repos: 1, kev: 2 }],
        owner_project: [{ key: "Platform", open: 55, repos: 1, kev: 6 }],
      },
      moreDim: { repo: 3, language: 1, owner_project: 0 },
    },
    tiers: {
      perTier: { kev: 7, exploit: 12, epss: 20, cwe: 0, aiVerdict: 0, critical: 0, none: 39, unknown: 12 },
      open: 78,
      unclassified: 12,
      excludedSecrets: 0,
    },
    funnel: {
      open: 90, intel: 78, exploitable: 19, exposed: 0, overdue: 0,
      unclassified: 12, exposureKnown: false, excludedSecrets: 0,
    },
    awaiting: {
      perSev: { CRITICAL: 4, HIGH: 8 },
      overall: 12,
      openTotal: 90,
      pctOfOpen: (12 / 90) * 100,
      notApplicable: 0,
    },
    latestScan: {
      scan_id: "s-42", ts: "2026-09-01T04:00:00.000Z", scope: "sca", mode: "full",
      severities: "CRITICAL,HIGH,MEDIUM,LOW", total: 120, new_count: 7, resolved_count: 4,
      reopened_count: 1, raw_ref: "drive-raw-1", obs_ref: "drive-obs-1", sealed: 0,
    },
    signalCoverage: {
      // Partly measured: 12 of 90 applicable rows were never evaluated.
      has_kev: { applicable: 90, measured: 78, missing: 12, coveragePct: (78 / 90) * 100, notApplicable: 30, total: 120 },
      // Fully measured.
      has_exploit: { applicable: 90, measured: 90, missing: 0, coveragePct: 100, notApplicable: 30, total: 120 },
      // Never measured at all — the case that must not read as a register with no EPSS risk.
      epss: { applicable: 90, measured: 0, missing: 90, coveragePct: 0, notApplicable: 30, total: 120 },
      ai_verdict: { applicable: 0, measured: 0, missing: 0, coveragePct: null, notApplicable: 120, total: 120 },
      validation_state: { applicable: 0, measured: 0, missing: 0, coveragePct: null, notApplicable: 120, total: 120 },
    },
    ...(over || {}),
  };
}

/** `api_getRegisterPage({scope:"sast"})` — the same shape, a different register. */
function sastPayload(over) {
  const base = scaPayload();
  return {
    ...base,
    scope: "sast",
    rowCount: 340,
    open: 300,
    resolved: 40,
    concentration: {
      perDim: {
        ...base.concentration.perDim,
        cwe: [
          { key: "CWE-79", open: 120, repos: 4, kev: 0 },
          { key: "CWE-89", open: 60, repos: 2, kev: 0 },
        ],
      },
      moreDim: { ...base.concentration.moreDim, cwe: 9 },
    },
    tiers: {
      perTier: { kev: 0, exploit: 0, epss: 0, cwe: 180, aiVerdict: 0, critical: 40, none: 60, unknown: 20 },
      open: 280,
      unclassified: 20,
      excludedSecrets: 0,
    },
    // No vendor to wait on: every actionable figure collapses onto the detection clock.
    awaiting: { perSev: {}, overall: 0, openTotal: 300, pctOfOpen: 0, notApplicable: 0 },
    signalCoverage: {
      ...base.signalCoverage,
      has_kev: { applicable: 0, measured: 0, missing: 0, coveragePct: null, notApplicable: 340, total: 340 },
      has_exploit: { applicable: 0, measured: 0, missing: 0, coveragePct: null, notApplicable: 340, total: 340 },
      epss: { applicable: 0, measured: 0, missing: 0, coveragePct: null, notApplicable: 340, total: 340 },
      // 0% in this tenant, and the page has to say so rather than hide the clause.
      ai_verdict: { applicable: 340, measured: 0, missing: 340, coveragePct: 0, notApplicable: 0, total: 340 },
    },
    ...(over || {}),
  };
}

/** `api_getSecretsPage()` — two halves, and `segments` deleted from the register half. */
function secretsPayload(over) {
  const register = {
    asOf: 1756900000000,
    scope: "secrets",
    severities: null,
    showNoFix: true,
    rowCount: 61,
    open: 41,
    resolved: 20,
    severityAxis: { supported: false, reason: "…" },
    counts: null,
    sevStats: null,
    previousCounts: null,
    aging: { perSev: { LOW: [2, 4, 6, 8], INFO: [1, 2, 3, 4], UNKNOWN: [0, 1, 0, 0] }, totalOpen: 31 },
    oldest: {
      findings: [
        { identifier: "sd-8812", repo: "acme/api", ownerProject: "Platform", severity: "LOW", ageDays: 300 },
      ],
      byRepo: [
        { key: "acme/api", agedCount: 12, openCount: 25, oldestDays: 300, ownerProject: "Platform" },
        { key: "acme/infra", agedCount: 3, openCount: 16, oldestDays: 91.5, ownerProject: "Infra" },
      ],
    },
    movement: { newCount: 2, resolvedCount: 5, reopenedCount: 0, persisting: 39, hasPrevious: true },
    concentration: {
      perDim: {
        repo: [{ key: "acme/api", open: 25, repos: 1, kev: 0 }],
        secret_kind: [
          { key: "SAAS_API_KEY", open: 20, repos: 2, kev: 0 },
          { key: "CERTIFICATE", open: 12, repos: 1, kev: 0 },
        ],
        owner_project: [{ key: "Platform", open: 25, repos: 1, kev: 0 }],
      },
      moreDim: { repo: 2, secret_kind: 4, owner_project: 1 },
    },
    tiers: { perTier: {}, open: 0, unclassified: 0, excludedSecrets: 41 },
    funnel: { open: 0, intel: 0, exploitable: 0, exposed: 0, overdue: 0, unclassified: 0, exposureKnown: false, excludedSecrets: 41 },
    awaiting: { perSev: {}, overall: 0, openTotal: 41, pctOfOpen: 0, notApplicable: 0 },
    latestScan: {
      scan_id: "s-43", ts: "2026-09-01T05:00:00.000Z", scope: "secrets", mode: "full",
      severities: null, total: 61, new_count: 2, resolved_count: 5, reopened_count: 0,
      raw_ref: "drive-raw-2", obs_ref: "drive-obs-2", sealed: 0,
    },
    signalCoverage: {},
  };
  const secrets = {
    asOf: 1756900000000,
    scope: "secrets",
    severityAxis: { supported: false, reason: "…" },
    rowCount: 61,
    open: 41,
    coverage: { measured: 5, unmeasured: 56, total: 61, coveragePct: (5 / 61) * 100, ignoredOtherScopes: 0 },
    validity: { valid: 3, invalid: 2, measured: 5, ratePct: 60 },
    timeToRevoke: {
      km: { curve: [{ t: 2, s: 0.9 }, { t: 6.5, s: 0.45 }], median: 6.5, medianLowerBound: null, events: 2, censored: 3, total: 5 },
      median: 6.5,
      p90: 19.25,
      medianLowerBound: null,
      events: 2,
      censored: 3,
      excludedUnmeasured: 56,
      excludedNoClock: 0,
      total: 61,
      withinSlaPct: 50,
      sla: 7,
      ignoredOtherScopes: 0,
    },
    // The removed-but-unrotated corner is deliberately non-empty: it is the hero, and a
    // fixture that left it at zero would let the hero silently stop being reachable.
    removalVsRotation: { removedAndRotated: 3, removedNotRotated: 17, rotatedNotRemoved: 1, neither: 40, total: 61 },
    segments: {
      validation_state: [
        { segment: "UNKNOWN", total: 56, open: 38, measured: 0, valid: 0, invalid: 0, rotated: 0, removed: 15, removedNotRotated: 15 },
        { segment: "VALID", total: 3, open: 3, measured: 3, valid: 3, invalid: 0, rotated: 0, removed: 1, removedNotRotated: 1 },
        { segment: "INVALID", total: 2, open: 0, measured: 2, valid: 0, invalid: 2, rotated: 2, removed: 2, removedNotRotated: 0 },
      ],
      confidence: [
        { segment: "HIGH", total: 40, open: 28, measured: 4, valid: 2, invalid: 2, rotated: 2, removed: 12, removedNotRotated: 11 },
        { segment: "MEDIUM", total: 21, open: 13, measured: 1, valid: 1, invalid: 0, rotated: 0, removed: 6, removedNotRotated: 6 },
      ],
      secret_kind: [
        { segment: "SAAS_API_KEY", total: 33, open: 20, measured: 3, valid: 2, invalid: 1, rotated: 1, removed: 10, removedNotRotated: 9 },
        { segment: "CERTIFICATE", total: 28, open: 21, measured: 2, valid: 1, invalid: 1, rotated: 1, removed: 8, removedNotRotated: 8 },
      ],
    },
    signalCoverage: {},
  };
  return { register, secrets, ...(over || {}) };
}

const SCA = scaModel(scaPayload());
const SAST = sastModel(sastPayload());
const SECRETS = secretsModel(secretsPayload());

// ============================================================================== utilities

/** Every object key in a structure, at every depth. */
function allKeys(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

/** Keys naming a rate, i.e. a figure that is meaningless without a denominator. */
const RATE_KEY = /(^pct$|Pct$)/;

/**
 * Every rate in the model sits under a denominator sentence — on its own object or on the
 * nearest ancestor that carries one. A rate whose denominator lives two blocks away on the
 * page is the failure this walk is for.
 */
function ratesWithoutDenominator(value, covered = false, path = "$", out = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      ratesWithoutDenominator(value[i], covered, `${path}[${i}]`, out);
    }
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const here = covered || typeof value.denominator === "string";
  for (const [k, v] of Object.entries(value)) {
    if (RATE_KEY.test(k) && !here) out.push(`${path}.${k}`);
    ratesWithoutDenominator(v, here, `${path}.${k}`, out);
  }
  return out;
}

// ========================================================================= the three pages

describe("the three register pages are wired, not stubbed", () => {
  for (const [name, src] of [["sca", SCA_SRC], ["sast", SAST_SRC], ["secrets", SECRETS_SRC]]) {
    it(`${name} no longer calls renderStub`, () => {
      expect(src).not.toMatch(/renderStub/);
      expect(src).not.toMatch(/_stub\.js/);
    });

    it(`${name} calls its own RPC through the SWR seam`, () => {
      expect(src.includes("swrCall")).toBe(true);
    });
  }

  it("sca and sast share one endpoint; secrets has its own", () => {
    expect(SCA_CODE).toMatch(/api_getRegisterPage/);
    expect(SAST_CODE).toMatch(/api_getRegisterPage/);
    // `getRegisterPage` REFUSES the secrets scope — asking it would be an error, not a page.
    // The header comment names it to say so; the CODE must never call it.
    expect(SECRETS_CODE).not.toMatch(/api_getRegisterPage/);
    expect(SECRETS_SRC).toMatch(/api_getRegisterPage/); // …and the refusal is explained
    expect(SECRETS_CODE).toMatch(/api_getSecretsPage/);
  });

  it("reaches only glossary ids the book actually defines", () => {
    const defined = new Set([...HELP_SRC.matchAll(/^\s*id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]));
    expect(defined.size).toBeGreaterThan(15);
    for (const [name, src] of [["sca", SCA_SRC], ["sast", SAST_SRC], ["secrets", SECRETS_SRC]]) {
      const used = [...src.matchAll(/term: "([a-z0-9-]+)"/g)].map((m) => m[1]);
      const bare = [...src.matchAll(/glossaryTip\([^,]+, "([a-z0-9-]+)"/g)].map((m) => m[1]);
      for (const id of [...used, ...bare]) {
        expect(defined.has(id), `${name} reaches an undefined glossary id: ${id}`).toBe(true);
      }
    }
  });
});

// ========================================================== sca: the clock splits in two

describe("sca — two clocks, never one blended number", () => {
  it("renders awaiting-vendor and actionable as two independent figures", () => {
    const clocks = SCA.clocks;
    expect(Object.keys(clocks).sort()).toEqual(["actionable", "awaitingVendor"]);
    expect(clocks.awaitingVendor.count).toBe(12);
    expect(clocks.actionable.count).toBe(78);
    // Two figures over the SAME open backlog, which is what makes them legible side by side.
    expect(clocks.awaitingVendor.count + clocks.actionable.count).toBe(90);
    // And they measure different things, stated on each tile rather than left to be inferred.
    expect(clocks.awaitingVendor.measures).toBe("the vendor");
    expect(clocks.actionable.measures).toBe("the team");
    expect(clocks.awaitingVendor.measures).not.toBe(clocks.actionable.measures);
  });

  it("publishes no blended clock, and pins that as a stated null", () => {
    expect(SCA.blended).toBe(null);
    // No third figure anywhere in the model averages the two populations together.
    const keys = allKeys(SCA);
    expect(keys.filter((k) => /blend|combined|overallMttr/i.test(k))).toEqual(["blended"]);
  });

  it("gives each clock its own denominator sentence naming its own population", () => {
    expect(SCA.clocks.awaitingVendor.denominator).toMatch(/12 of 90/);
    expect(SCA.clocks.awaitingVendor.denominator).toMatch(/no published fixed version/);
    expect(SCA.clocks.actionable.denominator).toMatch(/78 of 90/);
    expect(SCA.clocks.actionable.denominator).toMatch(/measures us rather than upstream/);
  });

  it("counts rows with a fixed version without claiming the AGGREGATE endpoint has the versions", () => {
    expect(SCA.fixedVersion.perRow).toBe(false);
    expect(SCA.fixedVersion.withFix).toBe(78);
    expect(SCA.fixedVersion.withoutFix).toBe(12);
  });

  /**
   * `fixed_version` USED TO BE ON `missingColumns` — this test encoded the claim
   * "`api_getRegisterPage` is the only endpoint this page reads, so the fixed-version STRING
   * never reaches the browser". `api_getRegisterRows` falsifies it: `REGISTER_ROW_COLUMNS.sca`
   * carries `fixed_version` and `component`, and the per-finding table draws both. `ecosystem`
   * has no ledger column at all (`LEDGER_COLUMNS` names none), so it is the one column that
   * genuinely cannot travel and is the only one left on the list.
   */
  it("names only the column with no ledger source at all — ecosystem — as still missing", () => {
    expect(SCA.missingColumns).toMatch(/ecosystem/);
    expect(SCA.missingColumns).not.toMatch(/fixed_version/);
    expect(SCA.missingColumns).not.toMatch(/component/);
  });
});

// ================================================================= absent is never zero

describe("tri-state signals — missing is not false", () => {
  it("gives a never-evaluated signal a different state and a different reading than a measured one", () => {
    const kev = SCA.signals.find((s) => s.id === "has_kev");
    const exploit = SCA.signals.find((s) => s.id === "has_exploit");
    const epss = SCA.signals.find((s) => s.id === "epss");

    expect(exploit.state).toBe("measured");
    expect(kev.state).toBe("partly-measured");
    expect(epss.state).toBe("unmeasured");

    // Three states, three readings. Nothing collapses them.
    expect(new Set([exploit.verdict, kev.verdict, epss.verdict]).size).toBe(3);
  });

  it("never renders an unevaluated signal as a zero or as a No", () => {
    const epss = SCA.signals.find((s) => s.id === "epss");
    expect(epss.missing).toBe(90);
    expect(epss.cells.missing).toBe("90 never evaluated");
    // Not "0", not "None", and not "No".
    expect(epss.cells.missing).not.toBe("0");
    expect(epss.cells.measured).toBe("None evaluated");
    expect(epss.verdict).toMatch(/absent signal is not a negative one/i);
  });

  it("distinguishes 'measured and negative' from 'never measured' on the same signal", () => {
    const cov = { applicable: 40, notApplicable: 0, total: 40 };
    const allEvaluated = signalFigure("has_kev", "CISA KEV", "sca", { ...cov, measured: 40, missing: 0, coveragePct: 100 });
    const noneEvaluated = signalFigure("has_kev", "CISA KEV", "sca", { ...cov, measured: 0, missing: 40, coveragePct: 0 });

    expect(allEvaluated.state).toBe("measured");
    expect(noneEvaluated.state).toBe("unmeasured");
    expect(allEvaluated.verdict).not.toBe(noneEvaluated.verdict);
    expect(allEvaluated.cells.missing).not.toBe(noneEvaluated.cells.missing);
    expect(allEvaluated.denominator).not.toBe(noneEvaluated.denominator);
    // The forty rows nobody looked at are never printed as forty clean rows.
    expect(noneEvaluated.cells.measured).toBe("None evaluated");
    expect(JSON.stringify(noneEvaluated)).toMatch(/never evaluated/);
  });

  it("keeps not-applicable apart from never-evaluated", () => {
    const na = signalFigure("has_kev", "CISA KEV", "sca", {
      applicable: 0, measured: 0, missing: 0, coveragePct: null, notApplicable: 340, total: 340,
    });
    expect(na.state).toBe("not-applicable");
    expect(na.verdict).toMatch(/no row in this register carries this signal/i);
    expect(na.missing).toBe(0);
  });

  it("prints null coverage as an em dash, never as 0%", () => {
    expect(pct1(null)).toBe("—");
    expect(pct1(undefined)).toBe("—");
    expect(pct1(0)).toBe("0.0%");
  });
});

// ============================================================ sast: the one honest clock

describe("sast — the disappearance-dating caveat is on the page", () => {
  it("states it in the view model, in words", () => {
    expect(SAST.clock.caveat).toBe(DISAPPEARANCE_CAVEAT);
    expect(SAST.clock.caveat).toMatch(/disappear/i);
    expect(SAST.clock.caveat).toMatch(/overstates the duration by up to one scan interval/);
    expect(SAST.clock.caveat).toMatch(/near-zero/);
    expect(SAST.clock.caveat).toMatch(/absence of observations, not a fast team/);
  });

  it("renders it as body copy rather than leaving it in a comment", () => {
    expect(SAST_SRC).toMatch(/el\("p", \{\}, vm\.clock\.caveat\)/);
  });

  it("names both ends of the clock and which is which", () => {
    expect(SAST.clock.birth).toMatch(/a real date/);
    expect(SAST.clock.death).toMatch(/an estimate/);
    expect(SAST.clock.birth).not.toBe(SAST.clock.death);
  });

  it("refuses a second clock rather than printing it as a zero", () => {
    expect(SAST.clock.awaitingVendorApplicable).toBe(false);
    // sca's two-clock pair is not on this page at all.
    expect(SAST.clocks).toBeUndefined();
  });

  it("shows ai_verdict coverage rather than hiding a clause that never fires", () => {
    expect(SAST.aiVerdict.state).toBe("unmeasured");
    expect(SAST.aiVerdict.measured).toBe(0);
    expect(SAST.aiVerdict.missing).toBe(340);
    expect(SAST.aiVerdict.cells.measured).toBe("None evaluated");
    expect(SAST.aiVerdict.denominator).toMatch(/never evaluated/);
    // And the page draws it.
    expect(SAST_SRC).toMatch(/AI triage coverage/);
  });

  it("states the rule as a sentence, and the sentence matches the rule in config.ts", () => {
    expect(SAST.rule.sentence).toBe(SAST_RULE_SENTENCE);
    const declared = CONFIG_TS.slice(
      CONFIG_TS.indexOf("export const DEFAULT_SAST_RISK_RULE"),
      CONFIG_TS.indexOf("};", CONFIG_TS.indexOf("export const DEFAULT_SAST_RISK_RULE")),
    );
    for (const clause of SAST_RULE_CLAUSES) {
      expect(declared, `clause ${clause} is not in DEFAULT_SAST_RISK_RULE`).toMatch(
        new RegExp(`\\b${clause}:\\s*true`),
      );
    }
    expect(SAST_RULE_CLAUSES).toEqual(["cwe", "aiVerdict", "critical"]);
  });

  it("ranks the weakness mix from the CWE dimension", () => {
    expect(SAST.weaknessMix.dim).toBe("cwe");
    expect(SAST.weaknessMix.rows.map((r) => r.key)).toEqual(["CWE-79", "CWE-89"]);
    expect(SAST.weaknessMix.more).toBe(9);
    // …and does not repeat it among the plain breakdowns below.
    expect(SAST.concentration.map((c) => c.dim)).not.toContain("cwe");
  });

  /**
   * THIS TEST USED TO ASSERT `SAST.missingColumns` NAMED file:line AND language AS ABSENT —
   * the claim that `api_getRegisterPage`'s aggregates were the only thing sast.js could read.
   * `api_getRegisterRows` falsifies it: `REGISTER_ROW_COLUMNS.sast` is `identifier, cwe,
   * file_path, start_line, language, origin, ai_verdict, severity, status, repo_name,
   * first_seen, last_seen, age_days` — every column this page's stub ever promised — and the
   * per-finding table draws all of them. Nothing is left to name as missing.
   */
  it("has nothing left to name as a missing per-finding column", () => {
    expect(SAST.missingColumns).toBeNull();
  });
});

// ======================================================= secrets: no severity, anywhere

describe("secrets — severity is not an axis, and the page carries no trace of one", () => {
  it("has no severity key at any depth of the view model", () => {
    const offenders = allKeys(SECRETS).filter((k) => /sev/i.test(k));
    expect(offenders).toEqual([]);
  });

  it("emits no severity class in the whole serialized output", () => {
    const serialized = JSON.stringify(SECRETS);
    // Both spellings: this codebase's own `sev-CRITICAL` and the generic `.severity-*`.
    expect(serialized).not.toMatch(/\bsev-[A-Za-z]/);
    expect(serialized).not.toMatch(/severity-[a-z]/i);
    expect(serialized).not.toMatch(/sevbar|sev-badge|sev-dot|sev-pill|sevkey/);
  });

  it("imports nothing severity-flavoured, so no shared helper can smuggle one in", () => {
    expect(SECRETS_CODE).not.toMatch(
      /\bsevBadge\b|\bsevEntries\b|\bsevSegmentBar\b|\bsevKeyRow\b|\bsevSpoken\b|\bsevPalette\b|\bsevRank\b/,
    );
    // The three sca models that carry a severity axis are not reached from here either.
    expect(SECRETS_CODE).not.toMatch(/\bagingModel\b|\boldestFindingsModel\b|\btierModel\b/);
    // And the import list from ./sca.js names nothing severity-shaped — this is the seam a
    // shared helper would arrive through, so it is checked as a list rather than by usage.
    const importBlock = SECRETS_CODE.slice(
      SECRETS_CODE.lastIndexOf("import {", SECRETS_CODE.indexOf('} from "./sca.js"')),
      SECRETS_CODE.indexOf('} from "./sca.js"'),
    );
    expect(importBlock).toMatch(/renderRegisterPage/); // the slice found the right block
    expect(importBlock).not.toMatch(/sev/i);
  });

  it("segments only on the three axes that speak to whether a credential is live", () => {
    expect(SECRETS.segments.map((s) => s.axis)).toEqual([
      "validation_state", "confidence", "secret_kind",
    ]);
  });

  it("drops the severity split out of the age buckets rather than reading it out", () => {
    const buckets = bucketTotals({ perSev: { LOW: [2, 4, 6, 8], INFO: [1, 2, 3, 4] }, totalOpen: 30 });
    expect(buckets.buckets).toEqual([
      { label: "0-7d", total: 3 },
      { label: "8-30d", total: 6 },
      { label: "31-90d", total: 9 },
      { label: "90+d", total: 12 },
    ]);
    expect(allKeys(buckets).filter((k) => /sev/i.test(k))).toEqual([]);
  });
});

describe("secrets — removed is not rotated", () => {
  it("keeps removal and rotation as two independent booleans on every corner", () => {
    for (const cell of SECRETS.removalVsRotation.cells) {
      expect(typeof cell.removed).toBe("boolean");
      expect(typeof cell.rotated).toBe("boolean");
    }
    // All four combinations of the two axes are present exactly once — a 2x2, not a scale.
    const combos = SECRETS.removalVsRotation.cells.map((c) => `${c.removed}/${c.rotated}`).sort();
    expect(combos).toEqual(["false/false", "false/true", "true/false", "true/true"]);
    expect(REMOVAL_CELLS).toHaveLength(4);
  });

  it("makes the removed-but-unrotated corner reachable and non-zero", () => {
    const cell = SECRETS.removalVsRotation.cells.find((c) => c.removed && !c.rotated);
    expect(cell).toBeDefined();
    expect(cell.id).toBe("removedNotRotated");
    expect(cell.count).toBe(17);
    expect(cell.reading).toMatch(/git history/);
  });

  it("counts each axis on its own, independently of the other", () => {
    const axes = SECRETS.removalVsRotation.axes;
    expect(axes.removed.yes).toBe(20); // 3 + 17
    expect(axes.rotated.yes).toBe(4); // 3 + 1
    expect(axes.removed.yes + axes.removed.no).toBe(61);
    expect(axes.rotated.yes + axes.rotated.no).toBe(61);
    // The two axes disagree, which is the whole reason the page has both.
    expect(axes.removed.yes).not.toBe(axes.rotated.yes);
  });

  it("leads with the corner where they disagree", () => {
    expect(SECRETS.hero.value).toBe("17");
    expect(SECRETS.hero.sentence).toBe(
      "17 secrets left the code and nobody has confirmed the credential is dead.",
    );
  });
});

describe("secrets — the denominators are sentences and the exclusions are printed", () => {
  it("renders validation coverage against its denominator, in words", () => {
    const c = SECRETS.validationCoverage;
    expect(c.measured).toBe(5);
    expect(c.unmeasured).toBe(56);
    expect(c.total).toBe(61);
    expect(c.denominator).toMatch(/5 of 61/);
    expect(c.denominator).toMatch(/UNKNOWN or ERROR/);
    expect(c.denominator).toMatch(/nobody checked/);
    // Unmeasured is neither live nor dead, and the sentence says both halves.
    expect(c.denominator).toMatch(/not that the credential is dead/);
    expect(c.denominator).toMatch(/not that it is alive/);
  });

  it("prints excludedUnmeasured beside the revocation clock", () => {
    const t = SECRETS.timeToRevoke;
    expect(t.excludedUnmeasured).toBe(56);
    expect(t.denominator).toMatch(/56 were EXCLUDED, not censored/);
    expect(t.denominator).toMatch(/nobody ever validated them/);
    // And it is a figure of its own on the page, not only a clause in a sentence.
    expect(SECRETS_SRC).toMatch(/Excluded, unmeasured/);
    expect(SECRETS_SRC).toMatch(/vm\.timeToRevoke\.excludedUnmeasured/);
  });

  it("keeps the four revocation populations summing to the register", () => {
    const t = SECRETS.timeToRevoke;
    expect(t.events + t.censored + t.excludedUnmeasured + t.excludedNoClock).toBe(t.total);
  });

  it("puts the SLA share on the events only, and says so", () => {
    expect(SECRETS.timeToRevoke.withinSlaPct).toBe(50);
    expect(SECRETS.timeToRevoke.slaDenominator).toMatch(/2 observed rotations only/);
    expect(SECRETS.timeToRevoke.slaDenominator).toMatch(/7-day target/);
  });

  // The claim: where the curve never reaches half there is no median to print, so a BOUND is
  // published instead — prefixed in the string, flagged in `bounded`, and never plotted as a
  // marker at a number the curve never reached. The glyph moved from ">" to the inclusive "≥"
  // under the vocabulary rule in README.md ("at least N" is inclusive; ">" is not); nothing
  // else in this case, or this file, changed.
  it("publishes a lower bound rather than a number when the curve never reaches half", () => {
    expect(boundedDays(6.5, null)).toEqual({ text: "6.5 d", bounded: false });
    expect(boundedDays(null, 41.2)).toEqual({ text: "≥ 41.2 d", bounded: true });
    expect(boundedDays(null, null)).toEqual({ text: "—", bounded: false });

    const unreachable = secretsModel(secretsPayload({
      secrets: {
        ...secretsPayload().secrets,
        timeToRevoke: {
          ...secretsPayload().secrets.timeToRevoke,
          median: null, medianLowerBound: 41.2,
        },
      },
    }));
    expect(unreachable.timeToRevoke.medianText).toBe("≥ 41.2 d");
    expect(unreachable.timeToRevoke.medianIsLowerBound).toBe(true);
    // A bound is not a marker: nothing gets plotted at a number the curve never reached.
    expect(unreachable.timeToRevoke.medianDays).toBe(null);
  });

  it("carries the twin fold as a measurement note", () => {
    expect(SECRETS.twinNote).toBe(TWIN_NOTE);
    expect(SECRETS.twinNote).toMatch(/187 keys/);
    expect(SECRETS.twinNote).toMatch(/135/);
    expect(SECRETS.twinNote).toMatch(/19\.9 days/);
    expect(SECRETS.twinNote).toMatch(/earlier of the two birth dates/);
  });
});

// ==================================================== every rate carries its denominator

describe("every rate is published beside the denominator it was read against", () => {
  for (const [name, vm] of [["sca", SCA], ["sast", SAST], ["secrets", SECRETS]]) {
    it(`${name} leaves no rate without one`, () => {
      expect(ratesWithoutDenominator(vm)).toEqual([]);
    });
  }

  it("writes the sentence into the [data-denominator] attribute a reader can be shown", () => {
    // The node builder is DOM, so this is the source check: the attribute carries the same
    // sentence the reader sees, rather than the two being able to drift apart. This case
    // pins WHERE THAT CLAIM HOLDS, not where the function happens to be defined: `denomNote`
    // moved out of sca.js into ui/figures.js verbatim in the figure-module consolidation, and
    // sca.js, sast.js and secrets.js all import the single copy there now — so the body this
    // regex is looking for lives in FIGURES_CODE, not SCA_CODE, and the claim it encodes is
    // unchanged by the move.
    expect(FIGURES_CODE).toMatch(/"data-denominator": sentence \}, sentence\)/);
  });

  it("gives each of the three pages denominator nodes to draw", () => {
    for (const [name, src] of [["sca", SCA_SRC], ["sast", SAST_SRC], ["secrets", SECRETS_SRC]]) {
      const count = (src.match(/denomNote\(|denominator:/g) || []).length;
      expect(count, `${name} draws ${count} denominator(s)`).toBeGreaterThan(5);
    }
  });
});

// ======================================================= never render a secret's value

describe("no page can put a secret's value on screen", () => {
  for (const [name, vm] of [["sca", SCA], ["sast", SAST], ["secrets", SECRETS]]) {
    it(`${name} emits no snippet or validationDetails field`, () => {
      expect(JSON.stringify(vm)).not.toMatch(/snippet|validationDetails/i);
    });
  }

  it("no page's CODE names one either", () => {
    for (const [name, src] of [["sca", SCA_CODE], ["sast", SAST_CODE], ["secrets", SECRETS_CODE]]) {
      expect(src, `${name} names a denied field`).not.toMatch(/\bsnippet\b|\bvalidationDetails\b/);
    }
    // secrets.js names both in its header, to record that Q_SECRETS omits them on purpose.
    expect(SECRETS_SRC).toMatch(/validationDetails/);
  });
});

// ================================================= the mirrors the client cannot import

describe("client mirrors of the TypeScript domain", () => {
  it("RISK_TIER_ORDER matches program.ts", () => {
    const signals = JSON.parse(
      PROGRAM_TS.slice(
        PROGRAM_TS.indexOf("export const SIGNAL_NAMES"),
        PROGRAM_TS.indexOf("];", PROGRAM_TS.indexOf("export const SIGNAL_NAMES")),
      ).replace(/[\s\S]*?=\s*\[/, "[").replace(/,\s*$/, "") + "]",
    );
    expect(RISK_TIER_ORDER).toEqual([...signals, "none", "unknown"]);
  });

  it("RISK_TIER_LABELS matches program.ts, label for label", () => {
    const body = PROGRAM_TS.slice(
      PROGRAM_TS.indexOf("export const RISK_TIER_LABELS"),
      PROGRAM_TS.indexOf("\n};", PROGRAM_TS.indexOf("export const RISK_TIER_LABELS")),
    );
    for (const [tier, label] of Object.entries(RISK_TIER_LABELS)) {
      expect(body, `${tier} label drifted`).toContain(`${tier}: "${label}"`);
    }
  });

  it("AGE_BUCKET_LABELS matches insights.ts", () => {
    const body = INSIGHTS_TS.slice(
      INSIGHTS_TS.indexOf("export const AGE_BUCKET_LABELS"),
      INSIGHTS_TS.indexOf("as const;", INSIGHTS_TS.indexOf("export const AGE_BUCKET_LABELS")),
    );
    for (const label of AGE_BUCKET_LABELS) expect(body).toContain(`"${label}"`);
    expect(AGE_BUCKET_LABELS).toHaveLength(4);
  });
});

// ================================================================ the shared block models

describe("the shared register blocks", () => {
  it("does not render an unmeasurable funnel step as a zero", () => {
    const f = funnelModel({
      open: 90, intel: 78, exploitable: 19, exposed: 0, overdue: 0,
      unclassified: 12, exposureKnown: false, excludedSecrets: 0,
    });
    expect(f.steps.map((s) => s.id)).toEqual(["open", "intel", "exploitable"]);
    expect(f.droppedSteps).toEqual(["exposed", "overdue"]);
    expect(f.note).toMatch(/no zero to print/);
  });

  it("keeps the step it CAN measure once exposure is known", () => {
    const f = funnelModel({ open: 5, intel: 4, exploitable: 2, exposureKnown: true });
    expect(f.droppedSteps).toEqual([]);
    expect(f.note).toBe(null);
  });

  it("publishes the truncation tail rather than a list that looks complete", () => {
    const dims = concentrationModel(scaPayload().concentration, ["repo", "language"]);
    expect(dims.map((d) => d.dim)).toEqual(["repo", "language"]);
    expect(dims[0].more).toBe(3);
    expect(dims[0].denominator).toMatch(/3 further group\(s\) are not shown/);
  });

  it("keeps the unclassified count outside the tier ranking", () => {
    const t = tierModel(scaPayload().tiers, RISK_TIER_ORDER, RISK_TIER_LABELS);
    expect(t.open).toBe(78);
    expect(t.unclassified).toBe(12);
    expect(t.denominator).toMatch(/12 could not be classified/);
  });

  it("names the missing columns rather than drawing a column of dashes", () => {
    const note = missingColumnsNote(["a", "b"]);
    expect(note).toMatch(/^Not in this page's payload: a, b\./);
    expect(note).toMatch(/aggregates and a top-N ranking/);
  });
});
