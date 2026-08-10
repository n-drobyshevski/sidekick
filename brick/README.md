# `brick/` — vulnerability metrics on Databricks

A small Spark pipeline that pulls Wiz vulnerability findings into Delta and computes four
metric families as query-able gold tables:

| Metric | Question it answers | Formula |
| --- | --- | --- |
| **MTTR / SLA** | How fast are we closing risk? | `resolved_at − first_detected_at`, in days; in-SLA is `mttr_days <= target` |
| **Coverage** | Of all high-risk vulnerabilities, what share did we remediate? | `TP / (TP + FN)` |
| **Efficiency** | Of everything we remediated, what share was actually high-risk? | `TP / (TP + FP)` |
| **Capacity** | Can we close faster than risk arrives? | monthly `closed / open_at_start`, and `closed − opened` |

Coverage and efficiency come from the Cisco Kenna / Cyentia *Prioritization to Prediction*
series. They are in direct tension — v2's industry baseline is 70% coverage at 18.5%
efficiency — so the pipeline always emits both, never one alone.

This is a third surface over the same register as the Streamlit app and the Apps Script
rebuild, not a replacement for either. The formulas are ported from
`wiz_dashboard/domain/metrics.py` (MTTR/SLA) and `gas/src/domain/program.ts` (the P2P family);
those remain the reference implementations.

## Layout

```
config.py        constants mirrored from wiz_dashboard/config.py + the risk rule
ingest.py        Wiz OAuth + paginated GraphQL -> raw finding dicts
metrics.py       pure PySpark DataFrame -> DataFrame transforms (no I/O)
run_pipeline.py  the Databricks entry point: bronze -> silver -> three gold tables
tests/           local-SparkSession tests, oracles ported from the existing suites
```

`brick/` never imports `wiz_dashboard` — a Spark cluster has neither that package nor
Streamlit. The shared constants are duplicated on purpose; `config.py` names its sources.

## Tables

All appended, never overwritten. Every row carries `scan_id` / `scan_ts`, so repeated runs
accumulate into a trend instead of clobbering the last one.

| Table | Grain | Contents |
| --- | --- | --- |
| `…wiz_os_findings_raw` | scan × finding | bronze: `node_json` as a string |
| `…wiz_os_findings` | scan × finding | silver: typed columns, `mttr_days`, `age_days`, `risk_class` |
| `…wiz_os_metrics_mttr` | scan × severity (+ `OVERALL`) | MTTR mean/median, open counts, open-age p50/p90, SLA target and compliance |
| `…wiz_os_metrics_program` | scan × severity (+ `OVERALL`) | the confusion matrix, coverage and efficiency with bounds, prevalence, signal coverage |
| `…wiz_os_metrics_capacity` | scan × month | opened, closed, backlog at month start, MMCR, net flow, verdict |

Fully qualified as `<catalog>.<schema>.<prefix><name>`, where the prefix defaults to
`wiz_<scope>_`. Two reasons: these usually land in a schema shared with other teams, where a
bare `findings` or `metrics_capacity` would be a collision waiting to happen; and the scope in
the name keeps an OS run and an all-types run in separate tables. `--table_prefix` overrides it
(empty opts out entirely).

## Scope

`--scope` decides which population a run measures, and drives **both** the API filter and the
table names — one parameter, so a table can never disagree with what is inside it. Every row
also carries a `scope` column, so it stays self-describing after a `UNION`.

| Scope | Population |
| --- | --- |
| `os` (default) | OS-package CVEs on host workloads, with a vendor fix available. Parity with `os_vulns.VARIABLES["filterBy"]` — `detectionMethod: OS`, `assetType: VIRTUAL_MACHINE`, `hasFix`, `assetIsRepresentativeResource: false`, and the `openssl`/`python`/`vim` exclusions — so the numbers are comparable with the Streamlit dashboard's |
| `all` | Every detection method and asset type. Deliberately *not* a superset of `os`: it also drops `hasFix` and the exclusions, so it means "all findings", not "all findings filtered like the OS view" |

Both scopes request `status: ["OPEN", "RESOLVED"]`. That one is not about scoping — without it
the API returns only open findings, and every remediation metric collapses (coverage 0%,
efficiency undefined, MTTR empty) while still looking like a real result.

`os_vulns.py` also pins a `projectIdV2`. That is one tenant's project, so it is **not** copied
into the scope; pass `--project_id=<id>` if you want it.

Moving to all vulnerability types later is `--scope=all`, which writes a parallel
`wiz_all_*` set. The two never mix, and comparing them is a `UNION` on the `scope` column.

