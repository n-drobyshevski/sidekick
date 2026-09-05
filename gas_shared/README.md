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
| `ui/` | 31 component modules plus `index.js`, the one import surface, and `helpPage.js` — a page, not a component, so deliberately not in the barrel |
| `styles/` | nine stylesheets: `tokens.base.css` first, `overrides.css` last |
| `test/contracts/` | eleven spec factories the apps register from their own test files |
| `test/testConfig.js` | a manifest fixture, for tests that reach a module reading one |
| `test/domStub.js` | a DOM small enough to render a component into, for a repo with no jsdom |

## What does NOT live here

- **The brand.** Five tokens per app, in that app's own `styles/tokens.css`. See below.
- **Anything that reads an app's domain layer.** `gas_devsecops/ui/projectScope.js` reads
  `src/domain/projectScope.ts` and means nothing in a sibling with no repositories, so it
  stays in that app. The parity contract holds the allow-list.
- **The shell.** `app.js`, `navModel.js`, `navFlyout.js`, `routeIcons.js`, `helpContent.js`
  and the pages are still per-app. Some of that is genuinely per-app; some is a later
  package's job.
- **The vocabulary.** `helpContent.js` is each register's own book — which words it defines is
  the part that is genuinely per-app. Only the SHAPE of a definition is shared (`{ id, term,
  lines[] }`, kebab-case ids), so a `glossaryTip` behaves the same in all three.
- **Page-shaped CSS**, with one exception: `styles/help.css`, which dresses the shared key
  sheet below. This bullet used to claim that sheet is "the shape every sidekick's key sheet
  has"; it is not, and was not when it was written — see the exception below. It is the shape
  TWO of the three have.

## The one page that IS shared, and the one that is not

`ui/helpPage.js` is the key sheet — a search field over one flat, alphabetical list of
`helpContent.js` entries, a `?term=` deep link, `/` to focus the search and Escape to clear it,
and a pure `helpModel(entries, query, term)` behind all of it. `gas/` and `gas_devsecops/` both
render it; each app's `pages/help.js` is four lines that hand over its own `allEntries()`, and
`styles/help.css` dresses it. `test/contracts/help.js` holds the behaviour, registered by both.

**`gas_ai/` keeps a bespoke lexicon page, and that is a decision rather than an unfinished
migration.** Its page is a four-column grid with an index rail (`aria-current` lands on the RAIL
item, not the entry), six family headings its book carries a `family` field for, live per-entry
counts resolved from bootstrap/KPI/digest payloads, `mark()` functions that render the real
component beside each definition, and a fixed 640x126 anatomy SVG with six callout buttons. It
already opts out of `styles/help.css` for a stated reason: `.help-entry` is a card there and a
grid row here, `.help-entry-term` a lead line there and a 14px term here.

Bending the shared module to fit it would take a `groupBy`, a per-entry render slot, a count
resolver and a diagram slot — four options with exactly one consumer each — which costs the
shared page the readability it was extracted for. The reason is written down in two places on
purpose: here, and at the top of `gas_ai/src/client/js/pages/help.js`. Do not "fix" it.

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

`AppManifest`'s JSDoc typedef also reserves `PAGES`, `LANE_ICONS` and `ROUTE_ICONS`; nothing
here consumes those yet. **`sync` is live**: `ui/feedback.js`'s `firstRunNotice` reads
`sync.noun` (and `sync.unit`) inside the function, so the one line every empty page owes its
reader names the control that app actually has. It used to be hard-coded to "sync", which sent
a `gas` reader looking for a button that app does not have — its endpoint is `api_runScan` and
its rail says "Run scan". Two registers take the default; gas declares `{ noun: "scan" }`.

`scopeKinds` is live too, and it is the app's rather than the manifest's: each app exports its
own `scopeKinds(data)` / `scopeChrome(data)` pair and hands them to the shared control (see
below).

## The scope seam

`ui/scopeModel.js` (DOM-free) and `ui/scopeControl.js` (the appbar combobox) are ONE control
for all three registers. They replace `gas/src/client/js/scopeSwitch.js` (363 lines, deleted),
and the control halves of `gas_ai`'s and `gas_devsecops`'s `ui/projectScope.js` (427 and 264,
reduced). The three had grown the same thing independently and agreed by copying.

