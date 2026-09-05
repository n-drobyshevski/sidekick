---
name: Wiz Security Dashboard
description: "OS vulnerability remediation analytics for Wiz findings: severity, MTTR, and SLA, read at a glance."
colors:
  signal-blue: "#2563eb"
  ink: "#171717"
  graphite: "#0a0a0a"
  graphite-hover: "#27272a"
  on-graphite: "#fafafa"
  page: "#ffffff"
  surface: "#f8f8fa"
  hairline: "#e6e6e9"
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
  status-ok: "#15803d"
  status-warn: "#a16207"
  status-bad: "#b91c1c"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.05em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.on-graphite}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.graphite-hover}"
    textColor: "{colors.on-graphite}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  badge-critical:
    textColor: "{colors.sev-critical-text}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System: Wiz Security Dashboard

## 1. Overview

**Creative North Star: "The Audit Ledger"**

This dashboard is a ledger of risk, not a billboard for it. Every figure on screen is meant to be defensible: a number a security analyst can act on and a leader can put in front of an auditor without flinching. The visual system earns trust the way a good ledger does, through exactness, consistency, and restraint. Surfaces are quiet near-white planes ruled by hairline borders; ink is near-black; figures are set in tabular numerals so columns line up and values never jitter as they update. Nothing decorative competes with the data.

Color is rationed like ink in a ledger. The interface is overwhelmingly neutral, and saturated color is spent only on genuine meaning: a severity level, an SLA breach, a state change. Because the field is calm, a single critical-red badge or a breached-SLA pill reads instantly. The build emulates shadcn/ui entirely in CSS over native Streamlit theming, so the result feels like a modern product tool (Linear, Stripe, Notion grade) rather than a security-vendor console. Components are tactile and confident: the primary action commits in solid near-black, controls sit at a comfortable 36px touch height, and surfaces carry a soft one-pixel shadow that makes them feel like real cards rather than painted rectangles.

This system explicitly rejects four looks. It is not generic SaaS-cream with gradient accents and a big-number hero template. It is not noisy security-vendor theater, walls of red and orange cells, gauges, and blinking risk drama. It is not dated enterprise density, gray-on-gray tables packed without hierarchy. And it is not consumer-playful, no mascots, illustrations, or marketing flourish that would undercut the credibility of a security tool.

**Key Characteristics:**
- Neutral by default; saturated color reserved for severity, state, and SLA verdicts.
- Tabular numerals everywhere figures appear, so values stay aligned and stable.
- Flat surfaces ruled by hairline borders; depth appears only on demand.
- Meaning never carried by color alone, every severity and status pairs color with a dot, glyph, or label.
- Familiar product-tool vocabulary (shadcn-grade), light theme only.

## 2. Colors

A near-monochrome neutral field with one calm blue accent and a six-step severity scale that is the only place full saturation is allowed.

### Primary
- **Signal Blue** (`#2563eb`): The single brand accent. Carries primary data emphasis, the focus ring, links, and the Altair categorical scale's LOW mark. It is an accent, never a surface; on any given screen it touches a small fraction of the pixels. Note it is deliberately *not* the primary-button color.

### Secondary
- **Graphite** (`#0a0a0a`, hover `#27272a`, text on it `#fafafa`): The solid near-black that fills the primary action button. A confident, decisive commit color borrowed from shadcn's neutral primary. Chosen over Signal Blue for primary buttons so blue stays a data/accent color and actions read as neutral-but-certain.

### Neutral
- **Ink** (`#171717`): Primary text. Secondary and tertiary text are black at 65% and 60% alpha over the page (defined as `--text-2` / `--text-3` in `styles.css`), kept above 4.5:1 for body.
- **Page** (`#ffffff`): The page background. Streamlit owns it natively.
- **Surface** (`#f8f8fa`): Cards, `st.metric`, and the sidebar. The cooler second layer that separates chrome from content. Card and button surfaces are also expressed as low-alpha black tints (`--surface-1` etc.) so they composite cleanly.
- **Hairline** (`#e6e6e9`): Every border, divider, and dataframe rule. The primary structuring device in a flat system.

