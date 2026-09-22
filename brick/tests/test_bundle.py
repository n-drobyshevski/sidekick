"""The Asset Bundle says what it deploys, and these are the parts that can be checked here.

``databricks bundle validate`` is the real gate and it cannot run in this repo: it resolves a
workspace and the current user, and there is neither. So this module checks the half that needs
no workspace -- that every path the bundle names exists, that every scope it passes is a scope
the tree it points at actually has, and that the two guards which make a scheduled run safe are
present on every scan task.

Ported from the OS register's own ``brick/tests/test_bundle.py`` -- ``git show
ef22b05^:brick/tests/test_bundle.py`` -- when the fork that lived beside it absorbed the ``os``
scope (S2); this file is that fork's copy, moved up from ``brick/devsecops/tests/`` when that
directory was retired at ``ef22b05``. Every job in ``brick/databricks.yml`` points at
``brick/run_pipeline.py`` now that there is only one tree, so ``CONFIG_FOR`` -- which used to
map two entry points to two forks' ``config.py`` -- collapses to the one entry it was already
heading toward. The scope check this module exists for stays live even with nothing left to mix
up with: a typo could still point a job's ``python_file`` at some other path, and
``test_every_scope_belongs_to_the_tree_the_job_points_at`` would refuse it, because
``CONFIG_FOR`` only recognises the one path the bundle is supposed to use.

Step 3 collapsed the three single-task scan jobs into one ``wiz_scan`` job with three chained
tasks (``scan_os -> scan_sca -> scan_sast``), because every scope now writes the same three
tables and three concurrent MERGEs into one ``wiz_vuln_ledger`` would conflict. ``parameters()``
therefore takes a ``task_key`` -- a job here may hold more than one task -- and the tests below
add the chain shape and the per-task scope/scan_id checks that a single-task job never needed.

``config.SCOPES`` is read with ``ast`` rather than imported so this test module needs no
``sys.path`` entry of its own and cannot collide with whatever a test run elsewhere already put
on ``sys.path`` (see ``brick/tests/test_deployment_integrity.py`` for the guard that matters when
something does).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml", reason="the bundle is YAML: pip install pyyaml")

BRICK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRICK_DIR.parent
BUNDLE = BRICK_DIR / "databricks.yml"

#: Which tree each entry point belongs to, and therefore whose ``SCOPES`` its ``--scope`` is
#: checked against. One entry: every job in the bundle points at this tree's ``run_pipeline.py``.
CONFIG_FOR = {
    "brick/run_pipeline.py": BRICK_DIR / "config.py",
}

VAR_REF = re.compile(r"\$\{var\.([A-Za-z_][A-Za-z0-9_]*)\}")


def scopes_of(config_path: Path) -> set:
    """The keys of that tree's ``SCOPES``, read without importing it."""
    tree = ast.parse(config_path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "SCOPES" for t in node.targets
        ):
            return {
                key.value
                for key in node.value.keys
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            }
    raise AssertionError(f"no SCOPES assignment in {config_path}")


@pytest.fixture(scope="module")
def bundle() -> dict:
    return yaml.safe_load(BUNDLE.read_text())


def jobs(bundle: dict) -> dict:
    return bundle["resources"]["jobs"]


def all_tasks(job: dict) -> list:
    """Every task of a job, in the order the bundle declares them."""
    return job["tasks"]


def parameters(job: dict, task_key: str) -> list:
    """The ``spark_python_task`` parameters of one named task in a job.

    A job may hold more than one task since Step 3 chained the three scan tasks into
    ``wiz_scan``, so the single-task shortcut this used to be (``(task,) = job["tasks"]``) would
    now raise on the very job it is asked about most.
    """
    for task in all_tasks(job):
        if task["task_key"] == task_key:
            return task["spark_python_task"]["parameters"]
    raise AssertionError(f"no task {task_key!r} in job {job.get('name', '?')!r}")


def flag(params: list, name: str):
    """The value of ``--name=value``, or None when the flag is absent."""
    prefix = f"--{name}="
    for param in params:
        if param.startswith(prefix):
            return param[len(prefix) :]
    return None


def test_the_bundle_parses_and_names_one_scan_job_and_one_maintain_job(bundle):
    assert set(jobs(bundle)) == {"wiz_scan", "wiz_maintain"}


def test_the_scan_job_has_exactly_three_tasks(bundle):
    task_keys = [task["task_key"] for task in all_tasks(jobs(bundle)["wiz_scan"])]
    assert task_keys == ["scan_os", "scan_sca", "scan_sast"]


def test_every_scan_task_names_a_scope_the_tree_has(bundle):
    scan_job = jobs(bundle)["wiz_scan"]
    scopes = {
        task["task_key"]: flag(task["spark_python_task"]["parameters"], "scope")
        for task in all_tasks(scan_job)
    }
    assert all(scopes.values()), f"a task names no scope: {scopes}"
    assert set(scopes.values()) == {"os", "sca", "sast"}
    available = scopes_of(CONFIG_FOR["brick/run_pipeline.py"])
    missing = set(scopes.values()) - available
    assert not missing, f"{missing} not in config.SCOPES ({sorted(available)})"


