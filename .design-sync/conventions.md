# Wiz Sidekick — the shared core

Instrument-grade security analytics: a light, neutral field with colour rationed to severity
and state. Precise and trustworthy; never playful, never a SaaS marketing page.

## Setup

**No provider, no theme wrapper.** Import the stylesheet and render — every component styles
itself from CSS custom properties on `:root`.

The brand accent is the one switch. Default is the DevSecOps yellow; add `data-brand="ai"` to
any ancestor for the AI register's crimson:

```jsx
<div data-brand="ai">  {/* omit entirely for the default yellow */}
  <KpiCard label="Open secrets" value="843" />
</div>
```

## The accent is split, and the split is load-bearing

Three tokens, three jobs. Getting this wrong is the single easiest way to ship something
unreadable, because `--accent` (#ffcb13) measures **1.52:1 on white**:

| Token | Use it for | Never |
|---|---|---|
| `--accent` | identity **fills** only — a mark, a meter fill, a switch track | text, focus rings, chart series |
| `--accent-edge` | **mandatory** under every accent fill (lifts it to 3.49:1) | — |
| `--accent-text` | every accent **ink**: links, focus rings, active option (7.39:1) | large fills |

Primary buttons are graphite (`--graphite` on `--on-graphite`), **not** accent-filled.

## Styling idiom: classes, then tokens

This system is class-named markup over a token layer. Style with the **existing class
vocabulary** first; reach for tokens only for your own layout glue. Do not invent class names,
and do not hard-code colour, spacing, or radius.

Real families, all defined in the shipped CSS:

- **Surface / ink** — `--page`, `--surface`, `--ink`, `--text-2`, `--text-3`, `--hairline`,
  `--track-bg`, `--wash-hover`
- **Severity** — `--sev-critical` … `--sev-unknown` for **fills**, and
  `--sev-critical-text` … `--sev-unknown-text` for **any coloured label**. The text tokens are
  deliberately darkened to clear 4.5:1 on pale tints; keep the split. This palette is
  byte-identical across every Wiz Sidekick surface — a severity means the same thing everywhere.
- **Scale** — `--space-half`, `--space-1` … `--space-7`; `--radius-xs`, `-sm`, `-md`, `-lg`,
  `-xl`, `-pill`; `--fs-micro`, `--fs-label`, `--fs-body`, `--fs-lead`, `--fs-display`, `--fs-hero`
- **Elevation** — `--shadow-button`, `--shadow-card`, `--shadow-sheet`, `--shadow-dialog`
- **Structural classes** — `.page-header` / `.stat-list` / `.stat-row`, `.kpi-card`,
  `.table-wrap` + `table.data`, `.pill`, `.sev-badge`, `.empty`, `.section-label`. `.num` puts
  tabular figures on any number.

## Two rules that are not stylistic

1. **Never pass a `title` attribute.** The element builder throws on it — a native tooltip is
   unreachable by keyboard, absent on touch, and truncated by the OS. Every component takes a
   `help` prop instead (a string, an array of lines, or `{ term }`).
2. **Colour never carries meaning alone.** Severity and status always pair colour with a dot,
   glyph, or label. Keep the `prefers-reduced-motion` alternative on anything animated.

## Where the truth lives

- `_ds/<folder>/styles.css` and its `@import` closure — the complete, unminified CSS. Read it
  before styling anything; it is the authority, not this summary.
- `components/<group>/<Name>/<Name>.prompt.md` — per component: props, a usage example, and
  **the exact classes that component emits**, so you can hand-write the same structure when a
  layout needs it.

## Idiomatic

```jsx
<div style={{ display: "grid", gap: "var(--space-4)", padding: "var(--space-5)" }}>
  <PageHeader
    hero={<HeroStat label="Median time to remediate" value="18.4 days"
                    sub="1,284 closed; 312 open and right-censored" />}
    aside={<SevSegmentBar counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210 }}
                          label="Open findings by severity" />}
    stats={<>
      <StatRow name="SAST" value="412" sub="open" />
      <StatRow name="Secrets" value="843" sub="open" meterPct={68} />
    </>}
  />
  <KpiCard label="SLA compliance" value="87%" sub="critical, last 90 days"
           chip={<StatusPill kind="warn" text="Below target" />} />
</div>
```

Note the shape: library components carry the content; your own glue is a plain `grid` using
`--space-*`. That is the whole idiom.
