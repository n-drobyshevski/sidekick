"""Wiring tests for the Databricks entry point.

These guard the parts that only fail on a cluster: parameter resolution across the three
places Databricks can supply them from, and the ``dbutils`` accessors degrading quietly when
there is no Databricks around. Getting these wrong produces a job that imports fine and then
does nothing useful.
"""

from __future__ import annotations

import json
import re
import sys
import types
from pathlib import Path

import pytest

pytest.importorskip(
    "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
)

# The modules are plain top-level files, so their own directory goes on the path -- the same
# arrangement the Databricks side uses.
BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import dbx  # noqa: E402
import run_pipeline  # noqa: E402
from config import SCOPES  # noqa: E402
import ingest  # noqa: E402
from config import FETCH_ASSET_FIELDS  # noqa: E402
from ingest import QUERY, build_filter, describe_errors  # noqa: E402


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
    # A deliberately generic namespace: the catalog is a runtime parameter, and a real one
    # here would read like configuration.
    ns = "some_catalog.some_schema"
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


def test_ingest_keeps_the_population_scope_separate_from_the_secret_scope(monkeypatch):
    """Regression: `scope` (which vulnerabilities) and `secret_scope` (where the credentials
    live) are different things. Sharing a local name overwrote the first with the second, so
    the population scope reaching the API was the string "wiz"."""
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    monkeypatch.setenv("WIZ_API_URL", "https://api.test.app.wiz.io/graphql")
    monkeypatch.setenv("SECRET_SCOPE", "wiz")
    monkeypatch.setenv("SEVERITIES", "CRITICAL")
    monkeypatch.setattr(sys, "argv", ["run_pipeline.py"])

    seen = {}
    monkeypatch.setattr(run_pipeline, "get_token", lambda *a, **k: "token")
    monkeypatch.setattr(run_pipeline, "secret", lambda scope, key, env: f"{scope}/{key}")
    # This test is about which `scope` reaches the API, and it drives `ingest_to_bronze` against
    # a hand-rolled fake session. Creating bronze for real needs a Delta catalog the fake does
    # not have and this test does not care about -- `test_ledger_pipeline` covers that.
    monkeypatch.setattr(run_pipeline, "create_clustered", lambda *a, **k: None)

    def fake_fetch(api_url, token, **kwargs):
        seen.update(kwargs)
        return iter([{"id": "f-1", "severity": "CRITICAL"}])

    monkeypatch.setattr(run_pipeline, "fetch_findings", fake_fetch)

    written = {}

    class FakeWriter:
        def format(self, _):  # noqa: A003 -- mirrors the Spark API
            return self

        def mode(self, _):
            return self

        def option(self, *_):
            return self

        def saveAsTable(self, name):  # noqa: N802 -- mirrors the Spark API
            written["table"] = name

    class FakeDF:
        def __init__(self, rows):
            self.rows = rows
            self.write = FakeWriter()

        def __getitem__(self, _):
            return self

        def cast(self, _):
            return self

        def withColumn(self, *_):
            return self

    class FakeSpark:
        def createDataFrame(self, rows, schema):  # noqa: N802 -- mirrors the Spark API
            written["rows"] = rows
            return FakeDF(rows)

    count = run_pipeline.ingest_to_bronze(
        FakeSpark(), "cat.sch.wiz_os_findings_raw", "scan-1", "2026-07-01T00:00:00Z", "os"
    )

    assert count == 1
    assert seen["scope"] == "os"  # the population, not "wiz"
    assert written["rows"][0][2] == "os"  # and the same value lands in bronze
    assert written["table"] == "cat.sch.wiz_os_findings_raw"


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
    from ingest import severity_filter

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


def test_scopes_share_the_actionable_filter():
    """hasFix is shared so remediation rates mean the same thing in each scope. Without it,
    awaiting-vendor-fix findings would sit in `all`'s coverage denominator and not in `os`'s,
    making `all` look worse for a reason that is not performance."""
    for scope in SCOPES:
        assert build_filter(scope)["hasFix"] is True


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


