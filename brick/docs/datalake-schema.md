# Wiz register: data lake schema

The three Delta tables the Wiz register pipeline stores in the data lake, with every column and
its type. Nothing else is written to storage: views and computed ratios are not stored.

**Sensitivity.** Columns marked **confidential** name your infrastructure, code or cloud
accounts and should be encrypted at rest. Use deterministic encryption for `asset_id`: the
pipeline groups and joins on it, so equal values must stay equal.

## Contents

- [Conventions](#conventions)
- [wiz_findings_raw (5 columns)](#wiz_findings_raw-5-columns)
- [wiz_vuln_ledger (28 columns)](#wiz_vuln_ledger-28-columns)
- [wiz_metrics (17 columns)](#wiz_metrics-17-columns)
  - [Top-level columns](#top-level-columns)
  - [mttr struct (22 fields)](#mttr-struct-22-fields)
  - [program struct (6 fields)](#program-struct-6-fields)
  - [capacity struct (6 fields)](#capacity-struct-6-fields)
  - [assets struct (16 fields)](#assets-struct-16-fields)

## Conventions

- Table names are `<catalog>.<schema>.wiz_<name>`; `wiz_` is the default prefix.
- `scope` is on every row: `os` (host OS packages), `sca` (code dependencies) or `sast` (code
  weaknesses). All three share the same tables, so always filter on it.
- Timestamps are UTC. Durations are days (`double`). Percentages are 0–100; `NULL` when the
  denominator is zero.
- Severity is one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`, `UNKNOWN`. In `wiz_metrics`
  an extra `OVERALL` row totals all severities.

## wiz_findings_raw (5 columns)

Raw API response: one row per finding per scan. Append-only. Clustered by `(scope, scan_id)`.

| Column | Type | Sensitivity | Description |
| --- | --- | --- | --- |
| `scan_id` | string | | Scan run id. |
| `scan_ts` | timestamp | | Scan start time. |
| `scope` | string | | `os`, `sca` or `sast`. |
| `seq` | bigint | | Position in the API response. |
| `node_json` | string | **confidential** | The finding exactly as Wiz returned it (JSON): asset names and ids, file paths, cloud accounts. |

## wiz_vuln_ledger (28 columns)

Current state of every finding ever seen: one row per `(scope, vuln_key)`, updated in place
each scan (`MERGE`). Clustered by `(scope, vuln_key)`.

| Column | Type | Sensitivity | Description |
| --- | --- | --- | --- |
| `vuln_key` | string | | Key with `scope`: `id:<wiz id>` or `h:<hash>`. |
| `scope` | string | | `os`, `sca` or `sast`. |
| `cve` | string | | CVE id (`os`, `sca`); weakness title (`sast`). |
| `component` | string | **confidential** | Package or library name; source file path for `sast`. |
| `severity` | string | | Latest severity. |
| `asset_id` | string | **confidential** | Wiz asset id (host, or repository branch). |
| `asset_name` | string | **confidential** | Host name or repository/branch name. |
| `asset_type` | string | | e.g. `VIRTUAL_MACHINE`, `REPOSITORY_BRANCH`. |
| `cloud` | string | | Cloud platform (`AWS`, `Azure`, `GCP`, …). |
| `subscription_name` | string | **confidential** | Cloud account / subscription name. |
| `subscription_ext_id` | string | **confidential** | Cloud provider's account / subscription id. |
| `first_seen` | timestamp | | Start of the current episode. |
| `last_seen` | timestamp | | Last scan that returned the finding. |
| `status` | string | | `OPEN` or `RESOLVED`. |
| `resolved_at` | timestamp | | Resolution time; `NULL` while open. |
| `resolution_src` | string | | `api` (Wiz said so) or `disappeared` (no longer returned). |
| `reopened_count` | int | | Times the finding came back after resolution. |
| `first_scan_id` | string | | Scan that first saw the current episode. |
| `last_scan_id` | string | | Scan that last saw it. |
| `fix_date` | timestamp | | When a fix became available, per Wiz (`os`, `sca`). |
| `fix_observed_at` | timestamp | | First scan that saw a fix (`os`, `sca`). |
| `has_kev` | boolean | | On CISA's Known Exploited Vulnerabilities list (`os`, `sca`). |
| `has_exploit` | boolean | | Public exploit known (`os`, `sca`). |
| `epss` | double | | Peak EPSS probability, 0–1 (`os`, `sca`). |
| `risk_observed_at` | timestamp | | First scan that captured an exploit signal. |
| `cwe` | string | | Comma-separated CWE ids (`sast`). |
| `language` | string | | Ecosystem, e.g. `JAVA` (`sast`, `sca`). |
| `ai_verdict` | string | | Wiz AI triage verdict (`sast`). |

`NULL` in `has_kev`, `has_exploit` or `epss` means "not captured", not `false`.

## wiz_metrics (17 columns)

Per-scan metrics. Append-only: each scan adds one `scan` row plus its metric rows in one commit.
`family` says what a row is; each metric family keeps its figures in one struct column named
after it, `NULL` on other families' rows. Ratios and totals are not stored; they are computed
from these fields when read.

| `family` | One row per | Uses columns |
| --- | --- | --- |
| `scan` | scan | `severities` … `reopened_count` |
| `mttr` | scan × severity (+ `OVERALL`) | `severity`, `mttr` |
| `program` | scan × severity (+ `OVERALL`) | `severity`, `program` |
| `capacity` | scan × month × population | `population`, `month`, `capacity` |
| `assets` | scan × asset group (+ `OVERALL`) × population | `population`, `asset_group`, `assets` |

### Top-level columns

| Column | Type | Sensitivity | Description |
| --- | --- | --- | --- |
| `scan_id` | string | | Scan run id. |
| `scan_ts` | timestamp | | Scan time; figures are as of this moment. |
| `scope` | string | | `os`, `sca` or `sast`. |
| `severities` | string | | `scan` rows: severities requested; `NULL` = all. |
| `total` | bigint | | `scan` rows: findings returned. |
| `new_count` | bigint | | `scan` rows: findings opened by this scan. |
| `resolved_count` | bigint | | `scan` rows: findings resolved by this scan. |
| `reopened_count` | bigint | | `scan` rows: findings reopened by this scan. |
| `family` | string | | `scan`, `mttr`, `program`, `capacity` or `assets`. |
| `severity` | string | | `mttr`, `program` rows: severity or `OVERALL`. |
| `mttr` | struct | | Time-to-remediate figures — see below. |
| `program` | struct | | Prioritisation counts — see below. |
| `population` | string | | `capacity`, `assets` rows: `all` or `high_risk`. Always filter on it. |
| `month` | timestamp | | `capacity` rows: first instant of the month. |
| `capacity` | struct | | Monthly throughput — see below. |
| `asset_group` | string | | `assets` rows: ecosystem, `UNKNOWN` or `OVERALL`. |
| `assets` | struct | | Assets-at-risk figures — see below. |

### mttr struct (22 fields)

| Field | Type | Description |
| --- | --- | --- |
| `mttr_median` | double | Median days to resolve, resolved findings only. |
| `resolved` | bigint | Resolved findings. |
| `open` | bigint | Open findings. |
| `open_age_p50` | double | Median age of open findings. |
| `open_age_p90` | double | 90th-percentile age of open findings. |
| `sla_compliant` | bigint | Resolved within SLA. |
| `sla_target` | int | SLA in days; `NULL` on `OVERALL` and `UNKNOWN`. |
| `km_events` | bigint | Resolved findings in the Kaplan–Meier estimate. |
| `km_censored` | bigint | Open findings in the Kaplan–Meier estimate. |
| `km_median` | double | Kaplan–Meier median days to remediate (headline figure). |
| `km_rmst` | double | Restricted mean days to remediate. |
| `km_truncated` | boolean | `km_rmst` is a lower bound. |
| `km_median_lower_bound` | double | "> N days" when `km_median` is `NULL`. |
| `resolved_api` | bigint | Resolutions reported by Wiz. |
| `resolved_disappeared` | bigint | Resolutions inferred from disappearance. |
| `mttr_actionable_mean` | double | Mean days from fix available to resolved. |
| `mttr_actionable_median` | double | Median days from fix available to resolved. |
| `actionable_resolved` | bigint | Resolved findings with a known fix date. |
| `actionable_age_p50` | double | Median days open since a fix existed. |
| `actionable_age_p90` | double | 90th percentile of the same. |
| `awaiting_vendor_fix_count` | bigint | Open findings with no fix yet. |
| `actionable_sla_compliant` | bigint | Resolved within SLA, counted from fix availability. |

### program struct (6 fields)

Each finding is classed high-risk / not high-risk / unknown, then remediated / open.

| Field | Type | Description |
| --- | --- | --- |
| `tp` | bigint | High-risk, remediated. |
| `fp` | bigint | Not high-risk, remediated. |
| `fn` | bigint | High-risk, still open. |
| `tn` | bigint | Not high-risk, still open. |
| `unknown_remediated` | bigint | Unclassifiable, remediated. |
| `unknown_open` | bigint | Unclassifiable, open. |

### capacity struct (6 fields)

| Field | Type | Description |
| --- | --- | --- |
| `opened` | bigint | Findings first seen this month. |
| `closed` | bigint | Findings resolved this month. |
| `open_at_start` | bigint | Backlog on the first day of the month. |
| `partial` | boolean | Month not over yet. |
| `reconstructed` | boolean | Month predates the first scan (back-dated, not observed). |
| `closed_observed` | bigint | Resolutions the scans recorded this month (`all` rows only). |

### assets struct (16 fields)

An asset is a repository branch; its group is its language.

| Field | Type | Description |
| --- | --- | --- |
| `assets` | bigint | Assets with at least one finding. |
| `density_p25` | double | 25th percentile of open findings per asset. |
| `density_p50` | double | Median open findings per asset. |
| `density_p75` | double | 75th percentile of open findings per asset. |
| `open_findings` | bigint | Open findings across those assets. |
| `assets_with_high_risk_pct` | double | Share of assets with an open high-risk finding. |
| `asset_coverage_p50` | double | Median per-asset coverage, `tp / (tp + fn)`. |
| `assets_with_high_risk` | bigint | Assets with any high-risk finding. |
| `mmcr_p50` | double | Median per-asset monthly close rate. |
| `falling_behind_pct` | double | Share of assets whose backlog grew. |
| `maintaining_pct` | double | Share whose backlog held steady (±2%). |
| `gaining_pct` | double | Share whose backlog shrank. |
| `assets_flowing` | bigint | Assets with a measurable net flow. |
| `km_median_days` | double | Kaplan–Meier median days to close a finding. |
| `km_median_lower_bound` | double | "> N days" when `km_median_days` is `NULL`. |
| `window_months` | double | Months since the first scan (min 1). |
