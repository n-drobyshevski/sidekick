// HIDING A CANVAS IS NOT ONE ASSIGNMENT — CHART.JS UNDOES IT.
//
// `DomPlatform.initCanvas` records `{display, height, width}` off `canvas.style` when a chart
// is constructed and forces `display: block`; `releaseContext` replays that record key by key
// on destroy. So a canvas that was `display: ""` when its chart was built is restored to `""`
// — VISIBLE — by its own teardown, however many times the caller set it to `"none"` first. And
// the teardown here sits behind the lazy chart-bundle import (`chartsLoader.js`), so it always
// lands after the caller's synchronous hide, never before it.
//
// MEASURED on the dev harness at 2026-09-08, one click of the MTTR by-domain lens swap: the
// outgoing canvas came back as a bare 300x150 `display: inline` element inside a 240px
// `.chart-box` and pushed the incoming chart 150px down, over its own caption and into the
// table beneath it. Three call sites had the defective shape (`pages/mttr.js`'s `showMsg` and
// its lens swap, `pages/overview.js`'s `showMsg`); all three go through the helper this file
// pins.
//
// WHAT IS ASSERTED IS THE ORDER, not the words. The fake loader below resolves a `destroyChart`
// that does what Chart.js's really does — write the recorded `display` back onto the canvas —
// so a helper that hides only before the teardown fails here for the same reason it failed on
// screen. The second describe covers the re-entrancy the predicate exists for: on the first
// swap of a session the bundle may still be in flight, and that window is wide enough for a
// reader to swap back.
//
// No DOM (vitest.config.ts sets no `environment`): a canvas here is `{style: {display}}`, which
// is the whole surface the helper touches.

import { describe, expect, it } from "vitest";

import { hideChartWhenSettled } from "../src/client/js/charts.js";

/** A canvas as this helper sees it, plus the one Chart.js behaviour that matters. */
function fakeCanvas(initialDisplay = "") {
  return { style: { display: initialDisplay }, recorded: initialDisplay };
}

/** A resolved loader whose `destroyChart` replays the recorded `display`, exactly as
 *  `DomPlatform.releaseContext` does. */
function loaderThatRestores() {
  return () => Promise.resolve({
    destroyChart(canvas) {
      canvas.style.display = canvas.recorded;
    },
  });
}

/** A loader that never resolves a bundle — the deployment that cannot run Chart.js at all. */
function loaderThatRefuses() {
  return () => Promise.reject(new Error("no way to run the charts bundle in this deployment"));
}

describe("hideChartWhenSettled: the canvas stays hidden THROUGH the teardown", () => {
  it("hides immediately, so the swap is not waiting on a network import", async () => {
    const canvas = fakeCanvas("");
    const p = hideChartWhenSettled(canvas, loaderThatRestores(), () => true);
    expect(canvas.style.display).toBe("none"); // before any await
    await p;
  });

  it("is still hidden after the destroy has restored the pre-chart display", async () => {
    const canvas = fakeCanvas("");
    await hideChartWhenSettled(canvas, loaderThatRestores(), () => true);
    expect(canvas.style.display).toBe("none");
  });

  it("hides even when the chart bundle never loads — there is nothing to restore", async () => {
    const canvas = fakeCanvas("");
    await hideChartWhenSettled(canvas, loaderThatRefuses(), () => true);
    expect(canvas.style.display).toBe("none");
  });

  // PERTURBATION. The shape all three call sites had: destroy in a fire-and-forget `.then`,
  // hide synchronously beside it. Reproduced inline over the SAME fake canvas and loader, so
  // the failure is visible here rather than described — it ends `display: ""`, which is what
  // put a 300x150 ghost canvas inside a 240px chart box.
  it("is not a vacuous guard — hiding only before the teardown leaves the canvas visible", async () => {
    const canvas = fakeCanvas("");
    const load = loaderThatRestores();

    const inflight = load().then((charts) => charts.destroyChart(canvas)).catch(() => {});
    canvas.style.display = "none";
    expect(canvas.style.display).toBe("none"); // looks right, synchronously
    await inflight;

    expect(canvas.style.display).toBe(""); // and is visible again a microtask later
    expect(canvas.style.display).not.toBe("none");
  });
});

describe("hideChartWhenSettled: a swap back while the teardown is in flight wins", () => {
  /** The scenario: the bundle is STILL LOADING when the reader swaps back, so by the time the
   *  teardown runs this canvas is the live lens again and is on screen. */
  function swapBackDuringTeardown() {
    const canvas = fakeCanvas("");
    const state = { hidden: true };
    const load = () => Promise.resolve({
      destroyChart(c) {
        c.style.display = c.recorded; // Chart.js's own restore
        state.hidden = false;         // the reader swapped back...
        c.style.display = "";         // ...and the lens was shown again
      },
    });
    return { canvas, state, load };
  }

  it("leaves the canvas alone when it is no longer the one to hide", async () => {
    const { canvas, state, load } = swapBackDuringTeardown();
    await hideChartWhenSettled(canvas, load, () => state.hidden);
    expect(canvas.style.display).toBe("");
  });

  // PERTURBATION. Drop the predicate — re-hide unconditionally once the teardown settles, the
  // obvious simplification of the helper — and the SAME scenario blanks the card the reader is
  // looking at. Reproduced inline rather than described.
  it("is not a vacuous guard — an unconditional re-hide blanks the live lens", async () => {
    const { canvas, load } = swapBackDuringTeardown();

    const withoutPredicate = (c, ld) => {
      c.style.display = "none";
      return ld().then((charts) => charts.destroyChart(c), () => {})
        .then(() => { c.style.display = "none"; });
    };
    await withoutPredicate(canvas, load);

    expect(canvas.style.display).toBe("none");
    expect(canvas.style.display).not.toBe("");
  });
});