What the apps keep is their **vocabulary**, as data — a `scopeKinds` array:

```js
{ key: "supportGroup", prefix: "sg", icon: "users",
  options: (data) => [{ id, label, hint, group, icon }],
  label:   (opt, data, ctx) => "…",   // ctx = { stale, id }
  caption: (opt, data, ctx) => "…",
  payload: (id) => ({ domain: "", supportGroup: id }) }
```

Three rules the shape encodes:

- **`payload(id)` is how each app keeps its EXISTING server contract.** gas emits
  `{domain, supportGroup}` (what `activeScope()` always handed every page); gas_ai
  `{projectView}` / `{domainView}` for `api_setSettings`; devsecops `{projectView}` for
  `api_setProjectView`. `test/contracts/scope.js` pins every one of those objects against what
  the deleted implementation produced — the one assertion in that file that could not be
  derived from the code. It was perturbed in all three apps (a key renamed) and fails.
- **At most one kind may be BARE** (`prefix: ""`). All three apps already left their first
  dimension unprefixed and prefixed the rest (`sg:`, `d:`), so keeping that asymmetry is what
  lets a stored scope survive the move byte for byte. Two bare kinds is a silent collision and
  `scopeModel.js` throws on it.
- **No group headings are synthesised.** A kind's own `options()` rows carry their `group`,
  because the grouping a reader sees is not the kind — gas_ai and devsecops both split ONE kind
  across "Business units" / "Support groups" / "Projects". A kind-level heading layered on top
  would give a single-kind app a heading it does not have.

## The diagnostics seam

`ui/diagnostics.js` draws the Settings -> System read-outs for all three registers, and it is
the one shared control whose contract is **that its sections are optional**. Not "configurable":
optional. The three System tabs do not show the same facts and this module does not make them.

| | storage | recent errors | product | build | credentials | last sync |
|---|---|---|---|---|---|---|
| `gas` | ✅ meter | ✅ full log, with Clear | — | one stamp | — | — |
| `gas_ai` | — | — | — | **two** stamps + mismatch | ✅ `neutral` when missing | — |
| `gas_devsecops` | — | — | ✅ | one stamp | ✅ `bad` when missing | ✅ |

Every gap in that table is a fact about a register, not a backlog item:

- **`gas_ai` has no error log AT ALL** — no tab, no RPC — so it draws no card. An empty-state
  card there would claim a log exists and happens to be quiet, which is the opposite of true.
- **Storage is in Settings only in `gas`.** The other two show cell usage on their Data page,
  and `gas_ai` could not draw a meter anyway: its `getStorageStats` publishes no `cellLimit`, so
  there is no ratio. That is a missing FIGURE, not a missing widget.
- **`gas_devsecops` gets no client-vs-server mismatch card.** It has the identical
  `buildInfo.js` module gas_ai uses for that comparison sitting in its client, imported by
  nothing. Passing no `client` stamp is what selects the one-stamp form; wiring the second one
  up would be a new deployment claim about that register.
- **`missingTone` has no default and the module throws without it.** gas_ai draws a missing
  credential `neutral` (dry-run against sample data is a legitimate mode there) and
  gas_devsecops draws it `bad`. Those are different claims about the same boolean, so the
  refusal is the same shape as `appConfig()`'s.

`test/contracts/diagnostics.js` holds both halves: the renderer's promises, asserted against a
real tree in `test/domStub.js`, and the SET of sections each app asked for, read out of that
app's own `pages/settings.js`. The second half is the one that matters — the failure this
package guards against is a well-meaning drive-by giving one register a section a sibling has.

Two things stay per app on purpose. The **sentences** are the register's (gas counts "tracked
vulnerabilities", a code register counts findings), passed in as data the way `scopeKinds` is.
And the **caching** is: gas folds `BUILD_ID` into its server cache key, gas_ai keeps `build`
outside the cached core, `gas_devsecops`'s `bootstrap()` is uncached — three mechanisms, and
each hands this module the result rather than a promise.

