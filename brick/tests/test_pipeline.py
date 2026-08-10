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
from brick.config import SCOPES  # noqa: E402
from brick.ingest import build_filter  # noqa: E402


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


def test_identifiers_are_validated(monkeypatch):
    """catalog / schema / prefix are interpolated into SQL, so a typo fails loudly."""
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    with pytest.raises(RuntimeError, match="not a valid identifier"):
        run_pipeline.resolve_namespace(argv=["--catalog=ok", "--schema=wiz;DROP TABLE x"])
    with pytest.raises(RuntimeError, match="not a valid identifier"):
        run_pipeline.resolve_tables("cat.sch", "os", argv=["--table_prefix=bad-prefix"])


def test_tables_are_prefixed_with_the_scope_by_default(monkeypatch):
    """A shared schema makes bare `findings` / `metrics_capacity` a collision risk, and the
    scope in the name keeps an OS run and an all-types run in separate tables."""
    monkeypatch.delenv("TABLE_PREFIX", raising=False)
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    ns = "datalake_insights_analytics.industry"
    tables = run_pipeline.resolve_tables(ns, "os", argv=[])
    assert tables.bronze == f"{ns}.wiz_os_findings_raw"
    assert tables.silver == f"{ns}.wiz_os_findings"
    assert tables.capacity == f"{ns}.wiz_os_metrics_capacity"

    assert run_pipeline.resolve_tables(ns, "all", argv=[]).silver == f"{ns}.wiz_all_findings"


def test_table_prefix_is_overridable_and_can_be_empty(monkeypatch):
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    assert (
        run_pipeline.resolve_tables("c.s", "os", argv=["--table_prefix=sec_"]).mttr
        == "c.s.sec_metrics_mttr"
    )
    bare = run_pipeline.resolve_tables("c.s", "os", argv=["--table_prefix="])
    assert bare.mttr == "c.s.metrics_mttr"


def test_scope_defaults_to_os_and_rejects_unknown_values(monkeypatch):
    monkeypatch.delenv("SCOPE", raising=False)
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    assert run_pipeline.resolve_scope(argv=[]) == "os"
    assert run_pipeline.resolve_scope(argv=["--scope=all"]) == "all"
    with pytest.raises(RuntimeError, match="unknown scope"):
        run_pipeline.resolve_scope(argv=["--scope=containers"])


def test_existing_schema_is_not_recreated():
    """A service principal in a shared catalog usually has CREATE TABLE on one schema and no
    CREATE SCHEMA on the catalog, so an unconditional CREATE would fail on a writable schema."""

    class FakeSpark:
        def __init__(self):
            self.catalog = self
            self.statements = []

        def databaseExists(self, name):  # noqa: N802 -- mirrors the Spark API
            return True

        def sql(self, statement):
            self.statements.append(statement)

    spark = FakeSpark()
    run_pipeline.ensure_schema(spark, "shared.industry")
    assert spark.statements == []


def test_missing_schema_is_created():
    class FakeSpark:
        def __init__(self):
            self.catalog = self
            self.statements = []

        def databaseExists(self, name):  # noqa: N802 -- mirrors the Spark API
            return False

        def sql(self, statement):
            self.statements.append(statement)

    spark = FakeSpark()
    run_pipeline.ensure_schema(spark, "sec.wiz")
    assert spark.statements == ["CREATE SCHEMA IF NOT EXISTS sec.wiz"]


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


# ------------------------------------------------------------------- the scope filter
#
# This dict decides which population every downstream metric is computed over. A wrong key
# here is not an error -- it is a plausible-looking number about the wrong thing.


def test_os_scope_matches_the_dashboards_population():
    """Parity with os_vulns.VARIABLES["filterBy"], which is what the Streamlit app measures."""
    got = build_filter("os", ["CRITICAL"])
    assert got["detectionMethod"] == ["OS"]
    assert got["assetType"] == ["VIRTUAL_MACHINE"]
    assert got["hasFix"] is True
    assert got["assetIsRepresentativeResource"] is False
    assert got["detailedNameV2"] == {"notEquals": ["openssl", "python", "vim"]}
    assert got["severity"] == ["CRITICAL"]


def test_every_scope_asks_for_resolved_findings():
    """Without this the API returns only OPEN findings and every remediation metric collapses
    -- coverage 0%, efficiency undefined, MTTR empty -- while looking like a real result."""
    for scope in SCOPES:
        assert build_filter(scope)["status"] == ["OPEN", "RESOLVED"]


def test_all_scope_does_not_restrict_type_or_asset():
    got = build_filter("all")
    assert "detectionMethod" not in got
    assert "assetType" not in got
    assert "hasFix" not in got


def test_project_id_is_opt_in():
    """os_vulns.py hardcodes one tenant's projectIdV2; copying it would silently scope every
    run to that project."""
    assert "projectIdV2" not in build_filter("os")
    assert build_filter("os", project_id="p-1")["projectIdV2"] == {"equals": ["p-1"]}


def test_build_filter_does_not_mutate_the_scope_template():
    build_filter("os", ["LOW"], project_id="p-1")
    assert "severity" not in SCOPES["os"]
    assert "projectIdV2" not in SCOPES["os"]


def test_unknown_scope_is_rejected():
    with pytest.raises(RuntimeError, match="unknown scope"):
        build_filter("nope")
