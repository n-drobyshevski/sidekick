# `brick/` — vulnerability metrics on Databricks

A small Spark pipeline that pulls Wiz vulnerability findings into Delta and computes four
metric families as query-able gold tables:

| Metric | Question it answers | Formula |
| --- | --- | --- |
| **MTTR / SLA** | How fast are we closing risk? | Kaplan–Meier median over `resolved_at − first_detected_at`, counting still-open findings as right-censored; in-SLA is `mttr_days <= target` |
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
config.py         constants mirrored from wiz_dashboard/config.py + the risk rule and scopes
dbx.py            reaching dbutils from inside a module, and doing without it off-cluster
ingest.py         Wiz OAuth + paginated GraphQL -> raw finding dicts
metrics.py        pure PySpark DataFrame -> DataFrame transforms (no I/O)
charts.py         matplotlib figures over the gold tables (notebook only)
dashboard.py      generates the AI/BI dashboard document (no Spark, no I/O)
dashboard_cli.py  writes that document to a file, or imports it to the workspace
run_pipeline.py   the Databricks entry point: bronze -> silver -> three gold tables
tests/            local-SparkSession tests, oracles ported from the existing suites
```

**These are plain top-level modules, not a package.** There is no `__init__.py`, and they
import each other by bare name (`import metrics`, `from config import …`). Whatever directory
holds them goes on `sys.path`. That is what lets the Databricks side be a single flat folder of
files, with no nesting to reproduce by hand and no package prefix to keep in sync.

The consequence to know about: `config`, `metrics` and `ingest` are generic module names. Put
the directory **first** on `sys.path` (`sys.path.insert(0, …)`, not `append`) so a same-named
module elsewhere on the path cannot win — that would fail as a confusing `AttributeError`
rather than an import error.

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
| `os` (default) | OS-package CVEs on host workloads. Parity with `os_vulns.VARIABLES["filterBy"]` — `detectionMethod: OS`, `assetType: VIRTUAL_MACHINE`, `assetIsRepresentativeResource: false`, and the `openssl`/`python`/`vim` exclusions — so the numbers are comparable with the Streamlit dashboard's |
| `all` | Every detection method and asset type: container SBOM, code libraries, OS, the lot |

Both scopes share `status: ["OPEN", "RESOLVED"]` and `hasFix: true`, and neither is about
scoping:

- **`status`** — without it the API returns only open findings, and every remediation metric
  collapses (coverage 0%, efficiency undefined, MTTR empty) while still looking like a real
  result.
- **`hasFix`** — restricts both scopes to findings a team could actually have remediated, so
  remediation rates mean the same thing in each. Otherwise awaiting-vendor-fix findings would
  sit in `all`'s coverage denominator and not in `os`'s, and `all` would look worse for a
  reason that is not performance.

What still differs beyond the type and asset restriction: the `openssl`/`python`/`vim`
exclusions and the representative-resource filter are OS-view policy and are not applied to
`all`, so `all` counts a few things `os` deliberately drops.

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

Only the five `.py` modules are needed at runtime — skip `tests/`, `README.md` and
`requirements.txt`, and note `requests` is already on the runtime. Put them all in **one flat
folder**, created as **Files**, not Notebooks (a notebook is not importable as a module, and
this is the most common way the setup goes wrong):

```
/Workspace/Users/<you>/wiz-metrics/       ← this path goes on sys.path
├── config.py
├── dbx.py
├── ingest.py
├── metrics.py
└── run_pipeline.py
```

Three ways to get them there, all ending in the same place:

- **Git folder** — Workspace → Create → Git folder against this repo. Then the path above is
  `/Workspace/Users/<you>/sidekick/brick`. The only option that tells you when your copy is
  stale.
- **CLI** — `databricks workspace import-dir ./brick /Workspace/Users/<you>/wiz-metrics`
  (add `--overwrite` to refresh). Copies `tests/` too, harmlessly.
- **UI** — create the folder, then Create → File once per module and paste. Or zip the five
  files and use Import on the folder.

### 3a. From a notebook

```python
import sys
sys.path.insert(0, "/Workspace/Users/<you>/wiz-metrics")   # insert, not append -- see Layout

dbutils.widgets.text("catalog", "")            # required -- see "Pick the catalog" above
dbutils.widgets.text("schema", "wiz")
dbutils.widgets.text("wiz_api_url", "https://api.<region>.app.wiz.io/graphql")
dbutils.widgets.text("secret_scope", "wiz")
dbutils.widgets.text("severities", "CRITICAL,HIGH")
dbutils.widgets.text("scope", "os")            # "all" for every vulnerability type

from run_pipeline import main
main()
```

Editing a module and re-running the cell changes nothing — Python caches imports. Run
`dbutils.library.restartPython()` after every edit.

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

The run itself prints all three families — MTTR and SLA by severity, coverage and efficiency,
and the most recent capacity months.

### Charts

`main()` returns what it wrote, so charting is a follow-on cell:

```python
result = main()