### Tertiary: The Severity Scale
The signature palette, used for chart marks, severity dots, and badge fills. Each level has a **fill** token (tuned to stay legible as a graphical mark on white) and a darkened **text** token (tuned for 4.5:1 on its own pale tint):
- **Critical** fill `#dc2626` / text `#b91c1c`
- **High** fill `#ea580c` / text `#c2410c`
- **Medium** fill `#d97706` / text `#b45309` (deliberately amber-brown, not yellow; the old `#eab308` failed contrast on white)
- **Low** fill `#2563eb` / text `#1d4ed8` (shares the blue accent)
- **Info** fill `#64748b` / text `#475569`
- **Unknown** fill `#475569` / text `#334155`

Status verdicts reuse a fixed trio: **OK** `#15803d`, **Warn** `#a16207`, **Bad** `#b91c1c`, always on a low-alpha tint of the same hue.

### Tertiary: The Categorical Group Palette
Distinct from severity: the hues that identify *groups* (domains, support groups, OS) in the grouping charts — the breakdown pie and the group-trend line (and the by-domain MTTR contribution and median bars, where hue is identity and the sign / reference line carries the up-vs-down meaning). Five hues, blue-first, held **outside** the severity red/orange/amber band so a group never reads as a severity, plus a neutral **Other** for the pooled tail:
- **cat-1** `#2563eb` (the brand blue) · **cat-2** `#0d9488` (teal) · **cat-3** `#90396a` (plum) · **cat-4** `#7fba04` (light green) · **cat-5** `#f66bb9` (pink) · **Other** `#94a3b8`

