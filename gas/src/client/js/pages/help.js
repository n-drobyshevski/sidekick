// Help: the key sheet — this register's vocabulary, drawn by the shared page.
//
// THE GAP THIS CLOSES. `gas_shared/ui/tip.js` has always wired a `{ term }` trigger to
// `navigate("help", { term })`, and `glossaryTipLines` has always appended "Enter for the full
// definition" beside it. This register carried neither end: `MANIFEST.findHelpEntry` was
// `() => null` (a resolver that resolves nothing, so every glossary trigger degraded to a
// plain label) and there was no `help` route for one to arrive at. Both ends are wired now —
// `app.js` resolves against `./helpContent.js`, and this route is where the link lands.
//
// WHAT IS HERE AND WHAT IS NOT. The page itself is `gas_shared/ui/helpPage.js`, shared with
// `gas_devsecops` — the search field, the flat list, the `?term=` deep link, the "/" and
// Escape shortcuts, and the pure `helpModel`. Read that file's header for every decision it
// makes, including the one worth knowing before editing a deep link: `?term=` lives in the
// HASH, not in `location.search`.
//
// WHAT STAYS HERE IS THE ONE LINE THAT CANNOT BE SHARED: which book to draw. A shared module
// has no `../helpContent.js` to import, so the entries travel as an argument — the same seam
// `appConfig.js` uses for `findHelpEntry`.

import { allEntries } from "../helpContent.js";
import { renderHelpPage } from "../../../../../gas_shared/ui/helpPage.js";

export async function renderHelp(host, params, ctx) {
  return renderHelpPage(host, params, ctx, { entries: allEntries() });
}
