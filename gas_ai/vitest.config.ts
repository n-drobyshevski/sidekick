import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * 30s, against vitest's 5s default.
     *
     * The default was never a meaningful assertion about this suite. A large share of these
     * files boot a whole server per test — `bootServer()` does `vi.resetModules()` and re-imports
     * the server graph against the GAS shims — and several then run a full dry-run sync. In
     * isolation those land around half a second to four and a half; under `vitest run`'s file
     * parallelism, with ~96 files competing for a worker pool sized to the machine, the same
     * work starves past 5s often enough that `npm run check` went red at random.
     *
     * Raised rather than papered over per test: it was catching scheduling contention, not slow
     * code, and the failures moved from file to file as the suite grew. A check that goes red
     * for reasons unrelated to the change under test teaches people to stop reading it, which
     * costs more than any real regression this timeout would have caught.
     *
     * If a test genuinely hangs, 30s still ends it — this is a margin, not an amnesty.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
