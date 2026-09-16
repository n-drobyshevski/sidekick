---
colors:
  accent: "#2563eb"
  accent-hover: "#1d4ed8"
  accent-text: "#2563eb"
  accent-edge: "transparent"
  accent-wash: "rgba(37,99,235,0.08)"
  on-accent: "#ffffff"
  graphite: "#0a0a0a"
  ink: "#171717"
  page: "#ffffff"
  surface: "#f8f8fa"
  hairline: "#e6e6e9"
  chart-cat-1: "#2563eb"
  chart-cat-2: "#0d9488"
  chart-cat-3: "#90396a"
  chart-cat-4: "#7fba04"
  chart-cat-5: "#f66bb9"
  chart-cat-other: "#94a3b8"
  sev-critical: "#dc2626"
  sev-high: "#ea580c"
  sev-medium: "#d97706"
  sev-low: "#2563eb"
  sev-info: "#64748b"
  sev-unknown: "#475569"
---

# DESIGN: Wiz Sidekick OS

> Sibling of [`../DESIGN.md`](../DESIGN.md). The creative north star, the type scale, the
> spacing ramp, the radius scale, the elevation vocabulary, the severity palette and the
> accessibility bar are **inherited unchanged**. What differs is stated here. Where this
> file is silent, the shared document governs.

## 1. What differs: nothing about the colour, and one rule the arithmetic forces

This is the one sidekick whose accent needed no split. `gas_ai`'s crimson and
`gas_devsecops`'s yellow each fail one contrast floor and carry a five-token accent contract
because of it (`gas_shared/README.md`, "The five-token accent contract"); Signal Blue
`#2563eb` fails neither.

### The Ink-Equals-Fill case

`--accent-text` equals `--accent` here, and `--accent-edge` is `transparent`, because the
fill clears both floors on its own (measured in `styles/tokens.css`, pinned in
`test/shared.test.js` ~256-293):

| measurement | value | floor |
|---|---|---|
| `#2563eb` on white | 5.17:1 | 4.5:1 text |
| `#2563eb` on `--accent-wash` (`rgba(37,99,235,.08)` over white = `#eef3fd`) | 4.65:1 | 4.5:1 text |

`--accent-edge` exists anyway, set to `transparent`: the shared rules (`gas_shared/README.md`)
name it unconditionally on every accent fill, and a token that is sometimes absent is a
wiring defect waiting to happen the day a rule reads it with no fallback. `--on-accent` is
`#ffffff`: near-black on this blue is 3.4686:1, which clears the 3:1 graphical-mark floor and
fails the 4.5:1 text floor, so white stays the answer. (`gas_shared/README.md` and
`gas_devsecops`'s own `tokens.css` once recorded this figure as 1.62:1; `test/shared.test.js`
re-measured it with the contract's own `ratio()` and both documents now carry the corrected
number. The conclusion never moved, only the arithmetic under it.)

**`#1d4ed8` is not the accent's text twin.** It is `--sev-low-text`, LOW severity's own
darkened label colour, and `--accent-hover` reuses that value as a *fill* hover state only,
never as ink. The severity palette is byte-identical across all four surfaces; the brand is
the one axis of variation, and it may not collide with the one thing every register agrees
on. `test/shared.test.js` pins both the non-collision and the fact that `--accent-hover` is a
fill token, never read as text.

## 2. The categorical group palette: this register is its only consumer

Root `DESIGN.md` §2 already describes the five-hue categorical set (`--chart-cat-1..5` plus
`--chart-cat-other`, capped at five so a colourblind-safe, warm-band-free set stays legible,
the tail folding to Other): that description was written from this app's own palette, and no
sibling draws a grouping chart yet. `charts.js`'s `CATEGORICAL` array is the copy the canvas
actually paints (a `<canvas>` cannot read a CSS custom property), kept in sync with
`styles/tokens.css` by convention and pinned together in `test/shared.test.js`.

The prefix is `--chart-cat-*`, not the shorter `--cat-*` these values shipped under before:
`gas_shared/styles/tokens.base.css` already owns `--cat-<kind>-ink/text/tint` for the node
colour palette (`--cat-asset-*`, `--cat-data-*`, `--cat-iam-*`, …), and two unrelated meanings
sharing one prefix is exactly the kind of collision a later reader picks the wrong one from.

## 3. `.spark` and `.sparkline` are two different things, and both names are taken

