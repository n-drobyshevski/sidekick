"""Time a whole pipeline run against a synthetic register, and prove two runs agree.

Not a test, and deliberately not under ``tests/`` -- pytest must never collect it. This is the
measuring instrument for performance work on ``run_pipeline.py``: a change to the pipeline
lands with a before/after number from here, or it does not land.

    # baseline, on the branch point
    python brick/bench_pipeline.py --findings 137870 --scans 3 --out before.json --dump before/

    # after the change
    python brick/bench_pipeline.py --findings 137870 --scans 3 --out after.json --dump after/ \
        --compare before.json
    diff -r before/ after/     # must be empty: the numbers are not allowed to move

**The session is built here, not borrowed from ``tests/conftest.py``.** conftest sets
``spark.sql.shuffle.partitions=1`` and turns AQE off, which is right for a suite of thirty-row
frames and is exactly the setting this script exists to measure. Borrowing it would measure the
wrong machine. The defaults below are cluster-shaped instead -- AQE on, 200 shuffle partitions
-- and ``--shuffle-partitions`` / ``--no-aqe`` move them.

It is still a local single-JVM Spark, so the absolute seconds mean nothing. The *ratios* between
two runs of this script on the same machine are the whole product.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import shutil
import sys
import time
from contextlib import contextmanager
from inspect import signature
from pathlib import Path
from typing import Dict, Iterator, List, Optional

BRICK_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BRICK_DIR))

# Must be set before the JVM starts, exactly as tests/conftest.py explains: --packages is read
# by spark-submit at launch and jars cannot be added to a running JVM.
# Tracks DELTA_PACKAGE in tests/conftest.py, and for the same reason -- see the comment there.
# Duplicated rather than imported because this script must stay runnable against a checkout of
# an older revision, which is the whole point of --compare.
DELTA_PACKAGE = "io.delta:delta-spark_2.12:3.3.2"
os.environ.setdefault(
    "PYSPARK_SUBMIT_ARGS", f"--packages {DELTA_PACKAGE} --driver-memory 4g pyspark-shell"
)
os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")


# --------------------------------------------------------------------- the synthetic register

SEVERITIES = ["CRITICAL", "HIGH"]
CLOUDS = ["AWS", "Azure", "GCP"]
ASSET_TYPES = ["VIRTUAL_MACHINE", "CONTAINER_IMAGE"]


def synth_nodes(count: int, seed: int, scan_index: int) -> List[dict]:
    """``count`` Wiz-shaped finding nodes, deterministic for a given ``seed``.

    Shaped to exercise the code rather than to look realistic: every field ``metrics.NODE_SCHEMA``
    reads is populated, the exploit signals are left NULL on a slice of the register (because
    NULL-vs-false drives the unclassified population and the published bounds), and
    ``firstDetectedAt`` is spread over two years so ``capacity_by_month`` has months to bucket.
    """
    rng = random.Random(seed)
    base = dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc)
    nodes = []
    for i in range(count):
        first = base + dt.timedelta(days=rng.randint(0, 730), seconds=rng.randint(0, 86399))
        resolved = None
        # A fifth of the register carries an API resolution; the rest is open, or will be
        # resolved by disappearing between scans.
        if rng.random() < 0.2:
            resolved = first + dt.timedelta(days=rng.randint(1, 120))
        # A tenth has no captured exploit signal at all -- NULL, not false. See metrics.py.
        blind = rng.random() < 0.1
        nodes.append(
            {
                "id": f"finding-{i}",
                "name": f"CVE-2024-{i % 9000:04d}",
                "detailedName": f"pkg-{i % 700}",
                "severity": rng.choice(SEVERITIES),
                "status": "RESOLVED" if resolved else "OPEN",
                "firstDetectedAt": first.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "lastDetectedAt": (base + dt.timedelta(days=730 + scan_index)).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                ),
                "resolvedAt": resolved.strftime("%Y-%m-%dT%H:%M:%SZ") if resolved else None,
                "fixDate": (first + dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "fixedVersion": f"1.{i % 40}.0",
                "hasExploit": None if blind else rng.random() < 0.25,
                "hasCisaKevExploit": None if blind else rng.random() < 0.05,
                "epssProbability": None if blind else round(rng.random(), 4),
                "vulnerableAsset": {
                    "id": f"asset-{i % 4000}",
                    "type": rng.choice(ASSET_TYPES),
                    "name": f"host-{i % 4000}",
                    "cloudPlatform": rng.choice(CLOUDS),
                    "subscriptionName": f"sub-{i % 25}",
                    "subscriptionExternalId": f"sub-ext-{i % 25}",
                },
            }
        )
    return nodes


def scan_population(count: int, seed: int, scan_index: int, churn: float) -> List[dict]:
    """One scan's payload: the register, minus a churned tail, plus that many new findings.

    The tail that goes missing is what makes the ledger do real work -- those lifecycles resolve
    by *disappearance*, which is the v2 behaviour the MERGE and the disappearance guard exist
    for. A benchmark whose scans are identical measures a no-op MERGE.
    """
    nodes = synth_nodes(count, seed, scan_index)
    if scan_index == 0 or churn <= 0:
        return nodes
    gone = int(count * churn)
    kept = nodes[gone:]
    fresh = synth_nodes(gone, seed + 1000 + scan_index, scan_index)
    for offset, node in enumerate(fresh):
        node["id"] = f"finding-new-{scan_index}-{offset}"
    return kept + fresh


# ------------------------------------------------------------------------------- the session


def build_session(warehouse: Path, shuffle_partitions: int, aqe: bool):
    from pyspark.sql import SparkSession

    builder = (
        SparkSession.builder.master("local[*]")
        .appName("brick-bench")
        .config("spark.sql.warehouse.dir", str(warehouse))
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.ui.enabled", "false")
        .config("spark.ui.showConsoleProgress", "false")
        .config("spark.sql.shuffle.partitions", str(shuffle_partitions))
        .config("spark.sql.adaptive.enabled", "true" if aqe else "false")
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config(
            "spark.sql.catalog.spark_catalog",
            "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        )
    )
    return builder.getOrCreate()


# -------------------------------------------------------------------------------- the timing


class Timings:
    """Wall-clock per named stage, plus how many Spark jobs each one cost.

    The job count is the more stable of the two on a shared machine: seconds move with whatever
    else is running, but "this stage submits 21 jobs" is a property of the code.
    """

    def __init__(self, spark):
        self._tracker = spark.sparkContext.statusTracker()
        self.stages: Dict[str, dict] = {}

    def _jobs(self) -> int:
        return len(self._tracker.getJobIdsForGroup())

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        before_jobs = self._jobs()
        start = time.perf_counter()
        try:
            yield
        finally:
            entry = self.stages.setdefault(name, {"seconds": 0.0, "jobs": 0, "calls": 0})
            entry["seconds"] += time.perf_counter() - start
            entry["jobs"] += self._jobs() - before_jobs
            entry["calls"] += 1


# ----------------------------------------------------------------------------------- the run


def stub_ingest(run_pipeline, payloads: List[List[dict]]) -> None:
    """Point the pipeline's API calls at a list of payloads instead of at Wiz.

    ``run_pipeline`` imported these by name, so they are rebound on that module rather than on
    ``ingest`` -- the same thing ``tests/test_pipeline.py`` does. Everything downstream of the
    generator, including the batching and the bronze write, is the real code.

    ``new_session`` is stubbed only where it exists, because this script has to run unmodified
    against the revision being measured *and* the one it is measured against -- a benchmark you
    have to edit between the two runs is not comparing the same thing.
    """
    state = {"index": 0}

    def fake_fetch(api_url, token, **kwargs):
        nodes = payloads[state["index"]]
        state["index"] += 1
        return iter(nodes)

    # `ingest_to_bronze` resolves this before it does anything else, and `param` reads the
    # environment when there is no job argument and no widget.
    os.environ.setdefault("WIZ_API_URL", "https://api.bench.invalid/graphql")

    run_pipeline.get_token = lambda *a, **k: "token"
    run_pipeline.secret = lambda scope, key, env: "stub"
    if hasattr(run_pipeline, "new_session"):
        run_pipeline.new_session = lambda: None
    run_pipeline.fetch_findings = fake_fetch


#: Significant digits kept when dumping a float. A double carries ~15-17, and the last two or
#: three of them are not a property of the register -- they are a property of the order Spark
#: happened to add things up in, which changes whenever the file layout changes. Adding liquid
#: clustering to the ledger moved `mttr_mean` (the one `avg()` in the published set) by up to
#: 3 ULP, ~2.7e-15 relative, on every other value being bit-identical. Rounding here is what
#: makes `diff -r` test "did a number move?" instead of "did the summation order change?".
#: 12 digits is far beyond anything the product displays and far short of the noise floor.
DUMP_SIGNIFICANT_DIGITS = 12


def _round(value):
    if isinstance(value, float) and value == value and value not in (float("inf"), float("-inf")):
        return float(f"%.{DUMP_SIGNIFICANT_DIGITS}g" % value)
    return value


def dump_tables(spark, tables, target: Path) -> None:
    """Every published table as sorted JSON, one file each.

    Sorted by every column, so two runs of the same code produce byte-identical files and
    ``diff -r`` is a real answer to "did any number move?". ``scan_id`` and ``scan_ts`` are
    dropped: they are the run's identity, not its output, and they differ by construction.
    Floats are rounded -- see ``DUMP_SIGNIFICANT_DIGITS``.
    """
    target.mkdir(parents=True, exist_ok=True)
    volatile = {"scan_id", "scan_ts", "first_scan_id", "last_scan_id", "risk_observed_at"}
    for name in (
        "silver", "ledger", "scans", "mttr", "program", "capacity", "sensitivity", "assets",
    ):
        frame = spark.table(getattr(tables, name))
        keep = [c for c in frame.columns if c not in volatile]
        rows = [{k: _round(v) for k, v in r.asDict().items()} for r in frame.select(*keep).collect()]
        rows.sort(key=lambda r: json.dumps(r, sort_keys=True, default=str))
        (target / f"{name}.json").write_text(
            json.dumps(rows, indent=1, sort_keys=True, default=str)
        )


def run(args) -> dict:
    import run_pipeline

    warehouse = Path(args.warehouse)
    if warehouse.exists():
        shutil.rmtree(warehouse)
    spark = build_session(warehouse, args.shuffle_partitions, not args.no_aqe)

    schema = "bench"
    spark.sql(f"DROP DATABASE IF EXISTS {schema} CASCADE")
    spark.sql(f"CREATE DATABASE {schema}")
    tables = run_pipeline.resolve_tables(schema, "os", argv=[])
    run_pipeline.ensure_tables(spark, tables)

    payloads = [
        scan_population(args.findings, args.seed, i, args.churn) for i in range(args.scans)
    ]
    stub_ingest(run_pipeline, payloads)

    timings = Timings(spark)
    print(
        f"[bench] {args.scans} scans x ~{args.findings} findings, churn={args.churn}, "
        f"shuffle.partitions={args.shuffle_partitions}, aqe={not args.no_aqe}"
    )
    for index in range(args.scans):
        scan_id = f"bench-scan-{index}"
        # Fixed, spaced timestamps: a benchmark that stamps wall-clock is not reproducible, and
        # `capacity_by_month` buckets on these.
        scan_ts = (dt.datetime(2026, 1, 1) + dt.timedelta(days=index)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        with timings.stage("ingest_to_bronze"):
            count = run_pipeline.ingest_to_bronze(
                spark, tables.bronze, scan_id, scan_ts, "os", SEVERITIES
            )
        # `total` is a keyword the revision under test may not have -- see `stub_ingest`.
        extra = {"total": count} if "total" in signature(run_pipeline.build_metrics).parameters else {}
        with timings.stage("build_metrics"):
            run_pipeline.build_metrics(
                spark, tables, scan_id, scan_ts, "os",
                severities=SEVERITIES, summary=False, **extra,
            )
        print(f"[bench] scan {index + 1}/{args.scans}: {count} findings")

    if args.attribute:
        attribute_stages(spark, run_pipeline, tables, timings)

    if args.dump:
        dump_tables(spark, tables, Path(args.dump))
        print(f"[bench] tables dumped to {args.dump}")

    result = {
        "findings": args.findings,
        "scans": args.scans,
        "churn": args.churn,
        "shuffle_partitions": args.shuffle_partitions,
        "aqe": not args.no_aqe,
        "stages": timings.stages,
    }
    spark.sql(f"DROP DATABASE IF EXISTS {schema} CASCADE")
    spark.stop()
    shutil.rmtree(warehouse, ignore_errors=True)
    return result


def attribute_stages(spark, run_pipeline, tables, timings: Timings) -> None:
    """Re-run the individual gold transforms so the total can be split between them.

    Separate from the run above and deliberately after it: these are extra executions, so they
    inflate nothing that the headline `build_metrics` number reports.
    """
    import ledger as ledger_mod
    import metrics
    from config import DEFAULT_RISK_RULE

    scan_ts = "2026-01-09T00:00:00Z"
    lifecycles = metrics.classify_risk(
        ledger_mod.lifecycle_frame(spark.table(tables.ledger), scan_ts), DEFAULT_RISK_RULE
    ).cache()
    lifecycles.count()
    for name, build in (
        ("attr:mttr_by_severity", lambda: metrics.mttr_by_severity(lifecycles)),
        ("attr:resolution_sources", lambda: metrics.resolution_sources(lifecycles)),
        ("attr:confusion_matrix", lambda: metrics.confusion_matrix(lifecycles)),
        (
            "attr:rule_sensitivity",
            lambda: metrics.rule_sensitivity(lifecycles, DEFAULT_RISK_RULE),
        ),
        (
            "attr:capacity_populations",
            lambda: metrics.capacity_populations(lifecycles, scan_ts),
        ),
        (
            "attr:asset_profile_populations",
            lambda: metrics.asset_profile_populations(lifecycles, scan_ts),
        ),
    ):
        with timings.stage(name):
            build().count()
    lifecycles.unpersist()


# ------------------------------------------------------------------------------- the report


def report(result: dict, baseline: Optional[dict]) -> None:
    stages = result["stages"]
    old = (baseline or {}).get("stages", {})
    width = max(len(n) for n in stages) if stages else 20
    header = f"{'stage':<{width}}  {'seconds':>9}  {'jobs':>6}"
    if baseline:
        header += f"  {'was':>9}  {'delta':>9}"
    print("\n" + header)
    print("-" * len(header))
    for name, entry in stages.items():
        line = f"{name:<{width}}  {entry['seconds']:>9.2f}  {entry['jobs']:>6}"
        if baseline:
            prior = old.get(name, {}).get("seconds")
            if prior:
                change = (entry["seconds"] - prior) / prior * 100
                line += f"  {prior:>9.2f}  {change:>8.1f}%"
            else:
                line += f"  {'-':>9}  {'-':>9}"
        print(line)

    def total(entries: dict) -> float:
        return sum(e["seconds"] for n, e in entries.items() if not n.startswith("attr:"))

    line = f"{'TOTAL':<{width}}  {total(stages):>9.2f}  {'':>6}"
    if baseline and total(old):
        change = (total(stages) - total(old)) / total(old) * 100
        line += f"  {total(old):>9.2f}  {change:>8.1f}%"
    print(line)


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--findings", type=int, default=20_000, help="findings per scan")
    parser.add_argument("--scans", type=int, default=3)
    parser.add_argument(
        "--churn", type=float, default=0.05,
        help="fraction of the register replaced between scans (drives disappearance)",
    )
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--shuffle-partitions", type=int, default=200)
    parser.add_argument("--no-aqe", action="store_true")
    parser.add_argument("--attribute", action="store_true", help="also time each gold transform")
    parser.add_argument("--out", help="write the timings to this JSON file")
    parser.add_argument("--compare", help="a previous --out file to report against")
    parser.add_argument("--dump", help="write every table to this directory as sorted JSON")
    parser.add_argument("--warehouse", default="/tmp/brick-bench-warehouse")
    args = parser.parse_args(argv)

    result = run(args)
    baseline = json.loads(Path(args.compare).read_text()) if args.compare else None
    report(result, baseline)
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=1, sort_keys=True))
        print(f"\n[bench] timings written to {args.out}")


if __name__ == "__main__":
    main()