import charts
charts.render_all(spark, result.tables)     # figures display as the cell output
```

Three figures: median MTTR against each severity's SLA target, the p50–p90 age span of the
open backlog, and coverage against efficiency with the unclassified-uncertainty bounds drawn
as error bars and the prevalence baseline marked.

`charts.load(spark, tables, scan_id=...)` reads a specific run; it defaults to the latest,
because the gold tables are appended and an unfiltered read would blend every run into one
picture. `run_pipeline` never imports `charts`, so a scheduled Job does not build figures
nobody will look at.

Two conventions the figures keep, both load-bearing:

- **A NULL is drawn as an annotated gap, never a zero bar.** "No resolved findings yet" and
  "closed instantly" must not look the same.
- **Severity is never carried by colour alone.** The shared palette is a heat ramp, and it
  fails a categorical colourblind check — HIGH `#ea580c` and MEDIUM `#d97706` sit ΔE 1.6 apart
  under deuteranopia and 6.7 apart with normal vision. Every mark is named by an axis tick or
  a point label; colour is redundant coding on top. Do not add a chart that needs the reader
  to tell those two hues apart.

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

## Dashboard

For reading the numbers rather than iterating on them — an overview page you scan first, and
two detail pages you open when something looks wrong. Cross-filtering does the navigation:
click a severity in any chart and every other widget on the same dataset re-filters.

| Page | |
| --- | --- |
| **Overview** | Six counter tiles — KM median MTTR, in-SLA %, coverage, efficiency, prevalence, signal coverage — plus MTTR and coverage by severity, and the MTTR trend across scans. Answers "how are we doing" and nothing else |
| **Remediation speed** | Severity filter, KM median against SLA target, p90 open age, the full per-severity table, and the same broken down by subscription |
| **Programme** | Coverage and efficiency by severity with their uncertainty bounds and the prevalence baseline, capacity by month, and where the high-risk findings live by subscription |

**Prerequisite:** AI/BI dashboards run on a SQL warehouse, not on your cluster. The viewer needs
`SELECT` on the gold tables.

```bash
python brick/dashboard_cli.py \
  --catalog=<catalog> --schema=<schema> --scope=os      # writes wiz_os_metrics.lvdash.json

databricks workspace import --format AUTO \
  --file wiz_os_metrics.lvdash.json "/Users/<you>/Wiz metrics.lvdash.json"
```

The path **must** end in `.lvdash.json` — with `format=AUTO` that suffix is what makes Databricks
recognise the upload as a dashboard rather than an inert JSON file. `--workspace_path` will do
the import over the REST API instead (using `DATABRICKS_HOST` / `DATABRICKS_TOKEN`), but the CLI
above is the documented route and the one to reach for.

### Why it is generated rather than committed as a file

Partly because the dataset SQL has to name your `catalog.schema.prefix` tables, which are run
parameters. Mostly because **the `.lvdash.json` format is not publicly documented** — Databricks'
own guidance is "export one of your own dashboards to learn the serialization". The schema in
`dashboard.py` was reconstructed from two real exported dashboards, so it is evidence-based, but
nothing in this repo can import one.

Generating it turns most of that risk into ordinary tests. `tests/test_dashboard.py` checks the
things that would make an import fail or display wrongly: every widget resolves to a defined
dataset, every encoded field exists in that widget's query *and* in the SQL's actual output, no
two widgets overlap, everything fits the six-column grid, ids are unique, generation is
deterministic, and the document is valid JSON with no NaN. Each dataset query is executed against
real pipeline output, so a column typo fails locally instead of on the warehouse.

Those guards were mutation-tested — an introduced overlap, a SQL column typo, and a severity
colour without a severity label each fail the suite.

**What none of it proves is that Databricks accepts the document.** The first import is the test.
If it is rejected, the error names the offending widget; fix the helper in `dashboard.py` rather
than hand-editing the JSON, or the next regeneration overwrites you.

## MTTR is Kaplan–Meier, not a mean of what closed

Averaging `mttr_days` over resolved findings is survivorship bias with a respectable name. The
findings that take longest are disproportionately the ones *still open*, so excluding them makes
remediation look faster than it is — and the gap widens exactly when a programme is falling
behind, which is when you least want a flattering number.

`metrics.kaplan_meier` (ported from `gas/src/domain/remediation.ts::kaplanMeier`) keeps those
findings in the risk set as **right-censored** observations: "not closed yet" is evidence, just
not the same evidence as "closed on day 40". Columns on `…metrics_mttr`:

| Column | |
| --- | --- |
| `km_median` | the headline. Smallest time where survival falls to ≤ 50% |
| `km_median_lower_bound` | set **only** when `km_median` is NULL, i.e. more than half of that severity is still open and the median does not exist yet. Report it as "> N d" rather than inventing a number |
| `km_rmst` | restricted mean survival time — area under the curve out to the longest observed time |
| `km_truncated` | survival never reached zero, so `km_rmst` is a floor rather than a mean |
| `km_events` / `km_censored` | how much of the estimate rests on closures vs. still-open findings |
| `mttr_mean` / `mttr_median` | the naive closed-only figures, kept for comparison with the Streamlit dashboard — the gap against `km_median` *is* the bias |

On the committed fixture the two differ by about 18%: naive 18.1d against a KM median of 21.3d.

Two implementation notes, both of which cost a wrong answer before they were caught:

- Survival is a running product and Spark has no product aggregate. `exp(Σ log f)` is the usual
  substitute, but `log(0)` is NULL in Spark and `sum()` skips NULLs, so a step that resolves the
  entire remaining risk set would be ignored and survival would stay positive after everything
  had closed. A sticky zero flag handles it.
- The median crossing is inclusive, and an exact tie is the *common* case — `0.75 × (1 − 1/3)` is
  exactly 0.5 in IEEE. The `exp(Σ log f)` form returns `0.5000000000000001` for that same curve,
  which fails a bare `<= 0.5` and reports "no median" for a register whose median is real. Hence
  the tolerance in `SURVIVAL_TIE_EPS`.

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
