"""The Asset Bundle says what it deploys, and these are the parts that can be checked here.

``databricks bundle validate`` is the real gate and it cannot run in this repo: it resolves a
workspace and the current user, and there is neither. So this module checks the half that needs
no workspace -- that every path the bundle names exists, that every scope it passes is a scope
the fork it points at actually has, and that the two guards which make a scheduled run safe are
present on every scan job.

Ported from ``brick/devsecops/tests/test_bundle.py`` when the fork that used to live beside
this one was retired (S2): every job in ``brick/databricks.yml`` points at ``brick/run_pipeline.py``
now that there is only one tree, so ``FORK_OF`` -- which used to map two entry points to two
forks' ``config.py`` -- collapses to the one entry it was already heading toward. The scope
check this module exists for stays live even with nothing left to mix up with: a typo could
still point a job's ``python_file`` at some other path, and
``test_every_scope_belongs_to_the_fork_the_job_points_at`` would refuse it, because ``FORK_OF``
only recognises the one path the bundle is supposed to use.

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
FORK_OF = {
    "brick/run_pipeline.py": BRICK_DIR / "config.py",
}

VAR_REF = re.compile(r"\$\{var\.([A-Za-z_][A-Za-z0-9_]*)\}")


def scopes_of(config_path: Path) -> set:
    """The keys of that fork's ``SCOPES``, read without importing it."""
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


def parameters(job: dict) -> list:
    (task,) = job["tasks"]
    return task["spark_python_task"]["parameters"]


def flag(params: list, name: str):
    """The value of ``--name=value``, or None when the flag is absent."""
    prefix = f"--{name}="
    for param in params:
        if param.startswith(prefix):
            return param[len(prefix) :]
    return None


def is_scan(job: dict) -> bool:
    """A scan ingests; ``--maintain=true`` exits before it does."""
    return flag(parameters(job), "maintain") is None


def test_the_bundle_parses_and_names_a_job_per_register(bundle):
    assert set(jobs(bundle)) == {
        "wiz_os_scan",
        "wiz_sca_scan",
        "wiz_sast_scan",
        "wiz_os_maintain",
    }


@pytest.mark.parametrize("name", ["wiz_os_scan", "wiz_sca_scan", "wiz_sast_scan"])
def test_every_scan_passes_the_run_id_as_its_scan_id(bundle, name):
    """Without it a retry looks like a brand-new scan and advances every lifecycle twice.

    Databricks retries a failed task *within* the same run, so ``{{job.run_id}}`` makes the
    second attempt arrive with the id the first one used -- it then finds its own row in the
    scan log and does nothing (``run_pipeline``, "Retries are safe, if you pass scan_id").
    """
    assert flag(parameters(jobs(bundle)[name]), "scan_id") == "{{job.run_id}}"


def test_no_job_may_run_concurrently_with_itself(bundle):
    """Two concurrent scans of one scope both pass the recorded-scan check and reconcile twice."""
    for name, job in jobs(bundle).items():
        assert job.get("max_concurrent_runs") == 1, name


def test_every_python_file_exists(bundle):
    for name, job in jobs(bundle).items():
        (task,) = job["tasks"]
        path = task["spark_python_task"]["python_file"]
        assert (REPO_ROOT / path).is_file(), f"{name} points at a missing {path}"


def test_every_scope_belongs_to_the_fork_the_job_points_at(bundle):
    """The check that catches a job wired to an entry point whose config does not have the
    scope it was given -- the one-tree survivor of a check that used to catch two forks'
    identically-named entry points instead."""
    for name, job in jobs(bundle).items():
        (task,) = job["tasks"]
        path = task["spark_python_task"]["python_file"]
        scope = flag(parameters(job), "scope")
        assert scope is not None, f"{name} names no scope"
        assert path in FORK_OF, f"{name} runs an unknown entry point {path}"
        available = scopes_of(FORK_OF[path])
        assert scope in available, f"{name}: {path} has no scope {scope!r}, only {sorted(available)}"


def test_the_maintain_job_only_maintains(bundle):
    """It runs OPTIMIZE and exits; asking it for credentials it never uses would be noise."""
    params = parameters(jobs(bundle)["wiz_os_maintain"])
    assert flag(params, "maintain") == "true"
    assert flag(params, "severities") is None
    assert flag(params, "secret_scope") is None


def test_every_scan_names_a_catalog_and_a_schema(bundle):
    """`catalog` has no default anywhere in this pipeline, so the job has to supply one."""
    for name, job in jobs(bundle).items():
        params = parameters(job)
        assert flag(params, "catalog"), name
        assert flag(params, "schema"), name


def test_every_variable_reference_is_declared(bundle):
    """A typo in ``${var.…}`` is otherwise found by the deploy, not by the reader."""
    declared = set(bundle["variables"])
    referenced = set(VAR_REF.findall(BUNDLE.read_text()))
    assert referenced <= declared, f"undeclared: {sorted(referenced - declared)}"
    assert declared <= referenced, f"declared but never used: {sorted(declared - referenced)}"


def test_the_catalog_and_node_type_have_no_default(bundle):
    """Both fail loudly rather than guessing: one is a disclosure, the other a wrong bill.

    ``run_pipeline.resolve_namespace`` refuses to default the catalog because these tables map
    unpatched CVEs to named hosts; the bundle must not put one back. ``node_type_id`` is
    cloud-specific and a default that is valid on one cloud is a deploy failure on another.
    """
    for name in ("catalog", "node_type_id"):
        assert "default" not in bundle["variables"][name], name


def test_both_targets_exist_and_dev_is_the_default(bundle):
    targets = bundle["targets"]
    assert set(targets) == {"dev", "prod"}
    assert targets["dev"].get("default") is True
    assert targets["prod"]["mode"] == "production"
