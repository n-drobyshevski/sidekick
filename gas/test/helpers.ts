// Shared test helpers: fixture loading and Python-parity deep comparison.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8"));
}

/**
 * Deep equality against a Python-exported expected value: numbers compare with a
 * 1e-9 relative tolerance (independent float pipelines), null/undefined/NaN unify.
 */
export function expectParity(actual: unknown, expected: unknown, path = "$"): void {
  const missing = (v: unknown) =>
    v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
  if (missing(expected)) {
    expect(missing(actual), `${path}: expected missing, got ${JSON.stringify(actual)}`).toBe(true);
    return;
  }
  if (typeof expected === "number") {
    expect(typeof actual, `${path}: expected number`).toBe("number");
    const a = actual as number;
    if (Number.isInteger(expected) && Number.isInteger(a)) {
      expect(a, path).toBe(expected);
    } else {
      const tol = Math.max(1e-9, Math.abs(expected) * 1e-9);
      expect(Math.abs(a - expected), `${path}: |${a} - ${expected}|`).toBeLessThanOrEqual(tol);
    }
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: expected array`).toBe(true);
    const arr = actual as unknown[];
    expect(arr.length, `${path}: length`).toBe(expected.length);
    expected.forEach((e, i) => expectParity(arr[i], e, `${path}[${i}]`));
    return;
  }
  if (typeof expected === "object") {
    expect(actual !== null && typeof actual === "object", `${path}: expected object`).toBe(true);
    const eObj = expected as Record<string, unknown>;
    const aObj = actual as Record<string, unknown>;
    for (const k of Object.keys(eObj)) expectParity(aObj[k], eObj[k], `${path}.${k}`);
    // No unexpected extra non-missing keys on the actual side.
    for (const k of Object.keys(aObj)) {
      if (!(k in eObj)) {
        expect(missing(aObj[k]), `${path}.${k}: unexpected extra key`).toBe(true);
      }
    }
    return;
  }
  expect(actual, path).toBe(expected);
}
