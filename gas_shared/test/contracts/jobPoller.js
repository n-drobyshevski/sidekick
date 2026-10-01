// The job poll (`gas_shared/ui/jobPoller.js`), under fake timers, and each register's binding of
// it in its own app.js — gas/'s scan card and gas_devsecops's sync card.
//
// THE POLL ITSELF is the same module in both apps, so its timing cases (moved here from
// gas_devsecops/test/syncProgress.test.js when the poller was lifted) run once per registering
// app against that one module: a hand-held `fetchJob` decides when each answer lands, and a
// stand-in `document` carries the `hidden` flag and the `visibilitychange` listeners.
//
// THE BINDING is what differs, and it is the half that broke before: gas polled with a 3 s
// `setInterval` that stacked requests behind a slow GAS execution and could hand two DONEs to
// `applyJob` (two "Scan complete." toasts, two `refresh()`es); devsecops's went through
// `swrCall`, whose cached and revalidated answers both reached `applyJob`. So the app's own
// app.js source is held to: the poll is `createJobPoller` imported from gas_shared, its fetch a
// plain `call("api_getJobStatus", { jobId })`, and no interval or cached job fetch of its own.

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {Function} ctx.beforeEach
 * @param {Function} ctx.afterEach
 * @param {object}   ctx.vi          vitest's `vi` (fake timers, spies) — a contract is not a
 *                                   test file, so it cannot import vitest itself
 * @param {string}   ctx.app
 * @param {object}   ctx.poller      the module as the app imports it:
 *                                   `{ createJobPoller, shouldContinuePolling, POLL_VISIBLE_MS,
 *                                   POLL_HIDDEN_MS }`
 * @param {string}   ctx.appSrc      the app's src/client/js/app.js, read as text
 */