`gas_shared/ui/sparkline.js`'s shared component is `.sparkline`, an SVG at the size of a word,
never `.spark`, because this app already owns `.spark` for the bordered per-tier
small-multiple card on the Overview page (`styles/pages.css`'s `.spark-grid`/`.spark`/
`.spark__head` block). `gas_shared/README.md` states the resolution in as many words: "gas
already owns `.spark`". So a page reaching for a trend line inside a card uses `.kpi-spark`
or `.trend-aside` (the shared shapes intake in this package) wrapping a `.sparkline`, and
`.spark` keeps meaning the tier card it has always meant. The two `charts.js`
`sparkline(canvas, values)` canvas functions (this app's and `gas_devsecops`'s) are a third,
unrelated thing again: near-duplicates of each other, reached through a namespace so nothing
resolves ambiguously, and untouched by the shared module.

## 4. The rail status dot answers for one register

`gas_devsecops` derives its rail dot from `lastScanByScope`/per-project state because it holds
three scopes' worth of freshness in one ledger to reconcile. `gas_ai` is not a second instance
of that: it has one job kind (`JobKind = "sync"`) and one `bootstrap.latestSync` row, and its
`railStatus.js` collapses onto that single row the same way this register's does. This register
has exactly one scope, one ledger, one scan history, so `never scanned` collapses onto
`latestScan` directly: there is no worse-of-several-scopes comparison to make, because there
is only ever the one. The dot still takes the shared shape (a real `<button>`, 24x24px hit
target over the 9px mark, state carried in a word as well as a colour); what is app-specific
is only the derivation being simpler, not the component.

## 5. The noun is scan, not sync

`gas_devsecops` and `gas_ai` fall back to a dry run without credentials and call the
operation "sync"; this register's `MANIFEST.sync = { noun: "scan", unit: "findings" }`
(`app.js`) names its own operation "Run scan" / "Scan history", and every shared string that
takes `sync.noun` (`firstRunNotice`, `syncCaption`) renders it that way here. The sibling
rule in `CLAUDE.md` about "sync" being the correct word for a dry-run fallback does not apply
to this register: it has a real scan with a real battery (`src/server/scanJobs.ts`), not a
dry-run stand-in, so "scan" is not a euphemism, it is the operation's name.

## 6. The Executive shape (adopted 2026-09-08)

Every GAS sidekick's front door is now the same shape, this one included: a static title
block (the only `h1`, which waits on no RPC), then a metric header from the shared
`pageHeader()`: the hero stat ("Remediation half-life", read through `kmHalfLifeView` so a
censored curve prints "at least N days" and an unread ledger prints "Not measured"), a
movement aside of per-severity rows against the newest scan a week or more older, and a
stat strip closed by a hairline; then the open severity strip with its key row WHERE THAT
MOVEMENT COMPARISON DOES NOT EXIST (see below); then the by-domain table; then the last-scan
block; and LAST, behind its own heading, Fix next — a
ranked table of (tier, owner) groups (an ordered list until the prose round of 2026-09-16 —
see §9) with its denominator ("25 of 70 open findings ranked") and a disclosure naming every
unranked reason with its count. The centred 720px `.exec` column and the page-level Run
scan button are gone (one control in one place, the rail), and so is every `.exec*` and
`.hero*` rule.

**Fix next moved to the foot of the page and became collapsible, and both halves of that are
one decision.** It sat directly under the hero for its whole life on the argument that the
hero states the register's claim about itself and the ranking states what follows from it.
What that order actually did was put the page's longest block — eight rows of eight columns,
its denominator, its disclosure and up to three task notes — between the one figure a leader
opens this page for and every other figure that qualifies it. The severity strip, the
by-domain split and the last-scan caption are one glance each and now sit together; the
ranked list is a WORKLIST, a different reader on a different errand, and it is at the end,
shut, opened on purpose. `gas_shared/ui/sheet.js`'s `collapsibleSection` is the component —
a `<details>` whose `<summary>` holds the h2 itself, so the heading is the toggle and the
definition rides on a `tipMark()` "?" beside it rather than turning the whole heading into a
`.tip-trigger` that would both toggle the section AND route to the book on one click.