Bronze keeps the finding as a JSON string so a Wiz schema change can never fail ingest;
silver is just the typed projection of whatever arrived.

## Running it on Databricks

**Requirements:** DBR 14.3 LTS or newer (Spark 3.5 — `F.percentile` is a 3.5 function), and
Unity Catalog if you want a three-level `catalog.schema.table` namespace. `requests` is already
on the runtime. Nothing else to install.

### 1. Store the credentials

Once per workspace, from the Databricks CLI:

```bash
databricks secrets create-scope wiz
databricks secrets put-secret wiz wiz-client-id
databricks secrets put-secret wiz wiz-client-secret
```

The service account needs the `read:vulnerabilities` scope in Wiz. Credentials are only ever
read through `dbutils.secrets`; nothing is inlined, and the values never reach a table or a log.

**Pick the catalog deliberately.** These tables map unpatched CVEs to named hosts, so they
belong somewhere with grants to match. `catalog` has no default for exactly this reason: the
job fails rather than guessing. Restrict the schema once it exists:

```sql
GRANT USE SCHEMA, SELECT ON SCHEMA <your-catalog>.<your-schema> TO `security-analysts`;
```

**Privileges the job needs.** `USE CATALOG` on the catalog, `USE SCHEMA` + `CREATE TABLE` on
the schema, and `MODIFY`/`SELECT` on its own tables. It needs `CREATE SCHEMA` on the catalog
**only** when the schema does not yet exist — `ensure_schema` checks first rather than issuing
an unconditional `CREATE SCHEMA IF NOT EXISTS`, which would otherwise fail with
PERMISSION_DENIED against a schema that already exists and is perfectly writable. In a shared
organisation catalog, have a platform admin create the schema once and grant `CREATE TABLE` on
it; the job then never needs catalog-level rights.

### 2. Get the code onto the workspace

Add the repo as a **Git folder** (Workspace → Create → Git folder) pointing at this repository.
That gives you `/Workspace/Users/<you>/sidekick/brick/...`.

### 3a. From a notebook

Create a notebook anywhere and point it at the repo root — the repo root, not `brick/`, since
the package is imported as `brick.*`:

```python
import sys
sys.path.append("/Workspace/Users/<you>/sidekick")   # adjust to your Git folder path

dbutils.widgets.text("catalog", "")            # required -- see "Pick the catalog" above
dbutils.widgets.text("schema", "wiz")
dbutils.widgets.text("wiz_api_url", "https://api.<region>.app.wiz.io/graphql")
dbutils.widgets.text("secret_scope", "wiz")
dbutils.widgets.text("severities", "CRITICAL,HIGH")
dbutils.widgets.text("scope", "os")            # "all" for every vulnerability type

from brick.run_pipeline import main
main()
```

`<region>` is the one in your Wiz tenant URL (`us1`, `eu2`, …). Get it wrong and auth succeeds
but the GraphQL POST 404s.

### 3b. As a scheduled Job

A **Python file** task with the Git repo as its source, `brick/run_pipeline.py` as the path,
and the parameters passed as `--name=value`:

```json
{
  "name": "wiz-vulnerability-metrics",
  "schedule": { "quartz_cron_expression": "0 0 6 * * ?", "timezone_id": "UTC" },
  "git_source": {
    "git_url": "https://github.com/<org>/sidekick",
    "git_provider": "gitHub",
    "git_branch": "main"
  },
  "tasks": [
    {
      "task_key": "metrics",
      "spark_python_task": {
        "python_file": "brick/run_pipeline.py",
        "parameters": [
          "--catalog=<your-catalog>",
          "--schema=wiz",
          "--wiz_api_url=https://api.<region>.app.wiz.io/graphql",
          "--secret_scope=wiz",
          "--severities=CRITICAL,HIGH",
          "--scope=os"
        ]
      },
      "new_cluster": { "spark_version": "14.3.x-scala2.12", "num_workers": 2 }
    }
  ]
}
```

A single-node cluster is plenty — the driver does the API paging and the Spark work is a
handful of aggregations over one scan.

### Parameters

Resolved in this order: `--name=value` on the command line, then `dbutils.widgets.get(name)`,
then the `NAME` environment variable, then the default. One code path covers Jobs, notebooks
and a laptop.