# ----------------------------------------------------------------------- the query


def test_the_shipped_query_does_not_ask_for_the_asset():
    """The live tenant no longer has those union members, and it rejects the whole request --
    not the sub-selection, the request. One unavailable field would cost every scan."""
    assert "vulnerableAsset" not in QUERY
    assert ingest.QUERY == ingest.build_query(FETCH_ASSET_FIELDS)
    assert FETCH_ASSET_FIELDS is False


def test_the_query_still_parses_with_the_asset_omitted():
    """An empty `vulnerableAsset {}` would be a syntax error, so the slot has to collapse
    entirely rather than render an empty block."""
    assert "{}" not in QUERY.replace(" ", "")
    # The fields the metrics actually depend on are all still there.
    for field in (
        "severity", "status", "firstDetectedAt", "resolvedAt",
        "hasExploit", "hasCisaKevExploit", "epssProbability",
    ):
        assert field in QUERY


def test_vulnerable_asset_is_selected_through_inline_fragments():
    """`vulnerableAsset` is a union: selecting its fields directly is a GraphQL validation
    error and the server answers 400. That is how this first failed against a live tenant.

    Asserted against the enabled form, which is what a tenant that still has these members
    would send -- the fragments have to stay correct for the constant to be worth flipping.
    """
    enabled = ingest.build_query(True)
    assert "... on VulnerableAssetVirtualMachine {" in enabled  # what scope=os returns
    assert "... on VulnerableAssetBase {" in enabled

    # No bare field selection between `vulnerableAsset {` and the first fragment.
    body = enabled.split("vulnerableAsset {", 1)[1].split("... on", 1)[0]
    assert not body.strip(), f"bare selection on the union: {body.strip()!r}"


def test_query_never_asks_a_member_for_a_field_it_lacks():
    """Two members genuinely lack some of the fields; asking anyway is another 400."""
    enabled = ingest.build_query(True)
    for member, missing in ingest._ASSET_OMISSIONS.items():
        block = enabled.split(f"... on {member} {{", 1)[1].split("}", 1)[0]
        selected = {line.strip() for line in block.splitlines() if line.strip()}
        assert not (selected & missing), f"{member} asked for {selected & missing}"


def test_every_asset_member_selects_something():
    enabled = ingest.build_query(True)
    for member in ingest._ASSET_MEMBERS:
        block = enabled.split(f"... on {member} {{", 1)[1].split("}", 1)[0]
        assert block.strip(), f"{member} has an empty selection set, which is also invalid"


# ------------------------------------------------------------------ error legibility


def test_graphql_errors_are_surfaced_by_message():
    """A 400 body names the offending field or filter key. raise_for_status() would report
    the status and throw that away, leaving nothing to debug from."""
    body = json.dumps(
        {
            "errors": [
                {
                    "message": 'Cannot query field "epssProbabilty" on type '
                    '"VulnerabilityFinding".',
                    "extensions": {"code": "GRAPHQL_VALIDATION_FAILED"},
                }
            ]
        }
    )
    got = describe_errors(body)
    assert "epssProbabilty" in got
    assert "GRAPHQL_VALIDATION_FAILED" in got


def test_unparseable_error_body_still_says_something():
    assert "upstream timeout" in describe_errors("<html>upstream timeout</html>")
    assert describe_errors("") == "(empty response body)"


# ------------------------------------------------------------- deployment consistency
#
# v2 added a sixth runtime module, ledger.py, and shipped with a README whose deployment tree
# still listed five. Following it produced a workspace holding v2's metrics.py and v1's
# run_pipeline.py, which imports cleanly and then dies at the silver write -- 137,870 findings
# into the first real run, as "A schema mismatch detected when writing to the Delta table".
# These tests exist so that specific mistake cannot be made silently again.