**Five, not more, on purpose.** A warm-band-free, light-tuned, WCAG-and-colorblind-safe categorical set caps out near five distinct hues — eight failed the check hard (violet≈blue under deuteranopia). So the colored groups are **capped at five and the rest fold into Other** (the table still lists every group); this is the categorical face of the Rationed-Ink Rule. The two lightest fills (green, pink) clear only the surface-contrast relief bar, so any label sitting *on* a fill picks its ink adaptively (near-black on the light fills, white elsewhere), and identity is always doubled by the on-arc %, legend point-styles, and direct labels — never color alone. This group palette lives in the GAS app only (the Streamlit `chartCategoricalColors` is the severity ramp): defined in `gas/src/client/styles.css` (`--cat-*`) and mirrored in `charts.js` `CATEGORICAL` (canvas can't read CSS vars), kept in sync by convention. Validate any change with the dataviz palette checker before shipping.

### Named Rules
**The Rationed Ink Rule.** Saturated color is spent only on meaning: severity, state, or an SLA verdict. If a color is on screen, it is answering a question about risk. Neutral is the default; decorative color is forbidden.

**The Two-Token Severity Rule.** Severity always carries two tokens: a vivid *fill* for marks and dots, and a *darker text* token for any colored label. Never set severity text in the fill color on a tint; it will fail contrast.

## 3. Typography

**Display / Body / Label Font:** one family. The native system sans stack: `-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`. No external fonts, no display/body pairing.

**Character:** Neutral, legible, and dense-capable. A single well-tuned sans carries headings, labels, body, and data. OpenType features `cv02 cv03 cv04 cv11` are enabled for cleaner letterforms, and `tabular-nums` is forced wherever figures appear (metrics, dataframes, badges, KPI values) so numbers stay column-aligned and do not jitter between updates.

### Hierarchy
- **Hero value** (600, `2rem` / 32px, letter-spacing `-0.02em`, tabular): The single page-hero metric value (Median MTTR on the MTTR & SLA page). At most one per page, and only ever a data value, never a heading; headings keep the 1.5rem display ceiling. This is the one sanctioned step above display, spent where the number *is* the page.
- **Display / h1** (600, `1.5rem` / 24px, line-height 1.2, letter-spacing `-0.02em`): Page titles and KPI-card values. The heading ceiling; this app never shouts.
- **Section label / h2** (600, `0.9375rem` / 15px): The `section_label()` heading above a group of widgets. Deliberately compact, below the type scale's 18px, so dense pages stay scannable while heading order stays sequential (h1 then h2).
- **Title / h3** (600, `1rem` / 16px): Card and subsection titles.
- **Body** (400, `0.875rem` / 14px, line-height 1.5): Default text. Prose capped at 65 to 75ch; data tables may run denser.
- **Label** (600, `0.75rem` / 12px, letter-spacing `0.05em`, uppercase): Sheet section titles, control labels, badges, sidebar group headers. Uppercase is reserved for these short labels only.

### Named Rules
**The Tabular Figures Rule.** Any number that updates or sits in a column is set in tabular numerals. Always. A jittering metric reads as untrustworthy.

**The No-Display-Font Rule.** Labels, buttons, and data are never set in a display or decorative face. One family, weight contrast only.

## 4. Elevation

Flat by default, depth on demand. Surfaces are flat planes defined by hairline borders, not stacked with ambient shadow. The only resting shadow is a one-pixel whisper that gives cards and buttons a physical edge. Real elevation is spent exactly once, on the right-anchored finding Sheet, where a genuine shadow lifts the overlay above the page it covers.

### Shadow Vocabulary
- **Card whisper** (`box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05)`): KPI cards, stat-list cards. Just enough to read as a surface, not a float.
- **Button rest** (`box-shadow: 0 1px 2px 0 rgba(0,0,0,0.04)`): Secondary buttons at rest.
- **Sheet overlay** (`box-shadow: -8px 0 24px -8px rgba(0,0,0,0.18), -2px 0 8px -4px rgba(0,0,0,0.10)`): The slide-in finding drawer. The single real elevation in the system, justified because the Sheet sits above everything.

### Named Rules
**The Whisper-Or-Lift Rule.** A surface gets either a one-pixel whisper (it is a card) or a real shadow (it is an overlay). Nothing in between. Mid-weight ambient shadows on in-page content are forbidden; that is the dated-app tell.

## 5. Components

Components are **tactile and confident**: comfortable 36px control heights, surfaces that read as real cards, and a primary action that commits without hedging. The vocabulary is consistent screen to screen, which is itself the point.

### Buttons
- **Shape:** Gently rounded, `8px` (`--radius-md`). Min-height `36px` (shadcn h-9), padding `6px 14px`.
- **Primary:** Solid Graphite (`#0a0a0a`), text `#fafafa`, no border. Hover deepens to `#27272a`. Used for the one committing action per context (Run scan). Deliberately neutral, not blue.
- **Secondary (default):** Bordered surface, hairline border, faint surface tint, one-pixel rest shadow. Hover lifts the tint and darkens the border. This is the everyday button.
- **Focus:** A `2px` Signal Blue outline at `2px` offset on every button. Never removed.

### Chips, Badges, and Pills
- **Severity badge:** A pill with a same-hue tint background (the fill token at ~14% over transparent), the darkened severity *text* token, a leading CSS-drawn dot, and the level name. Meaning is in the text and shape, not color alone. Carries an `aria-label`; the role depends on how the badge is painted. Server-rendered badges that appear once (Streamlit) use `role="status"`. Client-rendered badges use `role="img"` — a status is an `aria-live` region, and a drill-down sheet that paints one badge per issue and per finding would fire a dozen announcements on open.
- **Risk chip:** Small semantic chips (Exploit available, CISA KEV, Internet-exposed) in danger / warn / info tints, each with a leading dot in its own text color.
- **Status pill:** OK / Warn / Bad, tinted background plus same-hue text, for SLA verdicts and credential state.

### Cards / Containers
- **Corner Style:** `14px` (`--radius-xl`) for KPI and stat-list cards; `10px` for alerts and dataframes.
- **Background:** Surface tint over the white page.
- **Shadow Strategy:** Card whisper only (see Elevation). Never a heavier float.
- **Border:** Hairline (`#e6e6e9`), full border. Never a colored side-stripe.
- **Internal Padding:** `16px` (`--space-4`).

### Inputs / Fields
- **Style:** White field, hairline border, `8px` radius, `36px` min-height. Labels are `12px`, muted, weight via the label role.
- **Focus:** `2px` Signal Blue ring at `2px` offset.

### Navigation
- **Style:** A shadcn-style sidebar. Group headers are `11px` uppercase muted labels; nav links are `13px` with a Material icon, `8px` radius, rounded hover tint. The active item gets a neutral accent pill (not blue) and bumps to weight 600. Focus shows the blue ring. The sidebar is a cooler surface (`#f8f8fa`) with a hairline right border.

### The Tip

The app's one hover card, and its only answer to "what does this mean". It replaced three
vocabularies that had grown side by side in the GAS AI register: about forty native `title=`
attributes, an SVG `<title>` on every edge of the security graph, and Chart.js's dark canvas
box. All three are gone; `el()` now throws on a `title` attribute so the first two cannot come
back, and an anti-rot spec covers the two paths that go around `el()`.

It is a single node on `<body>`, moved rather than rebuilt: a `10px`-radius white card on a
hairline border with the card whisper, `12px/1.45` copy at `max-width: min(300px, 100vw - 32px)`,
and a caret pinned to the trigger's centre and clamped off both corners so a card pushed
against a window edge still points at what it explains. It opens below and flips above only
when the card does not fit below **and** there is more room above. Portaled, because the
alternative places `position: fixed` inside a trigger that may sit in a transformed `.sheet` —
which makes the sheet the containing block and the card land in the wrong place, invisibly so
under `prefers-reduced-motion`, where the sheet's transform is `none`.

**It meets SC 1.4.13 rather than approximating it.** Escape dismisses while the pointer stays
where it is, and the trigger stays muted until the pointer leaves, so nothing reopens under a
cursor that has not moved; the Escape is stopped from propagating, so a sheet underneath
survives the same keystroke. A close grace lets the pointer cross the gap onto the card.
Nothing times out. A pointer waits `220ms` cold and nothing at all if another card closed in
the last `400ms`, so scanning a row of column headings is one gesture; focus opens instantly.

**The card is `aria-hidden`, always.** The text reaches assistive technology on the anchor
instead, and choosing how is the judgement each call site makes: `spoken: false` where the
anchor already carries an `aria-label` or an `.sr-only` sibling, and a described sibling span
otherwise. This matters because the register had already written the prose and was showing it
only to screen readers — every lattice cell's vector sentence, every graph node's full
reading, the compliance rail's derived-versus-Wiz arithmetic, the toxic-combination matrix's
per-cell tally. Most of this component's job is letting the pointer reach it.

**A definition is a control; a value is not.** A `?` mark, a metric label or a column heading
becomes a real `<button>` with a dotted underline that goes solid on hover: keyboard-reachable,
tappable, one tab stop, and *visible before anything is hovered*, because a definition nobody
can see is not help. A term-backed trigger navigates to its entry in the Help key on activation
— the card never contains focusable content, which is what lets it keep a clean role and stay
out of a sheet's Tab trap. A badge or a clipped cell repeated once per row does **not** become
a control: it answers on hover and leaves the tab order alone, and its definition lives on the
column heading, which is asked once. A clipped value only speaks when it was actually clipped,
measured at hover time.

### Page Header

**The page's name is a heading, and it is the only `<h1>` on the page.** One component owns it (`page_header()` here; `pageHeader({ route })` in the three GAS sidekicks, which reads the name out of the route table so no page keeps a second copy of it), and it reads in three levels:

- **Lane** — the nav group the page sits in ("Data", "Registers", "Assurance"), at the 12px uppercase label step, muted. Orientation, not a heading: it is a `div`, and never an `h*`. A lane holds several pages, so a lane name as the heading would give them all the same one — which is exactly the regression this rule exists to prevent, and it shipped once.
- **Name** — the page's own title, as an `h1` at the **1.5rem display step**. The heading ceiling holds here: a page title is never set at the 2rem hero step, because that step is reserved for a measurement (see Hierarchy). A glossary `?` that defines the *page* sits **beside** the heading, never inside it: the tip's spoken copy is a real element, and folding it into the `h1` puts a fifty-word definition into the heading's accessible name — which is what a screen reader's heading list would then read out.
- **Lede** — the page's own sentence, muted, at the label step and capped at the reading measure. Where the title is a bare noun the section covers ("Data", "Settings"), a short contents phrase may precede it as a second block line; it never becomes a second heading.

Below those, optionally, the Hero Stat, one qualifying aside, and the stat strip — a borderless grid closed by a hairline. A page with a title and no figure is a legitimate header: most pages of a register are lists, and inventing a number to fill the hero slot would be exactly the big-number template the anti-references reject.

### Hero Stat
The one-per-page headline metric (`hero_stat()`), used where a single number is the page's reason to exist (Median MTTR on MTTR & SLA). Deliberately **borderless**: an optional uppercase muted label naming the figure, the value at the 2rem hero step with its change chip beside it, and a muted plain-text source line. The label is omitted only where the page's own `h1` already names the figure — the register pages whose heading is "Code" over a count of open weaknesses — so the block never states the same word twice. Where a glossary `?` defines the *figure* rather than the page, it hangs off this label. The complementary mini-stats (label over an 18px tabular value, optional change chip) sit below a hairline rule inside the same block. Dominance comes from size, top-left position, and whitespace, never from a card, gradient, or accent stripe.

**A page title is never the hero value.** The block above it is where the name goes. Putting the title in the 2rem slot reads as a claim that the name is the measurement, and it costs the page its real one: it once left a compliance page rendering its own name and its posture percentage at the same size, and a combinations page with two 32px strings ninety pixels apart.

### Signature Component: The Finding Sheet
A right-anchored drawer — a restyled `st.dialog` in this Streamlit register; the three GAS
sidekicks (`gas/`, `gas_ai/`, `gas_devsecops/`) implement the identical shape natively as
`gas_shared/ui/sheet.js`, one shared module rather than a per-app rebuild — that slides in over a scrim at `min(520px, 92vw)`, full-bleed on phones. It is a three-zone shell: a pinned header holding the record's identity, verdict chips and the severity accent; a single scrolling body whose section headings stick as you pass them; and a pinned footer so the action you came to take never scrolls out of reach. The affordance for "there is more below" is a hairline that appears on scroll, not a shadow — the Whisper-Or-Lift Rule holds inside the overlay too. It is shape-aware: a flat per-finding record shows a CVSS/EPSS risk strip, scoring, exploitability, asset, lifecycle/SLA, and remediation sections; a grouped-by-asset node shows a per-severity findings breakdown. The header carries a severity-colored left accent set inline from the finding's own severity. Slides in over `220ms` on an ease-out curve; the reduced-motion path zeroes the duration. The same shell dresses the utility drawers — filters, sync progress, a scan's query — at whatever width each asks for.

#### The wide variant: the Record Sheet

A *finding* is one flat fact and reads as one column. A *resource* is not: the GAS AI register's asset and issue records each carry a verdict, open issues, compliance findings, a score breakdown, exposure, guardrail coverage, relationships, identity and tags. Stacked in one scroll, checking a region means passing four sections you did not come for — and a section with nothing in it can only be omitted, which reads identically to "we don't check that".

So the record sheet keeps the shell and splits the body. It runs `min(960px, 94vw)` by default, with a `min(1280px, 96vw)` widen step and a draggable left edge between a `520px` floor and `96vw`; the chosen width persists across opens. Its body is two panes: a `184px` section rail on the surface tint, and a content pane that scrolls on its own. The rail is a real `tablist` — arrow keys and Home/End move within one tab stop, activation follows focus, and the active item takes the app's own nav treatment (a 2px accent bar plus weight, never a tint alone). **Every section always appears.** One with no records is dimmed, counted `0`, still selectable, and its pane says so in a sentence: the register's coverage stays legible from the rail, and "clean" is stated rather than inferred from an absence.

Overview closes on a **connection map**: one hop of the security graph — the record, what it runs as, what data it reaches, the guardrail it hasn't got — drawn in the graph page's own node vocabulary rather than a second one invented for the card, so a node means the same thing here as on the canvas the "Open in graph" button leads to. It is a picture, not a workbench: no pan, no zoom, nothing that would swallow the pane's scroll. Like the scan-coverage diagram it is **measured, not scaled** — the viewBox is drawn at the container's own pixel width so labels never shrink, and below its minimum the card scrolls instead. It is deliberately capped, with a "+N more" stub that leads to Relationships, which stays complete: the map is the shape, the list is the ledger. No dotted canvas ground — a dot grid promises a pan the picture cannot deliver.

The header gains a kind-tinted icon tile and a toolbar of small outlined actions. The record sheet has no pinned footer — that toolbar is pinned already, and carrying the primary action in both is noise. Record-to-record navigation lives in a control cluster (close, previous, next, and an `n/total` counter) that *looks* like it floats on the scrim but is a child of the dialog, so the focus trap and `aria-modal` still cover it. Below `1120px` there is no longer enough page beside the sheet to hang the cluster on and it comes inside as a row; below `900px` the rail becomes a scrolling strip above the pane and the drag handle retires; below `640px` the sheet is full-bleed like every other.

## 6. Do's and Don'ts

### Do:
- **Do** keep the field neutral and ration saturated color to severity, state, and SLA verdicts (the Rationed Ink Rule).
- **Do** pair every severity and status with a non-color signal: a dot, glyph, or text label. Color alone is never sufficient.
- **Do** use the two-token severity system: vivid *fill* for marks and dots, darker *text* token for any colored label, so labels clear 4.5:1 on their tint.
- **Do** set every figure in tabular numerals.
- **Do** let the primary action commit in solid Graphite (`#0a0a0a`); keep Signal Blue (`#2563eb`) for data, focus, and accent.
- **Do** define depth with hairline borders and the one-pixel card whisper; reserve real shadow for overlays like the Sheet.
- **Do** keep edits to `styles.css` in sync with the native tokens in `.streamlit/config.toml`; native theming is the source of truth, the stylesheet mirrors it.
- **Do** keep focus rings and a `prefers-reduced-motion` alternative on every interactive element and animation.

### Don't:
- **Don't** ship generic SaaS-cream with gradient accents or a big-number hero-metric template. No warm near-white body background; the page is true white, the palette is light-tuned.
- **Don't** build noisy security-vendor theater: no walls of red and orange cells, no gauges, no blinking risk drama. Loud-everywhere means signal-nowhere.
- **Don't** fall into dated enterprise density: no gray-on-gray Splunk-style tables, no density without hierarchy.
- **Don't** add consumer-playful flourish: no mascots, illustrations, or marketing decoration in a security tool.
- **Don't** use a colored side-stripe (`border-left` greater than 1px) as a decorative accent on cards, list items, or alerts. Carry severity in the badge and dot instead.
- **Don't** apply `background-clip: text` gradient text anywhere. Emphasis comes from weight and size.
- **Don't** introduce a second type family or a display font for labels, buttons, or data.
- **Don't** add mid-weight ambient shadows to in-page content; a surface is either a one-pixel-whisper card or a real-shadow overlay, nothing between.
