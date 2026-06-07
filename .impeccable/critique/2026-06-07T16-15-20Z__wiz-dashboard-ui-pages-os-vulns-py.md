---
target: os vulnerabilities page
total_score: 33
p0_count: 0
p1_count: 0
timestamp: 2026-06-07T16-15-20Z
slug: wiz-dashboard-ui-pages-os-vulns-py
---
## Design Health Score — 33/40 (Good, upper band)

Re-critique after this session's fixes. Prior assessment (in plan mode, unsaved): **29/40**.

| # | Heuristic | Score | Δ | Key issue / note |
|---|-----------|-------|---|------------------|
| 1 | Visibility of system status | 3 | – | Strong (st.status steps, toast, freshness, delta chips, posture band); dual-CTA muddle resolved (credited under #4) |
| 2 | Match system / real world | 4 | +1 | Dev-jargon labels fixed → "Sample data / Grouped by asset / Individual findings"; MTTR/SLA are correct register for the audience |
| 3 | User control & freedom | 4 | +1 | New "Clear filters" reset; ESC on sheet; URL-shareable state — full escape on this surface |
| 4 | Consistency & standards | 4 | +1 | Single scan CTA (sidebar only); cohesive vocab; pruned the divergent metric_card |
| 5 | Error prevention | 3 | – | Unchanged: safe dry-run, present-only render, empty handled |
| 6 | Recognition vs recall | 3 | – | Default-flat + clearer labels + the link reduce the grouped↔flat recall burden, but the model still exists |
| 7 | Flexibility & efficiency | 3 | – | Reset-filters + URL filters help; keyboard, multi-select/bulk, "open next" still absent (deferred) |
| 8 | Aesthetic & minimalist | 3 | – | De-triplicated severity, one filter toolbar, posture replaces the generic KPI band — strong, not yet "perfectly minimal" |
| 9 | Error recovery | 4 | +2 | `show_exception` now leads with plain-language cause + actionable hint, traceback collapsed; preserves prior findings |
| 10 | Help & documentation | 3 | – | Good contextual help/tooltips/info box; no global docs |

## Anti-patterns verdict — does NOT read as AI-generated (stronger than before)
**LLM review:** posture-first hierarchy, rationed color, severity shown once (card + bar), one scan CTA, plain copy. The closest-to-generic element (the severity-echoing 4-card KPI band) is gone — repurposed into a remediation posture band.
**Deterministic scan:** `detect.mjs` on the source → exit 0, no findings (limited reach on runtime-generated HTML).
**Live DOM scan** (rendered flat view): 0 gradient-text, 0 colored side-stripes, 0 glassmorphism, 0 all-caps body text; muted-label contrast ≈7:1. Only ≥16px shadow is Vega's third-party chart menu, not our content. 0 console errors across flat / grouped / group-by / reset round-trips.

## What's working
1. **Posture-first hierarchy.** H1 → posture band (Total · Median MTTR · In SLA + link) → severity breakdown (once) → filter toolbar → table. The leader's headline question is answered or routed at the top; the analyst's detail follows.
2. **One verdict, one place.** The band's MTTR/In-SLA prefer the durable ledger, so they match the MTTR & SLA page exactly — no contradicting numbers across surfaces.
3. **Calm, consistent surface.** Single scan CTA, de-triplicated severity, one filter+group toolbar, plain-language errors and labels, reset-filters that only appears when needed.

## Priority issues (remaining)
- **[P2] Triage loop is still one-at-a-time and mouse-bound.** Drill-down is tick-checkbox → rerun → drawer → close → tick next; no keyboard shortcuts, no multi-select/bulk triage, no "open next" inside the sheet. Genuinely Streamlit-constrained (the checkbox-as-button is already a workaround); a scoped effort, possibly a small custom component. *Command:* `/impeccable shape`.
- **[P3] The posture band mixes sources without saying so.** `Total findings` is the current scan; `Median MTTR` / `In SLA` are the cross-scan durable ledger. Documented in code, but a sharp reader sees "Total 17" beside ledger-based rates with no note. Add a one-line "from the durable base · full trend on MTTR & SLA" caption. *Command:* `/impeccable clarify`.
- **[P3] No trend direction on the band.** The leader sees "In SLA 50%" but not whether it's improving; the link delivers the trend, so it's acceptable, but a small delta chip (reusing the MTTR page's `_prev_from_trend`) would make the band self-sufficient. *Command:* `/impeccable shape`.
- **[P3] Scan discoverability is now sidebar-only.** A deliberate trade of the de-dup: the landing page has no inline scan CTA. The empty-state copy points to the sidebar, which mitigates, but a first-time leader could miss it. *Command:* `/impeccable onboard` (or accept).
- **[P3] Mobile/responsive unverified.** The 5-column filter toolbar + 2-col severity/bar will stack on phones (Streamlit collapses columns); not checked at narrow widths. *Command:* `/impeccable adapt`.

## Persona red flags
- **Alex (power user):** triage loop unchanged (one-at-a-time, mouse-bound); reset-filters is a new win, but no keyboard/bulk path.
- **Sam (a11y):** solid — heading order verified h1→h2 live; severity never color-only; the new reset button and page-link are focusable with text labels; reduced-motion + focus rings intact. Verify the Vega chart's keyboard story (click-to-filter is mouse-only, but redundant with the severity pills).
- **Leader (project):** now served — the posture band + "View MTTR & SLA" answers/routes the headline question instead of stranding them on severity counts.

## Minor observations
- The drill-down sheet's 3px severity `border-left` is the one sanctioned side-stripe (only present while the sheet is open); intentional.
- Posture band "Median MTTR / In SLA" help tooltips carry the source nuance, but a visible caption would be more honest at a glance.
- The filter toolbar's Group-by control can wrap at narrow widths (4 options in a ~3/13 column) — check under `adapt`.

## Questions to consider
- Is the sidebar-only scan trigger the right call for the *default landing page*, or should the OS page keep one inline CTA for first-run discoverability?
- Worth a small "durable base · trend on MTTR & SLA" caption under the posture band to make the scan-vs-ledger source explicit?
- Is the one-at-a-time triage loop a real bottleneck for your analysts, or is the single-finding drawer enough?