README = BRICK_DIR / "README.md"


def _readme_module_tree() -> set:
    """The `.py` filenames in the README's deployment file tree."""
    lines = README.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if "this path goes on sys.path" in line)
    names = set()
    for line in lines[start + 1:]:
        if line.startswith("```"):
            break
        match = re.search(r"([A-Za-z_][A-Za-z0-9_]*\.py)", line)
        if match:
            names.add(match.group(1))
    return names


def test_readme_deployment_tree_matches_the_real_import_graph():
    """The deployment instructions cannot drift from what the code actually needs.

    This is the test that would have caught the v2 release: adding a module without adding it
    to the tree now fails here rather than on someone's cluster.
    """
    documented = _readme_module_tree()
    assert documented, "could not find the deployment file tree in README.md"
    expected = {f"{name}.py" for name in run_pipeline.RUNTIME_MODULES}
    assert documented == expected, (
        f"README deployment tree and RUNTIME_MODULES disagree: "
        f"only in README {sorted(documented - expected)}, "
        f"only in code {sorted(expected - documented)}"
    )


def test_readme_does_not_still_say_five_modules():
    """The prose carried the count too, and prose does not fail a schema check."""
    text = README.read_text(encoding="utf-8")
    assert "five `.py` modules" not in text
    assert "ledger.py" in text


def test_every_runtime_module_declares_a_version():
    """A seventh module added later must not be able to opt out of the guard."""
    import importlib

    for name in run_pipeline.RUNTIME_MODULES:
        module = importlib.import_module(name)
        assert getattr(module, "MODULE_VERSION", None) == run_pipeline.PIPELINE_VERSION, (
            f"{name}.py is missing MODULE_VERSION or disagrees with config.PIPELINE_VERSION"
        )


def test_check_deployment_passes_on_a_matched_set():
    run_pipeline.check_deployment()  # must not raise


def test_check_deployment_rejects_a_stale_module(monkeypatch):
    """The v1-alongside-v2 case, which imports fine and only fails at the write."""
    stale = types.SimpleNamespace(MODULE_VERSION="1.0")
    monkeypatch.setitem(sys.modules, "metrics", stale)
    with pytest.raises(RuntimeError, match="Mixed brick deployment") as exc:
        run_pipeline.check_deployment()
    assert "metrics=1.0" in str(exc.value)
    assert "restartPython" in str(exc.value)


def test_check_deployment_rejects_a_module_with_no_version(monkeypatch):
    """A genuine v1 file has no MODULE_VERSION at all; getattr must not raise AttributeError."""
    ancient = types.SimpleNamespace()  # no MODULE_VERSION
    monkeypatch.setitem(sys.modules, "config", ancient)
    with pytest.raises(RuntimeError, match="Mixed brick deployment") as exc:
        run_pipeline.check_deployment()
    assert "config=pre-2.0" in str(exc.value)


def test_check_deployment_names_every_stale_module(monkeypatch):
    """Reporting one at a time would mean re-running to find the next."""
    monkeypatch.setitem(sys.modules, "metrics", types.SimpleNamespace(MODULE_VERSION="1.0"))
    monkeypatch.setitem(sys.modules, "ledger", types.SimpleNamespace())
    with pytest.raises(RuntimeError) as exc:
        run_pipeline.check_deployment()
    assert "ledger" in str(exc.value) and "metrics" in str(exc.value)


# ------------------------------------------------------------------ the path-backed mode
#
# `--data_path` is what lets a PoC with no catalog run at all. These are the pure-Python half:
# resolution, validation and the reference shape. The end-to-end half -- that a path-backed
# register holds the same rows as a catalog-backed one, and migrates into a catalog without
# losing any -- lives in test_ledger_pipeline.py, where there is a real Delta session.


