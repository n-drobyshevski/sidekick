# gas_shared — the Wiz Sidekick design system

One copy of the component base, the stylesheets and the design tokens that `gas/`, `gas_ai/`,
`gas_devsecops/` and `gas_hub/` all draw with. Not a build artifact and not an npm package:
plain ES modules and plain CSS, imported by relative path and bundled by each app's own
esbuild step.

Three of the four are REGISTERS — each measures one population and publishes figures about it.
`gas_hub/` is a LAUNCHER: a 2x2 grid of tiles over the three registers' `/exec` URLs, no data
of its own. Where a rule below reads differently for it, that is why, and it is said in place
rather than left as an omission.

There is no build here, no dependency and nothing to install. `package.json` exists so tools
read the tree as `"type": "module"`.

## What lives here

| | |
|---|---|
| `appConfig.js` | the seam — the manifest an app hands over before anything else runs |
| `api.js` | the `google.script.run` bridge and the `{ok,data}` envelope |
| `store.js` | the bootstrap cache, the SWR RPC cache and hash routing |
| `icons.js` | node-kind SVG (512 lines; only `ui/nodeCell.js` and `ui/uiIcons.js` reach it) |
| `ui/` | 37 component modules plus `index.js`, the one import surface, `helpPage.js` — a page, not a component, so deliberately not in the barrel — and `settingsForm.js` — a DOM-free model reached only by direct path, deliberately not in the barrel either (see "The settings seam" below) |
| `styles/` | nine stylesheets: `tokens.base.css` first, `overrides.css` last |
| `test/contracts/` | twenty-one spec factories the apps register from their own test files (the count was stale at "sixteen" before `collapsibleSection.js` was counted in; it is `grep -l 'export function register' test/contracts/*.js`) |
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
  That last clause was aspirational until the tip-budget round, and worth recording because
  the gap was invisible: `gas_ai` carried one `blurb` string and no `lines`, so
  `glossaryTipLines` fell through to `tipLead(entry.blurb)` and cut 46 of its 51 entries
  mid-sentence. A `glossaryTip` there showed an ellipsis where the other two showed a
  definition. All three carry `lines[]` now, and each app's `helpContent.test.js` holds the
  first two of them to a card-sized budget (`MAX_TIP_LINE_LENGTH`), because those two are
  what the card paints. Root `DESIGN.md` carries the rule.
- **Page-shaped CSS**, with one exception: `styles/help.css`, which dresses the shared key
  sheet below. This bullet used to claim that sheet is "the shape every sidekick's key sheet
  has"; it is not, and was not when it was written — see the exception below. It is the shape
  TWO of the three have.

  The gas parity wave's P3.4b (2026-09-08) added a narrower exception, and it is not a new
  category: `gas/` and `gas_devsecops/` each carried sixteen rule blocks in their own
  `pages.css` that were byte for byte identical, flagged since P1.6 as promotion candidates in
  gas's own sheet. A rule is page-shaped only while more than one app draws that page
  differently; once both copies say the same thing, the duplicate is the thing worth removing.
  `fixnext*`, `movement-rows/-row/-label/-counts/-block`, `sev-fan*`, `.page-header >
  .kpi-card`, `chart-row--pair`, `toolbar-group`, `finding-actions`, `.kv dd > .code-block`,
  `trend-aside*`, `rate-with-meter*`, `unclassified-card/-swatch` and `.section-label >
  .heading-pill` moved into `styles/components.css`; `.table-wrap { position: relative }` and
  the `.sev-fan`/`.chart-row--pair`/`.chart-row` narrow-viewport collapse moved into
  `styles/tables.css` beside the rules they extend; the `.page-header` narrow-viewport
  collapse moved into `styles/components.css` beside `.page-header`; and the rail status dot's
  hit-target chrome (`.sidebar .rail-status-dot` / `.sidebar button.rail-status-dot`) moved
  into `styles/base.css` beside `.rail-status-dot`. Both apps' own `pages.css` now hold only
  the pages a sibling does not draw.

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
| `gas_hub` | — | — | ✅ | one stamp | — | — |

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
- **`gas_hub` draws two cards and could not honestly draw the other four.** It calls no
  third-party API and stores no secret, so there is no credential whose presence it could
  report — and with no credentials card there is no `missingTone` to choose, which its
  registration asserts in as many words. It runs no scan and no sync (no last-sync line), owns
  no spreadsheet (no storage meter) and has no job that could fail (no error log). What is
  left — which product this is, and which build is serving it — is exactly what a launcher can
  say about its own deployment.

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

