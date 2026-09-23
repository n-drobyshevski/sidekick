// Chart.js used to be requested by the first chart to draw — after that page's data — so every
// chart page paid two GAS calls back to back (measured on the MTTR page: 3.3 s then 2.5 s). The
// shell now calls `afterFirstRoute` once the first route after a boot has settled, and this app
// starts the bundle there, on idle. The landing page, which draws no chart, still paints first.
// Read as source, the house pattern for the DOM half of the app.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APP = readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("../../gas_shared/shell/appShell.js", import.meta.url), "utf8");

describe("Chart.js prefetch after the first route", () => {
  it("hands the shell a prefetch that starts loadCharts on idle", () => {
    expect(APP).toMatch(/afterFirstRoute:\s*prefetchCharts/);
    const fn = APP.slice(APP.indexOf("function prefetchCharts("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("loadCharts()");
    expect(body).toContain("requestIdleCallback");
  });

  it("calls afterFirstRoute only as the first route after a boot settles", () => {
    const fin = SHELL.slice(SHELL.indexOf("async function route("));
    const hook = fin.indexOf("spec.afterFirstRoute()");
    expect(hook).toBeGreaterThan(-1);
    // Inside the `finally`, gated on firstRoute, before firstRoute is cleared.
    const finallyAt = fin.lastIndexOf("} finally {", hook);
    expect(finallyAt).toBeGreaterThan(-1);
    expect(fin.slice(finallyAt, hook)).toContain("firstRoute && spec.afterFirstRoute");
    expect(fin.indexOf("firstRoute = false", hook)).toBeGreaterThan(hook);
  });
});
