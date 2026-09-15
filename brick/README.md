# `brick/` — vulnerability and code-security metrics on Databricks

A small Spark pipeline that pulls Wiz findings — OS-package CVEs on host workloads, CVEs in the
libraries a repository depends on, and static-analysis weaknesses in first-party code — into
Delta, tracks each finding's lifecycle across scans in a persistent ledger, and computes metrics
as query-able gold tables:

**Deploying it?** [`docs/deploy.md`](docs/deploy.md) is the procedure, and the one place it goes
wrong — its *"2. Get the code onto the workspace"* is the step every `see brick/README.md` in the
modules and in the notebook boot cells is pointing at.

| Metric | Question it answers | Formula |
| --- | --- | --- |
| **MTTR / SLA** | How fast are we closing risk? | Kaplan–Meier median over `resolved_at − first_seen`, counting still-open findings as right-censored; in-SLA is `mttr_days <= target` |
| **Coverage** | Of all high-risk findings, what share did we remediate? | `TP / (TP + FN)` |
| **Efficiency** | Of everything we remediated, what share was actually high-risk? | `TP / (TP + FP)` |
| **Capacity** | Can we close faster than risk arrives? | monthly `closed / open_at_start`, and `closed − opened` |
| **Assets at risk** | Which repositories carry the backlog, which offer a foothold, which are falling behind? | P2P v5: per-repo density percentiles, foothold rate, coverage, half-life and net flow |

Coverage and efficiency come from the Cisco Kenna / Cyentia *Prioritization to Prediction*
series, which is the source of the **formulas**, not a benchmark these numbers can be read
against. They are in direct tension, so the pipeline always emits both, never one alone; assets
at risk is P2P volume 5's asset-centric family, written only for a scope whose findings resolve
to an asset the request can be narrowed to.
[`docs/reading-the-numbers.md`](docs/reading-the-numbers.md) is the page to read before quoting
either figure to anyone.

Those lifecycles are the difference between this and the pipeline's first version: metrics come
from what the register has been observed to do over time, not from whatever the latest snapshot
happens to say. See [The ledger, and why it exists](docs/internals.md#the-ledger-and-why-it-exists).

This is a second surface over the same registers as the Apps Script rebuilds, not a
replacement for them. `gas/` is the reference implementation for the
machinery every scope shares: the lifecycle rules are ported from `gas/src/domain/reconcile.ts`,
the P2P family from `gas/src/domain/program.ts`, and Kaplan–Meier from
`gas/src/domain/remediation.ts`. `gas_devsecops/` is the reference for what is genuinely only
here — its own filter-kind asymmetry table and its `awaiting_vendor_fix` scope guard are what
`config.OBJECT_FILTERS` and `config.HAS_VENDOR_FIX` below are checked against. Where GAS and the
older `wiz_dashboard/domain/` port disagree, GAS wins.

## The three tables

| Table | Grain | Contents |
| --- | --- | --- |
| `wiz_findings_raw` | scan × finding | bronze: `node_json` as a string, plus `seq` (API order) |
| **`wiz_vuln_ledger`** | **one row per `(scope, vuln_key)`** | **the durable base: `scope`, `first_seen`, `last_seen`, `status`, `resolved_at`, `resolution_src`, `reopened_count`, the fix clock and the exploit signals** |
| **`wiz_metrics`** | **wide, told apart by `family`** | **the commit record and every gold family, appended together** |

Every scope — `os`, `sca`, `sast` — writes this **same** set; there is no table per scope.
`scope` is part of the ledger's key rather than a label on it, and every read of the register
filters on it first. The legend for `family`, the two-population rule on `capacity` and
`assets`, and what each scope actually measures are in
[`docs/register.md`](docs/register.md).

## Running it

```bash
pip install -r brick/requirements.txt
SPARK_LOCAL_IP=127.0.0.1 python -m pytest brick/tests -q

export WIZ_CLIENT_ID=... WIZ_CLIENT_SECRET=...
python brick/run_pipeline.py --scope=os \
  --catalog=hive_metastore --wiz_api_url=https://api.<region>.app.wiz.io/graphql

databricks bundle deploy -t prod --var="catalog=<your-catalog>" \
  --var="wiz_api_url=https://api.<region>.app.wiz.io/graphql" \
  --var="node_type_id=<cloud-specific instance type>"
```

On a cluster this is six `.py` files in one flat folder and nothing else —
[`docs/deploy.md`](docs/deploy.md) is the procedure, and the one place it goes wrong.

## Where the rest is written down

| File | Who reads it | What is in it |
| --- | --- | --- |
| [`docs/register.md`](docs/register.md) | writing a query, or deciding what a scope measures | the three tables and their families, the scan record, table layout, the three scopes, the SAST rule, the two silver projections, assets at risk |
| [`docs/deploy.md`](docs/deploy.md) | the operator | credentials, getting the six modules onto the workspace, running from a notebook or as a bundle, parameters, retries, maintenance, reading the results |
| [`docs/migrating.md`](docs/migrating.md) | the operator, once | adopting an existing register, backfilling from bronze, importing the Apps Script app's data |
| [`docs/storage.md`](docs/storage.md) | no catalog, or a laptop | running locally, running against a local lake, path-based fallback storage, the legacy CSV register |
| [`docs/notebooks.md`](docs/notebooks.md) | the notebook analyst | the nine pages and the importer, the scan pin, which engine draws what, widgets |
| [`docs/reading-the-numbers.md`](docs/reading-the-numbers.md) | before quoting a number | coverage vs efficiency, Kaplan–Meier, the three easy mistakes, the actionable clock, what this does not do |
| [`docs/internals.md`](docs/internals.md) | the contributor | module layout, why the ledger exists, the test suite, benchmarking |

**This directory used to be two.** `brick/` measured only `os` and `brick/devsecops/` measured
`sca`/`sast` as a separate, self-contained copy of the same modules under the same names — a
real fork, deployable on its own, at the cost of the cross-scan reconciler and the P2P maths
existing twice. The two have since merged into this one tree, and with the second copy gone, so
is the rule that exactly one of them could be on `sys.path`. The trap that survives the merge is
narrower: a stale `sys.modules` entry left behind by an earlier import in the same long-lived
process, which `run_pipeline.check_deployment()` still catches before Spark starts.
