// gas_shared/domain/scopedAccess.ts — the stored roster both registers read — and the scoped
// summary projection (src/domain/scopeSummary.ts).

import { describe, expect, it } from "vitest";

import {
  distinctScopes,
  parseScoped,
  scopeKey,
  serializeScoped,
  validateScoped,
} from "../../gas_shared/domain/scopedAccess";
import { scopeSummaryOf, thinPoints } from "../../gas_shared/domain/scopeSummary";

const DIMS = ["d", "g"] as const;

describe("parseScoped — fails closed", () => {
  it("reads the stored shape, lowercasing addresses and sorting values", () => {
    const r = parseScoped('{"A@X.com":{"d":["Pay","Ops","Pay"],"g":["CS-1"]}}', DIMS);
    expect(r).toEqual({ "a@x.com": { d: ["Ops", "Pay"], g: ["CS-1"] } });
  });

  it("drops entries with no scope, no @, or an unknown dimension only", () => {
    const r = parseScoped(
      '{"a@x.com":{"d":[]},"nope":{"d":["Pay"]},"b@x.com":{"p":["repo"]},"c@x.com":{"g":["CS"]}}',
      DIMS,
    );
    expect(Object.keys(r)).toEqual(["c@x.com"]);
  });

  it("reads null, junk and non-objects as nobody", () => {
    for (const raw of [null, "", "{", "[]", "42", '"a@x.com"']) {
      expect(parseScoped(raw, DIMS), String(raw)).toEqual({});
    }
  });

  it("round-trips through serializeScoped", () => {
    const r = parseScoped('{"b@x.com":{"g":["CS"]},"a@x.com":{"d":["Pay"]}}', DIMS);
    expect(parseScoped(serializeScoped(r), DIMS)).toEqual(r);
    expect(serializeScoped(r)).toBe('{"a@x.com":{"d":["Pay"]},"b@x.com":{"g":["CS"]}}');
  });
});

describe("validateScoped — refuses with a sentence", () => {
  it("merges a repeated address instead of silently keeping the last row", () => {
    const r = validateScoped([
      { email: "a@x.com", scope: { d: ["Pay"] } },
      { email: "A@x.com", scope: { g: ["CS"] } },
    ], DIMS);
    expect(r).toEqual({ "a@x.com": { d: ["Pay"], g: ["CS"] } });
  });

  it("names the address with no scope", () => {
    expect(() => validateScoped([{ email: "a@x.com", scope: { d: [] } }], DIMS)).toThrow(/a@x.com/);
  });

  it("names a non-address", () => {
    expect(() => validateScoped([{ email: "nope", scope: { d: ["Pay"] } }], DIMS)).toThrow(/nope/);
  });

  it("refuses a roster too large for one Script Property", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      email: `person${i}@averylongdomainname.example.com`,
      scope: { d: ["A fairly long business domain name"] },
    }));
    expect(() => validateScoped(many, DIMS)).toThrow(/too long/);
  });
});

describe("scopeKey / distinctScopes", () => {
  it("is order-independent, so viewers sharing a scope share one warm entry", () => {
    expect(scopeKey({ d: ["b", "a"], g: [] })).toBe(scopeKey({ g: [], d: ["a", "b"] }));
    expect(scopeKey({ d: ["a"] })).not.toBe(scopeKey({ g: ["a"] }));
    const roster = parseScoped(
      '{"a@x.com":{"d":["Pay"]},"b@x.com":{"d":["Pay"]},"c@x.com":{"g":["CS"]}}', DIMS,
    );
    expect(distinctScopes(roster).size).toBe(2);
  });
});

describe("scopeSummaryOf — a projection, not a second estimate", () => {
  const mttr = {
    perSev: {
      LOW: { open: 1, resolved: 0, sla_pct: null, sla_target: 180 },
      CRITICAL: { open: 3, resolved: 2, sla_pct: 50, sla_target: 15 },
      HIGH: { open: 0, resolved: 0, sla_pct: null, sla_target: 30 },
    },
    overall: { open: 4, resolved: 2 },
    slaPct: 50,
    remediation: {
      km: { median: 12, medianLowerBound: null, naiveMedian: 5 },
      kmP90: 40,
      kmMedianPerSev: { CRITICAL: 12 },
      kmP90PerSev: { CRITICAL: 40 },
      openPastSla: { perSev: { CRITICAL: { breached: 2 } }, overall: { breached: 2, pct: 50, unknown: 0 } },
      awaiting: { perSev: { LOW: 1 }, overall: 1, pctOfOpen: 25 },
    },
    backlog: { observed: 4, unobserved: 0 },
  };

  it("carries the MTTR page's own numbers, severities in order, empty ones dropped", () => {
    const s = scopeSummaryOf(mttr, { trend: [] }, { asOf: "t", scan: null });
    expect(s.mttr).toEqual({ median: 12, medianLowerBound: null, p90: 40, naiveMedian: 5 });
    expect(s.perSev.map((r) => r.sev)).toEqual(["CRITICAL", "LOW"]);
    expect(s.perSev[0]).toMatchObject({ open: 3, pastSla: 2, kmMedian: 12, slaPct: 50 });
    expect(s.sla).toEqual({ attainmentPct: 50, pastSla: 2, pastSlaPct: 50, unknown: 0 });
    expect(s.awaiting).toEqual({ count: 1, pctOfOpen: 25 });
  });

  it("prefers the KM median in the trend and keeps the newest point when thinning", () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ date: `d${i}`, open: i, km_median_days: null, median_days: i }));
    const s = scopeSummaryOf(mttr, { trend: pts }, { asOf: "t", scan: null });
    expect(s.trend.length).toBe(60);
    expect(s.trend[s.trend.length - 1]).toEqual({ date: "d199", open: 199, medianDays: 199 });
    expect(thinPoints([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});
