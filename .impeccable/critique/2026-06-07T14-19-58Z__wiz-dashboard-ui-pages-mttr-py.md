---
target: MTTR & SLA page
total_score: 28
p0_count: 0
p1_count: 3
timestamp: 2026-06-07T14-19-58Z
slug: wiz-dashboard-ui-pages-mttr-py
---
# Design Critique — MTTR & SLA page (`wiz_dashboard/ui/pages/mttr.py`)

Method: two isolated assessments. **A** = a design-director review from source only (no app, no detector). **B** = deterministic detector + live DOM inspection of the page running on a local Streamlit instance, rendered from the existing durable base (18 findings, last scan 2026-05-30). Pixel screenshots could not be captured: Streamlit's persistent websocket keeps the page from reaching the idle state the screenshot tool requires within its timeout. All other DOM evidence (exact values, ARIA attributes, console output, computed styles) was read directly and is cited below.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Exemplary provenance: explicit "MTTR source: durable base / current scan only" caption, freshness line, sparse-day note. (Console carries 24 Vega warnings, but those aren't user-visible.) |
| 2 | Match System / Real World | 2 | "Oldest open" is actually the **90th-percentile** open age, not the oldest. Live value reads "4.0mo" — a number a leader would mis-quote to an auditor. |
| 3 | User Control and Freedom | 3 | Read-only consumer page (fine), but no date range, severity filter, or drill-through from here. |
| 4 | Consistency and Standards | 2 | "Are we in SLA?" is answered with **two different thresholds**: the bullet chart colours by `median ≤ target` (binary); the table colours by `sla_pct` at 90/70 (tri-state). A row can be a red bar AND a ✅. |
| 5 | Error Prevention | 3 | Strong empty / grouped-shape / divide-by-zero guards. Little to break. |
| 6 | Recognition Rather Than Recall | 3 | Targets are stated in lane labels ("Critical · ≤7d"), but reconciling overall In-SLA vs per-severity bullets vs table % is held in working memory. |
| 7 | Flexibility and Efficiency | 2 | No drill-down, filter, sort, or export from this page; the finding Sheet lives on the OS page. The analyst sees the problem here and must act elsewhere. |
| 8 | Aesthetic and Minimalist Design | 3 | Component-level minimalism is excellent; page-level is over-served — 5 KPIs + 4 bullets + 7-col table + 2 trend charts + 3 captions all answer one question. |
| 9 | Error Recovery | 3 | Few error states on this page; the grouped-shape `st.info` is handled honestly. |
| 10 | Help and Documentation | 3 | Good inline tooltips/captions, but the load-bearing caveats (p90, "disappearance counts as resolved") hide in hover text a leader won't trigger. |
| **Total** | | **28/40** | **Good — solid foundation, weak spots in honesty-of-label, threshold consistency, and efficiency.** |

> Note: Assessment A scored this 31/40 from source alone. Live evidence (In-SLA 41% with a mostly-over-target posture, the p90 mislabel showing "4.0mo", and the bullet-vs-table threshold fork) pulled heuristics 2 and 4 down a point each on synthesis. Final: **28/40.**

## Anti-Patterns Verdict

**Does this look AI-generated? No.** This reads as a deliberately built instrument, not a template.

- **LLM assessment:** The slop tells are absent — no gradient hero, no cream-card soup, no big-number-with-sparkline cliché, no emoji headlines. `tabular-nums` is enforced on every value column; the 4/8 spacing rhythm is real; severity colour is rationed to dots/badges/bars. One family + system font + restrained palette is correct brand discipline here, not flatness. A Linear/Stripe/Notion-fluent user would trust it. The one thing that makes such a user pause is structural, not stylistic: the same SLA truth is presented three ways.
- **Deterministic scan:** The bundled CLI detector returned `[]` (clean) — but that's **not meaningful coverage**: the page is Python that emits HTML at runtime, so there is no static markup for the slop detector to scan. The real deterministic signal came from the live DOM: 24 `Infinite extent` Vega warnings (`yearmonthdate_date` / `median_days` / `count`), a duplicated "May 29" x-axis tick on both trend charts, and `role=null` / `aria-label=null` on all three Vega chart containers.
- **Visual overlays:** None. The injected-overlay flow is for static sites; for this live app I inspected the running DOM directly instead. No pixel screenshot was captured (Streamlit never idles within the screenshot timeout), so no user-visible overlay is claimed.

## Overall Impression

A genuinely composed, honest, accessible-by-construction instrument that nails its hardest jobs (provenance, progressive disclosure, non-color severity signals) and then undercuts its own core audience with one structural flaw: **the same SLA verdict is told three times with two contradictory thresholds, and one of the headline numbers ("Oldest open") is mislabeled.** The single biggest opportunity is to make the page state *one* SLA truth, once, in language that survives an audit.

