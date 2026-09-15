# How it is built, and how it is checked

## Layout

```
config.py           constants: severity taxonomy, per-scope Wiz filters (SCOPES), which API
                     connection each scope reads (SOURCES), the risk rules (RiskRule and the
                     SAST-only any-of), and the actionable-clock scope guards
dbx.py               reaching dbutils from inside a module, and doing without it off-cluster
ingest.py            Wiz OAuth + paginated GraphQL -> raw finding dicts, for both connections
ledger.py            pure PySpark cross-scan lifecycle reconciliation (no I/O)
metrics.py           pure PySpark DataFrame -> DataFrame transforms (no I/O), both silver shapes
run_pipeline.py      the Databricks entry point: bronze -> the ledger -> one metrics table

import_bundle.py     one-shot: seed the `os` ledger from a gas/ migration bundle
csvstore.py          the register as typed CSV, for a deployment with no catalog -- see the
                     CSV register

panels.py            every number a notebook shows, and the one place that pins the scan
figures.py           pandas -> Plotly figures, drawn the way the GAS apps draw them
tiles.py             HTML fragments for displayHTML: heroes, KPI bands, the confusion matrix
notebooks/           ten .ipynb pages -- see Notebooks
databricks.yml       the Databricks Asset Bundle: one chained scan Job, one maintenance Job

tests/               local-SparkSession tests, oracles ported from gas/ and gas_devsecops/
fixtures/            the three committed Wiz captures the tests and devlake replay -- see
                     fixtures/README.md
docs/                this directory: the register, deploying, migrating, storage, the
                     notebooks, reading the numbers, and these internals
tools/               hand-run scripts, not part of any deployment: export_fixtures.py
                     (golden-fixture exporter for gas_devsecops/'s TypeScript parity suites)
                     and bench_pipeline.py (a synthetic register, timed through the real
                     entry points -- see Benchmarking)
```

`ledger.py` and `metrics.py` are pure `DataFrame -> DataFrame`; `run_pipeline.py` is the only
module that does I/O. That is what lets the lifecycle rules — the part most likely to be wrong —
be tested against a local `SparkSession` with no Delta table, no cluster and no API in the way.

The presentation layer keeps the same discipline one level up: `panels.py` is Spark in and a
small frame out, `figures.py` is pandas in and a `Figure` out, `tiles.py` is a value in and a
string out. None of them renders anything except through one function each, which is what makes
the whole UI testable without a workspace. See [Notebooks](notebooks.md).

**These are plain top-level modules, not a package.** There is no `__init__.py`, and they import
each other by bare name (`import metrics`, `from config import …`). Whatever directory holds
them goes on `sys.path`. That is what lets the Databricks side be a single flat folder of files,
with no nesting to reproduce by hand and no package prefix to keep in sync.

The consequence to know about: the runtime module names are generic — `config`, `metrics` and
`ingest` obviously so, and `panels`, `figures` and `tiles` even more plausibly, since they are
exactly what someone else's unrelated workspace file might be called. Put the directory **first**
on `sys.path` (`sys.path.insert(0, …)`, not `append`) so a same-named module elsewhere cannot
win — that would fail as a confusing `AttributeError` rather than an import error. Every
notebook's first cell does this, and `06_run_and_verify` prints the `__file__` each module
actually came from.

`brick/` never imports `wiz_dashboard` — a Spark cluster does not carry that package.
The shared constants are duplicated on purpose; `config.py` names its sources.

## The ledger, and why it exists

The pipeline's first version measured each scan in isolation: a run pulled findings and computed
everything from that one snapshot's `firstDetectedAt` / `resolvedAt`. Runs accumulated as
separate `scan_id`s, but nothing reconciled one against the next.

That gets one thing badly wrong. **Wiz stops returning a finding once it is remediated, and often
never sets `resolvedAt`** — so remediation usually looks like a finding quietly disappearing. The
first version could not see that at all, and `ledger.py`'s module docstring is the source of
truth for why the module exists and for what each metric cost without it.

The ledger gives each finding a durable identity (`vuln_key`) and a row that survives across
runs — first seen, still here, gone. Metrics come from those observed lifecycles instead of from
a snapshot, so a finding that vanishes is counted as resolved on the day it vanished.

The lifecycle rules are ported from `gas/src/domain/reconcile.ts`, which is the reference
implementation; `tests/test_ledger.py` replays that module's own golden fixture
(`gas/test/fixtures/reconcile.json`) scenario by scenario, so the port is checked against the
standard rather than against itself.

