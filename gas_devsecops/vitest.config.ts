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
 *   - anything importing `test/gasEnv.ts`, whose `bootServer()` calls `vi.resetModules()`
 *     and aliases `window` to `globalThis` before evaluating the GAS shims;
 *   - anything calling `vi.resetModules()` directly;
 *   - anything calling `vi.mock()` / `vi.doMock()`.
 *
 * A shared registry plus `resetModules()` is precisely the hazard `isolate` exists for: one
 * file's reset would pull the rug from under the next file's already-bound imports.
 *
 * THE THIRD CLAUSE WAS PAID FOR. `vi.mock` was missing from this rule and it made `npm run
 * check` flake at roughly one run in two, in two different files with two different faces:
 *
 *   - `readModels.test.ts` and `registerRows.test.ts` both mock `src/server/serverCache`,
 *     `ledgerStore`, `jobsStore` and friends, with DIFFERENT factories. Whichever ran first
 *     put its `src/server/readModels` into the shared registry, mocks and all, and the other
 *     imported that one — so the second file's paging, clamp and nulls-last assertions were
 *     answered by the first file's memo table. Measured, `pure`, one worker, cleared
 *     sequencer cache: `readModels.test.ts registerRows.test.ts` fails 5 in registerRows;
 *     `registerRows.test.ts readModels.test.ts` fails 49 in readModels; each alone passes.
 *   - `sampleData.test.ts` mocks `src/server/props` with an in-memory object. `serverCache.ts`
 *     reads DATA_VERSION and WIZ_PROJECT_ID_V2 through `getProp`, so it kept that object and
 *     never saw `serverCache.test.ts`'s own `PropertiesService` stub: its property-read counts
 *     came back 0 instead of 1 and its config stamp stayed pinned at sha1("") = da39a3ee.
 *     Measured: `sampleData.test.ts serverCache.test.ts` fails exactly those 3.
 *
 * Detecting the CALL and not the string, so a file that only mentions `vi.mock` in prose
 * stays in the fast project.
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
   * `threads` over v4's `forks` default, for two reasons. It is the faster pool on a suite
   * this size, and forked child processes get a smaller call stack than worker threads do —
   * `util.test.ts`'s `maxNum`/`minNum`/`pushAll` guards spread millions of arguments on
   * purpose (that is the whole point of the test; see its own header comment for the
   * measured boundary and the margin chosen above it) and some stress cases in
   * `remediation.test.ts` reach the same helpers at register scale. The pool is load-bearing,
   * not a preference. (This comment previously named `minIso` and 200_000 — neither is
   * accurate: `minIso` folds rather than spreads and carries no such test, and the guard's N
   * was raised past 200_000 once 200_000 was measured not to overflow even under `threads`.)
   */
  pool: "threads" as const,

  /**
   * 30s, against vitest's 5s default.
   *
   * This began as a margin around scheduling contention: files that booted a whole server
   * per test starved past 5s under file parallelism, and `npm run check` went red at random.
   * That workload is gone — the boots are shared now — and what is left is a hang-catcher:
   * if a test takes 30s it is generally stuck, and that is worth failing on.
   *
   * IT IS A FLOOR, NOT A CEILING, and two tests have opted out on measurement rather than on
   * preference. `test/remediation.test.ts`'s two N=200,000 stress cases take 17.6s and 19.1s
   * running alone and cross 30s under the `pure` project's worker sharing (31.3s / 40.6s
   * observed) while behaving correctly — see `STRESS_TIMEOUT_MS` there for the numbers and
   * for why N cannot be traded away to buy wall time. The claim "the slowest test is well
   * under a second", which this comment used to make, was false when it was written.
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
              // Nothing here rewires the registry: no `vi.mock`, no `vi.resetModules()`,
              // no `gasEnv` boot. That is the property that lets these files share a worker,
              // and the domain graph then gets executed once per worker instead of once per
              // file.
              //
              // "No server" is what this comment used to claim and it was never true — five
              // files reach into `src/server`, and one of them, `serverCache.test.ts`, is
              // what the `vi.mock` clause above was written to protect. What holds instead,
              // and was measured rather than assumed: `src/domain` has no module-level
              // mutable state at all (every top-level `let` is function-local, every
              // top-level Map/Set is a lookup table built once), and the server modules this
              // project does pull in hold exactly two mutable module-level values between
              // them —
              //
              //   - `serverCache.ts`'s three version memos, reached only by
              //     `serverCache.test.ts`, which drops them in `beforeEach` via
              //     `__resetMemosForTest()`;
              //   - `sheetsDb.ts`'s `spreadsheetCache`, which only `openSpreadsheet()`
              //     writes; the three files importing `sheetsDb` here take `TABS` /
              //     `TAB_HEADERS` and nothing else, so it stays null for the whole run.
              //
              // A new `src/server` import into this project is therefore not automatically
              // safe — check its top-level `let`s before adding one.
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
