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

`brick/` (OS vulnerabilities, scopes `os`/`all`) and `brick/devsecops/`
(`sca`/`sast`) are the PySpark + Delta surface over the same registers: bronze
→ silver → a `MERGE`d ledger → the `scans` commit row → gold tables. They are
deliberate FORKS with identical module names and exactly one may be on
`sys.path`. `devlake/` at the repo root is the dev-only harness that runs either
of them on a laptop; it is never deployed.

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
