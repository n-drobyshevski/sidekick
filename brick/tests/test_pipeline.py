"""Wiring tests for the Databricks entry point.

These guard the parts that only fail on a cluster: parameter resolution across the three
places Databricks can supply them from, and the ``dbutils`` accessors degrading quietly when
there is no Databricks around. Getting these wrong produces a job that imports fine and then
does nothing useful.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip(
    "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
)

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from brick import dbx, run_pipeline  # noqa: E402


def test_param_prefers_command_line(monkeypatch):
    """A Job's Python file task passes parameters as `--name=value` argv, not as widgets."""
    monkeypatch.setenv("CATALOG", "from_env")
    assert run_pipeline.param("catalog", argv=["--catalog=from_argv"]) == "from_argv"


def test_param_falls_back_to_env_then_default(monkeypatch):
    monkeypatch.setenv("SCHEMA", "from_env")
    assert run_pipeline.param("schema", argv=[]) == "from_env"
    monkeypatch.delenv("SCHEMA")
    assert run_pipeline.param("schema", "fallback", argv=[]) == "fallback"


def test_param_reads_widgets_when_databricks_is_present(monkeypatch):
    monkeypatch.setattr(dbx, "widget", lambda name: "from_widget" if name == "catalog" else "")
    monkeypatch.setenv("CATALOG", "from_env")
    assert run_pipeline.param("catalog", argv=[]) == "from_widget"


def test_param_handles_a_value_containing_equals():
    got = run_pipeline.param("wiz_api_url", argv=["--wiz_api_url=https://x/graphql?a=b"])
    assert got == "https://x/graphql?a=b"


def test_catalog_is_required(monkeypatch):
    """No default catalog. `main` exists in most UC metastores and is often broadly readable,
    so a default that quietly succeeds would land security findings in the wrong place."""
    monkeypatch.delenv("CATALOG", raising=False)
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    with pytest.raises(RuntimeError, match="--catalog"):
        run_pipeline.resolve_namespace(argv=[])


def test_empty_catalog_counts_as_missing(monkeypatch):
    monkeypatch.delenv("CATALOG", raising=False)
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    with pytest.raises(RuntimeError, match="--catalog"):
        run_pipeline.resolve_namespace(argv=["--catalog="])


def test_namespace_resolves_from_parameters(monkeypatch):
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    assert run_pipeline.resolve_namespace(argv=["--catalog=sec", "--schema=vulns"]) == "sec.vulns"


def test_schema_defaults_to_wiz_once_the_catalog_is_named(monkeypatch):
    monkeypatch.delenv("SCHEMA", raising=False)
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    assert run_pipeline.resolve_namespace(argv=["--catalog=sec"]) == "sec.wiz"


def test_dbutils_accessors_are_quiet_off_cluster():
    """Off Databricks these must return empty, not raise -- the env-var path depends on it."""
    assert dbx.get_dbutils() is None
    assert dbx.widget("anything") == ""
    assert dbx.secret_value("scope", "key") == ""


def test_secret_raises_a_useful_message_when_nothing_is_configured(monkeypatch):
    monkeypatch.delenv("WIZ_CLIENT_ID", raising=False)
    with pytest.raises(RuntimeError, match="WIZ_CLIENT_ID"):
        run_pipeline.secret(None, "wiz-client-id", "WIZ_CLIENT_ID")


def test_severity_filter_maps_info_to_the_api_spelling():
    from brick.ingest import severity_filter

    assert severity_filter(["critical", "high", "info"]) == [
        "CRITICAL",
        "HIGH",
        "INFORMATIONAL",
    ]
