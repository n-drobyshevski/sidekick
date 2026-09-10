# Wiz registers

This repository's maintained product surfaces are the Google Apps Script apps
and the shared Python domain/spec code they are tested against.

## Active apps

- `gas/` — OS vulnerability register
- `gas_ai/` — AI security register
- `gas_devsecops/` — DevSecOps register
- `gas_hub/` — launcher for the sibling apps
- `gas_shared/` — shared UI system used by the GAS apps

## Python code that remains

The root Python package is still used as domain/spec infrastructure:

- `wiz_dashboard/domain/` — Python behavioral spec and analytics logic
- `wiz_dashboard/data/` — supporting data transforms, cache, history, and ledger helpers
- `wiz_dashboard/models/` — schema/model helpers
- `brick/` and `brick/devsecops/` — Databricks/Delta pipelines over the same registers
- `devlake/` — local harness for the `brick/*` pipelines

Do not remove the remaining Python domain layer without also updating the GAS
fixture export flow and related tests. As documented in `CLAUDE.md`, the GAS
ports use the Python domain layer as a behavioral spec.

## Root Python setup

The root Python environment is for the shared/spec code and tests, not for a
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