## What's Working

1. **Honest-state discipline is the standout.** The MTTR-source caption (durable base vs current scan vs grouped-shape `st.info`), the sparse-day note ("Only one day of scans so far…"), and the instructive empty state all tell the literal truth about the data. For an audience that defends numbers to auditors, provenance-as-a-first-class-UI-element is exactly right, and rare.
2. **Progressive disclosure is correctly tuned.** Promoting the scannable SLA bullets as the hero and demoting the dense 7-column table into a collapsed expander serves both desks from one layout — Dana reads posture, Alex opens the table. (The one cost: see the a11y issue below.)
3. **Accessibility is load-bearing, not bolted on.** Severity never rides on colour alone (CSS dot + label + `aria-label`); the open/resolved lines carry both colour *and* `strokeDash`; the severity *text* tokens are deliberately darkened to clear 4.5:1 on their pale fills; focus rings are global and `!important`; reduced-motion zeroes every animation. Captions render at full ink (`rgb(23,23,23)`), well clear of AA.

## Priority Issues

### [P1] The same SLA verdict is told three times with two contradictory thresholds
- **Why it matters:** The stat card shows overall **In SLA: 41%**; the bullets show per-severity median-vs-target (mostly red, e.g. a "1.7mo" median against a ≤7–90d target); the table shows per-severity median + SLA target + In-SLA% + ✅/⚠️/🚨. The bullet colours by `median ≤ target` (binary) while the table colours by `sla_pct` at 90/70 — so a single severity can be a **red bar in the posture and a ✅ in the table at the same time**, because they silently measure different things (time-of-median vs share-within-SLA). A leader who screenshots both from the same row is contradicting herself. This is the page's central redundancy-vs-reinforcement failure.
- **Fix:** Pick one canonical SLA metric. Either colour the bullet bar off `sla_pct` too (same 90/70 policy, so a green bar always implies a ✅ row), or explicitly label each artifact ("Median vs target" on the bullets, "% within SLA" on the table) plus one line of copy stating they measure different quantities. Then question whether the table needs to exist at all beyond the a11y fallback (its columns are already duplicated inside the bullet tooltips).
- **Suggested command:** `/impeccable distill` (collapse the three-fold repetition), then `/impeccable clarify` (disambiguating labels/copy).

### [P1] "Oldest open" is mislabeled — it is the 90th-percentile age, not the oldest
- **Why it matters:** The KPI labeled "Oldest open" computes `max` over per-severity `open_age_p90`; the help tooltip admits "90th-percentile age," but the **label says Oldest.** Live, it reads "**4.0mo**." A leader will tell an auditor "our oldest unremediated finding is 4 months" — which is false (the true oldest is older than p90). Defending a wrong number to an auditor is the worst failure mode for this exact persona, and the label contradicts the math.
- **Fix:** Rename to **"Open age (p90)"** / **"90th-pct open age."** If a literal oldest is wanted, compute `max(_age_days)`. Don't rely on a hover tooltip to correct a wrong word.
- **Suggested command:** `/impeccable clarify`.

### [P1] The chart hero is inaccessible to screen readers, and the fallback table is hidden
- **Why it matters:** Confirmed in the live DOM: all three Vega charts (SLA bullets + both trends) have `role=null` and `aria-label=null` — opaque SVG with no text alternative. The stated a11y fallback is the per-severity table, but it lives inside a **collapsed** expander with no announced relationship to the chart, and the trend charts have **no** tabular fallback at all. A keyboard/screen-reader user (Sam) reaches the page's hero and hits a wall.
- **Fix:** Default-expand the breakdown table on the durable-base path (or render an `aria`-labelled per-lane text summary next to the bullets), give the chart containers an `aria-label`, and add a tabular alternative for the two trend charts. At minimum, change the bullet caption to name the table as the accessible equivalent.
- **Suggested command:** `/impeccable harden` (a11y + fallbacks), or `/impeccable audit` to enumerate every chart's gaps.

### [P2] Both trend charts emit "Infinite extent" warnings and render a duplicated axis tick
- **Why it matters:** The live page logs **24 `Infinite extent` Vega warnings** (`yearmonthdate_date` / `median_days` / `count`) and both trend charts render an x-axis reading "May 29 / May 29 / May 30" — a **duplicated tick** for the same day. `charts.py`'s own docstrings claim this exact warning was fixed by flooring to UTC day in `_daily`; it has regressed or never fully resolved. The charts aren't blank, but a degenerate domain + duplicate ticks reads as a broken instrument to a detail-oriented user, on the one page whose whole point is trustworthy figures.
- **Fix:** Re-check `_daily` against the durable-base trend shape (the duplicate suggests sub-day timestamps surviving the floor, or an all-null slice still reaching Vega); ensure an empty/degenerate domain returns `None` (caption path) before Vega sees it, and dedupe the day axis.
- **Suggested command:** `/impeccable audit` (then a code fix).

