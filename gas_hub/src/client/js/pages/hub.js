// The front door: eyebrow, h1, lede, then a 2x2 grid of tiles — one per sibling register plus
// "coming soon". PURE VIEW MODEL, THIN DOM, same split every Phase 2 page in these apps uses:
// hubModel.js decides, this file only draws.
//
// STATIC LAUNCHER FIRST — no cross-app reads, no live status polling a sibling's own register.
// bootstrap()'s tiles carry whatever URL an admin has stored in Settings; a tile with none
// reads as "not configured," never as a broken link. See gas_hub/PRODUCT.md for what would
// have to change before this page reads anything live.

import { bootstrap } from "../../../../../gas_shared/store.js";
import { el, errorState, pageHeader } from "../ui.js";
import { tile } from "../ui/tile.js";
import { tileModel } from "./hubModel.js";

export async function renderHub(host) {
  // The ONLY pageHeader({ route: "hub" }) call in this file — the h1 text ("Registers") and
  // the (absent) lane eyebrow both come from PAGES via appConfig(), never a second copy of
  // either string here.
  host.append(pageHeader({
    route: "hub",
    lede: "Each sidekick measures one population. Pick the one you came for. It opens in "
      + "this tab.",
  }));

  let boot;
  try {
    boot = await bootstrap();
  } catch (e) {
    // "Couldn't " — the anti-vacuity regex gas_shared/test/contracts/emptyStates.js pins
    // against this exact prefix, so a render that FAILED reads as a failure rather than as an
    // empty register.
    host.append(errorState("Couldn't load the launcher.", {
      detail: String((e && e.message) || e),
    }));
    return;
  }

  const grid = el("div", { class: "hub-grid" });
  for (const spec of tileModel(boot)) grid.append(tile(spec));
  host.append(grid);
}