def test_every_scan_id_is_retry_stable_and_distinct_per_scope(bundle):
    """``{{job.run_id}}`` is constant across a task's own retries; ``{{task.run_id}}`` is not
    (CLAUDE.md, "Databricks {{task.run_id}} changes on a task retry").

    Every scan task's ``--scan_id`` must be built from the job-scoped token, and no two tasks in
    the chain may resolve to the same id -- the three scopes now write commit rows into one
    shared ``wiz_metrics``, so a collision would let one scope's row overwrite another's.
    """
    scan_ids = []
    for task in all_tasks(jobs(bundle)["wiz_scan"]):
        scan_id = flag(task["spark_python_task"]["parameters"], "scan_id")
        assert scan_id is not None, task["task_key"]
        assert scan_id.startswith("{{job.run_id}}"), scan_id
        assert "{{task.run_id}}" not in scan_id, scan_id
        scan_ids.append(scan_id)
    assert len(scan_ids) == len(set(scan_ids)), scan_ids


def test_the_scan_chain_is_linear_and_survives_a_failed_link(bundle):
    """Concurrent MERGEs into one ledger would conflict, hence the chain (depends_on); a failing
    scope must neither block the scope behind it nor be blocked by the scope before it, hence
    ``run_if: ALL_DONE`` rather than the default ``ALL_SUCCESS``."""
    by_key = {task["task_key"]: task for task in all_tasks(jobs(bundle)["wiz_scan"])}
    assert by_key["scan_os"].get("depends_on") in (None, []), "scan_os must start the chain"
    assert by_key["scan_sca"]["depends_on"] == [{"task_key": "scan_os"}]
    assert by_key["scan_sca"]["run_if"] == "ALL_DONE"
    assert by_key["scan_sast"]["depends_on"] == [{"task_key": "scan_sca"}]
    assert by_key["scan_sast"]["run_if"] == "ALL_DONE"


def test_no_job_may_run_concurrently_with_itself(bundle):
    """Two concurrent runs of the same chain would let two tasks race the same MERGE target."""
    for name, job in jobs(bundle).items():
        assert job.get("max_concurrent_runs") == 1, name


def test_every_python_file_exists(bundle):
    for name, job in jobs(bundle).items():
        for task in all_tasks(job):
            path = task["spark_python_task"]["python_file"]
            assert (REPO_ROOT / path).is_file(), f"{name}/{task['task_key']} points at a missing {path}"


def test_every_scope_belongs_to_the_tree_the_job_points_at(bundle):
    """The check that catches a task wired to an entry point whose config does not have the
    scope it was given -- the one-tree survivor of a check that used to catch two forks'
    identically-named entry points instead."""
    for name, job in jobs(bundle).items():
        for task in all_tasks(job):
            path = task["spark_python_task"]["python_file"]
            scope = flag(task["spark_python_task"]["parameters"], "scope")
            assert scope is not None, f"{name}/{task['task_key']} names no scope"
            assert path in CONFIG_FOR, (
                f"{name}/{task['task_key']} runs an unknown entry point {path}"
            )
            available = scopes_of(CONFIG_FOR[path])
            assert scope in available, (
                f"{name}/{task['task_key']}: {path} has no scope {scope!r}, "
                f"only {sorted(available)}"
            )


def test_the_maintain_job_only_maintains(bundle):
    """It runs OPTIMIZE and exits; asking it for credentials it never uses would be noise."""
    params = parameters(jobs(bundle)["wiz_maintain"], "maintain")
    assert flag(params, "maintain") == "true"
    assert flag(params, "severities") is None
    assert flag(params, "secret_scope") is None


def test_every_task_names_a_catalog_and_a_schema(bundle):
    """`catalog` has no default anywhere in this pipeline, so every task has to supply one."""
    for name, job in jobs(bundle).items():
        for task in all_tasks(job):
            params = task["spark_python_task"]["parameters"]
            assert flag(params, "catalog"), f"{name}/{task['task_key']}"
            assert flag(params, "schema"), f"{name}/{task['task_key']}"


def test_every_variable_reference_is_declared(bundle):
    """A typo in ``${var.…}`` is otherwise found by the deploy, not by the reader."""
    declared = set(bundle["variables"])
    referenced = set(VAR_REF.findall(BUNDLE.read_text()))
    assert referenced <= declared, f"undeclared: {sorted(referenced - declared)}"
    assert declared <= referenced, f"declared but never used: {sorted(declared - referenced)}"


def test_the_catalog_and_node_type_have_no_default(bundle):
    """Both fail loudly rather than guessing: one is a disclosure, the other a wrong bill.

    ``run_pipeline.resolve_namespace`` refuses to default the catalog because these tables map
    unpatched CVEs to named hosts and repositories; the bundle must not put one back.
    ``node_type_id`` is cloud-specific and a default that is valid on one cloud is a deploy
    failure on another.
    """
    for name in ("catalog", "node_type_id"):
        assert "default" not in bundle["variables"][name], name


def test_both_targets_exist_and_dev_is_the_default(bundle):
    targets = bundle["targets"]
    assert set(targets) == {"dev", "prod"}
    assert targets["dev"].get("default") is True
    assert targets["prod"]["mode"] == "production"
