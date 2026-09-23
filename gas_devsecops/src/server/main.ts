import { bootstrapIfWarm } from "./api";
import { inlineBootJson } from "../../../gas_shared/server/inlineBoot";

export function doGet(_e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile("index");
  // The bootstrap payload rides in the page rather than behind a second round trip — see
  // gas_shared/server/inlineBoot.ts — but only from cache: computing a cold core here held the
  // whole page for 6–7 s on every load (measured, PERF_PLAN.md step 1). "" when it is cold, and
  // the client shows its splash and asks over api_bootstrap, which computes and caches it.
  template.bootJson = inlineBootJson(() => bootstrapIfWarm());
  return template
    .evaluate()
    .setTitle("Wiz Sidekick DevSecOps")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Used from index.html scriptlets: <?!= include('styles') ?> */
export function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
