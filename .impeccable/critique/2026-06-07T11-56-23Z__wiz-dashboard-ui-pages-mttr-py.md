---
target: MTTR & SLA page
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-06-07T11-56-23Z
slug: wiz-dashboard-ui-pages-mttr-py
---
# Critique: MTTR & SLA page (`wiz_dashboard/ui/pages/mttr.py`)

Reviewed live at 1440px and 390px against real durable-base data (median MTTR 1.3mo, In SLA 41%, 22 resolved / 18 open).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Page discloses "MTTR source: durable base", but the sidebar says "No scan yet" on a full page; trend "over time" axis is hard to read |
| 2 | Match System / Real World | 3 | Right domain language; "Oldest open" is actually a p90 age; days-vs-months unit split |
| 3 | User Control and Freedom | 3 | Read-only analytics; little to escape (no date-range control though) |
| 4 | Consistency and Standards | 2 | Same median shown as 52d and 1.7mo; hero metric styled two ways; heading scale ≠ design system |
| 5 | Error Prevention | 3 | Graceful empty states; grouped-shape info message is clear |
| 6 | Recognition Rather Than Recall | 2 | Cross-referencing posture bars (52) and table (1.7mo) forces conversion; independent bar scales |
| 7 | Flexibility and Efficiency | 2 | No time-window control on the trend (the primary view); no day/week aggregation; median-only |
| 8 | Aesthetic and Minimalist Design | 2 | Oversized headings + duplicated hero metric + two near-empty stacked charts + 4 stacked axes |
| 9 | Error Recovery | 3 | Good empty/grouped states; charts warn silently (infinite-extent) instead of "not enough history" |
| 10 | Help and Documentation | 3 | Section captions, KPI help tooltips, explicit screen-reader table note |
| **Total** | | **25/40** | **Acceptable — strong bones, hierarchy/density/trend hold it back** |

## Anti-Patterns Verdict

**Does this look AI-generated? No.** It actively clears all four PRODUCT.md anti-references: no SaaS-cream/gradient, no red/orange security-vendor theater, no gray-on-gray Splunk density, nothing playful. The custom components (KPI stat-list, severity table with progress + status glyphs, SLA bullet small-multiples) show real domain craft, and the honest "MTTR source" disclosure plus a11y scaffolding (dashed-line series, status glyphs, screen-reader table note) sit above the AI-default bar.

