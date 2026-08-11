"""The GAS -> brick seed: the column mapping, and the handoff to the first ordinary scan.

Two halves. The first pins the mapping's four silent failure modes -- a NULL risk signal
coerced to false, the severity-scope serialization, episodes dropped on the floor, and a
second import landing on top of a live register. Each of those produces a plausible number
rather than an error, which is exactly why they are tested rather than reviewed.

The second half is the one that matters most: import a bundle, then run a real scan in which
an imported OPEN finding is absent, and require it to resolve by *disappearance*. That single
assertion exercises the whole handoff -- the scan log's ordering, the severity conversion
feeding ``prev_scan_id_by_severity``, and ``last_scan_id`` surviving the import into
``reconcile``'s guard. Get any of them wrong and the imported backlog either freezes forever
or mass-resolves on the first run, and both look like real results.

Run with:  pytest brick/tests -q
"""

from __future__ import annotations

import gzip
import json
import re
import sys
from pathlib import Path

import pytest

pytest.importorskip(
    "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
)
pytest.importorskip(
    "delta", reason="import tests need delta-spark: pip install -r brick/requirements.txt"
)

from pyspark.sql import functions as F  # noqa: E402

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import import_bundle  # noqa: E402
import run_pipeline  # noqa: E402
from config import STATUS_OPEN, STATUS_RESOLVED  # noqa: E402
from import_bundle import BundleError  # noqa: E402

from test_ledger_pipeline import ledger_rows, run_scan  # noqa: E402

SCOPE = "os"
SEVERITIES = ["CRITICAL", "HIGH"]

# GAS scan ids ARE their timestamps (gas/src/domain/ledgerCore.ts:170), and the fixture keeps
# that shape on purpose -- brick treats them as opaque strings, and this is the test that
# proves it rather than assuming it.
G1 = "2026-07-01T05:00:00Z"
G2 = "2026-07-08T05:00:00Z"
G3 = "2026-07-15T05:00:00Z"


def gas_ledger_row(vuln_key, **over) -> dict:
    """A row in gas/src/domain/reconcile.ts's LEDGER_COLUMNS shape, with no brick columns."""
    row = {
        "vuln_key": vuln_key,
        "cve": "CVE-2026-1000",
        "severity": "HIGH",
        "asset_id": "vm-1",
        "asset_name": "web-01",
        "asset_type": "VIRTUAL_MACHINE",
        "cloud": "AWS",
        "first_seen": "2026-06-01T00:00:00Z",
        "last_seen": G3,
        "status": "OPEN",
        "resolved_at": None,
        "resolution_src": None,
        "reopened_count": 0,
        "first_scan_id": G1,
        "last_scan_id": G3,
        "subscription_name": "prod",
        "subscription_ext_id": "sub-1",
        "tags_json": '{"env": "prod"}',
        "fix_date": None,
        "fix_observed_at": None,
        "has_kev": None,
        "has_exploit": None,
        "epss": None,
        "risk_observed_at": None,
    }
    row.update(over)
    return row


def gas_episode(vuln_key, **over) -> dict:
    row = {
        "vuln_key": vuln_key,
        "cve": "CVE-2026-9000",
        "severity": "CRITICAL",
        "first_seen": "2026-05-01T00:00:00Z",
        "resolved_at": "2026-05-20T00:00:00Z",
        "resolution_src": "api",
        "reopened_count": 0,
        "compaction_id": "cmp-1",
        "superseded_by_scan": None,
        "fix_date": None,
        "fix_observed_at": None,
        "has_kev": True,
        "has_exploit": None,
        "epss": 0.9,
        "risk_observed_at": "2026-05-02T00:00:00Z",
    }
    row.update(over)
    return row


def gas_scan(scan_id, **over) -> dict:
    row = {
        "scan_id": scan_id,
        "ts": scan_id,
        "mode": "live",
        "shape": "flat",
        "total": 3,
        "new_count": 1,
        "resolved_count": 0,
        "reopened_count": 0,
        # The GAS serialization: JSON array text, not brick's comma-joined form.
        "severities": '["CRITICAL", "HIGH"]',
        "sealed": 0,
    }
    row.update(over)
    return row


