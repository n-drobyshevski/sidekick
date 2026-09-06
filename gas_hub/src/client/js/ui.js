// The component base, as one import surface.
//
// EVERYTHING BUT ONE MODULE IS gas_shared/ui/'s. This app draws no chart, no severity badge
// and no scope switch of its own — a hub over three registers has none of those things — so
// there is nothing here to fork beyond the one component genuinely this app's: the launcher
// tile. gas_shared/test/contracts/parity.js requires `src/client/js/ui/` to hold at least one
// local module; `tile.js` is it.
//
// Every call site keeps importing from "../ui.js"; esbuild flattens the re-export chain at
// build time, so the extra hop costs nothing at runtime.

export * from "../../../../gas_shared/ui/index.js";
export { tile } from "./ui/tile.js";
