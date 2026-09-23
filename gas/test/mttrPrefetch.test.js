// The MTTR page's requests used to run as a chain, measured warm in production: getMttr +
// getMttrPage (3.3 s), then the Chart.js bundle (2.5 s), then getMttrByDomainTrend (2.3 s) —
// ~8 s to the last chart for ~2 s of server work. Both late requests now start with the page.
// Read as source, the house pattern for the DOM half of a page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8");

function bodyOf(signature) {
  const start = SRC.indexOf(signature);
  expect(start, signature + " not found").toBeGreaterThan(-1);
  // Up to the next function declaration at the same (two-space) indent.
  const rest = SRC.slice(start + signature.length);
  const end = rest.search(/\n  (?:async )?function \w+\(/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("MTTR page prefetch", () => {
  const load = bodyOf("async function load(");
  const renderByDomain = bodyOf("function renderByDomain(");

  it("starts the by-group trend and the Chart.js bundle with the page's own RPCs", () => {
    const pageRpc = load.indexOf('"api_getMttrPage"');
    expect(load.indexOf('"api_getMttrByDomainTrend"')).toBeGreaterThan(-1);
    expect(load.indexOf('"api_getMttrByDomainTrend"')).toBeLessThan(pageRpc);
    expect(load.indexOf("loadCharts()")).toBeGreaterThan(-1);
    expect(load.indexOf("loadCharts()")).toBeLessThan(pageRpc);
  });

  it("does not request the trend again when the section renders", () => {
    // A second swrCall on a landed key revalidates with another RPC — the extra execution the
    // prefetch exists to remove.
    expect(renderByDomain).not.toContain('"api_getMttrByDomainTrend"');
    expect(renderByDomain).toContain("domainTrend");
  });
});