**Folding a section is not the same as moving a statement one level down, and §6's rule
survives intact.** "An honesty statement stays on the surface" is a rule about a section's
INTERIOR: never show a figure while its caveat sits behind a signifier. Everything inside Fix
next folds together — the cap note and the exposure refusal with the table they qualify — so
there is no state in which the list is legible and its constraints are not. The one line that
does have to be readable while the section is shut is its denominator, and that is why
`rankedShort` moved UP onto the heading (as `collapsibleSection`'s `hint`) instead of staying
a paragraph under the table. `test/wordsOneLevelDown.test.js` still holds `cutNote`,
`exposureNote` and `rankedShort` out of any `disclosure(`; `test/executiveFixNext.test.js`
holds the new half — `fixHost` last in `main.append`, the section built through
`collapsibleSection`, and the two notes appended to the section's body rather than outside it.
The open state is the page's (`fixOpen`, because swrCall paints twice on a warm cache) and is
remembered per reader under the app's own storage prefix.

**The open severity strip is the movement aside's fallback, not a second copy of it.** Both
are built from the same scoped rows under the same severity gate (`api.ts` hands
`insights.openMovement` and `executiveSeverityCounts` the same `baseVisible` and the same
`severities`), and the aside says strictly more about that population: a row per severity
carrying the open count, a `unitRow` tally of it, the previous count and the direction. Drawn
together, the front door stated 27 CRITICAL and 39 HIGH twice, a screen apart, in two
different pictures — and only the lower copy had to apologise for its own arithmetic, because
dropping UNKNOWN from the key row is what puts 27 + 39 = 66 under a hero counting 70. The
aside's rows carry UNKNOWN and sum to their own total; there is nothing up there to reconcile.

**It is a fallback rather than a deletion because `openMovement` needs two scans at least
seven days apart.** A register in its first week has no comparison, the aside prints its
refusal with the real span it can offer, and this block is then the only thing on the front
door that breaks the open backlog down at all. Exactly one of the two is on screen at any
time and it is always the richer one available. `executiveSeverityView` owns the decision and
reads it through `openMovementView` rather than through a second copy of the comparability
rule — asking "does `movement.rows` have anything in it" would be a second opinion free to
disagree with the strip actually rendered, and `test/executiveView.test.js` perturbs exactly
that shortcut. The cost is stated on the view: with no gate in force `openMovement` publishes
only the severities PRESENT at either endpoint, so a level the register held nothing in all
week loses the "LOW 0" key this section otherwise insists on.

**The early bootstrap paint went with it, and so did the scoped error box.** The block used
to be drawn unscoped from `boot.openCounts` on the first synchronous pass, so the landing page
showed real numbers before the RPC landed; whether it belongs on the page at all is now a
question about the payload. Computing comparability from bootstrap would be that second copy
of the rule again, and painting it anyway would flash a full section that vanishes on every
load of a mature register — a skeleton is the same flash wearing a shimmer. The slot stays
empty until the answer is known; the hero's own skeleton already says the page is loading. The
`Couldn't load counts for this scope.` box existed only to REPLACE that early paint (leaving
a register-wide tally under a failed scoped fetch was the lie the scope rewire removed), and
with nothing pre-painted there is nothing to replace — the hero carries the one failure and
the retry. An honesty statement (a bound, a refusal, a cut, the population caveat)
stays on the surface; an explanation moves onto the nearest label's tip or into the
disclosure. Measured against the DevSecOps front door on its own harness (272 words, 2
prose blocks): 276 words, 9 prose blocks, the difference being the eight ranked meta lines,
which carry the count, hosts, leading CVE, age and domain that its shorter list omits.

## 7. The formatter table

Beside the shared duration helpers (`gas_shared/ui/figures.js`'s `fmtDays` / `days1` /
`boundedDays`), this register has one of its own: `fmtSpan` (`src/client/js/ui/span.js`)
formats an hours-to-years duration, the MTTR page's own scale, where a fix can land in hours
or drag past a year, and a single day-count column would either truncate the fast end or
read as an absurd number of days on the slow one. Both obey the same bound-vs-exact rule the
shared helpers do: a right-censored or lower-bound figure prints `"≥ N d"` / `"at least N"`,
never a bare number that reads as measured when it is a floor.

## 8. Unchanged, and deliberately so

The **severity palette is byte-identical** to all three siblings: six fills, six darkened
text twins, the two-token rule intact. `src/domain/config.ts` holds `SEVERITY_COLORS`; the
text twins come from `styles/tokens.css`'s `--sev-*-text` tokens instead, since this register
has never kept a `SEVERITY_TEXT` domain constant (`test/shared.test.js` explains why, in
place). The
**Graphite Primary Rule** holds without restatement: the primary button is `#0a0a0a` with
`#fafafa` on it, exactly as root `DESIGN.md` specifies; this register never had reason to
diverge, unlike `gas_ai`'s accent-filled button. Also unchanged: the neutrals, the type scale
and its tabular figures, the spacing ramp, the radius scale, the whisper-or-lift elevation
rule, and the motion durations.

## 9. Measuring a page, and what the unit-chart round moved

`npm run density -- --port 8787 --playwright <path to a playwright package>` runs
gas_devsecops's rendered-page walker (`../gas_devsecops/dev/density.mjs --root .`) over this
app's own nine routes and prints, per route: words, prose blocks and their word count, bare
numeric tokens, table cells, pictures by kind (meter, sevbar, axis-bar, isotype, quad,
sparkline, canvas, svg), visible definition triggers, and horizontal overflow at 1280/640/360px.
`--diff before.json after.json` compares two runs metric by metric. `README.md`'s dev section
has the standing hazards; the one worth repeating is that two Playwright clients against one
`dev/serve.mjs` can each be served the other's half-built bundle.

**Unit-chart round (2026-09-15), at 1280px, seeded.** Each cell reads
`words / proseBlocks / proseWords / numbers / tableCells / visuals / tips`. Both columns are one
run's output of the same command against the same seed — derived, not typed.

| route | before | after |
|---|---|---|
| executive | 276 / 9 / 149 / 99 / 21 / **1** / 11 | 276 / 9 / 149 / 99 / 21 / **4** / 11 |
| mttr | 307 / 5 / 119 / 103 / 68 / 20 / 35 | unchanged |
| program | 416 / 8 / 269 / 121 / 76 / 9 / 24 | unchanged |
| overview | 556 / 8 / 195 / 201 / 210 / 10 / 11 | unchanged |
| data | 458 / 7 / 283 / 65 / 46 / 0 / 3 | unchanged |
| history | 204 / 2 / 50 / 108 / 64 / 7 / 11 | unchanged |
| attribution | 163 / 3 / 65 / 57 / 52 / 0 / 8 | unchanged |
| help | 2693 / 98 / 2359 / 8 / 0 / 0 / 0 | unchanged |
| settings | 227 / 3 / 84 / 26 / 0 / 0 / 0 | unchanged |

**Only `executive` moved, and only on pictures.** The movement strip's six severity rows each
gained a `unitRow` tally at one unit for the strip; the counts and the pairs beside them are
untouched, which is why `words` did not move and is the point rather than a shortfall — the
marks are a second encoding of a figure already in words. Three of the six severities have open
findings in the seed, hence +3.

**This page's tally is the only picture the front door may have.** `test/executiveFixNext.test.js`
asserts no canvas anywhere in `executive.js`; `unitRow` is DOM and CSS, so the rule stands
unbent. That is also why the swap landed here first rather than on a page with a chart budget.

**The 360px overflow is a measured near-miss, and the fix moved once.** The first after-run read
`executive (404px)` against a pre-existing 364px on every route: the tally ran at the module's
default 40-mark ceiling, drew 39 marks for the largest severity, and an `.isotype` is one
inline-flex run that cannot wrap. The first fix hid it below 640px. The RIGHT fix was a 12-mark
ceiling at the call site — `unitScale(..., { maxMarks: 12 })` — which is also where the
icon-array literature puts the count a reader still takes in at a glance, and which the first
screenshot of this change had already argued for on its own: at 39 marks the row wrapped and the
delta pill landed on a line of its own under a rule of ink. Re-measured with the hide rule
removed entirely, `executive` reads 364px again, so a phone reader keeps the picture. The
absence of a `display:none` here is a measurement, not an oversight; `components.css` says so
beside the rules.

**The marks did not share a left edge, and a screenshot is the only thing that showed it.**
`.movement-label`'s width is a MINIMUM, so a severity word wider than it pushed that row's tally
right: measured on the shipped page, CRITICAL's marks began at x=424, HIGH's at 423 and
UNKNOWN's at 433. UNKNOWN is the shorter word and the wider one to set, so the stagger did not
even track the label length. A reader comparing two mark runs against a moving origin is doing
the arithmetic the picture was drawn to save them — and every test passed, because a mark COUNT
is arithmetic and the arithmetic was right. Tally rows now take a fixed 10ch label basis
(measured against this register's own severity vocabulary; UNKNOWN is the widest at 63px) and
all three runs start at x=436.

**Three sites examined and rejected, with reasons, so the next round does not re-litigate them:**

- `pages/data.js`'s `bySeverityLine` — it feeds destructive-action confirmation copy, and that
  section's own rule is that nothing offers a button before it can say what the button would
  remove. A picture cannot carry that.
- `pages/overview.js`'s tier card — `TIER_COLORS` is shared with the canvas small multiples
  beside it, and `unitChart`'s four-tone vocabulary cannot carry a five-step ordinal scale
  without either recolouring that chart or lying about the order.
- `pages/overview.js`'s triage funnel — the rungs span two orders of magnitude and the existing
  bar has a deliberate minimum-width floor for it. At the strip's own unit a small rung rounds
  to zero tenths and `unitRow` correctly draws nothing; the module refuses a `minMark` option
  for exactly this reason. The prose under each rung is the thing to move, onto the label's tip.

## 10. The prose round, and what it replaced with what

§9's round added pictures and moved `proseBlocks` on no route. That was the wrong metric to
leave alone — the brief was to reduce prose blocks, and to replace what is too crucial to
delete with a form a reader scans rather than parses. Same command, same seed, both columns one
run's output; cells read `words / proseBlocks / proseWords / numbers / tableCells / visuals /
tips`. No route overflows at any width it did not before (the 364px at 360 is pre-existing on
every route).

| route | before | after |
|---|---|---|
| executive | 276 / **9** / **149** / 99 / 21 / 1 / 11 | 142 / **1** / **15** / 107 / **85** / **12** / 12 |
| program | 416 / **8** / **269** / 121 / 76 / 9 / 24 | 180 / **1** / **21** / 116 / 76 / 9 / 26 |
| overview | 556 / **8** / **195** / 201 / 210 / 10 / 11 | 419 / **1** / **20** / 198 / 210 / 11 / 16 |
| data | 458 / **7** / **283** / 65 / 46 / 0 / 3 | 250 / **1** / **26** / 65 / 46 / 0 / 9 |
| settings | 227 / 3 / 84 / 26 / 0 / 0 / 0 | 227 / 2 / 44 / 26 / 0 / 0 / 0 |
| mttr, history, attribution, help | unchanged | unchanged |

**Fix next is a ranked table, and that is where the front door's prose went.** Eight of its
nine prose blocks were the eight `<li>`s of the ranked list — a pill, a link and a `·`-joined
meta sentence each, which the density walker counts as prose because an `<li>` is one. The
same eight groups are eight rows of a `dataTable` now (`tableCells` 21 → 85): rank, tier, group,
open, hosts, leading CVE, oldest, domain, so the ages compare down one column and the counts
down another instead of being fished out of eight sentences. The open column carries a
`unitRow` tally at one unit for the table (`visuals` 1 → 12) — the shipped DevSecOps Executive
pattern. `test/executiveFixNext.test.js` pinned the `<ol>` "because the order is the claim"; a
rank column makes the same claim ("row 1 of 8") and the pin now asserts the table. `it.meta`
stays on the view and on every link's accessible name.

**Everything else that moved was an explanation, and it moved onto the thing it explains.**
Chart captions became the chart heading's `tipLabel` lines (Overview's tier trend, aging and
SLA-window cards; Program's rule-sensitivity scatter); section intros became `sectionLabel`
lines (Program's capacity and track-record sections, the latter carrying `capNote` too); the
Data page's three cleanup panels keep a one-clause description and carry the full rationale on
their titles, and its three import/export notes keep a lead phrase. Two facts that were
sentences became figures: the awaiting-a-vendor-fix note is a `statRow` with its share of open
as the meter, and the unrecognized-severity note is a `statusPill` with the caveat behind it.
Program's "A finding is high risk when …" lost its first three words and gained the overlap
caveat on the rule's own text. The `tips` column rising on every moved route is the check that
nothing was deleted — each moved sentence is one keyboard-reachable, signified trigger.

**Two things this round tried and took back.** A stat card for the capacity means duplicated
the page header's own "Monthly close rate" and "Closed per month" rows; it went, and the one
fact the header lacks — the base the means are taken over — is the section label's tip. And
`test/chartTable.test.js`'s model-ident heuristic read the first `*TableModel(` in a 2,000
character window, which, once two captions came off the Overview's tier and aging cards, was
the neighbouring card's; it reads the call NEAREST the `chartTable(` now (either side —
mttr.js builds one model into a variable just before its call).

**What stays.** `mttr` (5 blocks: the SLA-edge legend, the reconstructed-days note, the
vendor-fix exclusion and two chart captions) is the heaviest-tested page in the app and is the
next round's. `attribution`'s and `history`'s section notes (3 and 2) are scope statements.
