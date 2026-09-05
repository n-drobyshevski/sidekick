---
name: Wiz SIDEKICK AI
description: "AI-asset security graph, AARS risk scoring, toxic combinations and scan coverage, read at a glance."
colors:
  accent: "#be123c"
  accent-hover: "#9f1239"
  ink: "#171717"
  graphite: "#0a0a0a"
  graphite-hover: "#27272a"
  on-graphite: "#fafafa"
  page: "#ffffff"
  surface: "#f8f8fa"
  hairline: "#e6e6e9"
  text-2: "rgba(0,0,0,0.65)"
  text-3: "rgba(0,0,0,0.60)"
  svg-text-2: "rgba(0,0,0,0.62)"
  sev-critical: "#dc2626"
  sev-high: "#ea580c"
  sev-medium: "#d97706"
  sev-low: "#2563eb"
  sev-info: "#64748b"
  sev-unknown: "#475569"
  sev-critical-text: "#b91c1c"
  sev-high-text: "#c2410c"
  sev-medium-text: "#b45309"
  sev-low-text: "#1d4ed8"
  sev-info-text: "#475569"
  sev-unknown-text: "#334155"
  status-ok: "#136c34"
  status-warn: "#8a5406"
  status-bad: "#b91c1c"
  rank-1-solid: "#16a34a"
  rank-2-solid: "#ffcb13"
  rank-3-solid: "#ff8605"
  rank-4-solid: "#dc2626"
  cat-asset-ink: "#3b82f6"
  cat-data-ink: "#16a34a"
  cat-iam-ink: "#8b5cf6"
  cat-vuln-ink: "#dc2626"
  cat-exposure-ink: "#ea580c"
typography:
  fontFamily: "-apple-system, BlinkMacSystemFont, Inter, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
  hero:
    fontSize: "32px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  display:
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  displaySmall:
    fontSize: "18px"
    fontWeight: 600
  lead:
    fontSize: "16px"
    fontWeight: 600
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.05em"
  micro:
    fontSize: "11px"
    fontWeight: 500
spacing:
  half: "2px"
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
rounded:
  xs: "3px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  pill: "999px"
motion:
  dur-quick: "120ms"
  dur-fast: "140ms"
  dur-base: "180ms"
  dur-slow: "320ms"
  ease-out: "ease-out"
  ease-loop: "ease-in-out"
---

# Design System: Wiz SIDEKICK AI

This is the sibling of `../DESIGN.md`. The creative north star, the severity palette, the named
rules and the accessibility bar are **inherited unchanged**. What differs is stated here: the
brand accent, the ordinal posture scale, the graph category palette, and the surfaces that exist
only in this tool. Where this file is silent, the shared document governs.

## 1. Overview

**Creative North Star: "The Audit Ledger"**

This dashboard is a ledger of risk, not a billboard for it. Every figure on screen is meant to be
defensible: a number a security analyst can act on and a leader can put in front of an auditor
without flinching. The visual system earns trust the way a good ledger does, through exactness,
consistency, and restraint. Surfaces are quiet near-white planes ruled by hairline borders; ink is
near-black; figures are set in tabular numerals so columns line up and values never jitter as they
update. Nothing decorative competes with the data.

Color is rationed like ink in a ledger. The interface is overwhelmingly neutral, and saturated
color is spent only on genuine meaning: a severity level, a posture tier, a state change. Because
the field is calm, a single critical-red badge reads instantly.

**Key characteristics**
- Neutral by default; saturated color reserved for severity, posture tier, and state.
- Tabular numerals everywhere figures appear.
- Flat surfaces ruled by hairline borders; depth appears only on demand.
- Meaning never carried by color alone.
- One family, light theme only, no external font requests.

**What this tool adds to the shared system:** an ordinal posture scale (the shared doc has only
the categorical severity scale), a graph-category palette borrowed from the Wiz console, a
full-bleed workbench frame, and a decision lattice. All four are documented below.

## 2. Scales

The shared document specified a 4pt spacing ramp and a type hierarchy. Neither reached
`tokens.css`, and both drifted: 35 distinct spacing lengths with no tokens at all, and 13 distinct
font sizes crammed into the 9-15px band. These are the corrected, authoritative scales.

### 2.1 Spacing

`--space-half: 2px` · `--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` ·
`--space-4: 16px` · `--space-5: 24px` · `--space-6: 32px` · `--space-7: 48px`

