// The Settings page's two panels each make their own google.script.run call (`api_getUrls`,
// `api_getAccess`). They used to be awaited one after the other, putting two GAS calls' worth of
// per-call overhead (~1.5–2 s each) on the page back to back though neither reads the other.
// Read as source, the house pattern for the DOM half of a page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../src/client/js/pages/settings.js", import.meta.url), "utf8");

describe("hub Settings page", () => {
  const start = SRC.indexOf("export async function renderSettings(");
  const body = SRC.slice(start, SRC.indexOf("\n}\n", start));

  it("loads the URL and Access panels side by side", () => {
    expect(body).toMatch(/Promise\.all\(\[\s*buildUrlsPanel\(/);
    expect(body).toContain("buildAccessPanel(accessHost)");
    expect(body).not.toMatch(/await buildUrlsPanel\(/);
    expect(body).not.toMatch(/await buildAccessPanel\(/);
  });

  it("keeps the panels' page order in their hosts", () => {
    expect(body).toContain("host.append(urlsHost, accessHost, systemHost)");
  });
});
