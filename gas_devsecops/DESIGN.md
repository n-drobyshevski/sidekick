---
colors:
  accent: "#ffcb13"
  accent-hover: "#ebb800"
  accent-text: "#7c4a0a"
  accent-edge: "rgba(0,0,0,0.40)"
  accent-wash: "rgba(255,203,19,0.24)"
  graphite: "#0a0a0a"
  ink: "#171717"
  page: "#ffffff"
  surface: "#f8f8fa"
  hairline: "#e6e6e9"
  sev-critical: "#dc2626"
  sev-high: "#ea580c"
  sev-medium: "#d97706"
  sev-low: "#2563eb"
  sev-info: "#64748b"
  sev-unknown: "#475569"
---

# DESIGN — Wiz Sidekick DevSecOps

> Sibling of [`../DESIGN.md`](../DESIGN.md). The creative north star, the type scale, the
> spacing ramp, the radius scale, the elevation vocabulary, the severity palette and the
> accessibility bar are **inherited unchanged**. What differs is stated here. Where this
> file is silent, the shared document governs.

## 1. What differs: one colour, and the rule it forced

The OS sidekick is Signal Blue `#2563eb`. The AI sidekick is crimson `#be123c`. This one is
yellow `#ffcb13` — and yellow cannot do what those two do.

In this design system the accent is not decoration. It carries link text, focus rings,
progress fills, an active-option label and a chart series. Text needs 4.5:1 on white. Every
yellow bright enough to read as yellow measures between 1.5:1 and 3.2:1. This repository had
already hit that wall twice before the question was asked again: `#eab308` was rejected as
the Medium-severity fill at ~1.9:1 and replaced with amber-brown `#d97706`, and `gas_ai`'s
tier-2 yellow `#ffcb13` measures 1.30:1 against its own track and survives only behind a
dark inset edge.

So the accent's work is **split across two tokens**, and the split is the design.

| Token | Value | On white | Job |
|---|---|---|---|
| `--accent` | `#ffcb13` | 1.52:1 | identity **fills** only: the mark, the rail's active bar, a meter fill, a switch track |
| `--accent-edge` | `rgba(0,0,0,.40)` | — | **mandatory** beneath every one of those fills |
| `--accent-text` | `#7c4a0a` | 7.39:1 | links, focus rings, the active option, any accent ink, the chart series |
| `--accent-hover` | `#ebb800` | 1.84:1 | the hover state of an accent fill |
| `--accent-wash` | `rgba(255,203,19,.24)` | — | the one control reporting a standing state |
| `--on-accent` | `#171717` | 11.78:1 on `--accent` | ink drawn **on** an accent fill — near-black here, white on the other two siblings, which is the whole reason this fifth token exists rather than a rule naming one colour |