Numeric rather than `xs…xl` names, matching the shared document's existing `spacing` block so the
two tools stay comparable. `--space-half` is the one sub-step, and it exists for exactly one job:
the vertical interior of badges, chips and pills (`2px 8px`), which the shared component spec
already fixes at that value.

**The layout tier is the point.** Today 89% of all spacing in this tree is 14px or less and only
27 declarations in 6,277 lines reach 24px. Intra-group spacing stays tight (`--space-1` to
`--space-3`); **separation between sections uses `--space-5` to `--space-7`.** That contrast is
what the interface has never had, and it is what "clean" means here. Rhythm comes from the
difference between the two tiers, not from loosening everything.

**No arbitrary values.** A length outside this ramp needs a comment saying why, on the line.

### 2.2 Type

Four body steps and three display steps. One family, weight contrast only.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Hero value | 32px | 700 | **At most one per page**, and only ever a data value |
| Display / h1 | 24px | 600 | Page titles. Letter-spacing `-0.02em` |
| Display small | 18px | 600 | Sub-hero values, sheet titles |
| Lead / h3 | 16px | 600 | Card and subsection titles |
| Body | 14px | 400 | Default. Table cells, controls, prose |
| Label / h2 | 12px | 600 | Section labels, control labels, captions, tip copy. Uppercase + `0.05em` tracking **only** for the section-label and control-label uses |
| Micro | 11px | 500 | Badges, chips, dense table meta, counts |

**The 11 / 12 pair is a role distinction, not a hierarchy step**, so it is exempt from the
ratio rule. Everything else steps at 1.14 or better, and the display tier steps at 1.33.

Deliberately tighter than the general 1.25-per-step guidance, because this is a product register:
there are far more type roles here than on a brand surface, and exaggerated contrast between them
reads as noise. Do not "fix" the body band by spreading it.

**Banned:** fractional pixel sizes (there were 37), `font-weight: 650`, and any size outside the
seven above.

**Weight carries hierarchy, not just size.** 400 body, 500 emphasis and micro labels, 600 headings
and values, 700 for the hero value alone. The tree previously used 600 in 155 places against 400
in six, which is why hierarchy read flat.

### 2.3 Radius, elevation, motion

Radius: `--radius-xs: 3px` (newly named; it was already the most-used radius after the tokens, and
three of its uses sit on focus rings) through `--radius-pill`. No bare literals.

Elevation follows the shared **Whisper-Or-Lift Rule**: a surface gets either the one-pixel card
whisper or a real overlay shadow, nothing between. Tokens: `--shadow-card`, `--shadow-button`,
`--shadow-sheet`, plus `--shadow-dialog` and `--shadow-toast` for the two overlays that were
carrying bare literals.

Motion: `--dur-quick: 120ms` (the "updating/dim" idiom, newly named — it had seven bare uses),
`--dur-fast: 140ms`, `--dur-base: 180ms`, `--dur-slow: 320ms`. Note `--dur-fast` keeps its
existing 140ms value rather than absorbing 120ms: eight rules already reference it, and
redefining a live token is a behaviour change wearing a cleanup's clothes.
Easing vocabulary is `ease` / `ease-out` / `ease-in-out` / `linear`. **No cubic-beziers anywhere**,
a discipline this tree has actually held. Motion conveys state, feedback, loading and reveal, and
nothing else. Every animation keeps a `prefers-reduced-motion` alternative.

## 3. Colors

### Primary
- **Crimson** (`#be123c`, hover `#9f1239`): the single brand accent, and the one real divergence
  from the sibling tool's Signal Blue. It carries brand, nav, interactive state, the focus ring,
  links, and the toxic-combination halo. **It is never a severity and never a surface.**
