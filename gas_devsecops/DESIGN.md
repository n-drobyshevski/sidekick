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
`test/tokens.test.js` pins them, including the assertion that every text token really is
darker than its fill.

Also unchanged: the neutrals, `--text-3` at `0.6` alpha (`0.5` measured ~3.95:1 and failed),
the type scale and its tabular figures, the spacing ramp's two-tier rhythm, the radius
scale, the whisper-or-lift elevation rule, and the motion durations.

## 4. A note for whoever adds an ordinal scale

`#ffcb13` is literally `gas_ai`'s `--rank-2-solid`. Separate apps, so there is no collision
today. If this register ever grows a maturity or posture ramp, the brand colour will equal
tier 2 of 4 — and at that point the **ramp moves, not the brand**.