def bundle(ledger=None, episodes=None, scans=None, **over) -> dict:
    payload = {
        "kind": import_bundle.BUNDLE_KIND,
        "version": import_bundle.BUNDLE_VERSION,
        "exported_at": "2026-08-11T00:00:00Z",
        "schema_version": 2,
        "scans": scans if scans is not None else [gas_scan(G1), gas_scan(G2), gas_scan(G3)],
        "ledger": ledger if ledger is not None else [gas_ledger_row("id:f-a")],
        "episodes": episodes or [],
        "mttr_history": [],
    }
    payload.update(over)
    return payload


@pytest.fixture
def tables(spark, request):
    name = "i_" + re.sub(r"\W", "_", request.node.name).lower()[:100]
    spark.sql(f"DROP DATABASE IF EXISTS {name} CASCADE")
    spark.sql(f"CREATE DATABASE {name}")
    tbl = run_pipeline.resolve_tables(name, SCOPE, argv=[])
    run_pipeline.ensure_tables(spark, tbl)
    yield tbl
    spark.sql(f"DROP DATABASE IF EXISTS {name} CASCADE")


# ------------------------------------------------------------------- the severity scope


class TestSeverityScope:
    """GAS writes ``["CRITICAL", "HIGH"]``; brick writes ``CRITICAL,HIGH``. Copied verbatim,
    ``parse_severities`` reads the JSON form as None -- i.e. *unscoped* -- which is the one
    value the disappearance guard must never be handed by mistake."""

    def test_converts_the_gas_json_form(self):
        assert import_bundle.gas_severities('["CRITICAL", "HIGH"]') == "CRITICAL,HIGH"

    def test_severity_order_does_not_survive_as_ordering(self):
        # brick sorts alphabetically; GAS orders by SEVERITY_ORDER. Same set, and the round
        # trip through parse_severities is what has to agree, not the text.
        converted = import_bundle.gas_severities('["HIGH", "CRITICAL"]')
        assert run_pipeline.parse_severities(converted) == ["CRITICAL", "HIGH"]

    def test_null_means_unscoped_on_both_sides(self):
        assert import_bundle.gas_severities(None) is None
        assert import_bundle.gas_severities("") is None

    def test_accepts_a_value_already_in_bricks_form(self):
        assert import_bundle.gas_severities("HIGH,CRITICAL") == "CRITICAL,HIGH"

    def test_rejects_text_that_looks_like_json_and_is_not(self):
        with pytest.raises(BundleError):
            import_bundle.gas_severities('["CRITICAL", ')

    def test_the_verbatim_copy_would_have_been_read_as_unscoped(self):
        # The bug this conversion exists to prevent, asserted directly so the reason the
        # converter exists cannot be lost to a later simplification.
        assert run_pipeline.parse_severities('["CRITICAL", "HIGH"]') is None


# ------------------------------------------------------------------------ the risk signals


class TestRiskSignals:
    """A signal that was never captured must stay NULL. Coercing it to false inflates
    efficiency and deflates coverage simultaneously -- see the trap at the top of metrics.py."""

    def test_absent_signals_stay_null(self, spark):
        frame = import_bundle.ledger_frame(spark, bundle(), scope=SCOPE)
        row = frame.collect()[0]
        assert row["has_kev"] is None
        assert row["has_exploit"] is None
        assert row["epss"] is None

    def test_an_observed_false_is_not_an_absent_signal(self, spark):
        payload = bundle(ledger=[gas_ledger_row("id:f-a", has_kev=False, has_exploit=True)])
        row = import_bundle.ledger_frame(spark, payload, scope=SCOPE).collect()[0]
        assert row["has_kev"] is False
        assert row["has_exploit"] is True

    def test_sheets_round_tripped_booleans_are_understood(self, spark):
        # A bundle that has been through a spreadsheet carries "TRUE"/"FALSE" text
        # (gas/src/server/sheetsDb.ts formats every cell as plain text).
        payload = bundle(
            ledger=[gas_ledger_row("id:f-a", has_kev="TRUE", has_exploit="FALSE", epss="0.25")]
        )
        row = import_bundle.ledger_frame(spark, payload, scope=SCOPE).collect()[0]
        assert row["has_kev"] is True
        assert row["has_exploit"] is False
        assert row["epss"] == 0.25

    def test_epss_zero_is_not_null(self, spark):
        payload = bundle(ledger=[gas_ledger_row("id:f-a", epss=0.0)])
        assert import_bundle.ledger_frame(spark, payload, scope=SCOPE).collect()[0]["epss"] == 0.0


# ---------------------------------------------------------------------- the column mapping