## The settings seam

The settings-unification wave's thesis, in the words of `gas/src/domain/settingsImpact.ts`: "a
figure that appears only after you save is not decision support, it is a receipt." Before that
wave only `gas/`'s Settings page worked that way. Now `gas`, `gas_ai`, `gas_devsecops` and
`gas_hub` (one tab, three URL fields) all draw through one kernel and one readout vocabulary.

### The kernel — `ui/settingsForm.js`

Three apps had grown the same eight functions independently: `normalizeTab`, `changedFields`,
`settingsPatch`, `changeSummary`, `changeCountText`, `tabStatus`, `sameValue`, and `dirtyTabs`.
`settingsForm({tabs, fields, defaultTab})` is the one answer, and it is a **factory** rather than
eight free functions because each app has to close it over its own `{tabs, fields}` registry —
which tab a field belongs to, which label a tab wears — the same shape `scopeKinds` and
`diagnostics.js` already close a shared control over an app's own data, so every app's existing
import of these names (`normalizeTab`, and so on) keeps resolving unchanged. `dirtyTabs` is not
one of the seven the factory returns: it was dead in production in all three apps before this
package (`tabStatus` had already replaced its only call site in each app's `pages/settings.js`),
and its only remaining callers were each app's own test file, exercising a function nothing
built calls. Promoting a dead function into a shared kernel would have made three apps agree to
keep carrying it forever.

The factory throws **twice, at construction**, rather than letting either mistake surface later
as a bug a reader has to notice on screen: an unknown `defaultTab` (missing, or naming no tab in
`tabs`) throws, and a field naming a `tab` that is not in `tabs` throws. Both are typos a
hand-edited registry can make and neither has a safe fallback — guessing either one would hand a
reader the wrong tab and never say so.

**Reached by direct path — `gas_shared/ui/settingsForm.js` — never through `ui/index.js`.** This
file has no `document` in it anywhere, the same as `ui/scopeModel.js` and `ui/tableModel.js`, but
unlike those two it is deliberately outside the barrel: a settings-model test has no reason to
pull the other 37 component modules (`dom.js`'s `el()` included) in behind eight pure functions,
and every app's own settings-model file runs under plain Node with no jsdom to spare. The rule is
asserted, not just stated — `test/contracts/settingsForm.js` checks the import specifier by
regex against the app's own source, because the failure this guards against is a future edit
that adds `settingsForm` to the barrel and repoints an app's import at `ui.js` "since it already
has everything else," which would still resolve and pass every other assertion here. (An earlier
claim that importing it through the barrel throws `document is not defined` was tested during
this wave and is false — nothing else in `ui/index.js` touches `document` at import time either,
so a barrel import would resolve cleanly in a suite with no jsdom. The reason to keep the direct
path is the one above, a component count, not a crash — do not repeat the crash claim.)

### The readout vocabulary — `ui/settingsReadouts.js`, `ui/splitBar.js`, `figures.js`'s `openAndTotal`

Promoted from `gas/src/client/js/settingsReadouts.js` — gas was the only app whose Settings page
told a reader, beside each control, what that control was doing to the register, before this
wave. Four exports, plus the formatter that moved out beside `fmtCount`/`pct1`/`days1`:

- **`impactSplitModel()` / `impactSplit()`** — the with/without split a display toggle draws.
  `unit` is REQUIRED and throws without it: "findings" is right in `gas` and `gas_devsecops` and
  wrong in `gas_ai`, the same refusal `diagnostics.js`'s `missingTone` and this module's own
  `defaultTab` already use for a word that is never safe to guess. A zero-denominator share is
  `absentText`, never `"0.0%"` — zero of zero is unmeasured, not zero percent, and the headline
  drops its parenthetical entirely rather than print a percent sign over nothing measured.
- **`severitySplitModel()`** — the shared half of a severity scan-scope bar. `inScope` is a
  caller-supplied PREDICATE, `(sev) => boolean`, never a selected array: `gas_devsecops`'s
  `fetchSeverities === []` means every severity requested, never none, and a shared `.includes()`
  shim baked into this module would silently invert that register's most carefully argued
  default the moment it reached this control. `unit` is refused the same way `impactSplitModel`'s
  is.
- **`tickTimeline()`** — a labelled tick sequence. It NEVER computes a tick's own state: `gas`'s
  retention-window arithmetic (`wouldSeal`) is a domain decision and stays in `gas`'s own client
  mirror, in a `retentionTicks()` this module does not know exists. A state carrying a glyph but
  no word throws — fill is never the only cue.
- **`createCutHistogram()`** — a bucketed distribution with a draggable cut line, generalised
  from `gas`'s EPSS threshold histogram. Built EXACTLY ONCE; `update()` only ever rewrites what is
  already there and never recreates the `<input type="range">`. This is load-bearing, not a style
  choice: the range fires `input` continuously while dragged, and replacing that element mid-drag
  silently aborts the drag — the browser stops delivering `input` events to a node once it leaves
  the document. `test/contracts/settingsReadouts.js` isolates `update()`'s own body in a DOM
  sweep and asserts it never calls the constructor, not just a comment saying so.
- **`splitBar()`** (`ui/splitBar.js`) — the track both split models draw onto: one track, labelled
  segments, the figures repeated in words in the caption beneath it, because a bar alone fails the
  non-colour rule. It promoted alongside these, not because it had crossed an app boundary before
  this wave (it had not — both call sites were gas's own), but because the placement rule below
  puts it beside the primitives that build its input.
- **`openAndTotal()`** (`ui/figures.js`, beside `fmtCount`/`pct1`/`days1`) — gas's "N (M all
  time)" pair formatter, moved because it is a number formatter and not a DOM builder, and
  because `severitySplitModel` needed it too. It is NOT `fmtCount`: a missing count reads as the
  number `0`, never `absentText` — a deliberately different refusal that
  `openAndTotal(undefined, undefined)` is contracted to hold (see the moved test cases in
  `test/contracts/settingsReadouts.js`).

### What stays app-local

Anything that reads an app's own domain layer. `gas`'s risk cube (`riskCube.js`'s
`breakdownFromCube`/`epssHistogram`/`openSlice`/`ruleIsEmpty`/`ruleSentence`) reads `RiskRule`,
which means nothing in a sibling with no risk classifier. Each app keeps its own
`settingsReadouts.js` client mirror composing the shared primitives over its own payload shape —
`gas_ai`'s reads `fiveRsPins`/`categoryCube`/`rankCube`; `gas_devsecops`'s ports two functions
(`atOrBelow`, `strandedOpenCount`) from `src/domain/settingsImpact.ts` byte-for-byte, because the
client cannot import TypeScript, and pins them against the TS originals with a mirror test
rather than trusting the two copies to stay in sync by hand.

The **`(census, draft)` adapters** are the narrowest example. `severitySplitModel` needs a
predicate, and every register's in-memory draft shape is an ARRAY (`fetchSeverities`), never a
predicate. `gas`'s `severityScopeReadout(census, draft, selectable)` and `gas_devsecops`'s
`severityScopeReadout(scope, census, requestedSeverities, selectable)` are each that one closure
— `(sev) => draft.fetchSeverities.includes(sev)` — which is the one thing `severitySplitModel`
may not do generically, since a shared `.includes()` baked into `gas_shared` would invert
`gas_devsecops`'s `[]`-means-all default the instant it reached that register (see
`severitySplitModel`'s own header). There is no arithmetic here `gas_shared` could hold; it is
each register's own reading of its own draft shape.

### The tab spine

Register first, the app's own lanes in the middle, then Access, then System. Register decides
which rows a register's issue-shaped figures are even computed over, so it comes before every tab
that reads off that scope rather than trailing as a tab tacked onto the end — `gas_ai` used to
open on Graph, and its own `settingsModel.js` header states why Register displaced it. `gas` had
no Access tab at all before this wave; its roster sat on `System` beside the storage meter and
the error log, which are read-only deployment facts rather than a decision about who may do
what. The roster now gets its own tab, and a reader who may not edit it never sees a tab that
renders nothing: `renderAccessPanel()` returns `null`, the tab is never built, and a stale
`?tab=access` falls through `normalizeTab`'s two-argument form to Register.

The spine is pinned in the shared contract as an **opt-in** `ctx.spine` check
(`test/contracts/settingsForm.js`), not assumed from every registry that binds the kernel — an
app that is not shaped like the spine names its way out rather than being silently exempt from
the check. `gas_hub` is the one that does: `spine: false`, with the reason recorded in the
registration call itself rather than left as an absence — it has three PANELS and no tabstrip at
all (`test/shared.test.js`'s own comment), so there is no spine here for a drive-by to move back.

### The placement rule

Anything exported from `gas_shared/ui/` with a domain-free API gets its CSS in
`styles/components.css`; `styles/settings.css` keeps only the form vocabulary — the panel, the
labelled row, the switch, the tab strip, the save bar — none of which draws anything specific to
a register. `splitBar`'s hatch, `tickTimeline`'s ticks and `createCutHistogram`'s bars draw
nothing OS-vulnerability-specific either, which is why they moved to `components.css` rather than
following `settings.css` over from `gas`.

## Four primitives for a page with too many words

The density wave's finding was that these registers are *correct* and *wordy*: a `denomNote`
paragraph under every figure card (22 of them across three register pages, 13 on Secrets
alone), a five-column table with a prose "Reading" column wherever two yes/no questions cross,
and a figure that says where a number is but never where it is going. Four modules, all
additive, all with a pure model half a contract can hold and a thin DOM half that cannot be
wrong in an interesting way.

**`ui/quad.js` — two yes/no questions crossed.** `quadModel({rows, cols, cells, total, unit})`
returns the four corners in one fixed order with their shares, their "N of M *unit*" short
forms and one `aria` sentence stating every corner in words; `quadTable(model, {ariaLabel,
cellHelp})` draws them as a real table with `<th scope="col">` / `<th scope="row">` axes rather
than as a grid of divs with a label bolted on. It knows nothing about severity — no `sev*`
class, no import of `severity.js` — because the first caller is the secrets register, whose
`test/pagesLit.test.js` gate 4/7 forbids a severity axis in that page's executable code, and a
shared component is exactly the back door such a gate cannot see through. Two refusals rather
than two defaults: an unmeasured `count` is `absentText` and contributes NO share (a zero in
one corner of a 2x2 is a strong claim), and a corner with no `label` is refused outright,
because `data-tone` is the third cue and never the first. The share is read against the
caller's stated `total`, not against the sum of the corners — those are the same number only
when the cross partitions the population, and the confusion matrix on the program lane leaves
its unclassified rows outside.

**`ui/sparkline.js` — a series as one line, at the size of a word.** `sparkPath(points, {w, h,
pad})` is pure and returns `{d, n, gaps, first, last, min, max, end}`; `sparkline(points,
{label, w, h, className})` wraps it in a `role="img"` SVG stroked in `currentColor`, with an
emphasised end dot and no animation at all — so there is no `prefers-reduced-motion`
alternative owed. It refuses each point BY TYPE before any cast, and the reason is the one
CLAUDE.md has now recorded three times: `Number(null)`, `Number("")`, `Number([])` and
`Number(false)` are all `0` and all finite, so the one-line `points.map(Number)
.filter(Number.isFinite)` rewrite plots every scan that never ran on the floor of the chart
and drags the whole line's scale down with it. A refused point is a GAP that keeps its x
position and breaks the line — dropping it instead would fix the floor and get the slope
wrong, which is the only thing a sparkline is read for. The `aria-label` always states first,
last, low, high and the number of readings; a caller's own `label` NAMES the series and never
replaces those figures. Its class is `.sparkline`, not `.spark`, because `gas` already owns
`.spark` for the bordered per-tier card on its Overview page and its own sheet loads after
`components.css` — the same collision, and the same resolution, as `.health-` over `.diag-`.
The two CANVAS `sparkline(canvas, values)` functions in `gas`'s and `gas_devsecops`'s own
`charts.js` are untouched: they are reached through a namespace so nothing resolves
ambiguously, they are near-duplicates of each other, and folding them in here would be a
behaviour change to two shipped charts rather than an addition.

**`ui/figures.js` gains `figureCard` / `figureCardModel` — the denominator, one level down.**
A rate without its denominator is not a measurement, so the sentence stays; what moves is
where it is drawn. `figureCard({label, value, sub, chip, help, denominator})` builds the same
`kpiCard` and PREPENDS the denominator to the tip lines on the card's own label (resolving
`help` through the three shapes `tipLines()` already knows, so a `{term}` card keeps the
book's copy *and* its route to the entry), then writes the sentence to `data-denominator` on
the card node — the same claim `denomNote` has always made, and the reason a test can read
what a reader reads. `denomNote` itself is untouched and still exported: a denominator printed
over a table is still a paragraph. `figureCardModel` is the DOM-free half, and it takes an
optional resolver for one narrow reason — `tipLines({term})` reaches
`appConfig().findHelpEntry`, which THROWS when nothing configured it, and a contract that
installed a manifest to get past that would install it for every other file sharing the
vitest worker.

**`ui/unitChart.js` — a count as countable marks.** The fourth, and the one that arrived by
promotion rather than by extraction: `gas_devsecops`'s Executive page had drawn unit marks for
the open backlog since the cold-zone wave, with the ladder, the clipped partial mark and the
refuse-before-cast rule inline in that page, and no sibling could draw one. `unitScale` /
`unitCounts` are `pictogramUnit` / `pictogramCounts` verbatim; `unitChartModel` / `unitGrid` /
`unitKeyRow` are the part-to-whole half the tally never had. Two layouts, one file, two models —
they share the MARK (its box, its `--ink` fill, its forced-colours substitution) and keep two
models, because a tally goes wrong when the unit is per-row instead of per-table and a waffle
when the cells do not sum to the lattice.

**The class is `.isotype`, and that is the decision worth reading.**
`gas_devsecops/dev/densityModel.mjs`'s `VISUAL_PREDICATES` already counts `hasClass("isotype")`
as a picture. Naming the generalised module's wrapper anything else would have meant editing the
measuring instrument in the same wave that uses it to prove a change — a before-column and an
after-column read off two different rulers. The grid is the same class with a modifier for that
reason and no other, and it is why this package needed no edit to the walker at all.

Two non-colour channels rather than one: `data-tone` is `quad.js`'s four (a fifth would be a
severity, and a tone outside the set is refused, which is what structurally keeps a severity
distribution out of this module and in `sevSegmentBar`), and `data-fill` is a SILHOUETTE —
solid, ring or hatch — so two adjacent segments differ by shape as well as by fill. Four by
three is twelve distinguishable styles and zero new colour tokens; `--chart-cat-*` stays
reserved and undefined. `--hatch` gets its first consumer as designed: a segment that is a
coverage gap rather than a measurement.

**Twelve styles was the claim; for a while nine of them existed.** `[data-fill="hatch"]` painted
one ink at one alpha whatever the segment's `data-tone` was, so the tone channel reached solid
and ring and stopped at the third silhouette — four hatched tones rendered as one. Both cold-zone
censuses are built on that pair being distinguishable: they hatch `watching` (open findings whose
idle time could not be measured) as `warn` and `unobserved` (the scanner has lost sight of it) as
`neutral`, and shipped them pixel-identical, with the key row beneath as the only thing telling
them apart. The comb now takes its ink from `color`, the way the ring already took its own, with
`--hatch`'s geometry and its neutral rgba as the default so a hatch that was already neutral does
not move. Under forced colours the comb is dropped rather than tone-mapped: it is a hue now, and
`--warn` on a black High Contrast ground measures about 1.8:1 — the dashed border is what carries
measured-versus-not-measured there, and that is what was measured.

**A census block is as flat as it can be, and it grows to its card.** `unitGrid` lays an exact
lattice of 24 or fewer out as one row at 14px; past that it used to fall back to BOTH a square
shape and the waffle's 9px cell, so one repository over the edge turned a 318px strip into a 53px
square and thirty assets rendered as a 64px smudge in a 704px card — the same defect the 14px
rule was written to fix, one size class along. The shape and the size part company instead. A
census block takes as few rows as `ROW_MAX` allows and balances across them, because square is
right for a PROPORTION (10x10 makes one cell one percentage point) and carries nothing for a
census; and it keeps 14px as a FLOOR, with `.isotype--census` in `styles/components.css` growing
the column from there to the width of the card and capping it — at 30px, past which a cell stops
reading as a mark, and at 44rem, past which the lattice reads as a banner. The column count stays
in the module because the shape of a picture is a decision about the picture; how much room those
columns get is a fact about the viewport, and CSS is the only one of the two that can see it.
That cap used to be `gas`'s own `.cold-census { max-width: 44rem }`, where it was inert (the grid
inside was `max-content` and never reached it) and where `gas_devsecops` — which passes the same
class name — had no rule behind it at all.

