# gas_shared — the Wiz Sidekick design system

One copy of the component base, the stylesheets and the design tokens that `gas/`, `gas_ai/`
and `gas_devsecops/` all draw with. Not a build artifact and not an npm package: plain ES
modules and plain CSS, imported by relative path and bundled by each app's own esbuild step.

There is no build here, no dependency and nothing to install. `package.json` exists so tools
read the tree as `"type": "module"`.

## What lives here

| | |
|---|---|
| `appConfig.js` | the seam — the manifest an app hands over before anything else runs |
| `api.js` | the `google.script.run` bridge and the `{ok,data}` envelope |
| `store.js` | the bootstrap cache, the SWR RPC cache and hash routing |
| `icons.js` | node-kind SVG (512 lines; only `ui/nodeCell.js` and `ui/uiIcons.js` reach it) |
| `ui/` | 27 component modules plus `index.js`, the one import surface |
| `styles/` | nine stylesheets: `tokens.base.css` first, `overrides.css` last |
| `test/contracts/` | six spec factories the apps register from their own test files |
| `test/testConfig.js` | a manifest fixture, for tests that reach a module reading one |

## What does NOT live here

- **The brand.** Five tokens per app, in that app's own `styles/tokens.css`. See below.
- **Anything that reads an app's domain layer.** `gas_devsecops/ui/projectScope.js` reads
  `src/domain/projectScope.ts` and means nothing in a sibling with no repositories, so it
  stays in that app. The parity contract holds the allow-list.
- **The shell.** `app.js`, `navModel.js`, `navFlyout.js`, `routeIcons.js`, `helpContent.js`
  and the pages are still per-app. Some of that is genuinely per-app; some is a later
  package's job.
- **Page-shaped CSS.** `styles/help.css` is the one exception, and it earns it: every
  sidekick has the same key-sheet page, and what differs between them is the vocabulary in
  the list, which is data.

## The seam

A shared module cannot reach sideways into an app — `ui/tip.js` has no `../helpContent.js`
to import, and `store.js` cannot know which route is a given register's front door. Those
answers arrive as data:

```js
// gas_devsecops/src/client/js/app.js — the FIRST statement of the module body
configureApp({
  productName: "Wiz Sidekick DevSecOps",
  openingNoun: "register",       // "Opening the ${openingNoun}…" on the boot splash
  storagePrefix: "sidekickdso.", // trailing dot; two sidekicks on one origin must not collide
  defaultRoute: "executive",     // the first key of PAGES
  findHelpEntry: findEntry,      // this register's own glossary
});
```

**Every consumer reads it inside a function, never at module top level.** A top-level read
executes during import, which under esbuild's bundling order happens *before* `app.js`'s own
body runs — so it would throw on a correctly wired app. `store.js` reads `defaultRoute`
inside `parseHash()`; `ui/sheet.js` builds its localStorage keys inside the functions that
use them; `ui/tip.js` calls `findHelpEntry` when it resolves a term.

`appConfig()` throws when nothing configured it, and that throw is the point: an unset
manifest is a wiring defect that cannot be defaulted, because a default would silently give
one app another app's front door.

`AppManifest`'s JSDoc typedef also reserves `PAGES`, `LANE_ICONS`, `ROUTE_ICONS`,
`scopeKinds`, `sync` and `experimental`. Those are declared so the shape is one document
rather than a scatter of additions; nothing here consumes them yet.

## The five-token accent contract

The severity palette is byte-identical across all four surfaces — a severity means the same
thing everywhere. **The brand deliberately does not**, and it is the only axis of variation
between the three apps' stylesheets. Five tokens carry it, and the split between them is what
makes a shared rule correct in all three:

| token | what it may do |
|---|---|
| `--accent` | identity **fills** only: the mark, the rail's active bar, a meter fill, a switch track. Never text. Never a focus ring. Never a chart series. |
| `--accent-hover` | the hover state of such a fill |
| `--accent-text` | everything the accent carries as **ink**: links, focus rings, the active option, a chart series |
| `--accent-edge` | drawn under every accent fill, so a pale accent still reads as a mark |
| `--on-accent` | ink drawn **on** an accent fill |

### The per-app values, and the arithmetic behind them

| | `--accent` | `--accent-hover` | `--accent-text` | `--accent-edge` | `--on-accent` |
|---|---|---|---|---|---|
| `gas` | `#2563eb` | `#1d4ed8` | `#2563eb` | `transparent` | `#ffffff` |
| `gas_ai` | `#be123c` | `#9f1239` | `#be123c` | `transparent` | `#ffffff` |
| `gas_devsecops` | `#ffcb13` | `#ebb800` | `#7c4a0a` | `rgba(0,0,0,.40)` | `#171717` |

| measured | gas | gas_ai | gas_devsecops |
|---|---|---|---|
| `--accent-text` on white | 5.17 | 6.29 | 7.39 |
| `--on-accent` on `--accent` | 5.17 | 6.29 | 11.78 |
| `--accent` on white (fill, 3:1 floor) | 5.17 | 6.29 | **1.52** |

