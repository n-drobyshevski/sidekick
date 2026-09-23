// The MTTR page used to fetch the Chart.js bundle only when its first chart drew — after
// getMttrPage answered — so the two GAS calls ran back to back, each with its own ~1.5–2 s of
// per-call overhead (measured on gas/'s MTTR page, PR #331). The bundle now starts with the
// data. Read as source, the house pattern for the DOM half of a page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8");

describe("MTTR page prefetch", () => {
  it("requests the Chart.js bundle before the page's own data", () => {
    const start = SRC.indexOf("export async function renderMttr(");
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start);
    const charts = body.indexOf("loadCharts()");
    const data = body.indexOf('"api_getMttrPage"');
    expect(charts).toBeGreaterThan(-1);
    expect(charts).toBeLessThan(data);
  });
});
