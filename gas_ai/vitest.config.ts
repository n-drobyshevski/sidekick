import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TEST_DIR = "test";

/**
 * The files that must keep a module registry to themselves.
 *
 * Two kinds qualify, and both are detected from the source rather than listed by hand,
 * because a hand-written list is a thing that rots silently and the failure it produces
 * (state leaking between files) does not look like a config mistake:
 *
 *   - anything importing `test/gasEnv.ts`, whose `bootServer()` calls `vi.resetModules()`
 *     and aliases `window` to `globalThis` before evaluating the GAS shims;
 *   - anything calling `vi.resetModules()` directly.
 *
 * A shared registry plus `resetModules()` is precisely the hazard `isolate` exists for: one
 * file's reset would pull the rug from under the next file's already-bound imports.
 */
function statefulFiles(): string[] {
  return readdirSync(join(HERE, TEST_DIR))
    .filter((f) => /\.test\.[cm]?[jt]sx?$/.test(f))
    .filter((f) => {
      const src = readFileSync(join(HERE, TEST_DIR, f), "utf8");
      return src.includes("gasEnv") || src.includes("vi.resetModules");
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
   * `threads` over v4's `forks` default, for two reasons. It is the faster pool on a suite
   * this size, and forked child processes get a smaller call stack: `util.test.ts` spreads
   * 200_000 arguments into `minIso` on purpose — that is the whole point of the test — and
   * it overflows under `forks` while passing under `threads`. The pool is load-bearing, not
   * a preference.
   */
  pool: "threads" as const,

  /**
   * 30s, against vitest's 5s default.
   *
   * This began as a margin around scheduling contention: files that booted a whole server
   * per test starved past 5s under file parallelism, and `npm run check` went red at random.
   * That workload is gone — the boots are shared now, and the slowest file is well under a
   * second. What is left is a hang-catcher. If a test takes 30s something is genuinely
   * stuck, and that is worth failing on.
   */
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({
  test: {
    ...common,

    /**
     * Persists the transform cache to disk between runs. This suite is a large module graph
     * (~1 MB of `src/domain`, ~500 KB of `src/server`) behind a small number of tests per
     * file, which is exactly the shape this helps: the edit-run-edit loop stops re-paying
     * for modules it did not touch. Clear it with `vitest --clearCache`.
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
              // No server, no `vi.resetModules()`, and `src/domain` holds no module-level
              // mutable state at all — every top-level `let` is function-local and every
              // top-level Map/Set is a lookup table built once. So these files can share a
              // worker, and the domain graph gets executed once per worker instead of once
              // per file.
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