Refusals, all by type before any cast: an unmeasured count is `absentText` and contributes no
cells and no share; a zero denominator is unmeasured and never `"0.0%"`; `unit` is required and
throws; a segment with no `label` is refused outright; and segments summing PAST the stated
total throw, because two overlapping populations read as one partition has no silent outcome
worth having. Shares read against the STATED total, never the segments' own sum — the leftover
is a named remainder. `cells: "exact"` is one cell per member and throws above
`MAX_EXACT_CELLS`, because a grid that looks countable and is not is worse than one that never
claimed to be.

**A waffle owes no `chartTable` disclosure, and the reason is specific.** `chartTable.js` exists
because a `<canvas>` has no DOM to read and a Chart.js tooltip answers only a pointer, so the
figures are literally unreachable. `unitKeyRow` prints every segment's label, count and share in
real text beneath the lattice, and the model refuses a segment with no label — so there is no
configuration in which the grid is the sole carrier. That is `splitBar`'s caption argument, and
it is stronger than the canvas case because the numbers are beside the picture rather than one
disclosure down.

**One thing this module may not have: a `minMark` option.** A rung of 30 against an open backlog
of 200,000 rounds to zero tenths, so `unitRow` returns `null` and the caller draws nothing. That
is correct — the honest encoding of a continuous share of one denominator is a proportional bar
with a minimum-width floor, which `gas`'s triage funnel already has. An option that drew a mark
below the resolution of its own unit would be a licence to lie in the one place that must not.

