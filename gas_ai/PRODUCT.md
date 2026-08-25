# Product

## Register

product

## Users

Two desks share this dashboard, and the design has to serve both without forcing either to compromise:

- **Security analysts / SecOps** are the daily, hands-on users. They triage the AI estate: which agent is over-privileged, which model reaches sensitive data without a guardrail, which toxic combination is live right now. They decide what to remediate first and track whether fixes are landing. They want density, fast scanning, and the ability to drill into a single asset or issue without losing context.
- **Security leadership** check in less often and stay higher up. They read posture: how much of the AI estate is actually covered by scanning, how the risk score is distributed, whether compliance frameworks are passing. They need the top-line numbers to be unambiguous and defensible.

The common thread: both arrive with a question about risk and want an answer they can act on or report on, not a data dump to interpret.

## Product Purpose

A Google Apps Script dashboard over Wiz's security graph, scoped to the **AI estate**: agents, models, guardrails, MCP servers, and the identities, data and compute behind them. It pulls from a Wiz service account (or bundled sample data in dry-run mode), stores the register in a Google Sheet with gzipped Drive archives, and turns it into the views a security org operates on.

The primary lenses:

- **Priorities** — every unresolved issue and every open configuration finding, ranked together on one scale. The queue the model exists to order.
- **AARS** — the AI Asset Risk Score, and the editable scoring model behind it.
- **The security graph** — a depth-limited node graph asked for with a query, with toxic combinations highlighted.
- **Coverage** — what the pipeline actually touched, stated honestly, including what it could not reach.

The product exists to answer "what in the AI estate should I fix next, and how much of it are we actually watching" with numbers a team can trust enough to act on and stake a report on. Success is when an analyst opens it and knows what to fix next within seconds, and a leader opens it and can state the estate's posture without asking anyone.

This is a sibling of the OS-vulnerability tool in `gas/`. The severity palette is deliberately identical across both so a severity means the same thing in either; the brand accent deliberately is not.

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

1. **The number is the product.** The headline figures (the AARS score and its band, posture tier, open problems, coverage percentage) are what users come for. Lay out everything else in service of making those legible at a glance and trustworthy on inspection. Decoration that competes with the number loses.
2. **Severity is signal, not theater.** Reserve color, weight, and emphasis for real risk. When everything is loud, nothing is. A critical finding should stand out precisely because the rest of the interface is quiet.
3. **Legible to both desks.** Every primary surface must work for the analyst scanning for the next fix and the leader reading posture. Density serves the analyst; an unambiguous top line serves the leader. Neither audience should have to translate.
4. **Earned familiarity.** Use the conventions of best-in-class tools (Linear, Stripe, Notion-grade product UI) so the interface disappears into the task. Standard affordances, consistent component vocabulary screen to screen, no invented controls for standard jobs.
5. **Honest state.** The dashboard runs in dry-run mode without credentials, keeps a last-known-good snapshot, and tracks scan freshness. The design must tell the truth about its data: what was scanned, when, whether it's sample or live, and what an empty or stale view actually means. Never imply confidence the data doesn't support.

### A sixth, specific to this register

6. **Absent is never zero.** Wiz returns `null` for a flag it never evaluated. Collapsing that to `false` is what once made an unassessed asset render as a clean Tier 1. Measured, unmeasured and not-applicable are three different states and the interface must show three different things. An empty section says so in a sentence rather than disappearing, because a section that vanishes reads identically to "we checked and it was clean."

## Accessibility & Inclusion

Target **WCAG 2.1 AA**, holding the bar the codebase already sets:

- Body text at or above 4.5:1 against its background; large text at or above 3:1. The severity *text* tokens are deliberately darkened from the *fill* tokens to clear 4.5:1 on pale tints; keep that split.
- Visible focus indicators on every interactive element (the focus-ring rules are a11y-critical and must never be removed). Five of them are non-standard and each carries a written reason; read the reason before touching one.
- A `prefers-reduced-motion` alternative for every animation.
- **Non-color signals are mandatory** for severity and status. Color alone never carries meaning; pair it with a dot, glyph, label, or position. The red/orange/amber severity proximity is a known colorblind risk, so the redundant cues are load-bearing, not decorative.
- The interface must survive `forced-colors: active`. Shadows and backgrounds are discarded there, so any indicator built from a shadow needs a real border or outline fallback.
