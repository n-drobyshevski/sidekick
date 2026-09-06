"""Run a fork's real ``run_pipeline.main()`` against a fake Wiz server, into a local lake.

``scan()`` is the whole harness in one call: it puts a fork on ``sys.path`` (switching away
from whichever fork was there before, if any -- see :func:`_ensure_fork_on_path`), precreates
the tables ``create_clustered``'s builder cannot parse a three-level name for
(``devlake.lake.precreate_clustered`` / ``precreate_silver``), installs a
``devlake.fakewiz.FakeWiz`` serving the node list handed to it, and calls ``main()`` -- the real
entry point, not ``build_metrics`` -- so ``ingest_to_bronze``, ``ensure_schema``,
``recorded_scan`` and ``clear_scan`` are all exercised exactly as a Databricks Job would exercise
them.

CLI:

    python -m devlake.run --fork=brick --scope=os --scans=2 --lake=/tmp/lakecheck
    python -m devlake.run --fork=devsecops --scope=sca --scans=2 --lake=/tmp/lakecheck

Runs ``--scans`` scans a day apart, starting ``2026-06-01T00:00:00Z``, through the fork's
committed fixture (:func:`default_fixture`), and prints the ``scans`` log and the
``resolution_src`` split at the end.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Sequence
from unittest import mock

from devlake import fakewiz, lake as lake_module
from devlake import session

REPO_ROOT = Path(__file__).resolve().parent.parent

#: The committed captures each fork ships, keyed by (fork, scope). See ``default_fixture`` for
#: the scan-2 slicing rule that goes with each one.
FIXTURES = {
    ("brick", "os"): REPO_ROOT / "os_vulns_response_exemple.json",
    ("devsecops", "sca"): REPO_ROOT / "brick" / "devsecops" / "sca_findings_example.json",
    ("devsecops", "sast"): REPO_ROOT / "brick" / "devsecops" / "sast_response.json",
}


@dataclass
class RunResult:
    """What one :func:`scan` call produced.

    ``fork_result`` is the fork's own ``run_pipeline.RunResult`` (``tables``, ``scan_id``,
    ``scan_ts``, ``scope``), or ``None`` exactly when ``main()`` itself returns ``None`` -- an
    idempotent replay of an already-recorded ``scan_id``, or (not exercised by this harness) a
    maintain/export/restore run. ``tables``, ``calls`` and ``spark`` are handed back too so a
    caller need not re-derive any of them: ``tables`` is this scope's resolved table names,
    ``calls`` is the exact sequence of GraphQL requests the fake received (including their
    ``filterBy``, for a test that wants to inspect the wire shape), and ``spark`` is the session
    the scan ran against.
    """

    fork_result: Optional[Any]
    tables: Any
    calls: list
    spark: Any
    fake: fakewiz.FakeWiz


def _ensure_fork_on_path(fork: str) -> Path:
    """``session.put_fork_on_path``, recoverable across separate :func:`scan` calls.

    ``put_fork_on_path`` refuses outright to mix two forks within *one* scan, correctly: two
    forks resolving a bare ``import config`` mid-run really is the "half of one pipeline, half
    of the other" bug it exists to prevent. Across *separate* calls in the same process it is a
    different question -- a scan's whole result lives in Spark tables by the time it returns,
    not in a Python object this process keeps a reference to -- so when the *other* fork is the
    one currently resolvable, this purges ``session.FORK_MODULE_NAMES`` out of ``sys.modules``
    and both fork directories out of ``sys.path`` first, then calls ``put_fork_on_path`` fresh.

    A same-fork call -- the common case, several scans in a row -- finds no conflict and falls
    straight through; ``put_fork_on_path`` is already a no-op for that case. This is what lets
    ``python -m pytest devlake/tests`` exercise both forks' end-to-end scans in one process, and
    what lets the CLI below be invoked once per fork without caring what ran before it.
    """
    fork_dir = session.FORKS[fork].resolve()
    other_dirs = {name: path.resolve() for name, path in session.FORKS.items() if name != fork}

    conflict = any(
        entry and Path(entry).resolve() in other_dirs.values() for entry in sys.path
    )
    if not conflict:
        for name in session.FORK_MODULE_NAMES:
            module = sys.modules.get(name)
            module_file = getattr(module, "__file__", None) if module is not None else None
            if module_file and Path(module_file).resolve().parent != fork_dir:
                conflict = True
                break

    if conflict:
        for name in session.FORK_MODULE_NAMES:
            sys.modules.pop(name, None)
        all_dirs = {p.resolve() for p in session.FORKS.values()}
        sys.path[:] = [p for p in sys.path if not (p and Path(p).resolve() in all_dirs)]

    return session.put_fork_on_path(fork)


def purge_fork_state() -> None:
    """Unload whichever fork is currently active, leaving a clean process behind.

    Not needed between two ``scan()`` calls -- :func:`_ensure_fork_on_path` already handles
    that -- only at the end of a test module that used this package's fork-switching to run
    both forks in one pytest session, so a *different* test file collected afterward (one that
    calls the plain ``devlake.session.put_fork_on_path`` and expects a fresh process) is not
    left holding a refusal for a fork it never asked for.
    """
    for name in session.FORK_MODULE_NAMES:
        sys.modules.pop(name, None)
    all_dirs = {p.resolve() for p in session.FORKS.values()}
    sys.path[:] = [p for p in sys.path if not (p and Path(p).resolve() in all_dirs)]


def _extract_nodes(payload: Any) -> list:
    """The same "any connection under ``data``" fallback ``ingest.extract_nodes`` uses in both
    forks, duplicated rather than imported: this runs in :func:`default_fixture`, which has to
    work *before* any fork is on ``sys.path`` (the CLI resolves the fixture before it resolves
    ``--fork``'s ``config.SCOPES`` for the refusal check), so there is no fork ``ingest`` module
    to import from yet."""
    if isinstance(payload, list):
        return [n for n in payload if isinstance(n, dict)]
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, dict) and isinstance(value.get("nodes"), list):
                return [n for n in value["nodes"] if isinstance(n, dict)]
    if isinstance(payload.get("nodes"), list):
        return [n for n in payload["nodes"] if isinstance(n, dict)]
    return []


def default_fixture(fork: str, scope: str):
    """The committed capture for ``(fork, scope)``, plus the scan-2 slicing rule that makes
    disappearance actually fire on it. Returns ``(path, scan1_nodes, scan2_nodes)``.

    **os** (``os_vulns_response_exemple.json``, 4 findings, in file order): CRITICAL/OPEN,
    HIGH/RESOLVED, MEDIUM/OPEN, LOW/RESOLVED. The obvious slice -- a first-half truncation, the
    one ``brick/tests/test_catalog_mode.py``'s own fixture uses -- keeps the first two and
    drops the last two, and **resolves nothing by disappearance**: the dropped MEDIUM/OPEN
    finding's severity is outside the default ``CRITICAL,HIGH`` scan scope, so
    ``ledger.reconcile``'s guard correctly declines to resolve-by-disappearance a severity that
    was never scanned (``config.py``'s own comment: "reconciliation never resolves-by-
    disappearance a severity that was not scanned"), and the dropped LOW/RESOLVED finding was
    already resolved by the API in scan 1, so its absence from scan 2 resolves nothing either
    -- it is already resolved. Scan 2 here instead drops **index 0**, the CRITICAL/OPEN finding:
    CRITICAL is inside the default scan scope, so its disappearance is exactly what the guard
    is for, and it is the case this harness's end-to-end test asserts on.

    **sca** (``sca_findings_example.json``, 54 findings): a plain first-half truncation already
    fires disappearance here -- measured, the dropped half carries 14 HIGH/OPEN and 7
    CRITICAL/OPEN findings, both inside the default scan scope -- so no special slice is needed.

    **sast** (``sast_response.json``, 40 findings, all HIGH/OPEN, no ``createdAt`` -- the
    capture predates that column): scan 2 here is the same 40 nodes again, which resolves and
    reopens nothing; the payoff this harness exists to demonstrate for SAST is the birth-date
    column, not the disappearance guard (the sca and os cases already cover that), so
    ``test_end_to_end.py`` adds one synthetic node carrying ``createdAt`` itself rather than
    this function inventing tenant data that was never actually captured.
    """
    key = (fork, scope)
    path = FIXTURES.get(key)
    if path is None:
        raise RuntimeError(
            f"no default fixture for fork={fork!r} scope={scope!r} -- expected one of "
            f"{sorted(FIXTURES)}"
        )
    nodes = _extract_nodes(json.loads(path.read_text()))
    if key == ("brick", "os"):
        scan2 = nodes[1:]
    elif key == ("devsecops", "sca"):
        half = max(1, len(nodes) // 2)
        scan2 = nodes[:half]
    else:  # ("devsecops", "sast")
        scan2 = list(nodes)
    return path, nodes, scan2


def scan(
    fork: str,
    scope: str,
    nodes: Sequence[dict],
    *,
    lake: "Path | str",
    schema: str,
    scan_id: str,
    scan_ts: str,
    severities: str = "CRITICAL,HIGH",
    spark: Any = None,
    extra_argv: Sequence[str] = (),
) -> RunResult:
    """Run one fake scan through ``run_pipeline.main()``.

    ``nodes`` is exactly what the fake Wiz server answers with for this call -- there is no
    severity filtering applied to it here (the real API's own filtering is not reproduced by
    the fake; see ``fakewiz.FakeWiz``), so the caller picks ``severities`` wide enough to cover
    whatever it put in ``nodes``, the same way a real scan's ``--severities`` has to cover the
    population an operator actually wants back.

    ``spark`` lets several ``scan()`` calls share one session (and therefore one JVM) across
    scopes or scans -- pass the same session in and this never calls
    ``devlake.session.build`` at all. Left ``None``, it builds one against ``lake``.
    """
    lake_path = Path(lake).resolve()
    _ensure_fork_on_path(fork)
    import ingest as ingest_module  # noqa: PLC0415 -- bare, resolves against `fork` on sys.path
    import run_pipeline as run_pipeline_module  # noqa: PLC0415

    if scope not in run_pipeline_module.SCOPES:
        raise RuntimeError(
            f"unknown scope {scope!r} for fork {fork!r} -- expected one of "
            f"{sorted(run_pipeline_module.SCOPES)}"
        )

    if spark is None:
        spark = session.build(lake_path)

    # Creates the schema too (CREATE SCHEMA IF NOT EXISTS) -- both precreation calls below need
    # it to already exist, and main()'s own ensure_schema only runs after they do.
    lake_module.reregister(spark, lake_path, schema)
    namespace = lake_module.namespace(schema)
    tables = run_pipeline_module.resolve_tables(namespace, scope, argv=[])
    lake_module.precreate_clustered(spark, run_pipeline_module, tables)
    lake_module.precreate_silver(spark, run_pipeline_module, tables.silver, scope)

    fake = fakewiz.FakeWiz(scope, ingest_module, nodes=nodes)

    argv = [
        "run_pipeline.py",
        "--catalog=spark_catalog",
        f"--schema={schema}",
        f"--scope={scope}",
        f"--scan_id={scan_id}",
        f"--severities={severities}",
        "--wiz_api_url=https://fake.invalid/graphql",
        *extra_argv,
    ]

    with contextlib.ExitStack() as stack:
        fakewiz.install(stack, ingest_module, fake, run_pipeline_module=run_pipeline_module)
        stack.enter_context(mock.patch.object(run_pipeline_module, "utc_now_iso", lambda: scan_ts))
        stack.enter_context(mock.patch.object(sys, "argv", argv))
        stack.enter_context(
            mock.patch.dict(os.environ, {"WIZ_CLIENT_ID": "fake", "WIZ_CLIENT_SECRET": "fake"})
        )
        fork_result = run_pipeline_module.main()

    return RunResult(fork_result=fork_result, tables=tables, calls=fake.calls, spark=spark, fake=fake)


def _cli(argv: Optional[Sequence[str]] = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="python -m devlake.run",
        description=(
            "Run N fake Wiz scans through a fork's real run_pipeline.main(), into a local lake."
        ),
    )
    parser.add_argument("--fork", required=True, choices=sorted(session.FORKS))
    parser.add_argument("--scope", required=True)
    parser.add_argument("--scans", type=int, default=2)
    parser.add_argument("--lake", required=True)
    parser.add_argument("--schema", default="wiz")
    args = parser.parse_args(argv)

    _ensure_fork_on_path(args.fork)
    import run_pipeline as run_pipeline_module  # noqa: PLC0415

    if args.scope not in run_pipeline_module.SCOPES:
        raise SystemExit(
            f"unknown scope {args.scope!r} for fork {args.fork!r} -- expected one of "
            f"{sorted(run_pipeline_module.SCOPES)}"
        )

    _, scan1_nodes, scan2_nodes = default_fixture(args.fork, args.scope)
    node_sets = [scan1_nodes] + [scan2_nodes] * max(0, args.scans - 1)

    lake_dir = Path(args.lake)
    spark = session.build(lake_dir, app_name=f"devlake-run-{args.fork}-{args.scope}")

    base = dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc)
    result: Optional[RunResult] = None
    for i, scan_nodes in enumerate(node_sets[: args.scans]):
        scan_ts = (base + dt.timedelta(days=i)).strftime("%Y-%m-%dT%H:%M:%SZ")
        scan_id = f"scan-{i + 1}"
        result = scan(
            args.fork, args.scope, scan_nodes,
            lake=lake_dir, schema=args.schema, scan_id=scan_id, scan_ts=scan_ts, spark=spark,
        )
        print(f"[{scan_id}] {scan_ts}: {result.fork_result}")

    if result is None:
        print("no scans ran (--scans <= 0)")
        return 0

    tables = result.tables
    print("\n-- scans --")
    spark.table(tables.scans).orderBy("scan_ts").show(truncate=False)
    print("-- resolution_src split (ledger) --")
    spark.table(tables.ledger).groupBy("resolution_src").count().orderBy("resolution_src").show(
        truncate=False
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
