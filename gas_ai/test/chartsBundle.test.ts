// The Chart.js bundle, off the critical path.
//
// Chart.js is one pre-bundled 131 KB module that cannot be tree-shaken (the measurement is in
// src/client/js/charts.js's header), so the only lever left is not shipping it on the eight
// routes that draw nothing. It is built separately into `dist/js_charts.html` and fetched over
// `google.script.run` by the first route that draws a chart.
//
// THREE THINGS CAN BREAK SILENTLY, and none of them would fail a type check or a render:
//
//  1. The split stops splitting. Someone re-imports `charts.js` from a page module and
//     Chart.js is back in js_app.html — the app still works, every route just pays for it
//     again. The size assertion below is the only thing that would notice.
//  2. The endpoint stops returning runnable source. `getChartsBundle` unwraps a `<script>`
//     element by hand, and an off-by-one there yields a string the client cannot execute.
//  3. The bundle stops defining the global. `chartsBundle.js` assigns `window.__WSK_CHARTS__`
//     and nothing imports it, so nothing but this would catch its removal.
//
// What is NOT tested here, and cannot be: whether the HtmlService sandbox permits executing
// source obtained at runtime. Google documents no CSP for it, and `dev/serve.mjs` sets none,
// so every mechanism succeeds here regardless of what the deployed app would do. That is why
// chartsLoader.js tries three and degrades visibly rather than assuming one.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";

const ROOT = join(__dirname, "..");
const read = (name: string) => readFileSync(join(ROOT, "dist", name), "utf8");

let server: Awaited<ReturnType<typeof bootServer>>;

beforeAll(async () => {
  server = await bootServer();
  // The dev shim reaches for XMLHttpRequest, which Node has not got. Same contract, read off
  // the same file GAS would hold.
  (globalThis as Record<string, unknown>)["HtmlService"] = {
    createHtmlOutputFromFile(name: string) {
      const content = read(`${name}.html`);
      return { getContent: () => content };
    },
  };
});

afterAll(() => teardownServer());

describe("the split holds", () => {
  it("keeps Chart.js out of the bundle every route pays for", () => {
    const app = read("js_app.html");
    // Chart.js's own error strings, which minification keeps verbatim. Their absence from
    // js_app.html and presence in js_charts.html IS the split.
    for (const marker of ["This method is not implemented", "_chartjs", "radialLinear"]) {
      expect(app.indexOf(marker), `js_app.html still carries ${JSON.stringify(marker)}`)
        .toBe(-1);
    }
    // And present next door, so the absence above is a split rather than a typo. Two of the
    // three are the unregistered components charts.js's header proves cannot be dropped —
    // `radialLinear` is RadialLinearScale's own key — which makes them a reliable tracer for
    // "chart.js is in this file".
    const charts = read("js_charts.html");
    for (const marker of ["This method is not implemented", "_chartjs", "radialLinear"]) {
      expect(charts.indexOf(marker), `js_charts.html is missing ${JSON.stringify(marker)}`)
        .toBeGreaterThan(0);
    }
  });

  it("leaves the main bundle well under what it weighed with Chart.js in it", () => {
    // 734,213 bytes before the split, 562,434 after — a 171,779-byte cut, which is 23.4% of
    // the bundle and 18.9% of the ~906 KB doGet inlines once styles.html is counted. The
    // bound is loose on purpose: it exists to catch Chart.js coming back, not to police
    // ordinary growth.
    const bytes = statSync(join(ROOT, "dist/js_app.html")).size;
    expect(bytes).toBeLessThan(650_000);
  });
});

describe("the endpoint hands over source, not markup", () => {
  it("returns the bundle with its <script> wrapper removed", () => {
    const res = server.api.getChartsBundle({}) as { ok: boolean; data?: string };
    expect(res.ok).toBe(true);
    const src = res.data!;
    expect(src.indexOf("<script")).toBe(-1);
    expect(src.indexOf("</script>")).toBe(-1);
    expect(src.length).toBeGreaterThan(100_000);
  });

  it("returns source that defines the global the loader claims", () => {
    const src = (server.api.getChartsBundle({}) as { data: string }).data;
    // A window with just enough for chart.js's environment probes. If this needed much more
    // it would be a sign the bundle had grown a dependency on the app around it.
    const win: Record<string, unknown> = {
      matchMedia: () => ({ matches: false }),
      devicePixelRatio: 1,
      addEventListener() {},
      removeEventListener() {},
      document: { createElement: () => ({ style: {}, getContext: () => null }), documentElement: { style: {} } },
    };
    win["window"] = win;
    runInNewContext(src, win);
    const api = win["__WSK_CHARTS__"] as Record<string, unknown> | undefined;
    expect(api, "the bundle ran without defining __WSK_CHARTS__").toBeTruthy();
    // The four the loader and the two call sites between them use. `setChartTipHandler` is
    // the one worth naming: it is how the app's hover card reaches a bundle that must not
    // import ui/tip.js, and losing it would silently cost every chart its tooltip.
    for (const name of ["trendLine", "coverCurve", "setChartTipHandler", "ACCENT"]) {
      expect(typeof api![name], `__WSK_CHARTS__.${name}`).not.toBe("undefined");
    }
    expect(typeof api!["setChartTipHandler"]).toBe("function");
  });

  it("refuses rather than answering with an empty string", () => {
    // A deployment that never got the file. The client would try to run whatever came back,
    // so "" must be an error and not an answer.
    const saved = (globalThis as Record<string, unknown>)["HtmlService"];
    (globalThis as Record<string, unknown>)["HtmlService"] = {
      createHtmlOutputFromFile: () => ({ getContent: () => "<script>\n\n</script>\n" }),
    };
    try {
      const res = server.api.getChartsBundle({}) as { ok: boolean; error?: string };
      expect(res.ok).toBe(false);
      expect(String(res.error)).toContain("js_charts");
    } finally {
      (globalThis as Record<string, unknown>)["HtmlService"] = saved;
    }
  });
});