The class prefix is `.health-`, not `.diag-`, because `gas_ai/src/client/js/ui/diagList.js`
already owns `.diag-list` / `.diag-row` / `.diag-warn` for an unrelated concept.

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
yellow and 3.47:1 on the blue; white is 1.52:1 on the yellow and 5.17:1 on the blue. (The
blue figure read 1.62:1 here and in gas_devsecops's tokens.css until `gas/test/shared.test.js`
re-measured it with the contract's own `ratio()`: #171717 on #2563eb is 3.4686:1. The
CONCLUSION is unchanged and is why the correction is worth making rather than skipping —
3.47:1 clears only the 3:1 graphical-mark floor and still fails the 4.5:1 text floor, so white
is still `--on-accent` on the blue. A wrong number under a right answer is the kind of thing a
later reader re-derives a rule from.) A rule
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
| `tokens.js` | the severity palette, the five-token accent split, no `--accent` as ink, the graphite primary button, `charts.js`'s `ACCENT`, no hex literal outside the two token files (its own allow-list mechanism covers mask stops and a chart palette's greys — see `ctx.hexAllow`) |
| `emptyStates.js` | a failure is never dressed as an absence; every page below the front door says where its figures came from. `ctx.syncField` names the bootstrap field a first-run page gates on (`latestSync` by default, `latestScan` in gas) — hard-coding it had silently excused gas from this whole half. Also exports `code()`, the comment-and-string-aware stripper every other sweep in this directory (and `measure.mjs`) reads through, rather than the raw source |
| `navGroups.js` | `PAGES` is the only IA list — lane contiguity, two pages per labelled lane, one mark per lane and route, the manifest's front door |
| `brandMark.js` | the static splash SVG is the module's geometry, and the splash copy is the manifest's |
| `parity.js` | nothing shared has been forked back into an app: no re-copied `ui/` module, no local `api.js`/`store.js`/`icons.js`, no re-forked shell module, the barrel is still a re-export, and — P9 — no local DECLARATION of `relativeAge`/`syncCaption`/`absentText` anywhere in the app's client tree (catches the pre-P8 shape: a private helper inline in a page, not a second copy of the shared file). The stylesheet half: cascade order, `overrides.css` last, `tokens.base.css` FIRST (P9, asserted against the real parsed imports rather than the caller's own expected-order array), and — where `ctx.localSheets` is given — that only the declared local sheets remain local |
| `scope.js` | the kinds an app declares, the value encoding, and the exact object a pick puts on the wire |
| `zscale.js` | every app layer is a `--z-*` token |
| `diagnostics.js` | the Settings -> System read-outs: what the shared renderer promises, and the exact SET of sections each app asked it for. Half of it renders into `test/domStub.js`; half reads that app's own `pages/settings.js` |
| `help.js` | `ui/helpPage.js`'s behaviour: the search field, the `?term=` deep link, `/` to focus, Escape to clear, and the pure `helpModel()` underneath it all. Registered by `gas/` and `gas_devsecops/`; `gas_ai/` keeps its own bespoke lexicon page and does not register this one — see "The one page that IS shared" above |
| `relativeAge.js` | the one clock-relative label ("3 hours ago") — refuses null/undefined/blank/`[]`/`false` BEFORE any `Number()`/`Date.parse()` cast, with a perturbation proving the tempting cast-first rewrite fails on exactly those inputs |
| `syncCaption.js` | the rail's freshness sentence — that `app.js` calls the shared `syncCaption()` rather than growing its own `Math.floor(Date.now() - Date.parse(...))` day-count back |

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

## Before / after

