import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TEST_DIR = "test";

/**
 * A file that rewires the module registry — replacing what a specifier resolves to, or
 * throwing the whole registry away — cannot share one. `vi.mock` is exactly that: it is not
 * a per-test spy that a `restoreAllMocks` can put back, it is a decision about which module
 * object a specifier evaluates to, and under `isolate: false` that decision is CACHED and
 * outlives the file that made it.
 */
const REWIRES_REGISTRY = /(^|\n)[ \t]*vi\.(mock|doMock)\(/;

/**
 * The files that must keep a module registry to themselves.
 *
 * Three kinds qualify, and all three are detected from the source rather than listed by hand,
 * because a hand-written list is a thing that rots silently and the failure it produces
 * (state leaking between files) does not look like a config mistake:
 *
 *   - anything importing `test/gasEnv.ts` (or the local equivalent that resets modules and
 *     aliases `window` before evaluating the GAS shims);
 *   - anything calling `vi.resetModules()` directly;
 *   - anything calling `vi.mock()` / `vi.doMock()`.
 *
 * A shared registry plus `resetModules()` is precisely the hazard `isolate` exists for: one
 * file's reset would pull the rug from under the next file's already-bound imports. A sibling
 * package (gas_devsecops) measured this leaking at roughly one run in two before the third
 * clause (`vi.mock`) was added here — two files mocking the same module with different
 * factories, whichever ran first won the shared registry for both. Detecting the CALL and not
 * the string, so a file that only mentions `vi.mock` in prose stays in the fast project.
 */
function statefulFiles(): string[] {
  return readdirSync(join(HERE, TEST_DIR))
    .filter((f) => /\.test\.[cm]?[jt]sx?$/.test(f))
    .filter((f) => {
      const src = readFileSync(join(HERE, TEST_DIR, f), "utf8");
      return src.includes("gasEnv") || src.includes("vi.resetModules")
        || REWIRES_REGISTRY.test(src);
    })
    .sort()
    .map((f) => `${TEST_DIR}/${f}`);
}

const STATEFUL = statefulFiles();

/**
 * `npm run test:exact` sets this. It collapses the two projects back into one fully
 * isolated run — the workload this suite had before it was made fast. It is the answer to
 * "did the fast path just hide a state leak?", and it is the reason the fast path is
 * allowed to exist at all.
 */
const EXACT = process.env["GAS_TEST_FULL_ISOLATION"] === "1";

/** Root-relative, so `include`/`exclude` below can name files the same way. */
const ALL_TESTS = `${TEST_DIR}/**/*.test.?([cm])[jt]s?(x)`;

const common = {
  /**
   * `threads` over v4's `forks` default: the faster pool on a suite this size, and forked
   * child processes get a smaller call stack, which some stress tests in this suite exceed.
   * The pool is load-bearing, not a preference.
   */
  pool: "threads" as const,

  /**
   * 30s, against vitest's 5s default. A margin around scheduling contention when many files
   * boot shared fixtures under parallel workers; if a test takes 30s it is generally stuck,
   * and that is worth failing on. A floor, not a ceiling — a genuinely large stress case may
   * opt out on measurement, not preference, the way `gas_devsecops/test/remediation.test.ts`
   * documents for its own N=200,000 cases.
   */
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({
  test: {
    ...common,

    /**
     * Persists the transform cache to disk between runs, so the edit-run-edit loop stops
     * re-paying for modules it did not touch. Clear it with `vitest --clearCache`.
     */
    experimental: { fsModuleCache: true },

    // `dir` scopes the file search; the projects below use root-relative globs instead,
    // because setting both makes the patterns resolve against `test/test/`, which silently
    // matches nothing and hands every file to whichever project has no `include`.
    dir: TEST_DIR,

    ...(EXACT
      ? { isolate: true }
      : {
          projects: [
            {
              // Nothing here rewires the registry: no `vi.mock`, no `vi.resetModules()`,
              // no gasEnv-style boot. That is the property that lets these files share a
              // worker, so the module graph gets executed once per worker instead of once
              // per file. A new `src/server` import into this project is not automatically
              // safe — check its top-level `let`s/mutable module state before adding one,
              // the way gas_devsecops's own copy of this file documents for its two
              // exceptions (serverCache's version memos, sheetsDb's spreadsheet cache).
              test: {
                ...common,
                name: "pure",
                include: [ALL_TESTS],
                exclude: ["**/node_modules/**", "**/.git/**", ...STATEFUL],
                isolate: false,
              },
            },
            {
              test: { ...common, name: "stateful", include: STATEFUL, isolate: true },
            },
          ],
        }),
  },
});
