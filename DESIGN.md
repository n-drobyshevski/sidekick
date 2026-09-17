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
- A tip card is a definition, not a paragraph. See below.

## Tip copy

The hover card (`gas_shared/ui/tip.js`) is the family's one answer to "what does
this mean", and it is 300px wide at 12px — about 45 characters to a rendered row.
Copy written to fill it reads as a wall, which is the opposite of an instrument.

- **Line one is the definition**: what the thing is, at or under 110 characters
  (~15 words). A reader takes it at a glance without stopping to parse.
- **Line two is the consequence**, where there is one worth the row: the
  operational reading, at or under 90 characters. It is optional, not a slot to
  fill.
- **A card totals ~150 characters and never exceeds 200.** Past that it is a
  popover wearing a tooltip.
- **Everything else is a Help line.** `glossaryTipLines` paints only the first
  two lines of a book entry; `ui/helpPage.js` renders them all. So the third line
  is where a displaced sentence goes — prose comes off a card by moving down, not
  by being deleted.

This applies to inline `help: { lines: [...] }` at call sites exactly as it does
to the books, and the call sites are the part no test reaches. Each register's
`test/helpContent.test.js` pins its own book with `MAX_TIP_LINE_LENGTH`.

The vocabulary itself stays per-app (`gas_shared/README.md`: only the *shape* of a
definition is shared). Where two registers define the same id with the same words,
keep the words the same in both books rather than moving them into `gas_shared`.
