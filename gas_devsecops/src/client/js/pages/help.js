// Help: the key sheet — this register's vocabulary, drawn by the shared page.
//
// WHAT MOVED, AND WHY IT COULD. Everything except the words: the search field, the flat list,
// the `?term=` deep link, the "/" and Escape shortcuts, the `aria-current` mark and the pure
// `helpModel` are `gas_shared/ui/helpPage.js` now, because `gas/` grew the same page and the
// only thing that differed between them was `helpContent.js`. The header there carries every
// decision this file used to explain — the one-group-draws-no-heading rule, the word-boundary
// search, and the fact that `?term=` lives in the HASH rather than in `location.search`.
//
// WHAT STAYS HERE IS THE ONE LINE THAT CANNOT BE SHARED: which book to draw. A shared module
// has no `../helpContent.js` to import, so the entries travel as an argument — the same seam
// `appConfig.js` uses for `findHelpEntry`.
//
// STILL `renderHelp`, and still imported by `./pages/help.js` from app.js: the route
// registration and the module path are what `test/pagesHelp.test.js` pins, and neither had a
// reason to move.

import { allEntries } from "../helpContent.js";
import { renderHelpPage } from "../../../../../gas_shared/ui/helpPage.js";

export async function renderHelp(host, params, ctx) {
  return renderHelpPage(host, params, ctx, { entries: allEntries() });
}