**A backtick in a thrown string fails the BUILD, not the suite.** Three of this module's own
refusal messages quoted a parameter name in backticks. esbuild lowers template literals and
minify strips comments, but a backtick CHARACTER inside a string literal survives both, and
every app's `esbuild.config.mjs` middlebox guard rejects it. `gas` built anyway — it had
tree-shaken `unitChartModel` until a second register called it — so the failure only surfaced
two apps later. `test/contracts/unitChart.js` sweeps the module's comment-stripped source for
one now.

**Two forms that replaced sentences, from the prose round (2026-09-16).** `splitBar` given
`keys` (which `severitySplitModel` now returns beside its `caption`) draws one key per severity
under the track — swatch, word, figure, "not scanned" beside an out-of-scope one — and the
model's `summary` beneath them, and prints the caption nowhere. The caption is still built and
still the bar's spoken form; what changed is that a 45-word sentence on every Settings page in
two registers is a row of facts a reader scans. A caller passing only `caption` (the two-way
impact split) is drawn byte-identically. And `.scope-chips` / `.scope-chip` in
`components.css` draw a register's provenance line — `populationLine`'s `parts`, one chip
each, the lead chip the count — with the joined sentence as the group's `aria-label`. Both are
CSS-and-model changes only; neither is a new module.