| Name | Default | |
| --- | --- | --- |
| `catalog` | — | **required**, no default; `hive_metastore` on a workspace without Unity Catalog |
| `schema` | `wiz` | created only if it does not already exist |
| `scope` | `os` | `os` or `all` — see [Scope](#scope) |
| `table_prefix` | `wiz_<scope>_` | pass empty to use bare table names |
| `project_id` | — | optional `projectIdV2` restriction |
| `wiz_api_url` | — | **required**, `https://api.<region>.app.wiz.io/graphql` |
| `wiz_auth_url` | `https://auth.app.wiz.io/oauth/token` | override for a dedicated tenant |
| `secret_scope` | — | scope holding `wiz-client-id` / `wiz-client-secret` |
| `severities` | `CRITICAL,HIGH` | comma-separated |

### 4. Read the results

```sql
SELECT severity, coverage_pct, efficiency_pct, prevalence_pct, signal_coverage_pct
FROM   <catalog>.<schema>.wiz_os_metrics_program
WHERE  scan_id = (
  SELECT max_by(scan_id, scan_ts) FROM <catalog>.<schema>.wiz_os_metrics_program
)
ORDER BY severity;
```

Once both scopes are running, compare them on the `scope` column:

```sql
SELECT scope, coverage_pct, efficiency_pct
FROM   <catalog>.<schema>.wiz_os_metrics_program  WHERE severity = 'OVERALL'
UNION ALL
SELECT scope, coverage_pct, efficiency_pct
FROM   <catalog>.<schema>.wiz_all_metrics_program WHERE severity = 'OVERALL';
```

Start with `--severities=CRITICAL` on the first run: it is the fastest way to confirm the
tables land before pulling the whole register.

## Running it locally

```bash
pip install -r brick/requirements.txt
export WIZ_CLIENT_ID=... WIZ_CLIENT_SECRET=...
python brick/run_pipeline.py \
  --catalog=hive_metastore --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

Off Databricks the `dbutils` accessors return empty rather than raising, so credentials come
from the environment. Note that `saveAsTable` against a three-level `catalog.schema.table`
name needs Unity Catalog — a local Spark can only write two-level names.

## Tests

```bash
pip install -r brick/requirements.txt
pytest brick/tests -q
```

They spin up a local `SparkSession`; the module skips cleanly if pyspark isn't installed. The
root `pyproject.toml` deliberately does **not** collect `brick/tests` — the main suite must not
start depending on Spark.

The oracles are ported, not invented:

- the confusion-matrix block is the hand-counted 12-lifecycle register from
  `gas/test/program.test.ts` (TP=3, FP=3, FN=2, TN=2, one unclassified on each side →
  coverage 60%, efficiency 50%);
- the MTTR block is the `resolved_sample` case from `tests/test_metrics.py` (7.0 days median,
  100% in SLA against a 14-day HIGH target);
- one test replays the committed `os_vulns_response_exemple.json` end to end, so the real Wiz
  response shape is covered without a network call.

## Three things that are easy to get wrong

**`null` is not `false`.** `has_kev`, `has_exploit` and `epss` stay nullable the whole way
through. A NULL means the signal was *never captured*, which is not the same as observed-absent.
Coercing it to `false` inflates efficiency's numerator and deflates coverage's — both at once,
and silently. Unclassified findings therefore leave *both* sides of every rate, are counted in
their own row, and drive the published `_lo` / `_hi` bounds, whose width is the size of the
doubt. There is a regression test for exactly this.

**Empty denominators are NULL, not 0.** A rate over an empty population is unknown, and 0%
coverage is indistinguishable from "no high-risk findings" to a reader.

**Exact percentiles.** `metrics.py` uses `F.percentile`, which interpolates linearly the same
way pandas' `.median()` / `.quantile(0.9)` do. `percentile_approx` would quietly disagree with
the dashboard.

## What v1 does not do

- **No cross-scan lifecycle tracking.** Metrics come from one snapshot's `firstDetectedAt` /
  `resolvedAt`, exactly like `metrics.calculate_mttr`. So a vulnerability remediated by simply
  *disappearing* between scans is never counted as resolved, and MTTR is understated wherever
  Wiz doesn't set `resolvedAt`. This is what `wiz_dashboard/domain/lifecycle.py` and the ledger
  exist to fix; a Delta `MERGE` on a `vuln_key` is the natural v2.
- The capacity table has no `reconstructed` flag and no per-scan `resolved_count` cross-check —
  both need scan history the snapshot path doesn't keep.
- No actionable clock (`fix_available_at` / `mttr_actionable_days`), no domain triage, no
  Kaplan–Meier survival curves, no rule-sensitivity sweep. All of those exist on the GAS side.
