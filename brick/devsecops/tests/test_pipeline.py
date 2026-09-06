"""Wiring tests for the devsecops entry point.

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
from config import SCOPES, SOURCES  # noqa: E402
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
        run_pipeline.resolve_tables("cat.sch", "sca", argv=["--table_prefix=bad-prefix"])


def test_tables_are_prefixed_with_the_scope_by_default(monkeypatch):
    """A shared schema makes bare `findings` / `metrics_capacity` a collision risk, and the
    scope in the name keeps an OS run and an all-types run in separate tables."""
    monkeypatch.delenv("TABLE_PREFIX", raising=False)
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    # A deliberately generic namespace: the catalog is a runtime parameter, and a real one
    # here would read like configuration.
    ns = "some_catalog.some_schema"
    tables = run_pipeline.resolve_tables(ns, "sca", argv=[])
    assert tables.bronze == f"{ns}.wiz_sca_findings_raw"
    assert tables.silver == f"{ns}.wiz_sca_findings"
    assert tables.capacity == f"{ns}.wiz_sca_metrics_capacity"
    assert tables.assets == f"{ns}.wiz_sca_metrics_assets"

    # The two registers never share a table. They measure populations with different positive
    # classes -- see the README -- so blending them would be meaningless as well as wrong.
    assert run_pipeline.resolve_tables(ns, "sast", argv=[]).silver == f"{ns}.wiz_sast_findings"


def test_table_prefix_is_overridable_and_can_be_empty(monkeypatch):
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    assert (
        run_pipeline.resolve_tables("c.s", "sca", argv=["--table_prefix=sec_"]).mttr
        == "c.s.sec_metrics_mttr"
    )
    bare = run_pipeline.resolve_tables("c.s", "sca", argv=["--table_prefix="])
    assert bare.mttr == "c.s.metrics_mttr"


def test_scope_defaults_to_sca_and_rejects_unknown_values(monkeypatch):
    """`sca` rather than `sast`, because it is the register whose numbers mean what they appear
    to mean -- its findings carry a CVE, real exploit signals and real timestamps.

    And `os` is rejected outright: this fork does not measure hosts, and silently accepting the
    scope name would write `wiz_os_*` tables full of code findings."""
    monkeypatch.delenv("SCOPE", raising=False)
    monkeypatch.setattr(dbx, "widget", lambda name: "")
    assert run_pipeline.resolve_scope(argv=[]) == "sca"
    assert run_pipeline.resolve_scope(argv=["--scope=sast"]) == "sast"
    for wrong in ("os", "all", "containers"):
        with pytest.raises(RuntimeError, match="unknown scope"):
            run_pipeline.resolve_scope(argv=[f"--scope={wrong}"])


def test_both_scopes_default_to_the_same_gate_and_the_shape_says_they_need_not(monkeypatch):
    """The severity default is keyed by scope, and today both keys agree.

    This moves no number. Both registers here carry CVE-ish findings whose severities mean the
    same thing, so both pull CRITICAL,HIGH and every published figure is byte-identical to what
    a single tuple produced. What the shape buys is the next scope: it has to state its own
    gate rather than inherit a volume control chosen for a different population.

    The sibling register is the evidence that the inheritance is not hypothetical.
    `gas_devsecops` gave `secrets` the vulnerability registers' CRITICAL,HIGH, which deleted
    `PASSWORD` 209 -> 0 and `CERTIFICATE` 160 -> 0 -- every one of those sits below HIGH -- and
    shipped a secrets register with no passwords in it. Nothing errored; the gate was simply
    the right answer to a question nobody had asked about that population.
    """
    from config import DEFAULT_FETCH_SEVERITIES, default_fetch_severities

    monkeypatch.delenv("SEVERITIES", raising=False)
    monkeypatch.setattr(dbx, "widget", lambda name: "")

    # Equality, today, and stated rather than derived so a drift has to be deliberate.
    assert default_fetch_severities("sca") == ("CRITICAL", "HIGH")
    assert default_fetch_severities("sast") == default_fetch_severities("sca")

    # Keyed per scope, with an entry for every scope: a missing key is refused, not quietly
    # served from another population's gate.
    assert set(DEFAULT_FETCH_SEVERITIES) == set(SCOPES)
    with pytest.raises(RuntimeError, match="unknown scope"):
        default_fetch_severities("secrets")

    # And genuinely independent -- the half a single tuple could not express. Widening one
    # scope's gate leaves the other exactly where it was.
    monkeypatch.setitem(DEFAULT_FETCH_SEVERITIES, "sast", ("CRITICAL", "HIGH", "MEDIUM"))
    assert run_pipeline.resolve_severities("sast", argv=[]) == ["CRITICAL", "HIGH", "MEDIUM"]
    assert run_pipeline.resolve_severities("sca", argv=[]) == ["CRITICAL", "HIGH"]
    # It is a default, so an explicit `--severities` still outranks it on either scope.
    assert run_pipeline.resolve_severities("sast", argv=["--severities=critical"]) == ["CRITICAL"]

    # The API filter reads the same source, so the gate a scope pulls is the gate on the wire.
    monkeypatch.setitem(DEFAULT_FETCH_SEVERITIES, "sca", ("CRITICAL",))
    assert build_filter("sca")["severity"] == ["CRITICAL"]


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
        FakeSpark(), "cat.sch.wiz_sca_findings_raw", "scan-1", "2026-07-01T00:00:00Z", "sca"
    )

    assert count == 1
    assert seen["scope"] == "sca"  # the population, not "wiz"
    assert written["rows"][0][2] == "sca"  # and the same value lands in bronze
    assert written["table"] == "cat.sch.wiz_sca_findings_raw"


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


def test_sca_scope_matches_the_reference_query():
    """Parity with `sca_request.py`'s filterBy, which is the Wiz console's own export and the
    only evidence available that this selection validates.

    Both clauses earn their place. Without `codeToCloudPipelineStage: CODE` a dependency is
    counted once in the repository and again in every container image built from it; without
    `isDefaultBranch` the register grows and shrinks with the team's branching habits rather
    than with its code.
    """
    got = build_filter("sca", ["CRITICAL"])
    assert got["codeToCloudPipelineStage"] == ["CODE"]
    assert got["isDefaultBranch"] == {"equals": True}
    assert got["hasFix"] is True
    assert got["severity"] == ["CRITICAL"]
    # This fork measures code, so none of the host-register restrictions apply.
    assert "detectionMethod" not in got
    assert "assetType" not in got


def _vuln_scopes():
    """The scopes whose findings come from ``vulnerabilityFindings``.

    ``sast`` reads a different connection with a different filter type, so the two invariants
    below -- both of which are about VulnerabilityFindingFilters keys -- cannot apply to it.
    That exception is pinned by its own test rather than left as a silent gap in a loop.
    """
    return [scope for scope, source in SOURCES.items() if source.kind == "vulnerability"]


def test_every_scope_asks_for_resolved_findings():
    """Without this the API returns only OPEN findings and every remediation metric collapses
    -- coverage 0%, efficiency undefined, MTTR empty -- while looking like a real result."""
    for scope in _vuln_scopes():
        assert build_filter(scope)["status"] == ["OPEN", "RESOLVED"]


def test_sast_does_not_ask_for_resolved_findings_yet():
    """The invariant above is deliberately **declined** here, not unavailable.

    A SAST finding has a status, so the API can be asked for resolved ones. Two live reasons not
    to: ``SASTFinding`` has no ``resolvedAt``, and `status: RESOLVED` returns zero rows against
    this tenant. The query now selects ``createdAt``, so an already-resolved finding would land
    `first_seen = createdAt` and `resolved_at = now` -- reporting its AGE as its MTTR, which is
    worse than the flat 0 that arithmetic used to give because it looks like a measurement. See
    `config.SAST_FETCH_RESOLVED` for the trace, and
    `test_devsecops.test_asking_sast_for_resolved_findings_would_report_its_age_as_its_mttr`
    for the measurement.

    `hasFix` is a separate matter and simply meaningless for a weakness in first-party code.
    """
    got = build_filter("sast")
    assert "status" not in got
    assert "hasFix" not in got
    assert got["resource"] == {"isDefaultBranch": {"equals": True}}


def test_scopes_share_the_actionable_filter():
    """hasFix is shared so remediation rates mean the same thing in each scope. Without it,
    awaiting-vendor-fix findings would sit in `all`'s coverage denominator and not in `os`'s,
    making `all` look worse for a reason that is not performance."""
    for scope in _vuln_scopes():
        assert build_filter(scope)["hasFix"] is True


def test_sca_scope_is_the_code_stage_of_the_default_branch():
    """Both halves earn their place. Without `codeToCloudPipelineStage: CODE` a dependency is
    counted once in the repo and again in every image built from it; without `isDefaultBranch`
    the register grows and shrinks with the team's branching habits rather than its code."""
    got = build_filter("sca")
    assert got["codeToCloudPipelineStage"] == ["CODE"]
    assert got["isDefaultBranch"] == {"equals": True}
    # It is the same connection `os` reads, which is the whole reason it needs no new maths.
    assert SOURCES["sca"].connection == "vulnerabilityFindings"


