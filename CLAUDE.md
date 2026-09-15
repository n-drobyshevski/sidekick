# CLAUDE.md

Guidance for agents working in this repository.

## What this is

This repository's maintained product surfaces are the Google Apps Script apps:

- `gas/` — OS vulnerability register
- `gas_ai/` — AI security register
- `gas_devsecops/` — code register for SAST / SCA / secrets
- `gas_hub/` — launcher for the sibling GAS apps
- `gas_shared/` — shared component and style system used by those apps

The legacy root dashboard has been removed.

The root Python code that remains is still important: `wiz_dashboard/domain/`
and related `wiz_dashboard/{data,models}` modules act as the behavioral spec and
fixture-export source for parts of the GAS rebuild, especially `gas/`. Treat
that Python domain layer as maintained shared logic, not dead code.

`brick/` is the PySpark + Delta pipeline over the same registers, one tree for
the three scopes `os`, `sca` and `sast`. Every scope writes the same three tables
— `wiz_findings_raw` (bronze), `wiz_vuln_ledger` (`MERGE`d, keyed on
`(vuln_key, scope)`) and `wiz_metrics` (the commit record and every gold family,
told apart by a `family` column) — and `scope` is a column in every one of them.
`devlake/` at the repo root is the dev-only harness that runs it on a laptop; it
is never deployed. The measured traps of that pipeline (the resumable gold
write, the scope filters and what each one costs, the chained scan job) live in
`brick/docs/` — `register.md`, `deploy.md`, `migrating.md`, `storage.md`,
`notebooks.md`, `reading-the-numbers.md` and `internals.md`, mapped from
`brick/README.md`.

## Root Python usage

The root Python environment is for shared domain/spec code and tests, not a local
web UI. The top-level `pytest` suite should remain focused on non-UI logic.

## Testing

- Root Python: `pytest`
- GAS apps: app-local `npm run check` per package, as documented in each app
- After changing the Python behavioral spec used by GAS fixture export, regenerate
  affected fixtures and run the relevant GAS checks

## Working discipline

- Fix the root cause rather than papering over symptoms.
- Keep changes scoped to the app/package the user asked about.
- Do not remove or rewrite the Python domain/spec layer just because the old UI is
  gone; parts of the GAS system still depend on it.
- Never regenerate golden fixtures without reading the diff carefully.
- Commit locally; do not push or open a PR unless asked.

## Design context

For UI work, read the active app's documentation (`README.md`, `DESIGN.md`, and
any app-local docs) before changing styles or components. Do not assume old root
UI constraints still apply.
