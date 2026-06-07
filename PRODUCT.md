# Product

## Register

product

## Users

Two desks share this dashboard, and the design has to serve both without forcing either to compromise:

- **Security analysts / SecOps** are the daily, hands-on users. They triage OS-level CVEs on host workloads, decide what to remediate first, and track whether fixes are landing. They want density, fast scanning, and the ability to drill into a single finding without losing context.
- **Security leadership** check in less often and stay higher up. They read remediation posture: are we inside SLA, is MTTR trending the right way, what's the headline risk this week. They need the top-line numbers to be unambiguous and the reports/exports to be defensible.

The common thread: both arrive with a question about risk and want an answer they can act on or report on, not a data dump to interpret.

## Product Purpose

A Streamlit dashboard over Wiz vulnerability findings. It pulls OS-level CVE data (live via a Wiz service account, or bundled sample data in dry-run mode), then turns it into the views a security org actually operates on: severity breakdowns, an overview of what needs attention, per-finding drill-downs, and the primary lens, **MTTR and SLA remediation analytics** tracked over time with a persistent scan history.

The product exists to answer "how fast are we closing risk, and are we meeting our targets" with numbers a team can trust enough to act on and stake a report on. Success is when an analyst opens it and knows what to fix next within seconds, and a leader opens it and can state the org's remediation posture without asking anyone.

## Brand Personality

**Precise, trustworthy, instrument-grade.** This is a measuring instrument, not a billboard. The voice is calm and exact: it states what is true and what needs attention, and otherwise stays quiet. Confidence comes from accuracy and legibility, never from drama. A figure on screen should feel like one you could put in front of an auditor.

Emotional goal: composure. The user should feel in control of the risk picture, not alarmed by it.

## Anti-references

All four were called out explicitly. Steer away from every one:

- **Generic SaaS-cream + gradient.** No warm near-white body background, no gradient text or accents, no big-number hero-metric template. This is the AI-default look and it reads as unconsidered.
- **Noisy security-vendor theater.** No wall of red/orange cells, no gauges, no blinking "risk" drama. Over-coloring drowns the real signal and trains users to ignore it. Color is reserved for genuine severity and state.
- **Dated enterprise density.** No gray-on-gray Splunk/old-Qualys tables, no density without hierarchy. Dense is fine when the user needs it; cramped and undifferentiated is not.
- **Consumer-playful.** No mascots, illustrations, or marketing flourish. Personality in a security tool undercuts its credibility.

## Design Principles

1. **The number is the product.** The headline metrics (MTTR, SLA attainment, severity counts) are what users come for. Lay out everything else in service of making those legible at a glance and trustworthy on inspection. Decoration that competes with the number loses.
2. **Severity is signal, not theater.** Reserve color, weight, and emphasis for real risk. When everything is loud, nothing is. A critical finding should stand out precisely because the rest of the interface is quiet.
3. **Legible to both desks.** Every primary surface must work for the analyst scanning for the next fix and the leader reading posture. Density serves the analyst; an unambiguous top line serves the leader. Neither audience should have to translate.
4. **Earned familiarity.** Use the conventions of best-in-class tools (Linear, Stripe, Notion-grade product UI) so the interface disappears into the task. Standard affordances, consistent component vocabulary screen to screen, no invented controls for standard jobs.
5. **Honest state.** The dashboard already runs in dry-run mode, keeps a last-known-good snapshot, and tracks scan freshness. The design must tell the truth about its data: what was scanned, when, whether it's sample or live, and what an empty or stale view actually means. Never imply confidence the data doesn't support.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**, holding the bar the codebase already sets:

- Body text at or above 4.5:1 against its background; large text at or above 3:1. The severity *text* tokens are deliberately darkened from the *fill* tokens to clear 4.5:1 on pale tints; keep that split.
- Visible focus indicators on every interactive element (the focus-ring rules are a11y-critical and must never be removed).
- A `prefers-reduced-motion` alternative for every animation.
- **Non-color signals are mandatory** for severity and status. Color alone never carries meaning; pair it with a dot, glyph, label, or position. The red/orange/amber severity proximity is a known colorblind risk, so the redundant cues are load-bearing, not decorative.