def test_project_id_is_opt_in():
    """os_vulns.py hardcodes one tenant's projectIdV2; copying it would silently scope every
    run to that project."""
    assert "projectIdV2" not in build_filter("sca")
    assert build_filter("sca", project_id="p-1")["projectIdV2"] == {"equals": ["p-1"]}
    # The two filter types spell it differently -- sast_request.py passes a bare list.
    assert build_filter("sast", project_id="p-1")["projectId"] == ["p-1"]


def test_build_filter_does_not_mutate_the_scope_template():
    build_filter("sca", ["LOW"], project_id="p-1")
    assert "severity" not in SCOPES["sca"]
    assert "projectIdV2" not in SCOPES["sca"]


def test_unknown_scope_is_rejected():
    with pytest.raises(RuntimeError, match="unknown scope"):
        build_filter("nope")


# ----------------------------------------------------------------------- the query


def test_the_shipped_query_asks_for_exactly_two_asset_members():
    """The inversion of brick's rule, and the reason this fork can compute P2P v5 at all.

    A union fails as a whole, so one member the tenant no longer has costs the entire request
    -- which is why `FETCH_ASSET_FIELDS` is off for a register that would have to ask for all
    thirteen. `sca` returns REPOSITORY_BRANCH and nothing else, so it asks for the two members
    it needs and gets its asset columns. `sca_response.json` is the evidence.
    """
    assert FETCH_ASSET_FIELDS is False
    assert ingest.asset_members("sca") == (
        "VulnerableAssetBase",
        "VulnerableAssetRepositoryBranch",
    )
    assert "... on VulnerableAssetRepositoryBranch {" in QUERY
    assert "... on VulnerableAssetVirtualMachine {" not in QUERY
    # And the ecosystem column P2P v5 groups on, asked for only where it is read.
    assert "codeLibraryLanguage" in QUERY


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
    enabled = ingest._asset_selection(members=ingest._ASSET_MEMBERS)
    assert "... on VulnerableAssetRepositoryBranch {" in enabled  # what scope=sca returns
    assert "... on VulnerableAssetBase {" in enabled

    # No bare field selection between `vulnerableAsset {` and the first fragment.
    body = enabled.split("vulnerableAsset {", 1)[1].split("... on", 1)[0]
    assert not body.strip(), f"bare selection on the union: {body.strip()!r}"


