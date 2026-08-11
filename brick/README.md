# `brick/` — vulnerability metrics on Databricks

A small Spark pipeline that pulls Wiz vulnerability findings into Delta, tracks each
vulnerability's lifecycle across scans in a persistent ledger, and computes four metric families
as query-able gold tables:

| Metric | Question it answers | Formula |
| --- | --- | --- |
| **MTTR / SLA** | How fast are we closing risk? | Kaplan–Meier median over `resolved_at − first_seen`, counting still-open findings as right-censored; in-SLA is `mttr_days <= target` |
| **Coverage** | Of all high-risk vulnerabilities, what share did we remediate? | `TP / (TP + FN)` |
| **Efficiency** | Of everything we remediated, what share was actually high-risk? | `TP / (TP + FP)` |
| **Capacity** | Can we close faster than risk arrives? | monthly `closed / open_at_start`, and `closed − opened` |

Coverage and efficiency come from the Cisco Kenna / Cyentia *Prioritization to Prediction*
series. They are in direct tension, so the pipeline always emits both, never one alone — and
P2P is the source of the **formulas**, not a benchmark these numbers can be read against. See
[Reading coverage and efficiency](#reading-coverage-and-efficiency), which is the section to
read before quoting either figure to anyone.

Those lifecycles are the difference between this and the pipeline's first version: metrics come
from what the register has been observed to do over time, not from whatever the latest snapshot
happens to say. See [The ledger, and why v2 exists](#the-ledger-and-why-v2-exists).

This is a third surface over the same register as the Streamlit app and the Apps Script
rebuild, not a replacement for either. `gas/` is the most complete of the three and is the
reference implementation: the lifecycle rules are ported from `gas/src/domain/reconcile.ts`, the
P2P family from `gas/src/domain/program.ts`, and Kaplan–Meier from
`gas/src/domain/remediation.ts`. Where GAS and the older `wiz_dashboard/domain/` port disagree,
GAS wins.

## Layout

```
config.py         constants mirrored from wiz_dashboard/config.py + the risk rule and scopes
dbx.py            reaching dbutils from inside a module, and doing without it off-cluster
ingest.py         Wiz OAuth + paginated GraphQL -> raw finding dicts
ledger.py         pure PySpark cross-scan lifecycle reconciliation (no I/O)
metrics.py        pure PySpark DataFrame -> DataFrame transforms (no I/O)
charts.py         matplotlib figures over the gold tables (notebook only)
dashboard.py      generates the AI/BI dashboard document (no Spark, no I/O)
dashboard_cli.py  writes that document to a file, or imports it to the workspace
run_pipeline.py   the Databricks entry point: bronze -> silver -> ledger -> three gold tables
tests/            local-SparkSession tests, oracles ported from the existing suites
```

`ledger.py` and `metrics.py` are pure `DataFrame -> DataFrame`; `run_pipeline.py` is the only
module that does I/O. That is what lets the lifecycle rules — the part most likely to be wrong —
be tested against a local `SparkSession` with no Delta table, no cluster and no API in the way.

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

## The ledger, and why v2 exists

v1 measured each scan in isolation: a run pulled findings and computed everything from that one
snapshot's `firstDetectedAt` / `resolvedAt`. Runs accumulated as separate `scan_id`s, but nothing
reconciled one against the next.

That gets one thing badly wrong. **Wiz stops returning a finding once it is remediated, and often
never sets `resolvedAt`** — so remediation usually looks like a finding quietly disappearing. v1
could not see that at all. Those vulnerabilities stayed open forever: MTTR under-reported,
coverage under-reported, and the capacity table's `closed` column missed every such closure.

v2 gives each finding a durable identity (`vuln_key`) and a row in a **ledger** that survives
across runs — first seen, still here, gone. Metrics come from those observed lifecycles instead of
from a snapshot, so a vulnerability that vanishes is counted as resolved on the day it vanished.

The lifecycle rules are ported from `gas/src/domain/reconcile.ts`, which is the reference
implementation; `brick/tests/test_ledger.py` replays that module's own golden fixture
(`gas/test/fixtures/reconcile.json`) scenario by scenario, so the port is checked against the
standard rather than against itself.

| Rule | |
| --- | --- |
| First sighting | OPEN, `first_seen = min(firstDetectedAt, scan ts)` |
| Persisting | advance `last_seen`; `first_seen` stays earliest-known and never drifts later |
| API-resolved | `resolvedAt` present, or status in `RESOLVED_STATUSES` → `resolution_src = 'api'` |
| Disappearance | was OPEN, was in the previous scan covering its severity, absent now → `resolution_src = 'disappeared'` |
| Reopen | a RESOLVED finding is active again → OPEN, `reopened_count++`, a new episode |

A reopen "recomputes" `first_seen` rather than advancing it: it takes `min(firstDetectedAt, scan
ts)`, the same formula a first sighting uses, and deliberately ignores the value already on the
row. That breaks the earliest-known chain — the one place `first_seen` can move *later*. Note the
consequence: if Wiz still reports the original `firstDetectedAt`, the reopened episode inherits
that date rather than starting from the reopen. That is the reference implementation's behaviour
(`reconcile.ts:340`), and the surfaces have to agree.

Three different update disciplines coexist on a ledger row, and they are not interchangeable:

- **latest-observation-wins** — severity, CVE, asset attributes.
- **sticky first-wins, reset by a reopen** — the vendor-fix clock (`fix_date`, `fix_observed_at`).
- **monotone, never reset** — the exploit signals. `has_kev` / `has_exploit` go null → false →
  true and never back; `epss` keeps the **peak** ever observed. Exploit knowledge does not decay,
  and — because the gold tables are appended — a finding that silently left the high-risk
  population would leave last week's published coverage disagreeing with this week's for reasons
  unrelated to any remediation.

### Disappearance is an inference, and it is labelled as one

`resolution_src` records how each closure was learned, and `…metrics_mttr` publishes
`resolved_api` / `resolved_disappeared` per severity. A register whose closures are
overwhelmingly inferred is telling you something about the data source as much as about the
security programme — which you can only notice if the split is on the table.

`--disappearance` picks the date: `scan_ts` (default) is the scan that noticed the absence,
which overstates MTTR by at most one scan interval but never records a moment nobody observed;
`midpoint` halves that bias by inventing a timestamp between the two scans. On a daily job the
difference is under 24 hours.

## Tables

Everything except the ledger is appended, never overwritten. Every row carries `scan_id` /
`scan_ts`, so repeated runs accumulate into a trend instead of clobbering the last one. The
ledger is the exception: it is `MERGE`d, so a vulnerability keeps one row and one history no
matter how many times it is scanned.

| Table | Grain | Contents |
| --- | --- | --- |
| `…wiz_os_findings_raw` | scan × finding | bronze: `node_json` as a string, plus `seq` (API order) |
| `…wiz_os_findings` | scan × finding | silver: typed columns, `mttr_days`, `age_days`, `risk_class` |
| **`…wiz_os_vuln_ledger`** | **one row per `vuln_key`** | **the durable base: `first_seen`, `last_seen`, `status`, `resolved_at`, `resolution_src`, `reopened_count`, the fix clock and the exploit signals** |
| **`…wiz_os_scans`** | **one row per run** | **the run log: `scope`, `severities`, and the new/resolved/reopened deltas** |
| `…wiz_os_metrics_mttr` | scan × severity (+ `OVERALL`) | MTTR mean/median, open counts, open-age p50/p90, SLA target and compliance, the resolution-source split, and the `snap_*` snapshot comparison |
| `…wiz_os_metrics_program` | scan × severity (+ `OVERALL`) | the confusion matrix, coverage and efficiency with bounds, prevalence, signal coverage |
| `…wiz_os_metrics_capacity` | scan × month × **`population`** | opened, closed, backlog at month start, MMCR, net flow, verdict, `reconstructed`, `closed_observed` |
| `…wiz_os_metrics_sensitivity` | scan × signal subset | the same confusion matrix and rates under each of the seven non-empty rules, with the configured one marked `active` |

The gold tables are computed from the ledger. The snapshot figures are still computed and
published beside them as `snap_km_median`, `snap_mttr_median`, `snap_resolved`, `snap_open` —
**the gap between `km_median` and `snap_km_median` is the size of what v1 was missing.**

`…metrics_capacity` gains the two columns v1 could not produce, both of which need scan history:

- **`reconstructed`** — the month predates the first scan, so its opens and closes are back-dated
  from the API's own dates rather than watched by us. Not evidence of capacity, and excluded from
  the headline `mmcr_mean` for that reason. v1 could not draw the distinction, so a register three
  weeks old showed two years of confident monthly throughput.
- **`closed_observed`** — reconciliation's own resolution count, bucketed by the month of the scan
  that found them. An independent route to `closed`, which is derived from `resolved_at`. Where
  the two disagree, one of them is wrong, and publishing both is what lets a reader notice.

### `…metrics_capacity` carries two populations — always filter on `population`

Each month appears twice, once per population, and **an unfiltered read doubles every count.**

| `population` | |
| --- | --- |
| `all` | every finding. How much of the backlog moves in a month |
| `high_risk` | high-risk lifecycles only. The population P2P v3 defines net remediation capacity over, and what `gas/src/server/api.ts:859` passes (`highRiskOnly: true`) |

The two routinely disagree, and which one a number meant is not recoverable after the fact — so
both are written and every reader has to say which. The `high_risk` rows carry no
`closed_observed`: reconciliation's count has no risk label, so against that population it would
be a cross-check on a different set of findings, which is worse than none.

The grid is built per population from that population's own earliest `first_detected_at`, so a
register whose first high-risk finding arrived late has a shorter `high_risk` series. A register
with no high-risk lifecycles at all writes no `high_risk` rows.

> **Upgrading from 2.0:** `population` is added by schema evolution, so rows written by 2.0 land
> with `population = NULL` and are all-findings rows. Backfill them
> (`UPDATE … SET population = 'all' WHERE population IS NULL`) or filter on
> `coalesce(population, 'all')`, or the old scans quietly drop out of every filtered query.

### The scan log is load-bearing

`…wiz_os_scans` is not bookkeeping. It records which severities each scan covered, and
**disappearance is only safe because of it**: `--severities` defaults to `CRITICAL,HIGH`, so
without knowing a scan's scope, every MEDIUM row in the ledger would "vanish" on the first
scoped run and mass-resolve. Absence of something nobody looked for is not remediation. The same
table is the idempotency guard, and its earliest row is the observation horizon that
`reconstructed` is measured against.

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

**Six** `.py` modules are needed at runtime — skip `tests/`, `README.md` and
`requirements.txt`, and note `requests` is already on the runtime. Put them all in **one flat
folder**, created as **Files**, not Notebooks (a notebook is not importable as a module, and
this is the most common way the setup goes wrong):

```
/Workspace/Users/<you>/wiz-metrics/       ← this path goes on sys.path
├── config.py
├── dbx.py
├── ingest.py
├── ledger.py        ← added in v2; a folder set up for v1 will not have it
├── metrics.py
└── run_pipeline.py
```

> **Replace all six together.** The modules move in lockstep — v2's `metrics.py` writes a silver
> frame that only v2's `run_pipeline.py` knows how to merge — so a half-updated folder imports
> cleanly and then fails much later at something that looks unrelated. The first real v2 run hit
> exactly this: 137,870 findings ingested, then *"A schema mismatch detected when writing to the
> Delta table"*, which names neither the stale file nor the fix. Every module now carries a
> `MODULE_VERSION` and `run_pipeline` refuses to start when they disagree, but re-pasting the
> whole set is what avoids the problem rather than merely diagnosing it.

Three ways to get them there, all ending in the same place:

- **UI** — create the folder, then Create → File once per module and paste, all six. Then run
  the verification cell below; with six hand-pasted files it is the step that catches a miss.
- **Git folder** — Workspace → Create → Git folder against this repo. Then the path above is
  `/Workspace/Users/<you>/sidekick/brick`. The only option that updates every file at once and
  tells you when your copy is stale.
- **CLI** — `databricks workspace import-dir ./brick /Workspace/Users/<you>/wiz-metrics
  --overwrite`. **`--overwrite` is not optional when refreshing:** without it existing files are
  skipped and only the new `ledger.py` lands, which is the mixed folder described above.
  Copies `tests/` too, harmlessly.

### Check the upload landed

Cheap, and it catches both a missed file and the `sys.path` shadowing described under
[Layout](#layout) — the printed path tells you which `config.py` actually won:

```python
import config, dbx, ingest, ledger, metrics, run_pipeline
for m in (config, dbx, ingest, ledger, metrics, run_pipeline):
    print(f"{m.__name__:14} {getattr(m, 'MODULE_VERSION', 'PRE-2.0 — STALE'):16} {m.__file__}")
```

All six must report the same version, from the folder you just pasted into. Anything else and
the run will refuse to start.

Run this cell rather than relying on the built-in guard alone. `run_pipeline` can only check the
modules it imports, so it catches a stale `config.py` or `metrics.py` — but if `run_pipeline.py`
is itself the stale file, there is no v2 code running to do the checking, and you get the v1
behaviour with none of the diagnostics. That is precisely what happened on the first v2 run. The
cell reads the versions directly and has no such blind spot.

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

**After editing or re-pasting any module, restart Python — do not reload.**

```python
dbutils.library.restartPython()
```

Re-running the import cell changes nothing on its own, because Python caches imports. The
tempting fix is `importlib.reload` over the modules you think you changed, and it is worse than
doing nothing: it re-executes a module while every other module still holds references into the
old one, so `config`'s constants exist twice and a reload of `config` mid-import surfaces as
`ImportError: cannot import name 'SEVERITY_COLORS' from partially initialized module 'config'`.
It is also easy to leave a module out of the list — `ledger` is the one usually forgotten — which
recreates the mixed-version folder by another route. `restartPython()` has neither failure mode.

`<region>` is the one in your Wiz tenant URL (`us1`, `eu2`, …). Get it wrong and auth succeeds
but the GraphQL POST 404s.

### 3b. As a scheduled Job

A **Python file** task with the Git repo as its source, `brick/run_pipeline.py` as the path,
and the parameters passed as `--name=value`:

```json
{
  "name": "wiz-vulnerability-metrics",
  "schedule": { "quartz_cron_expression": "0 0 6 * * ?", "timezone_id": "UTC" },
  "max_concurrent_runs": 1,
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
          "--scope=os",
          "--scan_id={{job.run_id}}"
        ]
      },
      "new_cluster": { "spark_version": "14.3.x-scala2.12", "num_workers": 2 }
    }
  ]
}
```

That cron is daily at 06:00 UTC, which is the cadence v2 is built for: the ledger advances once a
day, so a disappearance is dated to within 24 hours of when it happened. Scan more often and the
dating gets tighter; scan less often and `scan_ts` resolution gets coarser (or switch to
`--disappearance=midpoint`).

`--scan_id={{job.run_id}}` and `max_concurrent_runs: 1` are what make a retry safe — see
[Retries](#retries-are-safe-if-you-pass-scan_id). Both matter more on a schedule than they do
interactively, because nobody is watching when the retry happens.

A single-node cluster is plenty — the driver does the API paging and the Spark work is a
handful of aggregations over one scan.

**On the first v2 run** the ledger and scan-log tables are created automatically, and `seq` is
added to bronze by schema evolution. Run `--rebuild_ledger=true` once first if you have v1
history worth keeping.

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
| `severities` | `CRITICAL,HIGH` | comma-separated; also recorded per scan and used by the disappearance guard |
| `scan_id` | a random id | pass `{{job.run_id}}` on a scheduled Job — see [Retries](#retries-are-safe-if-you-pass-scan_id) |
| `disappearance` | `scan_ts` | `scan_ts` or `midpoint` |
| `rebuild_ledger` | `false` | replay bronze and rebuild the ledger from scratch — see [Backfill](#backfilling-from-existing-bronze) |

### Retries are safe, if you pass `scan_id`

Reconciling one scan twice would advance every lifecycle a second time, so a retry must be
recognisable as a retry. Databricks retries a failed task **within the same run**, so
`--scan_id={{job.run_id}}` makes the second attempt arrive with the id the first one used. The
run then finds its own row in `…wiz_os_scans` and does nothing.

Without it, `scan_id` is random and a retry looks like a brand-new scan. Also set
`"max_concurrent_runs": 1` so two runs cannot reconcile against each other.

If a run dies *between* the ledger MERGE and the scan-log write, the next run detects it — the
ledger carries the scan id, the log does not — and **refuses rather than double-counting**.
Recover with `--rebuild_ledger`.

### Backfilling from existing bronze

If you have been running v1, bronze already holds months of scans. `--rebuild_ledger` truncates
the ledger and the scan log, then replays every bronze scan oldest-first through the same
reconciler the live path uses:

```bash
python brick/run_pipeline.py --catalog=<catalog> --rebuild_ledger=true \
  --severities=CRITICAL,HIGH --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

Without it the ledger starts today: every finding's `first_seen` collapses to now and MTTR reads
as roughly zero until enough history accumulates.

**One caveat, and it matters.** v1 never recorded which severities a scan asked for, so replayed
scans are assumed to have used the `--severities` you pass. If your history was collected under a
different scope, pass *that* scope — otherwise the replay will resolve-by-disappearance severities
the original scans never covered, and invent remediation that never happened. Scans written by v2
carry their own scope and are unaffected.

The rebuild is idempotent, and `brick/tests/test_ledger_pipeline.py` pins the invariant that
matters: replaying bronze lands exactly where running those scans live landed.

### 4. Read the results

```sql
SELECT severity, coverage_pct, efficiency_pct, prevalence_pct, signal_coverage_pct
FROM   <catalog>.<schema>.wiz_os_metrics_program
WHERE  scan_id = (
  SELECT max_by(scan_id, scan_ts) FROM <catalog>.<schema>.wiz_os_metrics_program
)
ORDER BY severity;
```

Read that against `prevalence_pct` on the same row, not against the P2P baselines — see
[Reading coverage and efficiency](#reading-coverage-and-efficiency). How much of it is the rule:

```sql
SELECT rule_label, active, coverage_pct, efficiency_pct, high_risk, unknown
FROM   <catalog>.<schema>.wiz_os_metrics_sensitivity
WHERE  scan_id = (
  SELECT max_by(scan_id, scan_ts) FROM <catalog>.<schema>.wiz_os_metrics_sensitivity
)
ORDER BY active DESC, rule_label;
```

The run itself prints all three families — MTTR and SLA by severity, coverage and efficiency
with the rule-sensitivity table beside them, and the most recent capacity months for each
population.

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

`delta-spark` is needed for the ledger tests; without it they skip and the pure-transform tests
still run. All the tests share one `SparkSession` from `tests/conftest.py`, because Delta's SQL
extensions can only be installed when a session is built and `getOrCreate()` returns whatever
already exists — leaving each module to make its own meant the first module alphabetically
decided whether the suite could use Delta.

The oracles are ported, not invented:

- the confusion-matrix block is the hand-counted 12-lifecycle register from
  `gas/test/program.test.ts` (TP=3, FP=3, FN=2, TN=2, one unclassified on each side →
  coverage 60%, efficiency 50%);
- the MTTR block is the `resolved_sample` case from `tests/test_metrics.py` (7.0 days median,
  100% in SLA against a 14-day HIGH target);
- **the lifecycle rules replay `gas/test/fixtures/reconcile.json`** — the golden fixture the
  TypeScript reconciler is tested against — scenario by scenario, comparing the resulting ledger
  and deltas field by field. Nothing about that fixture was written to suit this implementation,
  which is what makes it worth having;
- `vuln_key` is cross-checked against `wiz_dashboard.domain.lifecycle.vuln_key` over the
  committed Wiz response, so the surfaces provably agree on identity;
- one test replays the committed `os_vulns_response_exemple.json` end to end, so the real Wiz
  response shape is covered without a network call.

The rules that would be silently wrong rather than loudly broken were mutation-tested: removing
the disappearance previous-scan guard, the severity-scope guard, the monotone risk merge, the
peak-EPSS rule, the fix-clock reset on reopen, and `first_seen`'s earliest-wins each fail the
suite.

## Dashboard

For reading the numbers rather than iterating on them — an overview page you scan first, and
two detail pages you open when something looks wrong. Cross-filtering does the navigation:
click a severity in any chart and every other widget on the same dataset re-filters.

| Page | |
| --- | --- |
| **Overview** | Six counter tiles — KM median MTTR, in-SLA %, coverage, efficiency, prevalence, signal coverage — plus MTTR and coverage by severity, and the MTTR trend across scans. Answers "how are we doing" and nothing else |
| **Remediation speed** | Severity filter, KM median against SLA target, p90 open age, the full per-severity table, and the same broken down by subscription |
| **Programme** | Coverage and efficiency by severity with their uncertainty bounds and the prevalence baseline; the same two rates under each signal subset, so a reader can see how much of them is the rule; capacity by month for both populations; and where the high-risk findings live by subscription |

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

## Reading coverage and efficiency

The formulas are P2P's. **The positive class is not**, and that is the whole of how to read
these numbers.

P2P scores a remediation strategy against an *independent* ground truth: exploitation observed
in the wild, which lands on roughly 2–5% of CVEs. We have no such ground truth — only the
signals in the risk rule. So `risk_class = high` **is our own prioritization rule**, and the
confusion matrix measures what the register did against that rule rather than against reality.
That is the same move the Kenna product makes (it scores against Kenna's own risk band), and it
is a fair thing to measure. It is just not the thing P2P measures.

| | P2P research | Kenna.VM product | here |
| --- | --- | --- | --- |
| Positive label | exploitation observed in the wild | Kenna risk score, high band | `KEV ∨ public exploit ∨ EPSS ≥ 0.1` |
| Nature | retrospective ground truth | vendor prediction | our own rule |
| Prevalence | ~2–5% of CVEs | vendor-set | rule-set — read `prevalence_pct` |
| Unit | CVE (v1–v4), asset-centric from v5 | vulnerability instance | finding-instance (`vuln_key`) |
| Window | a defined period | rolling period | cumulative over the ledger |
| Unknown label | none — binary | none | first-class, with `_lo`/`_hi` bounds |

Four consequences, in the order they bite:

- **Do not compare our efficiency to 18.5%.** P2P vol. 2's industry baseline of 70% coverage at
  18.5% efficiency, and vol. 4's finding that most firms never cross 50%, are computed against a
  much rarer positive class. Ours will read higher and mean less.
- **`prevalence_pct` is the baseline that *is* a peer.** It is the share of classified findings
  that are high risk — exactly the efficiency a program picking findings at random would score.
  Efficiency at or below prevalence means the programme is not prioritizing at all. It is
  published beside every rate and on the overview page for this reason.
- **`hasFix: true` is in the population** (see [Scope](#scope)), so awaiting-vendor-fix findings
  are not in coverage's denominator. Deliberate, and one more reason the published baselines are
  not comparable.
- **The matrix is cumulative and asset-weighted.** Every finding the ledger has ever seen is in
  it, so the appended per-scan series is a to-date curve, not a monthly one — a good quarter
  barely moves it. And one CVE on 5,000 hosts contributes 5,000 rows.

One more, from the ledger's [sticky signals](#the-ledger-and-why-v2-exists): classification is
**not as-of**. Exploit knowledge is monotone by design, so a finding that reached KEV in month
six is counted high-risk in month one too. The bias is conservative — it can only move findings
into the high-risk population, never out — but it means the confusion matrix is "classified with
everything we know now", not "classified with what we knew then".

### Since the rule is the label, its sensitivity is a published metric

`…metrics_sensitivity` recomputes coverage and efficiency under each of the seven non-empty
signal subsets — KEV alone, EPSS alone, KEV-or-exploit, and so on — with the active rule marked
`active = true`. Ported from `gas/src/domain/program.ts::ruleSensitivity`.

It answers **"how much does the headline depend on which signals I turned on?"** and nothing
else. It is deliberately *not* P2P vol. 9's Figure 19, which plots candidate strategies against
observed exploitation; the subsets here are scored against themselves, so a subset cannot be
"wrong" — a narrow rule simply reports high efficiency over a small high-risk population.
Label it *rule sensitivity*, never *strategy comparison*.

What the table is good for is seeing the shape of the trade: each row carries `high_risk` and
`unknown` alongside the two rates, so a subset that buys efficiency by shrinking the high-risk
population — or by pushing rows into `unknown` — cannot hide it. The `KEV` row is usually the
starkest: P2P vol. 9 pp. 22–24 found CISA KEV alone covers only ~19% of what is exploited in
the wild, which is why the default rule is an any-of over three signals rather than KEV alone.

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

## What v2 does not do

The three things v1 was missing — cross-scan lifecycle tracking, the capacity `reconstructed`
flag, and the per-scan `resolved_count` cross-check — are done. What is still outstanding, all
of it available on the GAS side:

- **No actionable clock.** The SLA clock should arguably start when a vendor fix becomes
  available, not at detection (`gas/src/domain/ledgerCore.ts::baseRows` computes
  `fix_available_at`, `mttr_actionable_days`, `awaiting_vendor_fix`). The *inputs* are already
  captured — `fix_date` and `fix_observed_at` are on every ledger row — because they cannot be
  recovered afterwards: once a finding disappears from the API, a fix signal nobody wrote down
  is gone for good. Nothing reads them yet; the derivations are the remaining work.
- **No domain triage.** `gas/src/domain/domainRules.ts` assigns findings to owning teams from
  subscription and tag inputs. `subscription_name` / `subscription_ext_id` are on the ledger;
  **asset tags are not, because `ingest.py` does not select them** — adding that is an ingest
  change (a new field on every `vulnerableAsset` inline fragment), not a ledger one.
- **No retention or compaction.** The ledger grows monotonically. The Streamlit side seals old
  scans into `resolved_episodes` (`wiz_dashboard/data/ledger.py::compact_ledger`); on Delta the
  equivalent levers are `OPTIMIZE` and `VACUUM`, plus bronze retention. Nothing here does either
  yet, and a large register will eventually want it.
- **No Kaplan–Meier survival curves** — the point estimate is here, the curve is not.
- **No period-scoped confusion matrix.** Coverage and efficiency are cumulative over the whole
  ledger, so the per-scan series is a to-date curve and a good quarter barely moves it.
  `gas/src/domain/trend.ts::withCoverageEfficiency` recomputes the pair as-of each trend point
  (using `resolved_at <= d` rather than `status`); there is no `brick` equivalent. See
  [Reading coverage and efficiency](#reading-coverage-and-efficiency).

Two ledger fields also stay deliberately simple relative to GAS: there is no `tags_json`
(see above), and no `resolved_episodes` table, so a `vuln_key` has exactly one lifecycle row and
a reopen overwrites the previous episode's dates rather than archiving them. `reopened_count`
records that it happened; the earlier episode's `resolved_at` is not kept.