| Rule | |
| --- | --- |
| First sighting | OPEN, `first_seen = min(firstDetectedAt, scan ts)` |
| Persisting | advance `last_seen`; `first_seen` stays earliest-known and never drifts later |
| API-resolved | `resolvedAt` present, or status in `RESOLVED_STATUSES` → `resolution_src = 'api'` |
| Disappearance | was OPEN, was in the previous scan covering its severity and its scope, absent now → `resolution_src = 'disappeared'` |
| Reopen | a RESOLVED finding is active again → OPEN, `reopened_count++`, a new episode |

A reopen "recomputes" `first_seen` rather than advancing it: it takes `min(firstDetectedAt, scan
ts)`, the same formula a first sighting uses, and deliberately ignores the value already on the
row. That breaks the earliest-known chain — the one place `first_seen` can move *later*. Note the
consequence: if Wiz still reports the original `firstDetectedAt`, the reopened episode inherits
that date rather than starting from the reopen. That is the reference implementation's behaviour
(`reconcile.ts:340`), and the surfaces have to agree.

Three different update disciplines coexist on a ledger row, and they are not interchangeable:

- **latest-observation-wins** — severity, CVE, asset attributes, and (for `sast`) `ai_verdict`.
  A re-triage is a correction, not something to remember alongside the old verdict.
- **sticky first-wins, reset by a reopen** — the vendor-fix clock (`fix_date`,
  `fix_observed_at`), on the scopes that have one.
- **monotone, never reset** — the exploit signals, on the scopes that carry them. `has_kev` /
  `has_exploit` go null → false → true and never back; `epss` keeps the **peak** ever observed.
  Exploit knowledge does not decay, and — because the gold tables are appended — a finding that
  silently left the high-risk population would leave last week's published coverage disagreeing
  with this week's for reasons unrelated to any remediation.

### Disappearance is an inference, and it is labelled as one