- This is the **five-token accent contract** (`gas_shared/test/contracts/tokens.js`;
  `gas_shared/README.md`'s "The five-token accent contract") stated for this brand:
  `--accent`/`--accent-hover` = `#be123c`/`#9f1239` (a fill); `--accent-text` = `#be123c` too,
  because crimson clears the 4.5:1 TEXT floor on its own, not just the 3:1 graphical-mark
  floor a fill owes — that is what lets `--accent-edge` stay `transparent` here and
  `--on-accent` be `#ffffff`. `gas_devsecops`'s yellow cannot make that same collapse; see its
  own `DESIGN.md`.

### Secondary
- **Graphite** (`#0a0a0a`, hover `#27272a`, text on it `#fafafa`): the solid near-black that fills
  the primary action button. Neutral-but-certain, so the accent stays an accent.

### Neutral
- **Ink** `#171717` · **Page** `#ffffff` · **Surface** `#f8f8fa` · **Hairline** `#e6e6e9`.
- `--text-2` at 0.65 alpha, `--text-3` at 0.60. **0.60 is a floor, not a preference:** 0.50
  measured 3.95:1 and failed AA for the 11-13px labels it carries.
- `--svg-text-2` at 0.62 exists because SVG text cannot inherit `--text-2` through `color`.

### The severity scale
**Identical to the sibling tool, deliberately.** Each level has a *fill* (a graphical mark at
≥3:1) and a darkened *text* token (≥4.5:1 on its own pale tint): critical `#dc2626`/`#b91c1c`,
high `#ea580c`/`#c2410c`, medium `#d97706`/`#b45309`, low `#2563eb`/`#1d4ed8`, info
`#64748b`/`#475569`, unknown `#475569`/`#334155`.

Status verdicts: **OK** `#136c34`, **Warn** `#8a5406`, **Bad** `#b91c1c`. Both were darkened from
the sibling's values, which measured 4.27:1 and 4.20:1 on their own 0.12 tints and failed; they
now measure 5.55 and 5.35.

### The posture tier scale — ordinal, not categorical
Four steps, each with a solid (the mass strip, and the Compliance Posture bars), a tint (lattice
cells, badges), a text token that clears 4.5:1 on that tint, and an edge that keeps adjacent cells
apart. Tier 1 `#16a34a`, tier 2 `#ffcb13`, tier 3 `#ff8605`, tier 4 `#dc2626`.

**One ramp for every ordinal posture reading.** A decision lattice's tier, a problem outcome and a
compliance percentage band all ride these four steps, so "posture colour" is learned once. The
compliance bands were cut to four, breaking at 90 / 70 / 50 (`compliancePosture.ts`), to join it
rather than keep a palette of their own. The steps were measured against each other, not against
a track: on `--track-bg` the solids read 2.82 / 1.30 / 2.07 / 4.13, so a bar drawn in them carries
a `rgba(0,0,0,0.40)` inset edge to keep its *length* readable at tier 2. Darkening the track
instead makes tier 2 worse, not better.

**Adopted against a measurement, not a preference.** Every adjacent pair of solids separates by
29.2 / 16.1 / 19.3 in OKLab and 18.0 / 12.0 / 16.5 under dichromatic simulation, against floors of
15 and 8. The previous scale's amber and orange sat 6.7 apart and read as one block however the
alphas were tuned, which is what made the tier mass strip illegible. **Re-measure before changing
any step.**

### The graph category palette
Wiz's own cluster hues, so a category means the same thing here as in the console the analyst came
from: compute blue `#3b82f6`, data green `#16a34a`, identity purple `#8b5cf6`, vulnerability red
`#dc2626`, network orange `#ea580c`. Each carries a saturated `ink` (icon and medallion ring,
≥3:1), a darker `text` (≥4.5:1 on both white and its own tint), and a pale `tint` fill.

**Known cost, stated:** adopting Wiz's literal values collides three of them exactly with severity
tokens (`cat-vuln-ink` **is** `sev-critical`; `cat-exposure-ink` **is** `sev-high`;
`cat-asset-text` **is** `sev-low-text`). A category tint therefore no longer reads as distinct from
a severity, and on a graph node the severity **dot and word** are the only severity signal left.
They stay paired, so severity is still never carried by color alone, but the redundancy is gone.
Retint deliberately.

One deviation from Wiz: its network orange `#f97316` measures 2.64:1 on its own tint and fails the
3:1 floor for a graphical mark, so exposure takes `#ea580c` (3.35:1).

### Named rules
**The Rationed Ink Rule.** Saturated color is spent only on meaning. If a color is on screen, it
is answering a question about risk.

**The Two-Token Severity Rule.** Severity always carries two tokens: a vivid *fill* for marks and
dots, a *darker text* token for any colored label. Never set severity text in the fill color on a
tint; it will fail contrast.

**The Ordinal-Fork Rule.** The posture tier scale is not a fifth severity. An ordinal scale and a
categorical one are different instruments and never share tokens. The test is what the fact IS,
not which page draws it: on Compliance Posture the percentage *bands* are steps and take the
ordinal ramp, while the four posture *states* — scored, no resources, no policies, not reported —
are kinds and keep the status triad.

## 4. Layout

### The page shell
Every route opens the same way, through one shared component:

- An optional **lane eyebrow**: the nav group this route sits in, at the label step, uppercase,
  muted. A `div`, never an `h*` — a lane holds several pages, so a lane name as the heading gives
  them all the same one, which is precisely how three routes of the Risk lane came to announce
  "Risk" as their primary heading. Omitted for the chrome tail, which has no lane.
- **h1** — the route's own **`PAGES` title**, at the display step, and **nothing else at that
  step**. It is read from the route table rather than typed here, so the heading, the rail link
  and `document.title` cannot drift apart. A page title never takes the 32px hero step.
- An optional **subtitle**: one sentence, **12 words or fewer**. If it needs more, it is a Help
  entry wearing a page header, and it belongs in a tip that routes to Help. Where the route's
  title is a bare noun the page qualifies (`Data`, `Settings`, `Help`), a short contents phrase
  — four or five words, no verb — may precede that sentence as a second block line. It is copy
  the old header carried in the hero-value slot, not a second heading, and never a second
  sentence: the 12-word rule governs the sentence, and the phrase is not one.
- An optional **header block**: a borderless grid with a bottom hairline, holding the Hero Stat, an
  optional distribution strip, and a stat list. No card, no surface tint, no shadow. A page with
  a name and no figure renders the title block alone — most routes of a register are lists, and
  inventing a number for the hero slot is the big-number template the anti-references reject.
- An optional **toolbar**: one class, one shape, across every route.

Below that, sections separated at the `--space-5`/`--space-6` tier, each opening with a
section label.

### The Hero Stat
The one-per-page headline metric, and **only ever a measurement** — the page's name lives in the
h1 above it. **Deliberately borderless**: an uppercase label naming the figure, the value at the
32px hero step, an optional change or band chip beside it, and a muted plain-text source line.
The label is dropped only where the h1 already names the figure, so the block never states the
same word twice. Complementary mini-stats sit below a hairline inside the same block.

Dominance comes from **size, top-left position, and whitespace** — never from a card, gradient, or
accent stripe. A row of equal tiles is the hero-metric template the anti-references reject; it is
not this.

### Density
Rows are tight, sections are generous. Table rows sit near 36px. The analyst triages here daily
and pays for every row pushed off the screen; the leader needs the top line to stand clear of the
noise. Both are served by the two-tier spacing contrast, not by a single global density.

### Cards
A card means "this content is genuinely distinct and actionable." It is not a layout tool. Group
with spacing, alignment and hairlines first. **Nested cards are always wrong** — a discipline this
tree currently holds everywhere, and must keep holding.

## 5. Components

Comfortable 36px control heights, surfaces that read as real cards, a primary action that commits
without hedging. The vocabulary is consistent screen to screen, which is itself the point. Every
interactive component ships default, hover, focus, active, disabled, loading and error.

**Buttons.** `--radius-md`, min-height 36px, padding `6px 14px`. Primary is solid Graphite. The
everyday button is a bordered surface with a hairline and the one-pixel rest shadow. Focus is a
2px crimson outline at 2px offset, and it is never removed.

**Chips, badges, pills.** A same-hue tint background, the darkened *text* token, a leading
CSS-drawn dot, and the level name. Meaning is in the text and shape, not the color.

**Inputs.** White field, hairline border, `--radius-md`, 36px min-height. Labels at the label step.

**Navigation.** A crimson-accented rail, collapsed to 56px by default and expanded on request.
Group headers at the micro step, uppercase. The active item takes a 2px accent bar plus weight,
**never a tint alone**.

**Skeletons, not spinners.** A loading surface reveals a laid-out page, it does not grow one. The
skeleton mirrors the shape of what is arriving.

**Empty states teach.** A section with nothing in it is dimmed, counted `0`, still selectable, and
says so in a sentence. It is never omitted, because an omitted section reads identically to "we
don't check that."

### Signature component: The Tip

The app's one hover card, and its **only** answer to "what does this mean". It replaced three
vocabularies that had grown side by side: about forty native `title=` attributes, an SVG `<title>`
on every graph edge, and Chart.js's dark canvas box. All three are gone, and `el()` throws on a
`title` attribute so the first two cannot come back.

A single node on `<body>`, moved rather than rebuilt: a `--radius-lg` white card on a hairline with
the card whisper, 12px/1.45 copy at `max-width: min(300px, 100vw - 32px)`, and a caret pinned to
the trigger's centre and clamped off both corners. It opens below and flips above only when it
does not fit below **and** there is more room above. Portaled, because `position: fixed` inside a
transformed `.sheet` would make the sheet the containing block and land the card in the wrong
place.

**It meets SC 1.4.13 rather than approximating it.** Escape dismisses while the pointer stays put,
and the trigger stays muted until the pointer leaves. A close grace lets the pointer cross onto the
card. Nothing times out. A pointer waits 220ms cold and nothing at all if another card closed in
the last 400ms; focus opens instantly.

**The card is `aria-hidden`, always.** The text reaches assistive technology on the anchor instead.

**A definition is a control; a value is not.** A `?` mark, a metric label or a column heading
becomes a real `<button>` with a dotted underline: keyboard-reachable, one tab stop, and visible
before anything is hovered, because a definition nobody can see is not help. A badge repeated once
per row does **not** become a control; it answers on hover and its definition lives on the column
heading, which is asked once.

**Its ceiling is real and load-bearing.** Roughly four or five short lines, a 240-character lead,
and **no links or focusable content, ever** — that constraint is what lets it keep a clean role and
stay out of a sheet's tab trap. The trigger navigates to the full Help entry instead. So prose
demoted out of a page splits in two: a ≤240-character lead into the tip, the remainder into Help.

### Signature component: The Record Sheet

A right-anchored drawer over a scrim. A *finding* is one flat fact and reads as one column. A
*resource* is not: an asset record carries a verdict, open issues, compliance findings, a score
breakdown, exposure, guardrail coverage, relationships, identity and tags. Stacked in one scroll,
checking a region means passing four sections you did not come for.

So the record sheet keeps the shell and splits the body: a 184px section rail on the surface tint,
and a content pane that scrolls on its own. The rail is a real `tablist` with roving tabindex, and
the active item takes the app's nav treatment. **Every section always appears**, per the
empty-states rule above.

Widths run `min(960px, 94vw)` with a `min(1280px, 96vw)` widen step and a draggable left edge
between a 520px floor and 96vw; the chosen width persists. Below 1120px the record cluster comes
inside; below 900px the rail becomes a scrolling strip; below 640px the sheet is full-bleed.

Utility drawers (filters, sync progress, a scan's query) use the same shell single-pane at
`min(600px, 94vw)`.

### Tool-specific surfaces

**The workbench frame** (`fullBleed` routes: the graph and the AARS rules). A sticky bar carrying
the title, a model or view switch, and the commit controls that must never scroll away; below it a
split body. The page owns the whole content pane, without the standard padding or measure.

**The decision lattice.** A grid of cells reading a rule's leaves at once. Cells take the posture
tier *tint*, the mass strip takes the *solid*, and the ordinal scale's measured separation is what
makes the strip legible. It carries its own focus rings built from `box-shadow`; they are
indicators, not decoration.

**The graph canvas.** A six-layer stack: canvas chrome at `--z-canvas-chrome`, the floating query
editor at `--z-canvas-panel`, then scrim, sheet, popover and tooltip. Each inversion is deliberate
— the editor must cover the zoom capsule and legend, but a detail sheet must cover the editor, and
a tip must cover everything short of the boot splash and toasts.

**The sync zone.** The rail's own instrument: a progress card that mutates in place across a 3s
poll rather than rebuilding, so a live region does not chatter and focus survives.

## 6. Do's and Don'ts

### Do
- Keep the field neutral and ration saturated color to severity, tier and state.
- Pair every severity and status with a non-color signal.
- Use the two-token severity system, and keep the ordinal tier scale forked from it.
- Set every figure in tabular numerals.
- Let the primary action commit in Graphite; keep crimson for brand, focus and interactive state.
- Take spacing from the ramp and type from the seven steps.
- Separate sections at the `--space-5`/`--space-6` tier while keeping rows tight.
- Put a definition in a tip and its full text in Help.
- Keep focus rings and a `prefers-reduced-motion` alternative on everything.
- Give any shadow-built indicator a `forced-colors` fallback.

### Don't
- Ship SaaS-cream, gradient accents, or a row of equal hero tiles.
- Build security-vendor theater: walls of red cells, gauges, risk drama.
- Fall into gray-on-gray density without hierarchy.
- Add mascots, illustrations or marketing decoration.
- Use a colored side-stripe over 1px as a decorative accent.
- Apply `background-clip: text` gradient text anywhere.
- Introduce a second family, a display font, or a fractional type size.
- Nest a card inside a card, or reach for a card where spacing would group.
- Write a page subtitle sentence longer than 12 words, or a second sentence beside it.
- Put a page TITLE in the 32px hero-value slot. That step is a measurement; the name is the h1.
- Put a base64 data URI in the stylesheet. The build fails if a bare `//` survives minification,
  and the base64 alphabet contains `/`. Percent-encode SVG instead.