**`--hatch`, and the class over it.** One token in `styles/tokens.base.css` holding the
repeating-linear-gradient that means THIS PART IS NOT A MEASUREMENT, plus a `.hatch` utility
in `components.css`. It is ink at an alpha rather than a hue, which is the one kind of fill
forced-colors inverts toward the forced foreground while keeping its alpha — so it survives
High Contrast without `forced-color-adjust: none` pinning near-black onto a possibly-black
ground. It is for NEW work: `axisBar`'s hatch and `.sevbar-seg--empty`'s keep their own rules,
because repointing them changes shipped pictures and belongs in its own measured round.

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
| `gas_hub` | `#0a0a0a` | `#27272a` | `#0a0a0a` | `transparent` | `#fafafa` |

| measured | gas | gas_ai | gas_devsecops | gas_hub |
|---|---|---|---|---|
| `--accent-text` on white | 5.17 | 6.29 | 7.39 | 19.80 |
| `--on-accent` on `--accent` | 5.17 | 6.29 | 11.78 | 18.97 |
| `--accent` on white (fill, 3:1 floor) | 5.17 | 6.29 | **1.52** | 19.80 |

**`gas_hub`'s accent is the one that is not a hue.** The hub belongs to no register, so
borrowing one register's colour would say it did; graphite `#0a0a0a` is `--graphite`, the
primary-button colour `styles/base.css` already gives every app, reused as an identity. It
clears every floor unaided by the widest margin in the table, which is why its `--accent-text`
may point at the accent and its `--accent-edge` may be `transparent`. It carries a SECOND
vocabulary no sibling has — `--tile-os` / `--tile-ai` / `--tile-dso` / `--tile-soon`, the four
launcher tiles — and those are the three registers' own identity colours borrowed onto the
hub's front door, plus a border for the unbuilt fourth. They are not part of this contract and
nothing outside `ui/tile.js` may reach for one; `gas_hub/DESIGN.md` holds their measured table.

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
| `syncCaption.js` | the rail's freshness sentence — that `app.js` calls the shared `syncCaption()` rather than growing its own `Math.floor(Date.now() - Date.parse(...))` day-count back. `ctx.railHasSyncZone: false` (only `gas_hub`, which hands `createAppShell` no `railFooter` and has no freshness sentence at all) turns the first half into a NAMED skip and leaves the `Math.floor` prohibition running — a prohibition is exactly the kind of rule an app with no caption today can still break tomorrow |
| `quad.js` | `ui/quad.js`'s 2x2: the fixed corner order, shares read against the STATED total rather than the corner sum, an unmeasured count that is absent and never a zero, and a refusal for any corner carrying a tone without a word. Three perturbations reproduce the tempting wrong version inline — a cast-first count, a defaulted label, a renormalised share — and show each one disagreeing with the shipped model on the same input |
| `sparkline.js` | `ui/sparkline.js`'s path: every point refused by type BEFORE any cast, a gap that keeps its x position and breaks the line, and the label that always states first/last/low/high. Two perturbations, because there are two wrong answers here and only one of them is obvious — the cast-first rewrite (gaps plotted at 0, the floor moved) and the filter-them-out rewrite (the floor right, the slope wrong) |
| `figureCard.js` | `ui/figures.js`'s `figureCard`: the denominator PREPENDED to the tip lines, stamped on `data-denominator`, and drawn as no paragraph. Perturbed three ways — dropped from the lines (the attribute check still passes and the reader is told nothing), appended instead of prepended (buried under a three-line glossary entry), and merged into a bare `{lines}` (identical on screen, and every migrated card loses its route to the book) |
| `settingsForm.js` | `ui/settingsForm.js`'s kernel, run against every registry that binds it: this app's own `{tabs, fields}` registry is well-formed (every field names a real tab, no duplicate tab keys, every tab and field carries a non-empty label, and the malformed shapes actually throw), the kernel's fixed behaviour against one synthetic registry so the assertions are identical for every app rather than hand-derived from each one's own field names, the direct-import-path rule asserted as a specifier regex against the app's own source, the `tabStatus` key-presence-not-truthiness perturbation, and — opt-in via `ctx.spine` — the canonical Register · … · Access · System tab spine |
| `settingsReadouts.js` | the shared half of `ui/settingsReadouts.js` and `ui/figures.js`'s `openAndTotal`: the zero-denominator refusal (`absentText`, never `"0.0%"`), the naive `Array#includes` perturbation showing why `severitySplitModel`'s `inScope` must be a predicate and never a selected array, the glyph-without-word refusal for `tickTimeline`, a build-once identity assertion that `createCutHistogram`'s `update()` never recreates the range input, and `openAndTotal`'s own suppress-when-equal and refuse-before-cast rules. Registered from `gas`, `gas_ai` and `gas_devsecops` — not `gas_hub`, which has no register population |
| `unitChart.js` | the unit ladder and the part-to-whole: one unit per TABLE (a per-row unit draws 401 with fewer marks than 400), every input refused by type before any cast, cells allocated by largest remainder so the lattice sums exactly and no real segment rounds away to nothing, shares read against the STATED total, a segment with no word refused, a tone outside quad's four refused, and — because it broke a build once — no backtick in any string that survives minification. Registered from all three registers; `gas_hub` has no register population and does not |
| `collapsibleSection.js` | `ui/sheet.js`'s `collapsibleSection` — a whole section behind its own heading. Four perturbations, one per rewrite somebody would reasonably make: the heading built with `sectionLabel` (which turns the whole h2 into a `.tip-trigger`, so the obvious click target stops opening the section and a `{term}` help toggles AND navigates on one click), a guard using `stopPropagation` instead of `preventDefault` (`ui/tip.js` delegates on `document`, so the stronger-looking fix is the one that kills the tip), a `<details>` left holding its own open state (identical on a first paint, lost on the second — an swr page paints twice), and a `readOpen` returning `false` rather than `null` on a denied localStorage (every reader gets the section shut forever). Registered from `gas` and `gas_devsecops`, the two apps that draw one |

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

**`parity.js`'s FORKABLE sweep only walks `src/client/js/` — never `test/`.** The
settings-unification wave's P13 removed 23 test-file copies of `test/contracts/emptyStates.js`'s
`code()` source-stripper, 13 of which had silently stopped stripping comments partway through a
file (none had missed a real assertion — the defect was latent, not active, and was measured
that way before the fix). Nothing about that package closed the gap that let it happen:
`registerParityContract`'s FORKABLE walk (`walk(jsDir)`, `jsDir = resolve(root, "src/client/js")`)
never looks inside `test/`, so a shipped helper — `code()`, or any of the settings kernel's seven
names — can be re-forked into a new test file today and nothing in this suite will notice. Closing
it means the walk covering `test/` too, or a second, narrower FORKABLE list scoped to test-only
helpers; either is a real package, not a follow-up sentence.
