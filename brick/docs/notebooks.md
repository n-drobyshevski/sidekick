# Notebooks


Nine `.ipynb` pages under `notebooks/`, mirroring the pages of the GAS apps, plus a one-shot
importer. Each answers one question with a headline, a small set of charts and a table you can
sort and export. Run a cell, get a metric and its visualisation.

| Notebook | The one question it answers |
| --- | --- |
| **`00_security_posture`** | How fast are we closing risk, how much is open right now, and is it getting worse? |
| **`01_mttr_sla`** | How long does a finding actually live once you stop excluding what is still open — and where is it slow? |
| **`02_program_performance`** | Is remediation effort landing on the findings that matter, and can we close faster than risk arrives? |
| **`03_os_vulnerabilities`** | What is exploitable on host workloads, where does risk concentrate, and what moved since the last scan? |
| **`03_code_vulnerabilities`** | The same question over library CVEs and static-analysis weaknesses |
| **`04_scan_history`** | What has actually been measured, when, and how has the register moved across those measurements? |
| **`05_estate`** | Can this register be attributed to an owner at all, and which parts of the estate carry the backlog? |
| **`06_run_and_verify`** | Is the deployment sound, can I run a scan, and are the tables consistent? |
| **`07_import_gas`** | Can this register start from the history the Apps Script app already has, instead of from today? |
| **`08_code_assets`** | Which repositories carry the backlog, which offer a foothold, and which are falling behind? |

