// Pins ONE thing: `api.getChartsBundle` hands back runnable JavaScript, not the HTML partial
// GAS stores it in. Ported from gas_ai/test/chartsBundle.test.ts's third case only — that
// file also pins the split (Chart.js out of js_app.html, in js_charts.html) and a byte-size
// ceiling on the main bundle; this register's build is identical in shape, so re-proving the
// split here would be re-testing esbuild.config.mjs, not this endpoint. Keep this file to
// executability.
//
// WHY THIS MATTERS: `src/client/js/chartsLoader.js` fetches this string over
// `google.script.run` and EXECUTES it — `new Function(src)()`, a `<script>` element's
// `textContent`, or a `blob:` URL, whichever the deployment's undocumented CSP allows (see
// that file's header). `HtmlService.createHtmlOutputFromFile` can only ever return the
// content of an HTML FILE, wrapper included, because a GAS project has no way to store a
// bare `.js` file — `include()` reads `.html` too. If the endpoint forwards that wrapper
// unstripped, every one of the loader's three mechanisms is handed a string starting with
// `<script>`, which is not JavaScript, and all seven chart pages fall back to "Chart
// unavailable in this deployment" — regardless of what the sandbox would have allowed.
//
// WHAT THIS CANNOT PROVE. Whether the HtmlService iframe's undocumented CSP actually
// consents to running string-sourced code is a question this file has no way to answer:
// `dev/serve.mjs`, which stands in for GAS here, sets no CSP at all, so `runInNewContext`
// below succeeds unconditionally the way every one of the loader's three mechanisms would
// succeed against a policy that permits nothing. This only proves the endpoint hands the
// loader something worth attempting — never that the deployed sandbox will let it run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";

const ROOT = join(__dirname, "..");

let server: Awaited<ReturnType<typeof bootServer>>;

beforeAll(async () => {
  server = await bootServer();
  // The dev shim's HtmlService reaches for XMLHttpRequest, which Node has not got (see
  // dev/gas-shims.js). This fake reads the same file GAS would hold — the actual build
  // output at dist/js_charts.html — so the endpoint under test sees real content, not a
  // string made up for the test.
  (globalThis as Record<string, unknown>)["HtmlService"] = {
    createHtmlOutputFromFile(name: string) {
      const content = readFileSync(join(ROOT, "dist", `${name}.html`), "utf8");
      return { getContent: () => content };
    },
  };
});

afterAll(() => teardownServer());

describe("the endpoint hands over source, not markup", () => {
  it("strips the <script> wrapper and returns something the loader's mechanisms can run", () => {
    const res = server.api.getChartsBundle({}) as { ok: boolean; data?: string };
    expect(res.ok).toBe(true);
    const src = res.data!;
    expect(src.indexOf("<script")).toBe(-1);
    expect(src.indexOf("</script>")).toBe(-1);

    // A window with just enough for chart.js's environment probes and for the loader's own
    // hand-off (`setChartTipHandler`). If this needed much more it would be a sign the bundle
    // had grown a dependency on the app around it.
    const win: Record<string, unknown> = {
      matchMedia: () => ({ matches: false }),
      devicePixelRatio: 1,
      addEventListener() {},
      removeEventListener() {},
      document: {
        createElement: () => ({ style: {}, getContext: () => null }),
        documentElement: { style: {} },
      },
    };
    win["window"] = win;
    runInNewContext(src, win);

    const api = win["__WSK_CHARTS__"] as Record<string, unknown> | undefined;
    expect(api, "the bundle ran without defining __WSK_CHARTS__").toBeTruthy();

    // The names the pages actually call, measured off src/client/js/pages/*.js and
    // chartsLoader.js — not the wider export list chartsBundle.js happens to carry.
    for (const name of [
      "ACCENT",
      "destroyChart",
      "setChartTipHandler",
      "trendLine",
      "survivalCurve",
      "severityBar",
      "stackedAgeBar",
      "openResolvedLines",
      "coverageEfficiencyLines",
      "coverageEfficiencyScatter",
    ]) {
      expect(typeof api![name], `__WSK_CHARTS__.${name}`).not.toBe("undefined");
    }
    expect(typeof api!["setChartTipHandler"]).toBe("function");
  });
});