def test_query_never_asks_a_member_for_a_field_it_lacks():
    """Two members genuinely lack some of the fields; asking anyway is another 400."""
    enabled = ingest._asset_selection(members=ingest._ASSET_MEMBERS)
    for member, missing in ingest._ASSET_OMISSIONS.items():
        block = enabled.split(f"... on {member} {{", 1)[1].split("}", 1)[0]
        selected = {line.strip() for line in block.splitlines() if line.strip()}
        assert not (selected & missing), f"{member} asked for {selected & missing}"


def test_every_asset_member_selects_something():
    enabled = ingest._asset_selection(members=ingest._ASSET_MEMBERS)
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
    # And the one thing a fork's README must say out loud.
    assert "sys.path" in text


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
    with pytest.raises(RuntimeError, match="Mixed devsecops deployment") as exc:
        run_pipeline.check_deployment()
    assert "metrics=1.0" in str(exc.value)
    assert "restartPython" in str(exc.value)


def test_check_deployment_rejects_a_module_with_no_version(monkeypatch):
    """A genuine v1 file has no MODULE_VERSION at all; getattr must not raise AttributeError."""
    ancient = types.SimpleNamespace()  # no MODULE_VERSION
    monkeypatch.setitem(sys.modules, "config", ancient)
    with pytest.raises(RuntimeError, match="Mixed devsecops deployment") as exc:
        run_pipeline.check_deployment()
    assert "config=absent" in str(exc.value)


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
    tables = run_pipeline.resolve_tables("", "sca", argv=[], data_path="/Volumes/c/s/v/code")
    assert tables.bronze == "delta.`/Volumes/c/s/v/code/wiz_sca_findings_raw`"
    assert tables.ledger == "delta.`/Volumes/c/s/v/code/wiz_sca_vuln_ledger`"
    # The directory names match what a catalog run would call the tables, so the README's
    # CREATE TABLE ... LOCATION recipe is one statement per directory with nothing renamed.
    assert tables.capacity.endswith("/wiz_sca_metrics_capacity`")


def test_as_path_recovers_the_path_and_leaves_catalog_names_alone():
    """The whole storage abstraction: a reference carries its own path."""
    assert run_pipeline.as_path("delta.`/mnt/code/wiz_sca_scans`") == "/mnt/code/wiz_sca_scans"
    assert run_pipeline.as_path("cat.sch.wiz_sca_scans") is None


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
