import { bootstrapIfWarm } from "./api";
import { inlineBootJson } from "../../../gas_shared/server/inlineBoot";

export function doGet(_e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile("index");
  // The bootstrap payload rides in the page rather than behind a second round trip — see
  // gas_shared/server/inlineBoot.ts — but only from cache: a cold core would hold the whole page
  // (and hide the boot splash) for as long as it takes to compute. "" then, and the client asks.
  template.bootJson = inlineBootJson(() => bootstrapIfWarm());
  return template
    .evaluate()
    .setTitle("Wiz SIDEKICK AI")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Used from index.html scriptlets: <?!= include('styles') ?> */
export function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