class TestColumnMapping:
    def test_maps_every_shared_column(self, spark):
        row = import_bundle.ledger_frame(spark, bundle(), scope=SCOPE).collect()[0]
        assert row["vuln_key"] == "id:f-a"
        assert row["cve"] == "CVE-2026-1000"
        assert row["severity"] == "HIGH"
        assert row["asset_name"] == "web-01"
        assert row["subscription_ext_id"] == "sub-1"
        assert row["status"] == STATUS_OPEN
        assert row["first_seen"].isoformat() == "2026-06-01T00:00:00"
        assert row["first_scan_id"] == G1
        assert row["last_scan_id"] == G3

    def test_stamps_the_scope_and_leaves_component_null(self, spark):
        row = import_bundle.ledger_frame(spark, bundle(), scope=SCOPE).collect()[0]
        assert row["scope"] == SCOPE
        # GAS never persisted it; inventing a value would change the vuln_key hash basis.
        assert row["component"] is None

    def test_drops_tags_json_rather_than_failing_on_it(self, spark):
        frame = import_bundle.ledger_frame(spark, bundle(), scope=SCOPE)
        assert "tags_json" not in frame.columns

    def test_an_unrecognized_severity_becomes_unknown_not_null(self, spark):
        payload = bundle(ledger=[gas_ledger_row("id:f-a", severity="")])
        assert import_bundle.ledger_frame(spark, payload, scope=SCOPE).collect()[0][
            "severity"
        ] == "UNKNOWN"

    def test_scans_map_ts_to_scan_ts_and_convert_the_scope(self, spark):
        frame = import_bundle.scans_frame(spark, bundle(), scope=SCOPE)
        rows = {r["scan_id"]: r for r in frame.collect()}
        assert set(rows) == {G1, G2, G3}
        assert rows[G1]["scan_ts"].isoformat() == "2026-07-01T05:00:00"
        assert rows[G1]["severities"] == "CRITICAL,HIGH"
        assert rows[G1]["scope"] == SCOPE
        # mode / shape / raw_ref / obs_ref / sealed have no brick home.
        assert set(frame.columns) == set(run_pipeline.SCANS_SCHEMA.replace(",", " ").split()[::2])


# --------------------------------------------------------------------------- the episodes


class TestEpisodes:
    """GAS compaction moves settled lifecycles out of the live ledger, and ``baseRows`` unions
    them back at read time -- so the population GAS's own coverage is computed over is
    ledger + non-superseded episodes. Importing only the ledger shrinks both rates silently."""

    def test_a_sealed_episode_becomes_a_resolved_ledger_row(self, spark):
        payload = bundle(episodes=[gas_episode("id:f-old")])
        rows = {r["vuln_key"]: r for r in import_bundle.ledger_frame(spark, payload, scope=SCOPE).collect()}
        assert set(rows) == {"id:f-a", "id:f-old"}
        old = rows["id:f-old"]
        assert old["status"] == STATUS_RESOLVED
        assert old["resolved_at"].isoformat() == "2026-05-20T00:00:00"
        # last_seen takes resolved_at: the last moment the lifecycle was known to be real.
        assert old["last_seen"] == old["resolved_at"]
        assert old["resolution_src"] == "api"
        assert old["has_kev"] is True
        assert old["has_exploit"] is None
        assert old["epss"] == 0.9
        # No scan ids: the scans that saw it were sealed and are not in the bundle.
        assert old["last_scan_id"] is None

    def test_a_superseded_episode_is_skipped(self, spark):
        payload = bundle(episodes=[gas_episode("id:f-old", superseded_by_scan=G2)])
        keys = {r["vuln_key"] for r in import_bundle.ledger_frame(spark, payload, scope=SCOPE).collect()}
        assert keys == {"id:f-a"}

    def test_a_live_row_wins_over_an_episode_for_the_same_key(self, spark):
        payload = bundle(episodes=[gas_episode("id:f-a")])
        rows = import_bundle.ledger_frame(spark, payload, scope=SCOPE).collect()
        assert len(rows) == 1
        assert rows[0]["status"] == STATUS_OPEN

    def test_several_episodes_for_one_key_collapse_to_the_latest_and_are_counted(self, spark):
        payload = bundle(
            episodes=[
                gas_episode("id:f-old", resolved_at="2026-05-20T00:00:00Z", compaction_id="cmp-1"),
                gas_episode("id:f-old", resolved_at="2026-06-20T00:00:00Z", compaction_id="cmp-2"),
            ]
        )
        selected, collapsed = import_bundle.selectable_episodes(payload)
        assert collapsed == 1
        assert selected[0]["resolved_at"] == "2026-06-20T00:00:00Z"


