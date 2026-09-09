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
stat strip closed by a hairline; then Fix next, an ordered list of (tier, owner) groups with
its denominator ("25 of 70 open findings ranked") and a disclosure naming every unranked
reason with its count; then the open severity strip with its key row; then the by-domain
table; then the last-scan block. The centred 720px `.exec` column and the page-level Run
scan button are gone (one control in one place, the rail), and so is every `.exec*` and
`.hero*` rule. An honesty statement (a bound, a refusal, a cut, the population caveat)
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
