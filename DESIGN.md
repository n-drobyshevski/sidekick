# Wiz register design system

The maintained UI surfaces in this repository are the Google Apps Script apps:

- `gas/`
- `gas_ai/`
- `gas_devsecops/`
- `gas_hub/`
- `gas_shared/`

Use each app's local `README.md`, `DESIGN.md`, and implementation docs as the
source of truth for visual and interaction design.

## Shared direction

The register family should feel like an audit ledger: exact, restrained, and
credible. Use neutral surfaces, hairline borders, tabular figures, accessible
status language, and saturated color only where it carries meaning such as
severity, state, or SLA verdict.

## Working rules

- Keep the field neutral by default.
- Pair every severity or status color with a text, icon, dot, or shape cue.
- Use tabular numerals for changing counts, durations, percentages, and table
  figures.
- Prefer shared primitives from `gas_shared/` over per-app rebuilds.
- Keep app-specific design rules near the app that implements them.