# ------------------------------------------------------------------------ reading the file


class TestReading:
    def test_reads_plain_and_gzipped_json(self, tmp_path):
        payload = bundle()
        plain = tmp_path / "b.json"
        plain.write_text(json.dumps(payload))
        gzipped = tmp_path / "b.json.gz"
        gzipped.write_bytes(gzip.compress(json.dumps(payload).encode()))
        assert import_bundle.load_bundle(str(plain))["kind"] == import_bundle.BUNDLE_KIND
        assert import_bundle.load_bundle(str(gzipped))["kind"] == import_bundle.BUNDLE_KIND

    def test_a_gz_named_file_that_is_not_gzipped_still_reads(self, tmp_path):
        # A browser that decompressed the Drive download keeps the .json.gz name.
        path = tmp_path / "b.json.gz"
        path.write_text(json.dumps(bundle()))
        assert import_bundle.load_bundle(str(path))["version"] == import_bundle.BUNDLE_VERSION

    def test_rejects_the_wrong_kind(self):
        with pytest.raises(BundleError, match="Not a migration bundle"):
            import_bundle.validate_bundle(bundle(kind="something-else"))

    def test_rejects_the_deep_history_archive_half(self):
        with pytest.raises(BundleError, match="archive half"):
            import_bundle.validate_bundle(bundle(kind=import_bundle.ARCHIVE_KIND))

    def test_rejects_a_newer_version(self):
        with pytest.raises(BundleError, match="Unsupported bundle version"):
            import_bundle.validate_bundle(bundle(version=2))

    def test_rejects_a_bundle_with_no_scans(self):
        with pytest.raises(BundleError, match="no scans"):
            import_bundle.validate_bundle(bundle(scans=[]))

    def test_rejects_a_ledger_row_without_a_key(self):
        with pytest.raises(BundleError, match="vuln_key"):
            import_bundle.validate_bundle(bundle(ledger=[{"cve": "CVE-1"}]))


# --------------------------------------------------------------------------- the write


class TestImport:
    def test_seeds_both_tables_and_reports_what_it_wrote(self, spark, tables):
        payload = bundle(
            ledger=[gas_ledger_row("id:f-a"), gas_ledger_row("h:deadbeefdeadbeef")],
            episodes=[gas_episode("id:f-old")],
        )
        summary = import_bundle.import_bundle(spark, tables, payload, scope=SCOPE)
        assert summary["ledger_rows"] == 3
        assert summary["episodes_folded"] == 1
        assert summary["scans"] == 3
        assert summary["last_scan_id"] == G3
        # The h: count is the blast radius of the unrecoverable `component` column.
        assert summary["hashed_keys"] == 1
        assert spark.table(tables.ledger).count() == 3
        assert spark.table(tables.scans).count() == 3

    def test_refuses_a_register_that_already_has_history(self, spark, tables):
        import_bundle.import_bundle(spark, tables, bundle(), scope=SCOPE)
        with pytest.raises(BundleError, match="force_import"):
            import_bundle.import_bundle(spark, tables, bundle(), scope=SCOPE)

    def test_force_replaces_rather_than_merges(self, spark, tables):
        import_bundle.import_bundle(spark, tables, bundle(), scope=SCOPE)
        payload = bundle(ledger=[gas_ledger_row("id:f-b")], scans=[gas_scan(G1)])
        summary = import_bundle.import_bundle(spark, tables, payload, scope=SCOPE, force=True)
        assert summary["ledger_rows"] == 1
        assert {r["vuln_key"] for r in spark.table(tables.ledger).collect()} == {"id:f-b"}
        assert spark.table(tables.scans).count() == 1

    def test_leaves_bronze_and_silver_alone(self, spark, tables):
        import_bundle.import_bundle(spark, tables, bundle(), scope=SCOPE)
        # The bundle carries reconciled lifecycles, not raw findings. Nothing should have
        # invented a bronze row -- and --rebuild_ledger over an empty bronze must not be
        # able to wipe the seed by accident, which it would if we had written one.
        assert not spark.catalog.tableExists(tables.bronze)


# ---------------------------------------------------------------------------- the handoff


