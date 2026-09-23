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

`gas/` is the reference implementation of the register domain now — the Python
domain layer (`wiz_dashboard/`) that used to be its behavioral spec has been
deleted, and `gas/test/` verifies its own domain ports with vitest snapshots
(regenerate them with `vitest -u` after a deliberate domain change, reading the
diff carefully). The root Python that remains is `os_vulns.py` — the Wiz
GraphQL query and client spec — plus its tests: `gas/test/extract_query.py`
generates `gas/src/server/wizQuery.ts` from its `QUERY`/`VARIABLES`, and
`tests/test_client.py` is the behavioral spec behind `gas/src/server/wizClient.ts`.

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
- After changing a GAS domain port covered by fixture-parity vitest snapshots,
  regenerate them with `vitest -u` and read the diff carefully before committing

## Working discipline

- Fix the root cause rather than papering over symptoms.
- Keep changes scoped to the app/package the user asked about.
- Do not touch `os_vulns.py` or its tests casually; it is the live spec behind
  the generated `wizQuery.ts` and `wizClient.ts`.
- Never regenerate golden fixtures or vitest snapshots without reading the diff
  carefully.
- Commit locally; do not push or open a PR unless asked.
- In `gas/`, a deploy no longer invalidates the read-model cache (keys carry
  `serverCache.CACHE_EPOCH`, not the build id). When you change what a cached
  read-model returns — its shape or its meaning — bump that model's namespace
  suffix (`mttr12` → `mttr13`); `test/cacheNamespaces.test.ts` requires every
  namespace to carry one.
- `gas_devsecops/` follows the same rule: keys carry `serverCache.CACHE_EPOCH`, not the build
  id, so a changed read-model bumps its own namespace (`dsMttr4` → `dsMttr5`) and
  `test/cacheNamespaces.test.ts` there requires a version on every one. Bump `CACHE_EPOCH` only
  for a change that alters many payloads at once.

## Design context

For UI work, read the active app's documentation (`README.md`, `DESIGN.md`, and
any app-local docs) before changing styles or components. Do not assume old root
UI constraints still apply.