Two apps can point `--accent-text` at the accent itself and leave `--accent-edge`
transparent, because their accents clear both floors on their own. `gas_devsecops` cannot:
`#ffcb13` is 1.52:1 on white and 1.30:1 on the meter track, so its accent is a fill token and
nothing else, and every one of its fills carries the edge — `rgba(0,0,0,.40)` over `#ffcb13`
resolves to `#997a0b`.

**`--on-accent` exists because the answer differs per brand.** Near-black is 11.78:1 on the
yellow and 3.47:1 on the blue; white is 1.52:1 on the yellow and 5.17:1 on the blue. A rule
that painted `var(--ink)` on an accent fill — `styles/sheet.css`'s facet tick did, until this
package — is correct in exactly one of the three apps and wrong in the other two without
anything failing.

`test/contracts/tokens.js` holds all of it as arithmetic rather than as literals, so the same
contract runs against all three brands. Two more tokens travel with the brand and are checked
the same way: `--accent-wash` / `--accent-wash-hover`, the tint a standing state wears. The
contract composites the wash over white before measuring, because the question — "can
`--accent-text` be read on it" — is only answerable after compositing.

### Reserved: `--chart-cat-*`

The categorical chart palette the three registers will eventually agree on. **No app may
claim a token under that prefix locally.** Nothing defines them yet.

## The z scale

`styles/tokens.base.css` carries one merged scale for every layer these apps stack, in the
order they stack:

```
--z-canvas-chrome 5 · --z-canvas-panel 10 · --z-route-overlay 20 · --z-nav-flyout 25
--z-appbar 30 · --z-topbar 32 · --z-scrim 40 · --z-sheet 41 · --z-popover 52
--z-splash 55 · --z-tooltip 58 · --z-toast 60
```

Only `1` and `2` remain legal as literals, and only for stacking *within* a component (a
sticky table header over its own rows). `test/contracts/zscale.js` holds both halves.

`--z-topbar` is 32 and used to be a bare 45. That literal put the ≤800px top bar above the
scrim (40) and the sheet (41) as well as above the route overlay — so a modal opened at that
width dimmed the whole page except the top bar and left it clickable behind the overlay. The
rule's own comment only ever claimed the route-overlay clearance, which 32 keeps.

## The contracts

`vitest.config.ts` in each app collects only that app's `test/` directory, so a shared
contract cannot *be* a test file. Each is a factory the app calls with vitest's own
`describe`/`it`/`expect` and its own specifics:

```js
import { registerTokenContract } from "../../gas_shared/test/contracts/tokens.js";
registerTokenContract({ describe, it, expect, appRoot: new URL("../", import.meta.url),
                        app: "devsecops", severity: { SEVERITY_COLORS, ... } });
```

| contract | what it holds |
|---|---|
| `tokens.js` | the severity palette, the five-token accent split, no `--accent` as ink, the graphite primary button, `charts.js`'s `ACCENT`, no hex literal outside the two token files |
| `emptyStates.js` | a failure is never dressed as an absence; every page below the front door says where its figures came from |
| `navGroups.js` | `PAGES` is the only IA list — lane contiguity, two pages per labelled lane, one mark per lane and route, the manifest's front door |
| `brandMark.js` | the static splash SVG is the module's geometry, and the splash copy is the manifest's |
| `parity.js` | nothing shared has been forked back into an app; the stylesheet index is in cascade order |
| `zscale.js` | every app layer is a `--z-*` token |

`gas_devsecops/test/shared.test.js` is the worked example.

## Linting

`npm run lint` in `gas_devsecops` chains `lint:shared`, which runs that app's installed
ESLint **with this directory as the cwd** so `eslint.config.js` here is picked up normally:

```
cd ../gas_shared && node ../gas_devsecops/node_modules/eslint/bin/eslint.js .
```

Passing `--config ../gas_shared/eslint.config.js` from inside `gas_devsecops` does *not*
work: ESLint 10 resolves a flat config's `files` globs against a base path it takes from the
cwd, and reports every file here as "ignored because it is located outside of the base path".
Changing the cwd is the supported answer, not a workaround. The guard was perturbed (a free
identifier added to `ui/`) and does bite.

## Known follow-up

`.design-sync/adapter/` tracks the component base **by import path**, not by copy, so this
move touched it. `gen.mjs`, `docs-gen.mjs` and `styles.css` were re-pointed at `gas_shared/`
(with `nameCell` following `cells.js` -> `nodeCell.js`), and `gen.mjs` + `docs-gen.mjs` were
re-run: all 45 component imports and all 12 stylesheet imports resolve, and the docs diff is
additive — ten class names the last generation predated, no removals.

What was NOT re-run is the converter itself (`validate`, the DTS step and the preview
screenshots): `.design-sync/adapter/node_modules` is a per-clone symlink into `.ds-sync/`
that this worktree does not have. So the adapter is re-pointed and its inputs resolve; it has
not been rendered since.