`--on-accent` is the fifth token in `gas_shared/test/contracts/tokens.js`'s accent contract
(see `gas_shared/README.md`'s "five-token accent contract"), formalised after a rule that
painted `var(--ink)` on an accent fill turned out to be correct in exactly one of the three
apps and wrong in the other two with nothing failing.

### Why the edge is not optional

`rgba(0,0,0,.40)` composited over `#ffcb13` resolves to `#997a0b`, which reads **3.49:1**
against the meter track — the same figure `gas_ai` measured when its tier-2 yellow all but
vanished on the same ground. Darkening the track is the fix that does *not* work: it moves
the ground toward the yellow, 1.30 → 1.15.

### Why the wash is heavier than the siblings'

`gas` and `gas_ai` tint at `0.08`. At `0.08` this accent is invisible on white, so the wash
runs at `0.24`. `--accent-text` on it measures 6.65:1, which is what allows a tint to carry
a state at all — and it never carries it alone.

## 2. Named rules this register adds

### The Split-Accent Rule

An accent that cannot pass a contrast floor does not get an exemption; it gets a second
token. `--accent` is a fill and nothing else. If a rule needs the brand colour on type or on
an outline, the answer is `--accent-text`, always.

### The Edged-Fill Rule

Every `background: var(--accent)` carries `box-shadow: inset 0 0 0 1px var(--accent-edge)`
or the equivalent inset bar. A fill without its edge is a fill nobody can see against a pale
ground — and pale grounds are most of this interface.

### The Graphite Primary Rule (inherited, restored)

The primary button is `#0a0a0a` with `#fafafa` on it, as root `DESIGN.md` specifies.
`gas_ai` diverges and fills it with its accent; that divergence cannot survive here — white
on `#ffcb13` is 1.52:1, and near-black on it (11.78:1) would make the primary action look
like a highlighter.

## 3. Unchanged, and deliberately so

The **severity palette is byte-identical** to both siblings: six fills, six darkened text
twins, the two-token rule intact. A severity means the same thing in every sidekick; the
brand deliberately does not. `src/domain/config.ts` holds the values and
`test/shared.test.js` pins them, including the assertion that every text token really is
darker than its fill.

Also unchanged: the neutrals, `--text-3` at `0.6` alpha (`0.5` measured ~3.95:1 and failed),
the type scale and its tabular figures, the spacing ramp's two-tier rhythm, the radius
scale, the whisper-or-lift elevation rule, and the motion durations.

## 4. A note for whoever adds an ordinal scale

`#ffcb13` is literally `gas_ai`'s `--rank-2-solid`. Separate apps, so there is no collision
today. If this register ever grows a maturity or posture ramp, the brand colour will equal
tier 2 of 4 — and at that point the **ramp moves, not the brand**.

## The briefing (2026-09-24)

The Executive page uses the shared briefing shape (`gas_shared/ui/briefing.js`; the full
account is `gas/DESIGN.md` §6a). What is this register's own:

- **Open findings** compares two SYNCS, not scans, and the status line turns amber with the
  sync's age in words past seven days — every figure here is as of that sync.
- **MTTR** (the KM remediation half-life) prints `kmHalfLifeView`'s value as-is ("Not reached", "Not measured"), with its
  `secondary` ("under 25% fixed within N days") as the caption. This page does not re-decide.
- **By register** carries each register's sync-on-sync change; the three MTTRs ride in its
  foot ("MTTR per register"), never summed ("three registers, three clocks"), and each share keeps its
  `data-denominator` and the empty-base rule in a line of its own.
- **Fix first** follows the splits: the top three ranked groups as a small table, its head
  saying "Top 3 of N groups", with the cap note under it. The folded full Fix next list is
  gone; Act now's caption still carries "N of M open findings ranked".
- **Read with care** keeps the tracking-since line, the window line and the end-of-life note on
  the surface, as a list under the Fix first table, last on the page.
- The cold zone's denominator sentence — window, relative-mode clause, clock caveat and the
  scopes-without-scan clause — is unchanged, now on the figure's tip and `data-denominator`.
- **MTTR** opens with the same briefing (`gas/DESIGN.md` §6b): half-life ("Not reached" in words,
  its `secondary` as the caption), In SLA, Still open (censored, with its base) and Awaiting a
  vendor (with the refused count), the reading notes on the surface, then "Against the target,
  by severity". Where a curve never halved there is no half-life marker; the median open age
  (diamond) still shows the gap to the target. "SLA by severity — every cell" is folded, and
  remembered; everything else on the page is unchanged.

## Measuring a page, and what the unit-chart round moved

`npm run density` runs this app's own walker (`dev/density.mjs --root . --port 8787`) over its
eleven routes and prints, per route: words, prose blocks and their word count, bare numeric
tokens, table cells, pictures by kind, visible definition triggers, and horizontal overflow at
1280/640/360px. `--diff before.json after.json` compares two runs. This register owns the
walker; until the unit-chart round it was the only one of the three with no `density` script of
its own, which is a gap worth not reintroducing.

**Unit-chart round (2026-09-15), at 1280px, seeded.** Each cell reads
`words / proseBlocks / proseWords / numbers / tableCells / visuals / tips`.

| route | before | after |
|---|---|---|
| executive | 293 / 2 / 33 / 80 / 12 / 4 / 11 | **unchanged — and that is the pass condition** |
| mttr | 328 / 5 / 91 / 138 / 75 / 29 / 22 | unchanged |
| program | 251 / 2 / 38 / 57 / 29 / 9 / 17 | unchanged |
| sca | 274 / 1 / 27 / 337 / 388 / 13 / 19 | unchanged |
| sast | 254 / 0 / 0 / 284 / 345 / 11 / 16 | unchanged |
| secrets | 429 / 3 / 83 / 353 / 397 / 19 / 42 | unchanged |
| repos | 210 / 3 / 105 / **211** / 178 / **36** / 20 | **243** / 3 / 105 / **221** / 178 / **37** / 20 |
| history | 230 / 0 / 0 / 159 / 81 / 7 / 6 | unchanged |
| data | 119 / 1 / 23 / 71 / 54 / 0 / 6 | unchanged |
| help | 2354 / 81 / 1962 / 20 / 0 / 0 / 0 | unchanged |
| settings | 284 / 6 / 188 / 39 / 0 / 0 / 2 | unchanged |

**`executive` moving on NOT ONE metric is the finding this round wanted.** The open-backlog
isotype left this page for `gas_shared/ui/unitChart.js`, and a promotion that moves a pixel is a
promotion that changed a shipped picture. The walker's `isotype` bucket for this route reads 4
before and 4 after. Everywhere else in this repo a route that moves on no metric is a finding
under CLAUDE.md's rule; here it is the assertion, and that inversion is why it is written down
rather than left to a reader to infer from a table of zeros.

**`repos` gained 33 words, 10 numbers and one picture, and the words are the honest part.** The
cold-zone census (`coldCensusModel`, `renderColdCensus`) draws the five verdicts as one
part-to-whole with `unitKeyRow` beneath it, and that key row is new SURFACE information rather
than a restatement: `warm`, `clear`, `watching` and `unobserved` counts were only reachable in
tables further down the page, while the four figure cards above speak for cold repositories and
cold backlog against three different denominators. The key row is also what lets the lattice owe
no `chartTable` disclosure — see `gas_shared/README.md` on why that argument is stronger here
than for a canvas.

**Two of the five verdicts are hatched, and that is the section's own claim in picture form.**
`watching` is a repository with open findings whose idle time could not be measured at all;
`unobserved` is one the scanner has lost sight of. The section spends most of its prose
insisting neither is warm — `--hatch` means "this part is not a measurement" and says it where
the reader is already looking. `clear` is a ring rather than a fill: measured, and fine.

**The per-repository grid folded into the roll-up, and it was the worse of the two.**
`renderColdHeat` drew one row per REPOSITORY against five idle bands, and `paintRepo` lit
exactly one cell in each — an N × 5 table carrying N values, which is a column of data wearing
a matrix. It is gone. That one fact is a `.bandpill` beside the idle reading it bands, on the
repositories table; the shape of a PRODUCT's idle time is a `bandBar` in the roll-up row that
owns it; and the grid's estate-wide totals row survives as the band key row, which is also the
control. `heatLevel` and `heatModel` went with the table.

The ramp moved with it, from neutral ink to `--rank-1..4`, and §4's own prediction is what
licenses that: this file already said that if this register ever grew an ordinal scale the
brand yellow would be tier 2 of 4 — it is literally `--rank-2-solid` — and that at that point
"the ramp moves, not the brand". This is that scale. Nothing here takes `var(--accent)`; the
bands take the rank tokens, and the coincidence that one of them shares a hex with the brand is
named rather than relied on. The shade also stopped meaning magnitude: `heatLevel` shaded by
`count / max` over the grid, and a band's tone is now its own fixed position.

**The cross-filter is two axes, and this register gains a cut control with it.** A product (the
row's own name) crossed with an idle band (the key row). The band is a value OF the three-way
cut — `"all" | "cold" | "lost" | "band:N"` — rather than a state beside it, which removes a
corner a reader could otherwise ask for and never get: an unobserved repository has no bucket,
so "out of sight" crossed with an idle band is empty by construction. The three-way cut itself
is new here, ported from the sibling: the band needed a home, and both registers' detail tables
answer the same question. `coldBandRows` widens the listed population to match, because
`coldRepoRows` is cold-and-unobserved only and a band-0 press over it would light the picture
and list nothing.

**The bars are not controls.** Five segments per row times N rows is 5N tab stops, against
`quad.js`'s arity rule; the key row spends five once and a product costs the one stop a
clickable row already costs. A selection marks in place rather than rebuilding, because
rebuilding the key row would tear the focused button out from under the reader mid-press, and a
polite live region says the list moved. None of it is in the URL — every row a selection can
reach is already in the payload this page holds.

**Warm takes `ok`, not `warn`, and amber is left to the one segment that is a caveat.** This
reverses what the census first shipped. A warm repository carries open findings AND had one
resolve inside the window, so on this section's own question — *has work stopped?* — it is the
system working, and it is the LARGEST segment. Spent there, `--warn` made the census read as
roughly half problem when the alarm is `cold` plus `unobserved_open` and nothing else, and it
left `watching` — the one genuine caveat — wearing the same amber as the healthy majority.
`--warn` is a text-grade value besides: `tokens.base.css` records it darkened to `#8a5406` so
it would clear 4.5:1 *as text* on its own tint, and a large flat field of it reads as mud. So
`warm` and `clear` share a tone and are told apart by SILHOUETTE, which makes the ring
load-bearing where it used to be one of two separations. `gas/DESIGN.md` §11 carries the same
change and the same argument for the asset census.

**Unobserved is drawn as two segments, because it was never one piece of news.** `unobserved`
is tested before `clear`, so a repository that was remediated and then archived stays unobserved
for as long as the ledger remembers it — nothing open, and no scan will ever list it again. A
register with ordinary churn accumulates those without bound until they dominate the picture
(the sibling register that prompted the split read 1,947 of 2,404 assets out of sight, which
looked like a coverage catastrophe and described machines that no longer exist).
`coldCensusModel` splits on the one question that tells the two apart — is anything still open
on it? — so the alarming half is the half that deserved the alarm: backlog stranded on
repositories nobody is scanning any more. The open half is `bad` HATCHED where `cold` is `bad`
SOLID, the same alarm with the measurement missing. The VERDICT does not split
(`repos_unobserved` is still their sum), so the tables and the roll-up are untouched, and six
segments is `MAX_SEGMENTS` exactly.

**The two hatched verdicts are hatched in two different inks, and for a while they were not.**
They are one silhouette carrying two verdicts — `watching` is `warn`, `unobserved` is `neutral`
— which is the case the component's two channels exist for, and the shared `[data-fill="hatch"]`
rule ignored `data-tone` entirely, so they shipped pixel-identical with the key row beneath as
the only thing separating them. The comb takes its ink from `color` now, the way the ring beside
it always did: an amber comb is a warm reading nobody could measure, a grey one is a repository
nobody is looking at.

**What High Contrast costs this picture, measured rather than assumed.** Emulated forced colours
render the census as ten solid cells and one dashed: the hatch survives as a SILHOUETTE — the
dashed border, with the comb dropped, because a toned comb is a hue now — so
measured-versus-not-measured, the distinction this section exists to make, is intact, while the
two hatched tones collapse into each other and `cold` and `warm` do the same. Three silhouettes
cannot carry four tones. It is accepted rather than fixed: `.sevbar-seg` takes the other road
with `forced-color-adjust: none`, and that road is wrong here because `--warn` on a black High
Contrast ground measures about 1.8:1 — keeping the hue would trade a lost DISTINCTION for a lost
CELL. Nothing is actually lost, because `unitKeyRow` prints every segment's label, count and
share in text directly beneath the lattice and the model refuses a segment with no label.
`gas_shared/styles/components.css` carries the reasoning beside the rules.

**The lattice sizes itself to its population.** Eleven repositories at the waffle's 9px cell
rendered as a smudge in the corner of a full-width card. `unitGrid` lays an exact lattice of
24 or fewer out as one row at 14px — a small census is a strip a reader counts. `gas_ai`'s Scans
page had a local rule doing the same thing by hand; it is gone, because a local rule that agrees
with the shared default is one that will disagree with it later.

**Past that row limit the same rule had a cliff in it, and the cliff is gone.** A lattice of 25
fell back to BOTH a square shape and the waffle's 9px cell, so one repository over the edge
turned a 318px strip into a 53px square — the very smudge the paragraph above describes,
reintroduced one size class along. Shape and size part company now. A BLOCK is as flat as the
row limit allows rather than square, and it keeps its floor — 14px for a census, 9px for a
proportion, which has more columns and needs the smaller minimum to fit a 360px card — with
`.isotype--block` growing each column from there to the width of the card and capping it at 30px
per cell and 44rem overall.

**The proportional lattice takes the same rule, which it did not at first.** The flat shape
shipped for exact censuses only, on the reasoning that a 10x10 waffle means one cell per
percentage point and a stretched one would be a different claim. Only half of that was true:
stretching a CELL changes nothing, and only the COLUMN COUNT could change what a ROW reads as,
from a tenth to a fifth. What a square does carry is its own height, so a 10x10 grown wide
enough to look at is a banner. Both modes are flat now. This register saw the colour half of the
round before the width half either way: its own census is eleven repositories, which is a strip
in every version, and a block appears once a tenant passes twenty-four.

**The six `denomNote` paragraphs on this page stay.** They were the obvious prose to remove and
they are not restatements — `coldModeCaption` says which line drew the zone, `boundOnlySentence`
says idle time was never measured and the figure is a lower bound, and the repository-list note
says what the list excludes. Those are honesty statements, and this register's own rule puts an
honesty statement on the surface and only an explanation one level down.

### Prose round (2026-09-16)

The round above added a picture and left `proseBlocks` where it was. This one reduces it,
replacing what is too crucial to delete with a form a reader scans. Same command, same seed;
only the routes that moved are shown, and no route overflows at any width it did not before.

| route | before | after |
|---|---|---|
| repos | 210 / **3** / **105** / 211 / 36 / 20 | 223 / **1** / **28** / 221 / 37 / 22 |
| sca | 274 / **1** / **27** / 337 / 13 / 19 | 274 / **0** / **0** / 337 / 13 / 19 |
| settings | 284 / **6** / **188** / 39 / 0 / 2 | 284 / **3** / **71** / 39 / 0 / 2 |

(Cells read `words / proseBlocks / proseWords / numbers / visuals / tips`.)

**Three forms replaced three sentences, and two of them are shared now.** The register
provenance line ("In scope 400 · gate: all severities · only packages with a published fixed
version · …") is a row of `.scope-chips` on `sca`, `sast` and `secrets` — `populationLine`
already returned its parts, only the drawing changed, and the joined sentence is the group's
`aria-label`. The three severity scan-scope bars on Settings draw a key row under the track
(`splitBar` given the model's new `keys`) instead of a 45-word caption: swatch, word, figure
per severity, the out-of-scope ones hatched with "not scanned" beside their figure, and one
summary line under the keys. `repos`'s 51-word heat-map caption (the grid it belonged to is gone) and 27-word list note each kept
the clause a reader needs without hovering and put the rest on the nearest heading.

**The one paragraph that stays is pinned on purpose.** `renderColdZone` prints
`denomNote(coldModeCaption(view))` first, in all three branches, and `test/pagesData.test.js`
asserts exactly that: the sentence that says which line drew the zone goes above the figures it
qualifies. This round does not overrule that test.
