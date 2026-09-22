# Wiz registers

This repository's maintained product surfaces are the Google Apps Script apps.
`gas/` is the reference implementation of the register domain; its own
`gas/test/` verifies domain ports with vitest snapshots.

## Active apps

- `gas/` — OS vulnerability register
- `gas_ai/` — AI security register
- `gas_devsecops/` — DevSecOps register
- `gas_hub/` — launcher for the sibling apps
- `gas_shared/` — shared UI system used by the GAS apps

## Python code that remains

- `os_vulns.py` — the Wiz GraphQL query and client spec; `gas/test/extract_query.py`
  generates `gas/src/server/wizQuery.ts` from it, and `tests/test_client.py` is the
  behavioral spec behind `gas/src/server/wizClient.ts`
- `brick/` — the Databricks/Delta pipeline over the same registers (scopes `os`, `sca`, `sast`)
- `devlake/` — local harness for the `brick/` pipeline

## Root Python setup

The root Python environment is for `os_vulns.py` and its tests, not for a
local web app.

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pytest
```

## Repository guidance

For app-specific setup and validation, use the docs in each active app:

- `gas/README.md`
- `gas_ai/README.md`
- `gas_devsecops/README.md`
- `gas_hub/README.md`
- `gas_shared/README.md`
