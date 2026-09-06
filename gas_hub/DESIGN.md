---
colors:
  accent: "#0a0a0a"
  accent-hover: "#27272a"
  accent-text: "#0a0a0a"
  accent-edge: "transparent"
  accent-wash: "rgba(0,0,0,0.05)"
  on-accent: "#fafafa"
  graphite: "#0a0a0a"
  ink: "#171717"
  page: "#ffffff"
  surface: "#f8f8fa"
  hairline: "#e6e6e9"
  tile-os: "#2563eb"
  tile-ai: "#be123c"
  tile-dso: "#ffcb13"
  tile-dso-edge: "rgba(0,0,0,0.40)"
  tile-soon: "#52525b"
  sev-critical: "#dc2626"
  sev-high: "#ea580c"
  sev-medium: "#d97706"
  sev-low: "#2563eb"
  sev-info: "#64748b"
  sev-unknown: "#475569"
---

# DESIGN — Wiz Sidekick (the hub)

> Sibling of [`../DESIGN.md`](../DESIGN.md). The creative north star, the type scale, the
> spacing ramp, the radius scale, the elevation vocabulary, the severity palette and the
> accessibility bar are **inherited unchanged**. What differs is stated here. Where this
> file is silent, the shared document governs.

Two things differ, and they are related: this app has no brand hue of its own, and its one
page is four large blocks of somebody else's.

## 1. Why graphite

The OS sidekick is Signal Blue `#2563eb`. The AI sidekick is crimson `#be123c`. The DevSecOps
sidekick is yellow `#ffcb13`. A fourth saturated hue would say this app is a fourth register,
and it is not — it opens the other three and measures nothing.

So the accent is **graphite `#0a0a0a`**: `--graphite`, the primary-button colour
`gas_shared/styles/base.css` already gives every app, promoted to the identity colour. It reads
as chrome rather than as a brand, which is exactly what a front door should be, and it is the
one accent in the whole system that never had to argue with a contrast floor.

| Token | Value | Measured | Job |
|---|---|---|---|
| `--accent` | `#0a0a0a` | 19.80:1 on white | identity **fills** only, same rule as every sibling |
| `--accent-hover` | `#27272a` | — | the hover state of such a fill |
| `--accent-text` | `#0a0a0a` | 19.80:1 on white | links, focus rings, the active option, any accent ink |
| `--accent-edge` | `transparent` | — | none needed: the fill clears the 3:1 mark floor 6× over |
| `--on-accent` | `#fafafa` | 18.97:1 on `--accent` | ink drawn **on** an accent fill |
| `--accent-wash` | `rgba(0,0,0,.05)` | — | the tint a standing state wears |

Two of those are *permissions the other apps have to earn*. `--accent-text` may point at
`--accent`, and `--accent-edge` may be `transparent`, only because the fill itself clears the
**4.5:1 text floor** — a stronger claim than the 3:1 graphical-mark floor a fill owes.
`gas_devsecops` clears neither at 1.52:1, which is why the five-token split exists at all; see
`gas_shared/README.md`'s "five-token accent contract". `test/shared.test.js` pins all five by
value and re-derives both ratios rather than restating them.

**The primary button stays graphite.** That is not a coincidence here, it is the same token —
but the rule is still the shared one, and it is still `var(--graphite)` in `base.css` rather
than `var(--accent)`, so it does not silently follow this app if the accent ever moves.

## 2. The tiles — a stated exception to Whisper-Or-Lift

Root `DESIGN.md` says a surface either whispers (flat, hairline, tinted) or lifts (a shadow
that means "above"). The four launcher tiles do neither: each is a **full-colour fill** with a
**1px outline offset −8px, −8px behind it**. This is a deliberate exception, and it is granted
to `.tile` and `.tile::before` alone — nothing else in this app's chrome may reach for a
`--tile-*` token or an offset `::before`.

The argument for it: this page has exactly one job, and it is a *choice between four things*.
Four whispered cards would be four rectangles of the same near-white, distinguishable only by
their words; the reader would have to read the page rather than recognise it. Each register
already owns a colour, so colouring the tile with it makes the second visit a glance instead of
a read. And the offset shape is an **outline, not a shadow**, on purpose: a shadow says
"floating above", which is the elevation claim Whisper-Or-Lift is about not making casually,
while a drawn line at 1px says nothing except "there is a second card behind this one" and
stays a drawn line at any zoom.