def test_data_path_produces_delta_path_references(monkeypatch):
    """A path-backed table is named `delta.`<root>/<prefix><name>`` -- valid anywhere Spark
    wants a table, which is what lets one `Tables` serve both modes."""
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    tables = run_pipeline.resolve_tables("", "os", argv=[], data_path="/Volumes/c/s/v/brick")
    assert tables.bronze == "delta.`/Volumes/c/s/v/brick/wiz_os_findings_raw`"
    assert tables.ledger == "delta.`/Volumes/c/s/v/brick/wiz_os_vuln_ledger`"
    # The directory names match what a catalog run would call the tables, so the README's
    # CREATE TABLE ... LOCATION recipe is one statement per directory with nothing renamed.
    assert tables.capacity.endswith("/wiz_os_metrics_capacity`")


def test_as_path_recovers_the_path_and_leaves_catalog_names_alone():
    """The whole storage abstraction: a reference carries its own path."""
    assert run_pipeline.as_path("delta.`/mnt/brick/wiz_os_scans`") == "/mnt/brick/wiz_os_scans"
    assert run_pipeline.as_path("cat.sch.wiz_os_scans") is None


def test_data_path_is_optional_and_empty_means_catalog_mode(monkeypatch):
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    monkeypatch.delenv("DATA_PATH", raising=False)
    assert run_pipeline.resolve_data_path(argv=[]) == ""
    assert run_pipeline.resolve_data_path(argv=["--data_path=/mnt/x/"]) == "/mnt/x"


def test_data_path_refuses_a_backtick(monkeypatch):
    """The path is interpolated into SQL inside backticks -- same reasoning as IDENTIFIER."""
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    with pytest.raises(RuntimeError, match="backtick"):
        run_pipeline.resolve_data_path(argv=["--data_path=/mnt/`/x"])


def test_data_path_refuses_a_relative_path(monkeypatch):
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    with pytest.raises(RuntimeError, match="absolute path or a storage URI"):
        run_pipeline.resolve_data_path(argv=["--data_path=brick-data"])


@pytest.mark.parametrize(
    "uri",
    ["dbfs:/brick", "s3://bucket/brick", "abfss://c@a.dfs.core.windows.net/brick", "gs://b/brick"],
)
def test_data_path_accepts_storage_uris(monkeypatch, uri):
    """Two of the three places that persist are only addressable as a URI, so requiring a
    leading slash would have rejected the answers."""
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    assert run_pipeline.resolve_data_path(argv=[f"--data_path={uri}"]) == uri


def test_data_path_refuses_workspace_files(monkeypatch):
    """`/Workspace` persists and needs no catalog, which makes it the obvious PoC answer and a
    wrong one: executors cannot write to workspace files, and every write here is a distributed
    Delta write. It can appear to work on a single-node cluster and break when one is scaled.

    Refused even off Databricks -- unlike the ephemeral paths, there is no local sense in which
    /Workspace is a reasonable place for this, so there is nothing to allow.
    """
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    monkeypatch.setattr(dbx, "get_dbutils", lambda: None)
    with pytest.raises(RuntimeError, match="executors cannot write"):
        run_pipeline.resolve_data_path(argv=["--data_path=/Workspace/Users/me/brick"])


def test_data_path_refuses_ephemeral_cluster_disk(monkeypatch):
    """The one failure this mode exists to prevent.

    `/tmp` and `/local_disk0` are wiped when a cluster terminates, so a register written there
    is gone by morning -- silently, and exactly when somebody goes looking for the history. On
    Databricks it is refused; off Databricks those are ordinary directories and are allowed,
    which is what lets these tests and `tmp_path` work at all.
    """
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    monkeypatch.setattr(dbx, "get_dbutils", lambda: object())
    with pytest.raises(RuntimeError, match="ephemeral"):
        run_pipeline.resolve_data_path(argv=["--data_path=/tmp/brick"])

    monkeypatch.setattr(dbx, "get_dbutils", lambda: None)
    assert run_pipeline.resolve_data_path(argv=["--data_path=/tmp/brick"]) == "/tmp/brick"