**Deterministic scan** (`detect.mjs` on the rendered DOM, 3 findings): (1) `transition: max-width` on `.block-container` animates a layout property — legit minor. (2) "Flat type hierarchy" across an 11/11.2/12/13/14/15/16/18px band — a real crowding of near-identical small sizes (note: the detector couldn't see the runtime 44px/36px headings, so it caught the opposite end of the same type-scale problem). (3) "Numbered section markers 01–06" — **false positive**: it matched the trend chart's `01 AM…06 AM` time axis, not section labels.

**Computed-style evidence**: page title h1 = **44px/700**, section labels h2 = **36px** — Streamlit's defaults. The `styles.css` heading scale (intended h1≈24px, h2≈15px compact) does **not** apply to native widgets; `st.caption` no longer carries the `stCaption` testid the CSS targets (captions render native at 14px/opacity-0.6, ~4.67:1, which passes AA). So the design system lands on custom-HTML components but misses native headings/captions.

## Overall Impression

The headline question ("what's our remediation posture?") is answered well and immediately by the Key metrics card. The biggest opportunity is the trend section: the part that carries the page's primary job (are we improving over time?) is the weakest, most confusing element, while a duplicated hero metric and an oversized heading scale add weight the dense, instrument-grade intent doesn't want.

## What's Working

- **The Key metrics card** answers posture in one glance: median, In SLA, oldest open, resolved, open, each with a correctly-colored absolute + % change vs the previous scan. Strong opening peak.
- **The per-severity table** is excellent: formatted durations, an In-SLA progress column, and a ✅/⚠️/🚨 status glyph that carries the 90/70 policy without relying on color. It doubles as the chart's accessible fallback, and the page says so.
- **Honest data provenance**: the "MTTR source: durable base — a vuln that disappears between scans counts as resolved" caption is exactly the "Honest state" principle in action.

## Priority Issues

- **[P1] Native heading scale isn't applying → oversized, low-density, near-flat hierarchy.** h1 renders at 44px and section labels ("Key metrics", "SLA posture", "Remediation performance", "MTTR trend") at 36px, versus the design system's intended 24px/15px. Section labels nearly match the page title (44 vs 36 is a weak step), and on mobile they wrap and dominate. This defeats the "compact, instrument-grade, dense-capable" intent in PRODUCT.md/DESIGN.md, and it's app-wide.
  - **Why it matters**: density and scannability are the whole point for the analyst desk; oversized headings push the actual numbers down and flatten the read.
  - **Fix**: raise selector specificity so the scale beats Streamlit's (scope under `[data-testid="stMainBlockContainer"]`, target `stHeadingWithActionElements h1` and the markdown `h2`, or set sizes via native theme typography). Restore h1≈24px / section h2≈15px and re-verify computed sizes in the browser.
  - **Suggested command**: `/impeccable typeset`

- **[P1] The hero metric is shown twice.** "Median MTTR / Resolved / Open" appear in the Key metrics card, then again as the native "Overall median MTTR 1.3mo" + "22 resolved · 18 open" directly above the table, styled differently (native `st.metric` vs the custom KPI card).
  - **Why it matters**: the same number twice reads as a glitch and weakens hierarchy; it also wastes vertical space on a page that's already 1764px tall.
  - **Fix**: drop the duplicate `st.metric` + caption from `render_mttr_widget` when the KPI card is present (pass a flag), leaving the widget as the table only.
  - **Suggested command**: `/impeccable distill`

- **[P1] The trend charts read as broken on clustered/sparse data.** The "median over time" and "open vs resolved" charts show ~18 hourly x-ticks, a flat line with a vertical spike at the right edge, and large empty plot areas; the console logs repeated Vega `Infinite extent for field "date"/"median_days"/"count"` warnings.
  - **Why it matters**: this is the centerpiece of the primary job (tracking posture over time) and it's the least legible thing on the page. With frequent scans, the hourly clustering recurs even on real data.
  - **Fix**: aggregate the trend by day, label the x-axis, guard the empty/NaN domain (the infinite-extent warning), and handle the few-points/narrow-window case (prominent points, a sensible date floor, or a "N scans over M days" note).
  - **Suggested command**: `/impeccable harden`

- **[P2] SLA posture bullets: clipped value labels + non-comparable scales.** High's "20" and Medium's "30" median labels are clipped at the axis max, and because each lane uses an independent x-scale, bar lengths aren't comparable (Critical 52d and Low 62d look the same length but are opposite verdicts).
  - **Why it matters**: the most visually dominant element (bar length) is the least meaningful comparison; the verdict rests on color + a thin, easily-missed target tick.
  - **Fix**: pad/nudge the value label inside the plot (or move it to the lane label), and reinforce the verdict in text per lane (e.g., "52d / 7d target · 7× over") so length isn't the dominant signal.
  - **Suggested command**: `/impeccable layout`

- **[P2] Unit inconsistency for the same metric.** Posture bullets show raw, unitless days (52, 20, 30, 62); the table shows formatted durations (1.7mo, 20.0d, 1.0mo). A reader cross-referencing them has to convert.
  - **Why it matters**: consistency + recognition; two unit systems for one number on one screen is a small but constant friction.
  - **Fix**: apply one convention (the table's `format_duration` is friendlier) to the bullet value labels and axis, or always suffix "d".
  - **Suggested command**: `/impeccable clarify`

- **[P2] Status contradiction undermines trust.** The sidebar reads "No scan yet — click Run scan to load findings" while the page is full of durable-base data.
  - **Why it matters**: for the leadership desk landing here, "No scan yet" next to real numbers raises "is this current?" — the opposite of the trust the page is built for.
  - **Fix**: when the ledger has data, the sidebar freshness line should reflect the last persisted scan ("Last scan · N findings · <date>") instead of "No scan yet", or surface the base's as-of date on the page.
  - **Suggested command**: `/impeccable clarify`

## Persona Red Flags

**Alex (power-user analyst)**: No time-window control on the trend — can't scope to "last 30 days" or switch day/week aggregation; the primary artifact isn't interactive. Median-only MTTR (no p90/p95) limits SLA analysis. Table sorting is whatever Streamlit gives.

**Sam (accessibility)**: Strong baseline — SLA chart has an explicit screen-reader table fallback, status uses glyphs not color alone, the open/resolved series use dash + color. Risks: the posture chart's meaning rests on bar length + a thin dark target tick; help "?" targets are 16×16 (below the WCAG 2.2 24px minimum); the duplicated "Overall median MTTR" makes a screen reader announce the same number twice.

**Dana (security lead — project persona from CLAUDE.md)**: Gets her one-line posture immediately (In SLA 41%, median 1.3mo) — good. But the sidebar "No scan yet" makes her doubt currency, the trend (her "are we improving?" question) is the weakest element on the page, and "Oldest open 3.9mo" reads as a single item when it's really a p90 age.

**Emotional journey**: Confident peak at the top (KPI card nails the headline), a valley exactly at the high-stakes "are we improving?" moment (duplicated number, then near-empty trend), and a weak end since the two flat charts are last. The strongest content is first; the weakest is last, which inverts the peak-end rule.

## Minor Observations

- "Remediation performance" + "Overall median MTTR" + the table is three labels for one section; collapse to one.
- The two trend charts get identical visual treatment (same height/axis); the open/resolved chart has no y-title while the MTTR chart has a long rotated one — slight asymmetry.
- Muted "· ±N%" chip (`.kpi-card__delta-pct`, opacity 0.7 of #b91c1c ≈ 3.9:1 at 12px) is sub-4.5:1 — the one genuine app-CSS contrast miss (secondary info).
- The "−0pp" change chip ("In SLA ▼ −0pp · −1%") shows a zero-magnitude absolute with a direction arrow plus a non-zero percent — confusing; show "▼ −1%" or a neutral "±0".
- Vega "Conflicting legend property disable" warning on the open/resolved chart (strokeDash legend vs color legend) — harmless config wart.
- `_stcore` 404s when deep-linking to `/mttr` — benign Streamlit base-path quirk.

## Questions to Consider

- What if the trend were the hero of this page instead of its footer?
- Does the per-severity story need both a bullet chart and a table, or is one the truth and the other the accessible fallback?
- What would "are we improving?" look like answered in a single sentence at the top?