The exception ends at the tiles. Everything else on the page — the header, the rail, the
settings panels, the save bar — is the shared system unmodified.

### The tile table, measured

| Tile | Fill | Ink | Edge | Measured |
|---|---|---|---|---|
| OS Patching | `--tile-os` `#2563eb` | `--on-tile-os` `#ffffff` | none | 5.17:1 |
| AI | `--tile-ai` `#be123c` | `--on-tile-ai` `#ffffff` | none | 6.29:1 |
| DevSecOps | `--tile-dso` `#ffcb13` | `--on-tile-dso` `#171717` | **`--tile-dso-edge` `rgba(0,0,0,.40)`, mandatory** | 11.78:1 |
| Coming soon | — (the page's own ground) | `--ink` `#171717`, with `--text-2` on the eyebrow and scope line | `--tile-soon` `#52525b`, 1px border | 7.73:1 for the border on white |

Each tile's **offset outline takes its own colour** — `.tile--os::before` draws in
`--tile-os`, and so on. Drawn in one flat neutral it read as a drop shadow that had lost its
blur: four identical hairlines behind four different fills, which is the elevation story the
outline exists *not* to tell. In each register's own hue it reads as what it is, the tile's
edge echoed. The DevSecOps tile is the exception and it is the same exception as the fill's:
`#ffcb13` is 1.52:1 on white, so its echo would be a line nobody can see, and it takes
`--tile-dso-edge` instead.

**The yellow's edge is not optional and cannot be forgotten.** `#ffcb13` is 1.52:1 on white —
under even the 3:1 graphical-mark floor — so the fill is not a legal mark by itself. The inset
ring is therefore declared *inside the `.tile--dso` block*, beside the fill it rescues, rather
than as a separate `.tile--edged` class a DevSecOps tile could be drawn without: there is no
code path that reaches the yellow and skips it. `test/shared.test.js` asserts both the ratio
and the block.

**The unbuilt fourth is secondary, and that is the design.** Drawn as a solid grey fill it
carried the same visual weight as the three real products beside it — four blocks of colour,
one of which opens nothing. A bordered card on the page's own ground says "planned" without a
disabled control or a greyed-out label. It has no `--on-tile-soon` token because it has no fill
for ink to sit on; `--tile-soon` is a **border token**, and as a 1px line the only floor it owes
is 3:1, which it clears at 7.73:1.

### Three states, and none of them is a disabled control

| State | Element | What it says |
|---|---|---|
| configured | `<a class="tile tile--os" href>` | the scope line plus the external-link glyph |
| not configured | `<div class="tile tile--os tile--unset">` | keeps the colour and the headline; a dashed inner ring and a sentence naming Settings → Sidekick URLs |
| coming soon | `<div class="tile tile--soon">` | the bordered card, `cursor: default` |

Neither non-link is a disabled `<button>` or an `<a>` without an `href`. A control that looks
like a control and does nothing on click is worse than no control (PRODUCT.md's honest-state
principle), so the two are plain `<div>`s that read as statements. An unset tile keeps its
register's colour precisely so a reader can still tell OS Patching from AI while it is unset —
the missing thing is the address, not the register.

## 3. Unchanged, and deliberately so

- **The severity palette is byte-identical** to all three registers, even though this app draws
  no severity. A severity means the same thing in every sidekick; the brand deliberately does
  not. `src/domain/config.ts` says why the file exists here at all.
- **The z scale** is `gas_shared/styles/tokens.base.css`'s, with no local `--z-*`. The tile's
  offset outline uses no `z-index` at all and its content uses the component-local `1` — the
  two literals the z-scale contract allows for ordering *within* a component.
- **The focus ring, the reduced-motion alternatives and the 4.5:1 text floor** are the shared
  system's, untouched.
- **`--ok` / `--warn`** are defined once, in the shared base. This app redefines neither.

## 4. One rule this app adds to the rail

Every route here is `group: null` — two front-door pages, not a lane and a chrome tail. The
shared `navRail.js` draws a leading `.nav-rule` in front of the first `group: null` item on the
assumption that a labelled lane came before it, so with no lane at all the rail opened with a
hairline separating nothing from nothing. `src/client/styles/pages.css` hides it
(`.sidebar > .nav-rule:first-child { display: none }`) rather than changing the shared
component, which all three registers depend on for their own real chrome tail.