### [P2] The over-target SLA posture has no reassuring or actionable frame — a composure breach
- **Why it matters:** Live, In SLA is **41%** and most severities are well over target, so the hero is a stack of red bars with "N× over target" labels and nothing else. The brand's emotional goal is *composure, not alarm*; this is precisely the high-stakes moment that principle exists for, and it currently slips toward the security-vendor theater the product explicitly rejects. Tellingly, the empty/sparse states got warm, instructive copy while the breach state — the one that matters most — got the least design investment.
- **Fix:** Add one calm summary line above the bullets ("3 of 4 severities over target; Critical is the priority — N findings") and/or a muted "what this means / what to do next" caption. Frame the red, don't just flash it.
- **Suggested command:** `/impeccable clarify` (reassurance copy) + `/impeccable layout` (a summary beat above the posture).

## Persona Red Flags

**Alex — impatient power analyst** ("what do I remediate first"): the page is read-only — he sees "Critical · over target" but **cannot click through to a finding** (the drill-down Sheet is on the OS page, not here); he must open the expander on every visit to get resolved/open per severity; no filter, sort, or export. He sees the problem and has nowhere to go.

**Sam — screen-reader / keyboard-only:** the hero SLA bullets are **opaque SVG** (`aria-label=null`, confirmed live); the verdict text exists only as Vega marks and tooltips he can't hover; the a11y fallback table is behind a **collapsed** expander with no announced relationship; both trend charts have **no** tabular alternative. The text KPIs, severity `aria-label`s, and the SLA `role="progressbar"` (used elsewhere) do work for him — but the page's primary content does not.

**Dana — security leader, reads posture in 20s, must defend a number to an auditor:** "**Oldest open: 4.0mo**" is the wrong word for a p90; she must guess which "In SLA" is canonical (overall 41%, the bullets, or the table's per-row %); the **red-bar-plus-✅** contradiction means she could screenshot "over target" and "compliant" from the same row. The provenance caption ("a vuln that disappears between scans counts as resolved") is exactly the auditor footnote she needs — but it's a `st.caption` that's easy to miss, and the assumption behind it is never articulated where she'd defend it.

## Minor Observations

- **KPI lines mix units:** confirmed live — "Median MTTR **1.3mo** ▲ +15.2d · +61%" and "Oldest open **4.0mo** ▲ +8.2d". Value in months, delta in days, on one line. `format_duration` also jumps units across the 30-day boundary (29.9d → "1.0mo"), so a median crossing 30 days reads oddly between scans.
- **In-SLA delta drops its unit:** confirmed live — "In SLA 41% **±0**" shows a bare `±0` with no "pp," while the non-zero branch shows "Npp." Inconsistent unit display in `_delta_html`'s flat branch.
- **Two oranges, two meanings:** the SLA-bullet "warn" fill `#d97706` equals the MEDIUM severity fill; the open-trend line is `#ea580c` (= HIGH severity fill). A reader could pattern-match the orange line to "high severity."
- **`stat_list_card` ignores `accent`** (documented), yet `_hero` passes `accent` on every item — dead parameters implying a colour that never renders; misleading to a future editor.
- **Narrow-viewport split unverified:** the `st.columns(2)` Key-metrics/SLA-posture band has no responsive guard. The codebase already hit and fixed this exact `st.columns` squeeze in `page_scaffold` (switched to `st.container(horizontal=True)`); this page didn't adopt that pattern. Couldn't confirm the break visually (screenshot blocked), so flagged as a risk, not a confirmed defect.
- **Deep-link 404s:** navigating directly to `/mttr` logs two console 404s (`_stcore/health`, `_stcore/host-config`) — a Streamlit subpath quirk, benign, not triggered by in-app nav.

## Questions to Consider

1. If the bullets and the table show ~80% the same per-severity data — and the bullet tooltip already contains every table column — **why does the table exist** except as the screen-reader fallback? If that's its only job, make it the a11y-first artifact (always rendered, visually muted) rather than a collapsed "breakdown."
2. **Is median MTTR the honest headline for a security leader, or is p90/p95 the number that survives audit?** The page reports *median* remediation time but *p90* open-age — an inconsistent sense of "what counts." An auditor cares about the tail.
3. The over-target posture is the moment this page exists for. **Why does it have less design investment than the empty state?** The emotional budget is inverted.
4. Five KPIs share one card at equal weight. If "the number is the product," **which single number is THE product of this page** — and why isn't it visually primary?
5. Should this page be **clickable into a finding** at all? Posture and action are split across two pages today. Deliberate separation of "leadership read" from "analyst act," or an accident of which page owns the Sheet?