The wave's own plan called for "re-run the baseline script and record the after-column."
No such script was ever saved — the 2026-09-04 baseline that established "19 of 23 shared
ui/*.js are byte-identical between gas_ai and gas_devsecops" (the first `gas_shared/` commit's
own message) was computed ad hoc, once, by a method that was never written down. That is why
this section cannot simply "record the after-column": there was no committed method to re-run.

`gas_shared/measure.mjs` is that method, committed. It measures client JS/CSS size, cross-app
duplication (byte-identical / near-identical <=15% churn via `git diff --no-index --numstat` /
diverged), CSS hygiene, component vocabulary, `dist/` size with gzip, and the 12-item scorecard
below — against **any two refs, by the same code path**, so a before/after table is never one
column measured one way beside a column measured another:

```
node gas_shared/measure.mjs                              # this working tree only
node gas_shared/measure.mjs --ref <sha>                  # one historical ref, read-only
node gas_shared/measure.mjs --before 01aca7b --after HEAD   # the wave's own comparison
```

`--ref`/`--before` materialize a commit read-only via `git archive -o <file>` + `tar -xf`
into a scratch directory (the same technique `gas/whichBuild.mjs` uses to hash `src/` at a
historical commit) — nothing is checked out, no worktree is touched. `01aca7b` is the commit
immediately before `gas_shared/` existed at all (`git ls-tree 01aca7b -- gas_shared` is empty;
it is the direct parent of the first `gas_shared/` commit).

**Both columns below are one run's output** (`npm run measure:wave` from this directory),
derived, not typed — the module-count mistake this file already made once, when two packages
each counted only their own addition, is the reason the rule is "run the walk, don't type the
number."

| | gas | gas_ai | gas_devsecops | gas_shared |
|---|---|---|---|---|
| **before** — client JS | 32 files / 13,304 lines | 91 / 38,315 | 55 / 18,702 | (did not exist) |
| **before** — client CSS | 1 / 2,062 | 19 / 7,194 | 9 / 2,893 | (did not exist) |
| **after** — client JS | 35 / 12,228 | 65 / 31,982 | 24 / 11,445 | 46 / 9,357 |
| **after** — client CSS | 3 / 1,059 | 12 / 4,447 | 3 / 131 | 9 / 3,312 |

Every app's own client tree shrank; the difference moved into one `gas_shared/` copy rather
than disappearing. gas_ai's CSS count looks like it shrank from 19 files to 12 — that is
`gas_shared/`'s seven shared sheets leaving gas_ai's own `styles/` directory, not seven
stylesheets deleted.

**Duplication across apps' own client trees** — same-basename files still living in more than
one app's own `src/client` tree (not counting anything routed through `gas_shared/`):

| | shared-basename pairs | identical | near-identical (<=15%) | diverged |
|---|---|---|---|---|
| before | 99 | 17 | 20 | 62 |
| after | 50 | 1 | 3 | 46 |

The after-column's 50 remaining pairs are overwhelmingly **same name, different page** —
`app.js`, `data.js`, `settings.js`, `ui.js`, each app's own `styles.css`/`tokens.css` — the
kind of file every app is expected to have its own copy of. None of them are the shared
component base any more; that is what `gas_shared/test/contracts/parity.js` now holds by
construction rather than by this script's count.

**A disagreement with the hand-computed 2026-09-04 baseline, reported rather than
reconciled.** The first `gas_shared/` commit's message claims "19 of 23 shared ui/*.js are
byte-identical between gas_ai and gas_devsecops" at the commit immediately before it —
`01aca7b`, the same ref this script's "before" column uses. Measuring that exact pair at
that exact commit (`gas_ai/src/client/js/ui/*.js` vs `gas_devsecops/src/client/js/ui/*.js`,
byte comparison): **24 shared basenames, 10 byte-identical, not 19 of 23.** Loosening the bar
to <=15% churn (this script's own "near-identical" bucket) adds 10 more — `dom.js` 12.9%,
`tipPlace.js` 10.4%, `tableModel.js` 16.0% (just over), `settings.js` 6.5%, `severity.js`
5.5%, `sheet.js` 0.3%, `tip.js` 1.0%, `popover.js` 2.2%, `uiIcons.js` 1.1%, `data.js` 1.8% —
leaving only `feedback.js` (21.8%), `format.js` (25.9%) and `tableModel.js`'s own second
look diverged outright, plus `projectScope.js` (54.4%), which is the one file in that list
that is SUPPOSED to differ (it reads each app's own domain layer). So "19 identical, 4
trivially different" reads as "10 identical, 10 within 16% churn, 3 genuinely apart" once
measured the same way twice. The direction of the finding — a handful of near-copies, one
legitimate exception — still supports the commit's argument; the specific count in it does
not survive a second measurement, which is exactly the class of error this script exists to
stop happening a third time.

**The `dist/` total went UP, not down**, and that is not this script contradicting itself —
`gas/dist/` gained a whole extra bundle (`js_charts.html`, Chart.js split out of the main
client bundle) somewhere in the same window, which is a real feature, not de-duplication
noise. Total dist bytes (raw / gzip), same run:

| | before | after |
|---|---|---|
| gas | 996,788 / 280,039 | 1,040,132 / 287,889 |
| gas_ai | 1,717,611 / 489,176 | 1,733,690 / 493,489 |
| gas_devsecops | 814,555 / 244,561 | 833,908 / 248,922 |

Line/duplication counts are where the wave's saving shows; `dist/` size answers a different
question ("does the user download more or less") and the honest answer here is "slightly
more, for an unrelated reason," not "the wave made the bundles smaller."

### The 12-item cross-app inconsistency scorecard

Same run, same method, both columns. Every mark below is a structural check (an import, a
call-site count, a contract registration) — not a restatement of the claim it is checking.

| item | before | after |
|---|---|---|
| boot-splash copy | ✗ | ✓ |
| page-header pattern | ✗ | ✗ |
| sevBadge role | ✗ | ✓ |
| empty-vs-error | ✗ | ✓ |
| table pagination | ✗ | ✓ |
| scope-control chrome | ✗ | ✓ |
| sync button disabled-with-reason | ✓* | ✓* |
| last-sync caption | ✗ | ✓ |
| diagnostics/System panel | ✗ | ✓ |
| help page presence and shape | ✗ | ✓* |
| z-index scale | ✗ | ✓ |
| `--ok` / `--warn` | ✗ | ✓ |

Two rows are not a plain ✓, on purpose:

- **`sync button disabled-with-reason` measures ✓* at BOTH ends**, which disagrees with "all
  12 were ✗ at baseline" for this one item, and that disagreement is reported rather than
  smoothed over. gas and gas_ai fall back to a dry run without credentials and have never had
  a disabled state to explain; gas_devsecops's disabled button already reached the same
  tooltip-on-disabled mechanism (`tipAnchor()` / `.tip-disabled-wrap`) before this wave, via
  the fork from gas_ai's chassis. There was no gap here to close, at either end — a ✓ that
  claimed the wave fixed this would be inventing a before-state that measures false.
- **`help page presence and shape` is ✓\*, not ✓**, because it is shared by two of three apps
  BY DECISION — gas_ai's bespoke lexicon page is a documented exception (see "The one page
  that IS shared, and the one that is not" above), not an unfinished migration.
- **`page-header pattern` is still ✗.** gas and gas_devsecops draw every page title through
  `pageHeader()`; gas_ai has five bare `el("h1", …)` call sites left (`combos.js`, `aars.js`,
  `graph.js`, `problems.js`, `config.js`) — `graph.js` and `aars.js`'s carry a `workbench-title`
  class, which may be a distinct sub-heading component rather than the page header proper, but
  this script does not re-derive that distinction; it reports the honest count rather than
  assuming the exception.

### Component vocabulary and CSS hygiene, same run

```
node gas_shared/measure.mjs --before 01aca7b --after HEAD
```

prints, per app, both before and after: `el("h1")` vs `pageHeader()` calls, hand-typed em
dashes vs `absent()`, `emptyState()` vs `errorState()`, `pager()` vs `tableFooter()`, local
`num()` definitions, `sevBadge()` calls, test-file counts, and a CSS hygiene line (hex
literals outside the token files, distinct `font-size` values, `z-index` literals, reduced-
motion blocks, `outline:` on `--accent` vs `--accent-text`). The full output is long enough
that it is not reproduced here in full — run the command above for the current numbers
rather than trusting a snapshot that will drift the next time either app changes.

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
