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
| `<catalog>.<schema>.findings_raw` | scan × finding | bronze: `node_json` as a string |
| `<catalog>.<schema>.findings` | scan × finding | silver: typed columns, `mttr_days`, `age_days`, `risk_class` |
| `<catalog>.<schema>.metrics_mttr` | scan × severity (+ `OVERALL`) | MTTR mean/median, open counts, open-age p50/p90, SLA target and compliance |
| `<catalog>.<schema>.metrics_program` | scan × severity (+ `OVERALL`) | the confusion matrix, coverage and efficiency with bounds, prevalence, signal coverage |
| `<catalog>.<schema>.metrics_capacity` | scan × month | opened, closed, backlog at month start, MMCR, net flow, verdict |

Bronze keeps the finding as a JSON string so a Wiz schema change can never fail ingest;
silver is just the typed projection of whatever arrived.

## Running it

On Databricks, as a Job (Python file task) or pasted into a notebook:

```python
%pip install requests
dbutils.widgets.text("catalog", "main")
dbutils.widgets.text("schema", "wiz")
dbutils.widgets.text("wiz_api_url", "https://api.<region>.app.wiz.io/graphql")
dbutils.widgets.text("secret_scope", "wiz")
dbutils.widgets.text("severities", "CRITICAL,HIGH")

from brick.run_pipeline import main
main()
```

Credentials come from the secret scope (`wiz-client-id`, `wiz-client-secret`), falling back to
the `WIZ_CLIENT_ID` / `WIZ_CLIENT_SECRET` environment variables so the same code runs off
a cluster. Nothing is ever inlined.

Then:

```sql
SELECT severity, coverage_pct, efficiency_pct, prevalence_pct, signal_coverage_pct
FROM   main.wiz.metrics_program
WHERE  scan_id = '<scan>' ORDER BY severity;
```

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