class TestHandoffToTheFirstScan:
    """The test that proves the migration, rather than the mapping.

    After the seed, brick's next ordinary run has to continue the imported lifecycles: keep
    the ones still present, and resolve the ones that have gone. That depends on three things
    the import is responsible for -- the scan log's newest row being the last GAS scan, its
    severity scope parsing back to a real list, and ``last_scan_id`` on each imported row
    matching that scan.
    """

    def seeded(self, spark, tables):
        payload = bundle(
            ledger=[
                gas_ledger_row("id:f-a", cve="CVE-2026-f-a"),
                gas_ledger_row("id:f-b", cve="CVE-2026-f-b"),
            ]
        )
        return import_bundle.import_bundle(spark, tables, payload, scope=SCOPE)

    def test_the_scan_log_hands_over_the_last_gas_scan(self, spark, tables):
        self.seeded(spark, tables)
        assert run_pipeline.previous_scan(spark, tables)[0] == G3
        # ...covering the severities GAS was actually scanning, not "everything".
        by_sev = run_pipeline.prev_scan_id_by_severity(spark, tables)
        assert by_sev["CRITICAL"] == G3 and by_sev["HIGH"] == G3
        assert "MEDIUM" not in by_sev

    def test_a_finding_that_vanishes_resolves_by_disappearance(self, spark, tables):
        from test_ledger_pipeline import node

        self.seeded(spark, tables)
        # f-a is still there; f-b is not. Only f-b should close. The node reports a
        # firstDetectedAt *later* than the imported date, so the imported one has to win.
        still_here = node("f-a", firstDetectedAt="2026-07-10T00:00:00Z")
        run_scan(spark, tables, [still_here], "scan-1", "2026-07-22T00:00:00Z")
        rows = ledger_rows(spark, tables)

        assert rows["id:f-b"]["status"] == STATUS_RESOLVED
        assert rows["id:f-b"]["resolution_src"] == "disappeared"
        assert rows["id:f-a"]["status"] == STATUS_OPEN
        # The whole point: the imported history survives the first brick scan. first_seen is
        # the date GAS recorded, not today, so MTTR measures a real interval.
        assert rows["id:f-a"]["first_seen"].isoformat() == "2026-06-01T00:00:00"
        assert rows["id:f-a"]["last_scan_id"] == "scan-1"

    def test_the_api_still_wins_when_it_knows_an_earlier_date(self, spark, tables):
        """Earliest-known, not imported-wins. The seed is a floor on what we have observed,
        not a claim that nothing happened before it -- and ``first_seen`` may only move
        earlier (ledger.py:397-403), which the import must not quietly break."""
        from test_ledger_pipeline import node

        self.seeded(spark, tables)
        run_scan(
            spark, tables,
            [node("f-a", firstDetectedAt="2026-04-01T00:00:00Z"), node("f-b")],
            "scan-1", "2026-07-22T00:00:00Z",
        )
        assert ledger_rows(spark, tables)["id:f-a"]["first_seen"].isoformat() == (
            "2026-04-01T00:00:00"
        )

    def test_an_out_of_scope_severity_is_not_mass_resolved(self, spark, tables):
        from test_ledger_pipeline import node

        payload = bundle(ledger=[gas_ledger_row("id:f-m", severity="MEDIUM")])
        import_bundle.import_bundle(spark, tables, payload, scope=SCOPE)
        # A CRITICAL/HIGH scan says nothing about a MEDIUM finding. Absence of something
        # nobody looked for is not remediation.
        run_scan(spark, tables, [node("f-a")], "scan-1", "2026-07-22T00:00:00Z")
        assert ledger_rows(spark, tables)["id:f-m"]["status"] == STATUS_OPEN

    def test_the_imported_lifetimes_reach_the_gold_tables(self, spark, tables):
        from test_ledger_pipeline import node

        self.seeded(spark, tables)
        run_scan(spark, tables, [node("f-a")], "scan-1", "2026-07-22T00:00:00Z")
        mttr = (
            spark.table(tables.mttr)
            .filter((F.col("scan_id") == "scan-1") & (F.col("severity") == "HIGH"))
            .collect()[0]
        )
        # f-b closed after ~51 days (2026-06-01 -> 2026-07-22), not ~0 as it would read had
        # the seed collapsed first_seen to the import.
        assert mttr["resolved"] == 1
        assert mttr["mttr_median"] > 45
        assert mttr["resolved_disappeared"] == 1