`resolution_src` records how each closure was learned, and the `mttr` family of `…metrics`
publishes `resolved_api` / `resolved_disappeared` per severity. A register whose closures are
overwhelmingly inferred is telling you something about the data source as much as about the
security programme — which you can only notice if the split is on the table. For `sast`, whose
source has no `resolvedAt` at all (see [Scopes](register.md#scopes)), the split is not a caveat, it is the
whole story: every closure there is `disappeared`.

`--disappearance` picks the date: `scan_ts` (default) is the scan that noticed the absence,
which overstates MTTR by at most one scan interval but never records a moment nobody observed;
`midpoint` halves that bias by inventing a timestamp between the two scans. On a daily job the
difference is under 24 hours.

## Tests

```bash
pip install -r brick/requirements.txt
pytest brick/tests -n 3 --dist loadgroup -q
```

One suite, one process, across all three scopes — there is no second fork to run separately any
more. They spin up a local `SparkSession`; the module skips cleanly if pyspark isn't installed.
The root `pyproject.toml` deliberately does **not** collect `brick/tests` — the main suite must
not start depending on Spark.

`delta-spark` is needed for the ledger tests; without it they skip and the pure-transform tests
still run. All the tests share one `SparkSession` from `tests/conftest.py`, because Delta's SQL
extensions can only be installed when a session is built and `getOrCreate()` returns whatever
already exists — leaving each module to make its own meant the first module alphabetically
decided whether the suite could use Delta.

**On the parallel run.** Each worker gets its own `SparkSession`, its own in-memory catalog and
its own warehouse directory, so nothing they do can collide — which means how tests are spread
across them is only ever a question of cost. `--dist loadgroup` is what lets `conftest.py`
answer it: it pins `test_panels` and `test_notebooks` to one worker, because both read the
session-scoped `live_tables` and session-scoped means *once per worker*, so splitting them would
build the whole live register twice. Everything else is left unpinned and handed out per test —
including the two heaviest modules, `test_ledger_pipeline` and `test_import_bundle`, which build
a private database per test and so parallelise all the way down.

A worker is a whole JVM, not a thread, and a `local[1]` Spark session still runs a scheduler, a
listener bus and its own garbage collector — so it wants appreciably more than one core, and
`-n auto` oversubscribes a small machine. On a four-core box `-n 3` measured faster than
`-n auto`; on a larger one `auto` is fine. The heap is sized for this too: `conftest.py` asks
for 4g when it is the only session and 3g per worker when it is not (2g ran out of Java heap on the
3.0 suite around stage 11,000; 3g finishes clean), because four workers at 4g
want 16g and the swapping costs more than the parallelism returns.

The one thing that does not parallelise is the first-ever run after `DELTA_PACKAGE` in
`conftest.py` changes: `--packages` resolves the jars through Ivy into a shared `~/.ivy2`, and
several workers populating a cold cache at once can race. Run the suite serially once after
bumping that version, then in parallel thereafter. `tests/test_pins.py` guards the version pair
itself: `delta-spark`'s installed version must equal the jar version pinned in `conftest.py`,
because the two ship from one release and a floor is not enough — Spark 3.5.6 changed a plain
`overwrite`-mode `saveAsTable` to compile against Delta's staged V2 table, and only delta-spark
3.3.3's `StagedDeltaTableV2` advertises the capability that path needs.

Three modules — `test_figures.py`, `test_tiles.py` and `test_pipeline.py` — touch no Spark at
all (Plotly figures, HTML strings, and argument parsing against a fake session). Running just
those needs no JVM and takes seconds, which is the fast loop while working on that layer:

```bash
pytest brick/tests/test_figures.py brick/tests/test_tiles.py brick/tests/test_pipeline.py -q
```

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
  response shape is covered without a network call, and `tests/test_os_scope.py` pins the `os`
  filter shape against the same fixture family;
- `tests/test_code_scopes.py` carries the code-register oracles: both silver projections emit the
  same columns, the CWE ancestor hop works, one missing signal makes a whole row unknown, and
  asking for resolved SAST findings would report zero-day MTTR — over
  `fixtures/sca_findings_example.json` (synthetic: the captured `fixtures/sca_response.json` is
  the *grouped* query, one row per repository with severity counts, and has no per-finding rows
  to drive a pipeline) and `fixtures/sast_response.json`;
- **`test_csvstore.py`** asserts the confusion matrix over a CSV-reloaded register is identical
  to the one over the Delta tables it came from. A NULL exploit signal read back as `false`
  inflates efficiency and deflates coverage at once, so the round-trip is checked over every
  column rather than over the ones somebody thought to assert. It also scans, exports,
  **deletes the Delta directory outright** and scans again, asserting that lifecycles continue,
  `first_seen` does not collapse and a dropped finding still resolves by disappearance — the
  whole claim of `--csv_path`, and a claim whose failure mode in production is not an error but
  a register that looks healthy and is measuring nothing. See
  [The CSV register](storage.md#the-csv-register-legacy).

The rules that would be silently wrong rather than loudly broken were mutation-tested: removing
the disappearance previous-scan guard, the severity-scope guard, the scope guard on
`awaiting_vendor_fix`, the monotone risk merge, the peak-EPSS rule, the fix-clock reset on
reopen, and `first_seen`'s earliest-wins each fail the suite.

## Benchmarking

`tools/bench_pipeline.py` is the measuring instrument for performance work on the pipeline. It
builds a synthetic register, drives it through the **real** `ingest_to_bronze` and
`build_metrics` — the API is stubbed, nothing else is — and reports wall-clock and Spark-job
count per stage.

```bash
python brick/tools/bench_pipeline.py --findings 20000 --scans 3 \
    --out before.json --dump before/          # on the revision you are measuring against
python brick/tools/bench_pipeline.py --findings 20000 --scans 3 \
    --out after.json --dump after/ --compare before.json
diff -r before/ after/                        # must be empty
```

`--dump` writes every table as sorted JSON with the run's identity columns removed, so
`diff -r` answers the only question that matters about a performance change: **did any number
move?** An optimisation that cannot pass that diff is not an optimisation.

Two things to know before believing a result:

- **The absolute seconds are meaningless.** This is one local JVM; only the ratio between two
  runs of the same script on the same machine says anything.
- **Run it more than once.** The variance is large. A single pair of runs on a four-core box
  showed a 36% improvement for a change that three runs a side put at 8% — the first baseline
  run was simply slow. Report medians, and report the job counts too: seconds move with whatever
  else the machine is doing, "this scan submits 125 Spark jobs" does not.

`--attribute` additionally times each gold transform on its own, which is how you find out that
`rule_sensitivity`'s seven passes are ~1.5s of an ~85s run and therefore not the problem.

The session is built here rather than borrowed from `tests/conftest.py`, deliberately: conftest
sets `spark.sql.shuffle.partitions=1` and turns AQE off, which is right for thirty-row test
frames and would measure the wrong machine entirely.