export function registerJobPollerContract(ctx) {
  const { describe, it, expect, beforeEach, afterEach, vi, app, appSrc } = ctx;
  const { createJobPoller, shouldContinuePolling, POLL_VISIBLE_MS, POLL_HIDDEN_MS } = ctx.poller;

  /** A running job summary; the poll reads only `phase` (and the tests read `job_id`). */
  const job = (overrides = {}) => ({ job_id: "job-1", phase: "FETCHING", ...overrides });

  function harness({ onJob = null } = {}) {
    const answers = []; // queued resolvers, oldest first
    const fetched = [];
    const seen = [];
    const listeners = new Set();
    const doc = {
      hidden: false,
      addEventListener: (type, fn) => { if (type === "visibilitychange") listeners.add(fn); },
      removeEventListener: (type, fn) => { if (type === "visibilitychange") listeners.delete(fn); },
    };
    const poller = createJobPoller({
      fetchJob: (jobId) => new Promise((resolve, reject) => {
        fetched.push(jobId);
        answers.push({ resolve, reject });
      }),
      onJob: (j) => { seen.push(j); if (onJob) onJob(j); },
      doc,
    });
    /** Answer the oldest outstanding request and let its continuation run. */
    const answer = async (value) => {
      answers.shift().resolve(value);
      await vi.advanceTimersByTimeAsync(0);
    };
    const fail = async () => {
      answers.shift().reject(new Error("transient"));
      await vi.advanceTimersByTimeAsync(0);
    };
    const setHidden = (h) => {
      doc.hidden = h;
      for (const fn of [...listeners]) fn();
    };
    return { poller, fetched, seen, answer, fail, setHidden, listeners };
  }

  describe(app + ": shouldContinuePolling — the one stop rule", () => {
    it("stops on a null job — nothing running, never started or already reclaimed", () => {
      expect(shouldContinuePolling(null)).toBe(false);
      expect(shouldContinuePolling(undefined)).toBe(false);
    });

    it("stops on every terminal phase", () => {
      for (const phase of ["DONE", "FAILED", "CANCELLED"]) {
        expect(shouldContinuePolling(job({ phase })), phase).toBe(false);
      }
    });

    it("continues through every non-terminal phase either register's jobs tab writes", () => {
      for (const phase of [
        "FETCHING", "RECONCILING", "PERSISTING", "REPLAYING", "STAGING", "APPLYING", "FINALIZING",
        "BACKFILLING", "PURGING",
      ]) {
        expect(shouldContinuePolling(job({ phase })), phase).toBe(true);
      }
    });
  });

  describe(app + ": createJobPoller — the job poll app.js drives", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("polls every 3 s in view and every 15 s hidden", () => {
      expect(POLL_VISIBLE_MS).toBe(3000);
      expect(POLL_HIDDEN_MS).toBe(15000);
    });

    it("ticks at once, then every 3 s while the tab is in view", async () => {
      const h = harness();
      h.poller.watch("job-1");
      expect(h.fetched).toEqual(["job-1"]); // the card paints now, not one interval from now
      await h.answer(job());
      await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS - 1);
      expect(h.fetched).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.fetched).toHaveLength(2);
      expect(h.seen).toHaveLength(1);
    });

    it("never has two requests out: the next tick waits for a slow answer", async () => {
      const h = harness();
      h.poller.watch("job-1");
      await vi.advanceTimersByTimeAsync(10 * POLL_VISIBLE_MS); // a GAS execution that takes 30 s
      expect(h.fetched).toHaveLength(1);
      await h.answer(job());
      await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS);
      expect(h.fetched).toHaveLength(2);
    });

    for (const phase of ["DONE", "FAILED", "CANCELLED"]) {
      it(`hands a ${phase} job over exactly once and stops`, async () => {
        const h = harness();
        h.poller.watch("job-1");
        await h.answer(job({ phase }));
        expect(h.seen.map((j) => j.phase)).toEqual([phase]);
        expect(h.poller.isRunning()).toBe(false);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.fetched).toHaveLength(1);
        expect(h.seen).toHaveLength(1); // one "complete" toast, one refresh()
        expect(h.listeners.size).toBe(0);
      });
    }

    // `applyJob` repaints the card and the drawer; a throw there used to skip the reschedule,
    // so the poll stopped for good while isRunning() still said true.
    it("keeps polling when onJob throws on a running job, and logs it", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      let throws = true;
      const h = harness({ onJob: () => { if (throws) throw new Error("paint failed"); } });
      h.poller.watch("job-1");
      await h.answer(job());
      expect(err).toHaveBeenCalledTimes(1);
      expect(h.poller.isRunning()).toBe(true);
      await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS);
      expect(h.fetched).toHaveLength(2);
      throws = false;
      await h.answer(job({ phase: "DONE" }));
      expect(h.seen.map((j) => j.phase)).toEqual(["FETCHING", "DONE"]);
      expect(h.poller.isRunning()).toBe(false);
      err.mockRestore();
    });

    it("a terminal answer whose onJob throws still stops, without an unhandled rejection", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const h = harness({ onJob: () => { throw new Error("paint failed"); } });
      h.poller.watch("job-1");
      await h.answer(job({ phase: "DONE" }));
      expect(err).toHaveBeenCalledTimes(1);
      expect(h.poller.isRunning()).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.fetched).toHaveLength(1);
      err.mockRestore();
    });

    it("stops on a null job — nothing running, never started or already reclaimed", async () => {
      const h = harness();
      h.poller.watch("job-1");
      await h.answer(null);
      expect(h.seen).toEqual([null]);
      expect(h.poller.isRunning()).toBe(false);
    });

    it("keeps polling through a failed fetch, and hands nothing over for it", async () => {
      const h = harness();
      h.poller.watch("job-1");
      await h.fail();
      expect(h.seen).toEqual([]);
      await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS);
      expect(h.fetched).toHaveLength(2);
    });

    it("slows to 15 s while hidden, and ticks at once when the tab comes back", async () => {
      const h = harness();
      h.poller.watch("job-1");
      h.setHidden(true);
      await h.answer(job());
      await vi.advanceTimersByTimeAsync(POLL_HIDDEN_MS - 1);
      expect(h.fetched).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.fetched).toHaveLength(2);
      await h.answer(job());
      await vi.advanceTimersByTimeAsync(1000);
      h.setHidden(false);
      expect(h.fetched).toHaveLength(3); // no wait for the 15 s timer
      await h.answer(job());
      await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS);
      expect(h.fetched).toHaveLength(4);
    });

    it("coming back into view while a request is out does not send a second", async () => {
      const h = harness();
      h.poller.watch("job-1");
      h.setHidden(true);
      h.setHidden(false);
      expect(h.fetched).toHaveLength(1);
    });

    it("drops the answer of a request a stop() overtook", async () => {
      const h = harness();
      h.poller.watch("job-1");
      h.poller.stop();
      await h.answer(job({ phase: "DONE" }));
      expect(h.seen).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.fetched).toHaveLength(1);
    });

    it("re-pointed at a new job, ignores the old one's late answer and polls the new one", async () => {
      const h = harness();
      h.poller.watch("job-1");
      h.poller.watch("job-2");
      expect(h.fetched).toEqual(["job-1", "job-2"]);
      await h.answer(job({ job_id: "job-1", phase: "DONE" }));
      expect(h.seen).toEqual([]);
      expect(h.poller.isRunning()).toBe(true);
      await h.answer(job({ job_id: "job-2" }));
      expect(h.seen.map((j) => j.job_id)).toEqual(["job-2"]);
      await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS);
      expect(h.fetched).toEqual(["job-1", "job-2", "job-2"]);
    });
  });

  // The app's half: what it builds its poll from, and what it no longer does beside it.
  describe(app + ": app.js polls through the shared createJobPoller and a plain call()", () => {
    it("imports createJobPoller from gas_shared/ui/jobPoller.js", () => {
      expect(appSrc).toMatch(
        /import \{[^}]*\bcreateJobPoller\b[^}]*\} from "(\.\.\/)+gas_shared\/ui\/jobPoller\.js";/,
      );
    });

    it("builds its poll with a plain call() per tick", () => {
      expect(appSrc).toMatch(
        /createJobPoller\(\{\s*fetchJob: \(jobId\) => call\("api_getJobStatus", \{ jobId \}\)/,
      );
    });

    it("keeps no interval and no cached job fetch of its own", () => {
      expect(appSrc).not.toMatch(/setInterval|clearInterval/);
      expect(appSrc).not.toMatch(/swrCall\("api_getJobStatus"/);
    });
  });
}
