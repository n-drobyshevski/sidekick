# Column reference

Every column the pipeline writes, table by table, for anyone querying the register directly.
Why the tables are shaped this way is in [`register.md`](register.md). What the numbers mean,
and what not to claim from them, is in [`reading-the-numbers.md`](reading-the-numbers.md).

| Table | One row per | Written by |
| --- | --- | --- |
| `wiz_findings_raw` | finding × scan | append, every scan |
| `wiz_vuln_ledger` | finding lifecycle | `MERGE`, every scan |
| `wiz_metrics` | scan, and one row per gold grain | append, every scan |
| `wiz_metrics_<family>` | the same rows as `wiz_metrics`, one family each, flat | view, replaced every scan |

## Contents

- [Conventions that hold everywhere](#conventions-that-hold-everywhere)
- [`wiz_findings_raw` — bronze (5 columns)](#wiz_findings_raw--bronze-5-columns)
- [`wiz_vuln_ledger` — one row per finding lifecycle (28 columns)](#wiz_vuln_ledger--one-row-per-finding-lifecycle-28-columns)
  - [Identity (5 columns)](#identity-5-columns)
  - [Asset (6 columns)](#asset-6-columns)
  - [Lifecycle (8 columns)](#lifecycle-8-columns)
  - [Vendor-fix clock (`os` and `sca`) (2 columns)](#vendor-fix-clock-os-and-sca-2-columns)
  - [Exploit intelligence (`os` and `sca`) (4 columns)](#exploit-intelligence-os-and-sca-4-columns)
  - [Static-analysis inputs (3 columns)](#static-analysis-inputs-3-columns)
- [`wiz_metrics` — the commit record and every gold family (17 columns)](#wiz_metrics--the-commit-record-and-every-gold-family-17-columns)
  - [Read a family view, not the table](#read-a-family-view-not-the-table)
  - [What the table stores (17 columns)](#what-the-table-stores-17-columns)
  - [`family = 'scan'` — the commit record (5 columns)](#family--scan--the-commit-record-5-columns)
  - [`family = 'mttr'` — time to remediate, per severity (26 fields unpacked)](#family--mttr--time-to-remediate-per-severity-26-fields-unpacked)
  - [`family = 'program'` — coverage and efficiency, per severity (22 fields unpacked)](#family--program--coverage-and-efficiency-per-severity-22-fields-unpacked)
  - [`family = 'capacity'` — monthly throughput (17 fields unpacked)](#family--capacity--monthly-throughput-17-fields-unpacked)
  - [`family = 'assets'` — assets at risk (P2P volume 5) (18 fields unpacked)](#family--assets--assets-at-risk-p2p-volume-5-18-fields-unpacked)
- [Example queries](#example-queries)

## Conventions that hold everywhere

- **Names.** Fully qualified as `<catalog>.<schema>.wiz_<name>`. The `wiz_` prefix is the
  default and `--table_prefix` changes it.
- **`scope`** is on every row of every table: `os` (OS-package CVEs on hosts), `sca` (CVEs in the
  libraries a repository depends on) or `sast` (static-analysis weaknesses in first-party code).
  The three registers share one table set, so **filter on `scope` first, always.**
- **Timestamps** are UTC `TIMESTAMP`s.
- **Durations** are `DOUBLE` days, fractional (`1.5` is a day and a half).
- **Percentages** are `DOUBLE`s on a 0–100 scale, not 0–1. A percentage whose denominator is
  zero is `NULL`, not `0`.
- **`NULL` is information.** On the exploit signals it means "never captured", which is not the
  same as `false`. On a KM median it means "not reached yet". On a rate it means "nothing to
  divide by". Don't `coalesce` a `NULL` to zero without knowing which of these it is.
- **Severity** is one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`, `UNKNOWN`. Wiz's
  `INFORMATIONAL` folds to `INFO`, and anything unrecognised becomes `UNKNOWN` rather than being
  dropped. In the metrics, an extra `OVERALL` row per scan totals all severities (or all asset
  groups). Don't sum the per-severity rows and the `OVERALL` row together.
- **SLA targets**, in days: `CRITICAL` 7, `HIGH` 14, `MEDIUM` 30, `LOW` 90, `INFO` 180. `UNKNOWN`
  has none.

## `wiz_findings_raw` — bronze (5 columns)

One row per finding per scan, exactly as the Wiz API returned it. Append-only. Clustered on
`(scope, scan_id)`, so filter on both.

| Column | Type | Description |
| --- | --- | --- |
| `scan_id` | string | The run that fetched this row. On a scheduled job this is the Databricks job run id. |
| `scan_ts` | timestamp | When that run started. Every row of a scan carries the same value. |
| `scope` | string | `os`, `sca` or `sast`. |
| `seq` | bigint | The row's position in the API response, from 0. Only useful for reproducing API order. |
| `node_json` | string | The finding as the API returned it, as a JSON string. `os` and `sca` findings share one node shape, and `sast` findings have their own. Parse with `from_json` or `:` path syntax. |

Most queries should read the ledger rather than this table. Bronze is the durable record the
ledger is rebuilt from, and it holds one full copy of the register per scan.

## `wiz_vuln_ledger` — one row per finding lifecycle (28 columns)

One row per `(scope, vuln_key)`, updated in place by every scan (`MERGE`, not append). It is the
current state of every finding the register has ever seen, including ones the API has stopped
returning. Clustered on `(scope, vuln_key)`.

### Identity (5 columns)

| Column | Type | Description |
| --- | --- | --- |
| `vuln_key` | string | **Key**, together with `scope`. `id:<wiz id>` when Wiz returned a finding id (the normal case), otherwise `h:<hash>` over CVE, asset, asset type, cloud and component. The prefix tells the two schemes apart. |
| `scope` | string | `os`, `sca` or `sast`. Part of the key: the same CVE through an OS package and through a library is two findings. |
| `cve` | string | The CVE id (`CVE-2024-…`) for `os` and `sca`. For `sast` this is the **weakness title** ("SQL Injection"), not an identifier. The CWE ids are in `cwe`. |
| `component` | string | What the finding is in: the package or library name for `os` and `sca`, the file path for `sast`. |
| `severity` | string | Latest severity Wiz reported. See the conventions above. |

### Asset (6 columns)

The latest non-empty value wins, so an asset that is renamed keeps its newest name.

| Column | Type | Description |
| --- | --- | --- |
| `asset_id` | string | The Wiz id of the asset carrying the finding. For `sca` and `sast` this is a repository branch. For `os`, **NULL** unless asset fields are enabled (`config.FETCH_ASSET_FIELDS`, off by default). |
| `asset_name` | string | Human-readable asset name: host name, or repository/branch. |
| `asset_type` | string | Wiz asset type, e.g. `VIRTUAL_MACHINE`, `REPOSITORY_BRANCH`. |
| `cloud` | string | Cloud platform (`AWS`, `Azure`, `GCP`, …). NULL for `sast`. |
| `subscription_name` | string | Cloud account/subscription name. NULL for `sast`. |
| `subscription_ext_id` | string | The cloud provider's own id for that account/subscription. NULL for `sast`. |

### Lifecycle (8 columns)

| Column | Type | Description |
| --- | --- | --- |
| `first_seen` | timestamp | Start of the current episode: the earlier of Wiz's `firstDetectedAt` and the first scan that saw it. It never moves later, **except on a reopen**, which starts a new episode. |
| `last_seen` | timestamp | `scan_ts` of the most recent scan that returned this finding. A finding that disappeared keeps the value from the last scan that saw it. |
| `status` | string | `OPEN` or `RESOLVED`. There is no "reopened" status: a reopened finding is `OPEN` and `reopened_count` goes up. |
| `resolved_at` | timestamp | When it was resolved. This is Wiz's `resolvedAt` when the API said so, or the scan time if Wiz gave no date. For a finding that disappeared, it's the `scan_ts` of the scan that noticed (or the midpoint between the two scans under `--disappearance=midpoint`). Cleared on reopen. NULL while open. |
| `resolution_src` | string | How the resolution was learned: `api` (Wiz said so) or `disappeared` (inferred because the finding stopped being returned). NULL while open. |
| `reopened_count` | int | How many times this finding came back after being resolved. `0` for most rows. |
| `first_scan_id` | string | The scan that first saw the current episode. |
| `last_scan_id` | string | The scan that last saw it. |

### Vendor-fix clock (`os` and `sca`) (2 columns)

The first value recorded is kept. A reopen clears both columns. Always NULL for `sast`, which
has no vendor to wait on.

| Column | Type | Description |
| --- | --- | --- |
| `fix_date` | timestamp | When Wiz says a fixed version became available. |
| `fix_observed_at` | timestamp | The first scan that saw a fix exist. This is an upper bound on when the fix appeared, and it's used when `fix_date` is missing. |

### Exploit intelligence (`os` and `sca`) (4 columns)

**Monotone:** once true, always true, and it survives a reopen. NULL means the signal was never
captured, which is not the same as `false`. Always NULL for `sast`.

| Column | Type | Description |
| --- | --- | --- |
| `has_kev` | boolean | On CISA's Known Exploited Vulnerabilities list. |
| `has_exploit` | boolean | A public exploit is known. |
| `epss` | double | **Peak** EPSS probability ever observed (0–1), not the current one. |
| `risk_observed_at` | timestamp | The earliest scan that captured any of the three signals above. |

### Static-analysis inputs (3 columns)

| Column | Type | Description |
| --- | --- | --- |
| `cwe` | string | Comma-separated CWE ids, sorted (`CWE-79,CWE-89`). `sast` only. |
| `language` | string | The ecosystem the finding lives in (`JAVA`, `JAVASCRIPT`, …). Set for `sast` and, where Wiz returns it, for `sca`. NULL for `os`. The `assets` family groups by it. |
| `ai_verdict` | string | Wiz's AI triage verdict, upper-cased. `sast` only. Unlike the exploit signals, the **latest** verdict wins, because a re-triage is a correction. |

## `wiz_metrics` — the commit record and every gold family (17 columns)

Append-only. Each scan appends its commit record, then all its gold rows in one commit, so a
scan's families are all present or all absent. The `family` column tells the five grains apart:

| `family` | One row per | Filter also on |
| --- | --- | --- |
| `scan` | scan (the commit record) | — |
| `mttr` | scan × severity (+ `OVERALL`) | `severity` |
| `program` | scan × severity (+ `OVERALL`) | `severity` |
| `capacity` | scan × calendar month × population | `population`, `month` |
| `assets` | scan × asset group (+ `OVERALL`) × population | `population`, `asset_group` |

`assets` is written for every scope, but only findings with an `asset_id` count toward it. With
default settings `os` has no asset ids, so it produces no `assets` rows.

### Read a family view, not the table

Every run that publishes gold replaces one view per family beside the table:
`wiz_metrics_scan`, `wiz_metrics_mttr`, `wiz_metrics_program`, `wiz_metrics_capacity` and
`wiz_metrics_assets`. A view is its family's rows, flat: `scan_id`, `scan_ts`, `scope`, then
exactly the columns listed under that family below — derived ones included, so `SELECT *` is
readable. Column counts, `scan_id`, `scan_ts` and `scope` included: `wiz_metrics_scan` 8, `wiz_metrics_mttr` 29, `wiz_metrics_program` 25, `wiz_metrics_capacity` 20, `wiz_metrics_assets` 21.

- The `family` filter is built in. You still filter on `scope`, and on `population` for
  `capacity` and `assets`.
- To get the latest figures, pin to the newest `scan_id` for that scope.
- A register on `--data_path` has no catalog, so it gets no views. Read it through
  `run_pipeline.read_family(spark, tables, "<family>")`, which returns the same frame. That is
  also what the notebook pages read.

### What the table stores (17 columns)

The table itself has seventeen columns (`run_pipeline.METRICS_COLUMNS`), however many measures
the families carry:

| Column | Type | On rows of |
| --- | --- | --- |
| `scan_id`, `scan_ts`, `scope`, `family` | string, timestamp, string, string | every family |
| `severities`, `total`, `new_count`, `resolved_count`, `reopened_count` | string, bigint ×4 | `scan` |
| `severity` | string | `mttr`, `program` |
| `population` | string | `capacity`, `assets` |
| `month` | timestamp | `capacity` |
| `asset_group` | string | `assets` |
| `mttr` | struct | `mttr` |
| `program` | struct | `program` |
| `capacity` | struct | `capacity` |
| `assets` | struct | `assets` |

A column is NULL on the rows of every family it does not belong to. Each gold family keeps its
**measures** in the struct named after it — the struct fields listed below; their stored order
is `run_pipeline.FAMILY_MEASURES`. Its **derived** columns are not stored at all: they are
arithmetic over the measures, defined once as SQL in `metrics.DERIVED`, and every view and every
page computes them on read. A query on the table itself reaches into the struct
(`mttr.km_median`) and has no derived columns to select.

The four gold-family sections below count **fields once unpacked** — top-level dims, struct
fields and derived columns together — which is the shape of the family's view, not a count of
table columns. In the tables, **Stored as** says where each column lives: a top-level column, a struct
field, or *derived*. Every row also carries `scan_id`, `scan_ts` and `scope`:

| Column | Type | Description |
| --- | --- | --- |
| `scan_id` | string | The scan these figures describe. Joins to `scan_id` in bronze and to the ledger's `first_scan_id`/`last_scan_id`. |
| `scan_ts` | timestamp | That scan's timestamp. Figures are "as of" this moment. |
| `scope` | string | `os`, `sca` or `sast`. |
| `family` | string | `scan`, `mttr`, `program`, `capacity` or `assets`. In the table only — a view is one family already. |

### `family = 'scan'` — the commit record (5 columns)

One row per completed scan, stored flat. It is also how the pipeline knows what each scan
looked at, so it is load-bearing, not bookkeeping (see [`register.md`](register.md)).

| Column | Type | Description |
| --- | --- | --- |
| `severities` | string | The severities this scan requested, comma-separated (`CRITICAL,HIGH`). NULL means every severity. A finding outside this list is never resolved by its absence. |
| `total` | bigint | Findings the API returned in this scan. |
| `new_count` | bigint | Lifecycles this scan opened for the first time. |
| `resolved_count` | bigint | Lifecycles this scan resolved, whether by `api` or by `disappeared`. |
| `reopened_count` | bigint | Previously resolved lifecycles this scan saw again. |

### `family = 'mttr'` — time to remediate, per severity (26 fields unpacked)

**26 fields once unpacked:** 1 top-level, 22 in the `mttr` struct, 3 derived on read. In the table itself they occupy 2 of its 17 columns (`severity` and the `mttr` struct); the view `wiz_metrics_mttr` has 29 columns, `scan_id`, `scan_ts` and `scope` included.

Computed over every lifecycle in the ledger for this scope, open or resolved.

| Column | Type | Stored as | Description |
| --- | --- | --- | --- |
| `severity` | string | top-level | A severity, or `OVERALL`. |
| `resolved` | bigint | `mttr.resolved` | Resolved lifecycles (those with a measurable time to resolve). |
| `open` | bigint | `mttr.open` | Open lifecycles. |
| `mttr_median` | double | `mttr.mttr_median` | Median days from `first_seen` to `resolved_at`, **resolved findings only**. Biased low, because the slowest findings are the ones still open. Prefer `km_median`. |
| `km_median` | double | `mttr.km_median` | **The headline figure.** Kaplan–Meier median time to remediate, counting open findings as "not closed yet". NULL when fewer than half have closed; read `km_median_lower_bound` then. |
| `km_median_lower_bound` | double | `mttr.km_median_lower_bound` | Set only when `km_median` is NULL: the longest observed duration, so it can be reported as "> N days". |
| `km_rmst` | double | `mttr.km_rmst` | Restricted mean survival time: the average days to remediate, capped at the longest observed duration, open or resolved. |
| `km_truncated` | boolean | `mttr.km_truncated` | True when not every finding has closed by that longest duration. `km_rmst` is then a floor, not a mean. |
| `km_events` | bigint | `mttr.km_events` | Resolved findings that entered the KM estimate. |
| `km_censored` | bigint | `mttr.km_censored` | Open findings that entered the KM estimate. |
| `open_age_p50` | double | `mttr.open_age_p50` | Median age in days of the open findings. |
| `open_age_p90` | double | `mttr.open_age_p90` | 90th-percentile age of the open findings. |
| `oldest_open_days` | double | *derived* | `OVERALL` row only: the worst per-severity `open_age_p90` of the same scan. |
| `sla_target` | int | `mttr.sla_target` | This severity's SLA in days. NULL on `OVERALL` and `UNKNOWN`. |
| `sla_compliant` | bigint | `mttr.sla_compliant` | Resolved findings closed within their SLA (on the target day counts as met). |
| `sla_pct` | double | *derived* | `sla_compliant / resolved`. On `OVERALL` it's total compliant over total resolved, not an average of the severity rows. |
| `resolved_api` | bigint | `mttr.resolved_api` | Resolutions Wiz reported. |
| `resolved_disappeared` | bigint | `mttr.resolved_disappeared` | Resolutions inferred because the finding disappeared. A high share says more about the data source than about the team. |

The **actionable clock** measures from when a fix existed rather than from when the finding
appeared, which is closer to what an SLA means. It applies to `os` and `sca`. For `sast` these
columns are NULL or 0, because `sast` has no vendor fix.

| Column | Type | Stored as | Description |
| --- | --- | --- | --- |
| `mttr_actionable_mean` | double | `mttr.mttr_actionable_mean` | Mean days from fix available to resolved. |
| `mttr_actionable_median` | double | `mttr.mttr_actionable_median` | Median of the same. |
| `actionable_resolved` | bigint | `mttr.actionable_resolved` | Resolved findings with a known fix date. Always ≤ `resolved`, and the gap is what the clock couldn't price. |
| `actionable_age_p50` | double | `mttr.actionable_age_p50` | Median days open since a fix became available, for open findings. |
| `actionable_age_p90` | double | `mttr.actionable_age_p90` | 90th percentile of the same. |
| `awaiting_vendor_fix_count` | bigint | `mttr.awaiting_vendor_fix_count` | Open findings with no fix available yet. |
| `actionable_sla_compliant` | bigint | `mttr.actionable_sla_compliant` | Findings resolved within SLA, counted from fix availability. |
| `actionable_sla_pct` | double | *derived* | `actionable_sla_compliant / actionable_resolved`. Read it beside `sla_pct`, not subtracted from it, because the two denominators differ. |

### `family = 'program'` — coverage and efficiency, per severity (22 fields unpacked)

**22 fields once unpacked:** 1 top-level, 6 in the `program` struct, 15 derived on read. In the table itself they occupy 2 of its 17 columns (`severity` and the `program` struct); the view `wiz_metrics_program` has 25 columns, `scan_id`, `scan_ts` and `scope` included.

Each lifecycle is classified as high-risk, not high-risk or unknown by the scope's risk rule
(the run log prints it in words on its header line), then crossed with remediated vs open. The
formulas come from Cyentia's *Prioritization to Prediction* (P2P). Only the six counts are
stored; everything else is derived from them.

| Column | Type | Stored as | Description |
| --- | --- | --- | --- |
| `severity` | string | top-level | A severity, or `OVERALL`. |
| `tp` | bigint | `program.tp` | High-risk and remediated: the work that mattered. |
| `fp` | bigint | `program.fp` | Not high-risk and remediated: effort spent elsewhere. |
| `fn` | bigint | `program.fn` | High-risk and still open: remaining risk. |
| `tn` | bigint | `program.tn` | Not high-risk and still open: correctly deprioritised. |
| `unknown_remediated` | bigint | `program.unknown_remediated` | Remediated, but the rule's inputs were missing so it couldn't be classified. |
| `unknown_open` | bigint | `program.unknown_open` | Open and unclassifiable. |
| `classified` | bigint | *derived* | `tp + fp + fn + tn`. |
| `unknown` | bigint | *derived* | `unknown_remediated + unknown_open`. |
| `total` | bigint | *derived* | `classified + unknown`: every lifecycle at this severity. (The `scan` family's `total` is a different number.) |
| `remediated` | bigint | *derived* | `tp + fp + unknown_remediated`. |
| `open` | bigint | *derived* | `fn + tn + unknown_open`. |
| `high_risk` | bigint | *derived* | `tp + fn`. |
| `not_high_risk` | bigint | *derived* | `fp + tn`. |
| `coverage_pct` | double | *derived* | `tp / (tp + fn)`: the share of high-risk findings that were remediated. |
| `coverage_lo` | double | *derived* | Coverage if every unclassified *open* finding were really high-risk. |
| `coverage_hi` | double | *derived* | Coverage if every unclassified *remediated* finding were really high-risk. |
| `efficiency_pct` | double | *derived* | `tp / (tp + fp)`: the share of remediation that went to high-risk findings. |
| `efficiency_lo` | double | *derived* | Efficiency if every unclassified remediated finding were not high-risk. |
| `efficiency_hi` | double | *derived* | Efficiency if every unclassified remediated finding were high-risk. |
| `prevalence_pct` | double | *derived* | `high_risk / classified`. The efficiency that picking findings at random would score. Efficiency at or below this means no real prioritisation. |
| `signal_coverage_pct` | double | *derived* | `classified / total`. Every rate above rests on this share, so report it alongside them. |

Always report coverage and efficiency together. They pull in opposite directions, and either
one alone can be pushed to 100%.

### `family = 'capacity'` — monthly throughput (17 fields unpacked)

**17 fields once unpacked:** 2 top-level, 6 in the `capacity` struct, 9 derived on read. In the table itself they occupy 3 of its 17 columns (`population`, `month` and the `capacity` struct); the view `wiz_metrics_capacity` has 20 columns, `scan_id`, `scan_ts` and `scope` included.

One row per UTC calendar month, from the population's first finding to the current month, and
**once per `population`**. Months with no activity still get a row.

| Column | Type | Stored as | Description |
| --- | --- | --- | --- |
| `population` | string | top-level | `all` (every finding) or `high_risk` (high-risk lifecycles only, the population P2P defines capacity over). **Always filter on it.** |
| `month` | timestamp | top-level | First instant of the calendar month (UTC). |
| `opened` | bigint | `capacity.opened` | Findings first seen this month. |
| `closed` | bigint | `capacity.closed` | Findings resolved this month, by `resolved_at`. |
| `open_at_start` | bigint | `capacity.open_at_start` | Backlog on the first day of the month. |
| `partial` | boolean | `capacity.partial` | The month isn't over yet. It's excluded from the summary columns below. |
| `reconstructed` | boolean | `capacity.reconstructed` | The month predates the register's first scan, so its numbers are back-dated from Wiz's own dates rather than observed. It's excluded from the summary. |
| `closed_observed` | bigint | `capacity.closed_observed` | Resolutions the scans themselves recorded in this month. It's an independent check on `closed`, and a large disagreement means one of them is wrong. `all` rows only. |
| `mmcr` | double | *derived* | Monthly close rate: `closed / open_at_start`. |
| `net` | bigint | *derived* | `closed − opened`. Positive means the backlog shrank. |
| `net_pct` | double | *derived* | `net / open_at_start`. |
| `verdict` | string | *derived* | `gaining`, `keeping-up` or `falling-behind`, from `net_pct`. Anything within ±2% counts as keeping up. |

The summary columns are the same value on every month row of a scan and population, so read
them from any one row. All five are derived. A **counted** month is one that is neither
`partial` nor `reconstructed` and has a backlog to close.

| Column | Type | Stored as | Description |
| --- | --- | --- | --- |
| `mmcr_mean` | double | *derived* | Mean `mmcr` over counted months. |
| `one_in_n` | double | *derived* | `100 / mmcr_mean`, for "we close about 1 in N of the backlog each month". |
| `months_counted` | bigint | *derived* | How many months `mmcr_mean` rests on. A small number means a young or rebuilt register. |
| `net_total` | bigint | *derived* | Sum of `net` over every month. |
| `overall_verdict` | string | *derived* | The verdict for the mean `net_pct` over counted months. NULL when no month counted. |

### `family = 'assets'` — assets at risk (P2P volume 5) (18 fields unpacked)

**18 fields once unpacked:** 2 top-level, 16 in the `assets` struct. In the table itself they occupy 3 of its 17 columns (`population`, `asset_group` and the `assets` struct); the view `wiz_metrics_assets` has 21 columns, `scan_id`, `scan_ts` and `scope` included.

One row per asset group plus `OVERALL`, **once per `population`**. An asset is a repository
branch, and its group is its `language`; findings with no language fall into `UNKNOWN`. Every
column here is a per-asset aggregate that cannot be recomputed from the others, so all of them
are stored.

| Column | Type | Stored as | Description |
| --- | --- | --- | --- |
| `population` | string | top-level | `all` or `high_risk`. **Always filter on it.** |
| `asset_group` | string | top-level | An ecosystem (`JAVA`, `JAVASCRIPT`, …), `UNKNOWN`, or `OVERALL`. |
| `assets` | bigint | `assets.assets` | Assets in the group with at least one finding in this population. |
| `open_findings` | bigint | `assets.open_findings` | Open findings across those assets. |
| `density_p25` | double | `assets.density_p25` | 25th percentile of open findings per asset. |
| `density_p50` | double | `assets.density_p50` | Median open findings per asset. |
| `density_p75` | double | `assets.density_p75` | 75th percentile of open findings per asset. |
| `assets_with_high_risk_pct` | double | `assets.assets_with_high_risk_pct` | Share of assets with at least one open high-risk finding. P2P calls this the foothold rate, since one opening is enough. |
| `assets_with_high_risk` | bigint | `assets.assets_with_high_risk` | Assets that have any high-risk finding, open or closed. This is the denominator for `asset_coverage_p50`. |
| `asset_coverage_p50` | double | `assets.asset_coverage_p50` | Median, across assets, of each asset's coverage (`tp / (tp + fn)`). |
| `km_median_days` | double | `assets.km_median_days` | Half-life: the Kaplan–Meier median days to close a finding on this kind of asset. |
| `km_median_lower_bound` | double | `assets.km_median_lower_bound` | Set when `km_median_days` is NULL: "> N days". |
| `window_months` | double | `assets.window_months` | Months since the register's first scan, floored at 1. It's the time the rate columns below rest on. |
| `mmcr_p50` | double | `assets.mmcr_p50` | Median, across assets, of the monthly close rate. |
| `falling_behind_pct` | double | `assets.falling_behind_pct` | Share of assets whose backlog grew over the window. |
| `maintaining_pct` | double | `assets.maintaining_pct` | Share of assets whose backlog held steady (±2%). |
| `gaining_pct` | double | `assets.gaining_pct` | Share of assets whose backlog shrank. The three shares add up to 100 over `assets_flowing`. |
| `assets_flowing` | bigint | `assets.assets_flowing` | Assets with a measurable net flow over the window. |

## Example queries

The latest MTTR for one scope:

```sql
WITH latest AS (
  SELECT max_by(scan_id, scan_ts) AS scan_id FROM wiz_metrics_scan WHERE scope = 'sca'
)
SELECT severity, km_median, km_median_lower_bound, sla_pct, open, resolved
FROM wiz_metrics_mttr JOIN latest USING (scan_id)
WHERE scope = 'sca'
ORDER BY severity;
```

A coverage and efficiency trend, one point per scan:

```sql
SELECT scan_ts, coverage_pct, efficiency_pct, prevalence_pct, signal_coverage_pct
FROM wiz_metrics_program
WHERE scope = 'os' AND severity = 'OVERALL'
ORDER BY scan_ts;
```

The high-risk monthly capacity as of the latest scan:

```sql
SELECT month, opened, closed, open_at_start, mmcr, verdict, partial, reconstructed
FROM wiz_metrics_capacity
WHERE scope = 'os' AND population = 'high_risk'
  AND scan_id = (SELECT max_by(scan_id, scan_ts) FROM wiz_metrics_scan WHERE scope = 'os')
ORDER BY month;
```

Stored measures straight off the table, for a reader with no views (a `--data_path` register
read through DuckDB, say). Only struct fields are there — `sla_pct` and the other derived
columns exist in the views, not in the table:

```sql
SELECT scan_ts, severity, mttr.km_median, mttr.resolved, mttr.open
FROM wiz_metrics
WHERE scope = 'sca' AND family = 'mttr'
ORDER BY scan_ts, severity;
```

The open findings behind those numbers:

```sql
SELECT vuln_key, cve, component, severity, asset_name, first_seen,
       datediff(current_timestamp(), first_seen) AS age_days, has_kev, epss
FROM wiz_vuln_ledger
WHERE scope = 'os' AND status = 'OPEN'
ORDER BY severity, first_seen;
```