`00`–`05` and `08` are **read-only about your data**. `06` is the only one that ingests, which
is deliberate: a page somebody opens to check a number should not be one Run All away from a
credentialed API sweep. `07` is the other writer, and it is meant to be run once, before the
first `os` scan — see
[Migrating from the Apps Script app](migrating.md#migrating-from-the-apps-script-app).

The one exception, and it is not a data write: `panels.context()` calls
`run_pipeline.ensure_tables()`, so a deployment where the pipeline has never run creates the two
empty lifecycle tables instead of failing every view with `TABLE_OR_VIEW_NOT_FOUND` in cell 1.
It checks existence first, so in the normal case it needs nothing beyond `SELECT`. Pass
`ensure=False` to `context()` for a viewer that holds only `SELECT` on a never-scanned register.

A register with no scans then opens on **"No scan data yet"** rather than a traceback
(`tiles.scan_zone_from`). Every page's first cell goes through that helper: `last_scan(…).first()`
is `None` on an empty table, and the obvious `…first().asDict()` dies with an `AttributeError`
that a fresh deployment cannot tell apart from a broken install.

Two GAS pages have no analogue here and are absent rather than approximated. **Settings** — the
parameters are widgets and Job parameters, and the high-risk rules are `config.DEFAULT_RISK_RULE`
/ `config.SastRiskRule`, so changing them is a code change. **Data**'s import half — this
pipeline ingests from the Wiz API and has no CSV import path; the export half is the download
button on every result grid.

`05_estate` is GAS's **Attribution** page renamed rather than faked. GAS maps findings to
value-chain domains through configurable rules over subscriptions and asset tags. This pipeline
has no domain rules and `ingest.py` selects no asset tags for `os`, so there is nothing to
compute a coverage gap against there. The page says so and answers the nearest question the
register can actually support. Adding tags to `ingest.py` is the real fix.

> **`05_estate` is currently empty for `os`, and that is the honest reading.** See
> [The asset fields are not fetched](#the-asset-fields-are-not-fetched) — every column it groups
> on is NULL for that scope, so `panels.attributability` reports 0% populated. That is the page
> working, not the page broken: it exists to answer "can this register be attributed to an owner
> at all".

## The asset fields are not fetched

`config.FETCH_ASSET_FIELDS` is **False**. The live tenant no longer has the `vulnerableAsset`
union members `os`'s query used, and GraphQL rejects the *whole request* rather than the
sub-selection — so one unavailable field costs every scan. It is a constant rather than a
deletion: `ingest._asset_selection` and its member list are intact, so a tenant that still has
them turns the columns back on by flipping one line. `sca` sidesteps the problem entirely with
its own narrower member list — see [Scopes](register.md#scopes) — which is why it has asset columns and
`os` does not.

| | |
| --- | --- |
| **NULL while it is off (`os`)** | `asset_id`, `asset_name`, `asset_type`, `cloud`, `subscription_name`, `subscription_ext_id` — so `05_estate`, the by-subscription breakdowns and `risk_mix` have nothing to group on |
| **Unaffected** | MTTR, SLA, coverage, efficiency, capacity, and the whole ledger. They read severity, status, timestamps and the exploit signals, none of which live on the asset |
| **Identity unaffected** | `vuln_key` prefers the Wiz finding id, which is still selected. Only the fallback hash uses asset fields, and it is not reached |

Bronze written before the flag still holds the asset JSON, so `--rebuild_ledger` over that
history repopulates those columns for the scans that captured them.

## The scan pin, and why there is a `panels.py`

The gold tables are appended, so **every read has to name a scan or it blends every run that has
ever happened into one entirely plausible chart.** Rather than repeat that predicate in every
cell and hope, the first cell of every notebook calls `panels.context(spark)`, which registers
session temp views that are already pinned, scope-filtered and severity-filtered:

```
v_mttr  v_program  v_capacity  v_assets  v_findings  v_scans  v_lifecycles   ← one scan
v_mttr_all  v_program_all  v_findings_all                                    ← deliberately not
```

**The `scope` widget is what picks the register, and it now does the whole of that job.**
Before the three scopes shared one table set, the widget mainly drove the API filter; which
*table* you were reading was mostly settled by `table_prefix`. With `wiz_findings_raw` /
`wiz_vuln_ledger` / `wiz_metrics` shared by every scope, `ctx.scope` (resolved from the widget by
`run_pipeline.resolve_scope`) is the **only** thing that turns the shared tables into one
register — every view above filters `scope = ctx.scope`, `panels.register_views`'s own
docstring says so is "now the only thing separating the three registers", and changing the
widget and re-running is how a reader moves from `os` to `sca` to `sast`, not a different
notebook path or a different table name.

`max_by(scan_id, scan_ts)` is written in exactly one function in the whole repo. The three
`_all` views are the only unpinned surface and are named so a reader can see it. The consequence
worth having: no SQL in any notebook interpolates a widget, so `tests/test_notebooks.py`
executes every shipped `%sql` cell **verbatim** against real pipeline output.

Two data facts the views correct on the way past, both of which the published tables carry:

- `OVERALL` is not a member of `SEVERITY_ORDER`, so a bare `severity IN (…)` filter deletes the
  row every headline reads. The views keep it explicitly — and note it cannot be narrowed by the
  severity widget, because the pipeline computed it once over everything that was scanned.
- `SLA_TARGETS` has no `UNKNOWN` key, so `mttr_days <= NULL` is NULL, `sum(when(…).otherwise(0))`
  turns that into a **0**, and `safe_pct` divides it into a confident `0.0%`. The views null it
  back out, and anything counting "open past SLA" drops rows with no target from both sides.

## Which engine draws what, and why

**Plotly** draws anything where the *drawing* carries the argument: a NULL that must be a gap, a
reference rule with a label, a staircase, direct labels, uncertainty bounds, or two series that
must differ by more than hue. Databricks renders it live in the cell — pan, hover, legend
toggling — so this is not the old static-PNG surface with a new library. It is also the only
layer where the two rules below can be *tested*: a `Figure` is an object a test can interrogate.

**The native chart editor** draws five things, all of them plain counts where the picker adds
something code cannot: two stacked bars, a 100% stacked bar, and two pivot tables. **The native
result grid** shows every table, because it sorts, filters, exports CSV and docks to a dashboard
better than anything this repo would write — GAS's drawers and pagers are that grid here.

**`displayHTML`** draws the surfaces where the number *is* the product: heroes, KPI bands,
severity tiles, the confusion matrix. Never tabular data.

Two conventions run through all of it, and both are enforced by tests rather than by review:

- **A NULL is drawn as an annotated gap, never a zero.** "No resolved findings yet" and "closed
  instantly" must not look the same. A filled line has the same problem in slower motion —
  Plotly closes the fill polygon down to zero either side of a gap — so a series containing a
  NULL loses its fill.
- **Severity is never carried by colour alone.** The palette is a heat ramp and it fails a
  categorical colourblind check: HIGH `#ea580c` and MEDIUM `#d97706` sit ΔE 1.6 apart under
  deuteranopia and 6.7 apart with normal vision. Every severity series carries its own marker
  shape, every mark is named by a tick or a label, and colour is redundant coding on top.

## The five native charts are not committed, and this is why

A Databricks result visualisation lives under an undocumented, version-dependent
`application/vnd.databricks.v1+*` key, partly in cell metadata and partly in cell output.
Nothing in this repo can author one correctly, and nothing in it could verify one if it did —
which is precisely the failure mode the generated `.lvdash.json` dashboard was deleted to
escape. So no visualisation JSON ships at all.

What ships instead, for each of the five, is:

1. a markdown line above the cell beginning `Chart ▸`, naming the exact fields to set;
2. the cell itself, whose **default rendering is already a correct, sortable, exportable table**.

**The one-time workspace step.** Open each notebook, *Run all*, then for every `Chart ▸` header
click **+ → Visualization** and set exactly the fields the recipe names. Then either:

- **(a)** leave the charts in the workspace copy and accept that a `git pull` may drop them —
  re-creating one is a fifteen-second mechanical act, because the recipe is committed; or
- **(b)** if a workspace admin has enabled *"Allow Git folders to export IPYNB outputs"*, commit
  the notebook back and the visualisation travels with it.

**(b) is workspace-configuration dependent and nothing in this repo can test it.** The failure is
bounded by construction, which is the point: if the visualisation is never created, or is
stripped on the way through Git, the reader sees a correct sorted table — never an error, never a
wrong chart. That is a strictly better failure than "the whole document is rejected", and it is
why only five of the visuals are native. The same *unverified UI guidance* caveat applies to the
menu paths in this section and to **Run accessed commands** below.

`tests/test_notebooks.py` parses every `Chart ▸` recipe and checks each column it names against
the producing panel's declared `OUTPUT_COLUMNS`, so the recipe cannot rot even though the chart
is not committed.

## Widgets

Every notebook declares the same base widgets — `catalog`, `schema`, `scope`, `table_prefix`,
`severities`, `scan_id`, `module_path` — plus its own page widgets. Set them before running
anything; `catalog` has no default for the reason given under
[Store the credentials](deploy.md#1-store-the-credentials).

Two behaviours to know:

- **Set the notebook to "Run accessed commands"** if you want a widget change to re-run the
  cells that depend on it. Otherwise you change the filter and read a chart drawn under the old
  value, which is the notebook form of the honest-state rule.
- `table_prefix` takes the literal `-` for "no prefix at all". `run_pipeline.param` is
  `widget or env or default`, and an empty string is falsy — so a cleared widget means "use the
  default", not "use nothing".

## What was lost with the AI/BI dashboard

Two real capabilities, stated plainly rather than glossed:

- **Cross-filtering.** Clicking a severity in one chart and watching every other widget
  re-filter is now changing a widget and re-running.
- **The SQL-warehouse viewer path.** An AI/BI dashboard could be shared with someone who had
  only `SELECT` on the gold tables. A notebook needs a cluster to attach to.

What was gained is that every number on every page is now covered by a test that runs on a
laptop, and that the chart definitions are code rather than an undocumented JSON schema
reconstructed from exports.
