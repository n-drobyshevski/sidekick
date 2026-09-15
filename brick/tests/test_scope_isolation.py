"""Three scopes, one table set: what keeps them apart, and what happens when it is removed.

The register is one ledger, one bronze and one metrics table now, with ``scope`` a column in
each rather than a fragment of their names. That makes every scope's rows present in every
other scope's reads unless something filters them out -- and disappearance-resolution reads
absence as remediation, so a missing filter is not a mislabelled input but a remediation
programme that never happened. ``gas_devsecops/``, which learned this the other way round,
priced the mutation at 19,949 findings.

There are FOUR independent things holding the three registers apart, and this module perturbs
each of them separately because they do not fail in the same way and they do not all fail
loudly:

1. ``reconcile_scan``'s prior filter (``.where(scope == ...)``) -- removing it is caught by
2. ``ledger._refuse_foreign_scope``, which REFUSES rather than corrupting; and with that
   stubbed out, still caught by
3. ``scan_log_desc``'s scope filter, which feeds the disappearance clock
   (``p_last_scan_id == expected_prev``) and blocks a foreign row from resolving because its
   last scan is not this scope's previous scan; and
4. the MERGE key ``(vuln_key, scope)``, which is what keeps one key's two populations two rows.

Guards 1-3 are genuinely independent, and the measurement that says so is in
``test_a_scan_of_one_scope_resolves_nothing_in_another``: removing 1 alone raises, removing 1+2
still leaves the register correct, and only removing 1+2+3 lands the damage in the data. Guard 3
removed BY ITSELF is the quiet one and has its own test -- it makes a real resolved_count read
zero, which no error and no count anywhere says is wrong.

The scans below run in the order the chained Databricks job produces them -- ``sca`` then ``os``
then ``sca`` again -- because that interleaving is the whole point: each scope's previous scan
is never the newest scan in the table.

**The fixture builders are copied from ``test_ledger_pipeline.py`` / ``test_metrics_table.py``,
not imported** -- pytest resolves fixtures from the requesting module and its conftest, never
from another test module, and the two files are edited independently. Only what these tests use
was copied, and ``write_bronze`` / ``run_scan`` here take a ``scope`` argument the originals do
not need.

Run with:  pytest brick/tests/test_scope_isolation.py -q
"""

from __future__ import annotations

import datetime as dt
import itertools
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip(
    "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
)
pytest.importorskip(
    "delta", reason="ledger tests need delta-spark: pip install -r brick/requirements.txt"
)

from pyspark.sql import functions as F  # noqa: E402

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import ledger as ledger_mod  # noqa: E402
import metrics  # noqa: E402
import panels  # noqa: E402
import run_pipeline  # noqa: E402
from config import STATUS_OPEN, STATUS_RESOLVED  # noqa: E402
from ledger import LEDGER_SCHEMA  # noqa: E402

SCA = "sca"
OS = "os"
SEVERITIES = ["CRITICAL", "HIGH"]

#: The chained job's order: sca, then os, then sca again. The timestamps have to ascend in that
#: order or ``scan_log_desc``'s "most recent first" would not put the OTHER scope's scan at the
#: front, which is the arrangement every perturbation below turns on.
TS = {
    "sca-1": "2026-05-01T00:00:00Z",
    "os-1": "2026-05-08T00:00:00Z",
    "sca-2": "2026-05-15T00:00:00Z",
    "os-2": "2026-05-22T00:00:00Z",
}

#: Ten sca findings, five of them dropped by the truncated second scan, and six os findings
#: that no sca scan has any business touching. The numbers are named because the assertions
#: divide them and because the perturbations below are priced in them: five real disappearances
#: that go unrecorded, six phantom rows that appear instead.
SCA_FINDINGS = 10
SCA_KEPT = 5
SCA_DROPPED = SCA_FINDINGS - SCA_KEPT
OS_FINDINGS = 6


# ------------------------------------------------------------------------ fixture builders


def node(fid="f-1", severity="HIGH", **over) -> dict:
    base = {
        "id": fid,
        "name": f"CVE-2026-{fid}",
        "detailedName": "openssl",
        "severity": severity,
        "status": "OPEN",
        "firstDetectedAt": "2026-04-01T00:00:00Z",
        "resolvedAt": None,
        "hasCisaKevExploit": True,
        "hasExploit": False,
        "epssProbability": 0.5,
        "vulnerableAsset": {
            "id": "vm-1", "name": "web-01", "type": "VIRTUAL_MACHINE",
            "cloudPlatform": "AWS", "subscriptionName": "prod",
        },
    }
    base.update(over)
    return base


def sca_nodes(count=SCA_FINDINGS) -> list:
    return [node(f"sca-{i:02d}") for i in range(count)]


def os_nodes(count=OS_FINDINGS) -> list:
    return [node(f"os-{i:02d}") for i in range(count)]


def write_bronze(spark, tables, nodes, scan_id, scan_ts, scope):
    """Stand-in for ``ingest_to_bronze``: the same rows without the API, created the same way.

    Bronze is the one table whose clustering spec is declared by the ingest path rather than by
    ``ensure_tables``, so this creates it through ``create_clustered`` for the same reason
    ``test_ledger_pipeline``'s copy does -- appending into a table Delta creates on the fly
    would silently test an unclustered bronze.
    """
    run_pipeline.create_clustered(
        spark, tables.bronze, run_pipeline.BRONZE_TABLE_SCHEMA, "bronze"
    )
    rows = [(scan_id, scan_ts, scope, i, json.dumps(n)) for i, n in enumerate(nodes)]
    df = spark.createDataFrame(
        rows, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
    )
    writer = (
        df.withColumn("scan_ts", F.col("scan_ts").cast("timestamp"))
        .write.format("delta")
        .mode("append")
        .option("mergeSchema", "true")
    )
    path = run_pipeline.as_path(tables.bronze)
    writer.save(path) if path else writer.saveAsTable(tables.bronze)


def run_scan(spark, tables, nodes, scan_id, scan_ts, scope, severities=SEVERITIES):
    """One full scan of one scope: bronze, then everything ``build_metrics`` does."""
    write_bronze(spark, tables, nodes, scan_id, scan_ts, scope)
    run_pipeline.build_metrics(
        spark, tables, scan_id, scan_ts, scope, severities=severities, summary=False
    )


# ------------------------------------------------------------------------------- readers


def ledger_rows(spark, tables, scope=None) -> dict:
    """``{vuln_key: row}`` for one scope, or for the whole register when ``scope`` is None."""
    frame = spark.table(tables.ledger)
    if scope is not None:
        frame = frame.where(F.col("scope") == scope)
    return {r["vuln_key"]: r.asDict() for r in frame.collect()}


def scope_counts(spark, tables) -> dict:
    """``GROUP BY scope`` over the ledger -- the one read that shows a phantom population."""
    return {
        r["scope"]: r["count"]
        for r in spark.table(tables.ledger).groupBy("scope").count().collect()
    }


def scan_row(spark, tables, scan_id, scope) -> dict:
    return run_pipeline.recorded_scan(spark, tables, scan_id, scope)


def sorted_rows(frame) -> list:
    """Every row of a frame, ordered deterministically, for a before/after comparison."""
    return sorted(str(r.asDict()) for r in frame.collect())


def families_for(spark, tables, scope) -> dict:
    """``{(scan_id, family): count}`` for one scope's share of the metrics table."""
    out: dict = {}
    for row in (
        spark.table(tables.metrics).where(F.col("scope") == scope).select("scan_id", "family")
    ).collect():
        key = (row["scan_id"], row["family"])
        out[key] = out.get(key, 0) + 1
    return out


# --------------------------------------------------------------------------- the register


@pytest.fixture
def register(spark, tmp_path):
    """A factory for fresh path-backed registers, so a perturbation gets a clean one.

    Path-backed rather than schema-backed because ``create_clustered`` goes through
    delta-spark's own Python builder, which cannot parse a three-level name (CLAUDE.md, brick
    section) -- and because a directory per register is cheap enough that every perturbation
    below can have its own rather than trying to undo the damage it just did.
    """
    counter = itertools.count()
    made = []

    def make():
        tables = run_pipeline.resolve_tables(
            "", argv=[], data_path=str(tmp_path / f"register-{next(counter)}")
        )
        run_pipeline.ensure_tables(spark, tables)
        made.append(tables)
        return tables

    return make


def seed_both_scopes(spark, tables):
    """``sca-1`` then ``os-1``: two populations in one ledger, in the chained job's order."""
    run_scan(spark, tables, sca_nodes(), "sca-1", TS["sca-1"], SCA)
    run_scan(spark, tables, os_nodes(), "os-1", TS["os-1"], OS)


def truncated_sca_scan(spark, tables):
    """``sca-2``: the same sca register with ``SCA_DROPPED`` of its findings gone."""
    run_scan(spark, tables, sca_nodes(SCA_KEPT), "sca-2", TS["sca-2"], SCA)


# ------------------------------------------------------------------------- perturbations
#
# Each one reproduces the defective code inline rather than asserting a rule from a comment,
# and each one is checked to have actually BITTEN -- a guard that fires on nothing is a finding,
# not a pass (CLAUDE.md). The check is in the test that installs it.


def unfilter_the_prior(patch, spark, tables):
    """``reconcile_scan``'s prior read with its ``.where(F.col("scope") == scope)`` deleted.

    Patched at ``ledger.reconcile`` rather than by editing ``reconcile_scan``, because the line
    under test is the ARGUMENT that call site passes: substituting the whole ledger table for
    the frame it was handed is exactly what deleting the filter would do, and nothing else in
    ``reconcile_scan`` changes.
    """
    real = ledger_mod.reconcile

    def unfiltered(prior, current, **kwargs):
        return real(spark.table(tables.ledger), current, **kwargs)

    patch.setattr(ledger_mod, "reconcile", unfiltered)


def stub_the_refusal(patch):
    """``_refuse_foreign_scope`` deleted as "redundant" -- the second guard, stood down."""
    patch.setattr(ledger_mod, "_refuse_foreign_scope", lambda prior, current, scope: None)


def unfilter_the_scan_log(patch):
    """``scan_log_desc``'s body with its ``scope`` conjunct deleted, and nothing else changed.

    This is the one that feeds ``reconcile``'s disappearance clock: ``previous_scan`` and
    ``prev_scan_id_by_severity`` both read this list, and both of them answer "what did the
    last scan OF THIS POPULATION see".
    """

    def unscoped(spark, tables, scope):
        return (
            spark.table(tables.metrics)
            .filter(F.col("family") == run_pipeline.FAMILY_SCAN)
            .select("scan_id", "scan_ts", "severities", "resolved_count")
            .orderBy(F.col("scan_ts").desc(), F.col("scan_id").desc())
            .collect()
        )

    patch.setattr(run_pipeline, "scan_log_desc", unscoped)


#: The conjunct that makes the ledger's key ``(vuln_key, scope)`` rather than ``vuln_key``.
MERGE_SCOPE_CONJUNCT = " AND target.scope = source.scope"


class _ScopelessMergeSession:
    """A session wrapper that strikes the scope conjunct out of the SHIPPED merge statement.

    Deliberately not a copy of ``merge_ledger``'s body: a copied SQL string would keep passing
    after the real one changed, and the point of this perturbation is to remove one clause from
    the statement production actually issues. ``removed`` records that the clause was there to
    remove -- if the MERGE is ever rewritten so this text no longer appears, the perturbation
    silently becomes a no-op and the test that installs it says so instead of passing.
    """

    def __init__(self, spark):
        self._spark = spark
        self.removed = 0

    def __getattr__(self, name):
        return getattr(self._spark, name)

    def sql(self, statement, *args, **kwargs):
        if MERGE_SCOPE_CONJUNCT in statement:
            statement = statement.replace(MERGE_SCOPE_CONJUNCT, "")
            self.removed += 1
        return self._spark.sql(statement, *args, **kwargs)


def drop_the_scope_from_the_merge_key(patch, spark) -> _ScopelessMergeSession:
    """MERGE ``ON target.vuln_key = source.vuln_key`` and nothing else -- the pre-S3-T2 key."""
    wrapper = _ScopelessMergeSession(spark)
    real = run_pipeline.merge_ledger
    patch.setattr(
        run_pipeline,
        "merge_ledger",
        lambda _spark, tables, touched: real(wrapper, tables, touched),
    )
    return wrapper


# ================================================================ (a) a scan of one scope


def test_a_scan_of_one_scope_resolves_nothing_in_another(spark, register, monkeypatch):
    """**Failure of absence**: an os row dated gone because an sca scan did not look at it.

    Every row of the os register is absent from an sca scan BY CONSTRUCTION, and
    resolution-by-disappearance is what turns absence into a remediation date. So the claim is
    not "the numbers come out right" but "the other two registers are not even in the join".

    Three perturbations, on three fresh registers, because the three guards that hold this are
    independent and the third is the only one whose failure reaches the data:

    1. the prior read unfiltered -> ``_refuse_foreign_scope`` REFUSES, naming both scopes;
    2. plus the refusal stubbed out -> the disappearance clock still blocks every os row,
       because ``scan_log_desc`` is still scoped and an os row's ``last_scan_id`` is not this
       scope's previous scan. The register comes out correct. This is why the third guard had
       to be perturbed separately to find the damage: two mutations agreeing by accident is
       exactly the "guard that fires on nothing" CLAUDE.md warns about;
    3. plus the scan log unfiltered -> the damage lands. Six os rows are re-stamped
       ``scope='sca'`` and INSERTed as a phantom population, the five real sca disappearances
       go unrecorded, and ``resolved_count`` reads 6 where it should read 5 -- a plausible
       number, which is worse than a wrong-looking one.
    """
    tables = register()
    seed_both_scopes(spark, tables)
    os_before = ledger_rows(spark, tables, OS)
    truncated_sca_scan(spark, tables)

    # --- as shipped -------------------------------------------------------------------
    os_after = ledger_rows(spark, tables, OS)
    assert len(os_after) == OS_FINDINGS
    assert os_after == os_before, "an sca scan must not rewrite a single os ledger row"
    for key, row in os_after.items():
        assert row["status"] == STATUS_OPEN, key
        assert row["resolved_at"] is None, key
        assert row["resolution_src"] is None, key
        assert row["last_scan_id"] == "os-1", key

    assert scan_row(spark, tables, "sca-2", SCA)["resolved_count"] == SCA_DROPPED
    assert scope_counts(spark, tables) == {OS: OS_FINDINGS, SCA: SCA_FINDINGS}
    assert (
        spark.table(tables.ledger)
        .where((F.col("scope") == SCA) & (F.col("resolution_src") == "disappeared"))
        .count()
        == SCA_DROPPED
    )

    # --- (1) the prior read unfiltered -> the refusal ----------------------------------
    refused = register()
    seed_both_scopes(spark, refused)
    with monkeypatch.context() as patch:
        unfilter_the_prior(patch, spark, refused)
        with pytest.raises(RuntimeError) as exc:
            truncated_sca_scan(spark, refused)
    message = str(exc.value)
    assert "reconcile(scope='sca') was handed prior rows carrying scope 'os'" in message
    assert "would resolve them all as fixed" in message
    # Refused BEFORE the join, so the ledger is exactly where the seed left it.
    assert scope_counts(spark, refused) == {OS: OS_FINDINGS, SCA: SCA_FINDINGS}
    assert run_pipeline.recorded_scan(spark, refused, "sca-2", SCA) is None

    # --- (2) ... with the refusal stubbed out -> the clock still blocks ----------------
    clocked = register()
    seed_both_scopes(spark, clocked)
    with monkeypatch.context() as patch:
        unfilter_the_prior(patch, spark, clocked)
        stub_the_refusal(patch)
        truncated_sca_scan(spark, clocked)
    assert scope_counts(spark, clocked) == {OS: OS_FINDINGS, SCA: SCA_FINDINGS}, (
        "the scoped scan log is the second guard: an os row's last_scan_id is os-1, and sca-2's "
        "previous sca scan is sca-1, so no os row can be said to have disappeared from it"
    )
    assert scan_row(spark, clocked, "sca-2", SCA)["resolved_count"] == SCA_DROPPED
    assert all(
        row["status"] == STATUS_OPEN for row in ledger_rows(spark, clocked, OS).values()
    )

    # --- (3) ... and the scan log unfiltered too -> the damage -------------------------
    damaged = register()
    seed_both_scopes(spark, damaged)
    scoped_log = run_pipeline.scan_log_desc(spark, damaged, SCA)
    with monkeypatch.context() as patch:
        unfilter_the_prior(patch, spark, damaged)
        stub_the_refusal(patch)
        unfilter_the_scan_log(patch)
        # The perturbation has to BITE: an unscoped log sees os-1 as well as sca-1, and it is
        # os-1 sitting at the front of it that makes every os row's last_scan_id look like
        # "the previous scan".
        assert len(run_pipeline.scan_log_desc(spark, damaged, SCA)) == len(scoped_log) + 1
        truncated_sca_scan(spark, damaged)

    damaged_counts = scope_counts(spark, damaged)
    assert damaged_counts[SCA] == SCA_FINDINGS + OS_FINDINGS, (
        "every os row was re-stamped scope='sca' by reconcile and INSERTed by the MERGE: a "
        "phantom population, in a register that merely looks bigger"
    )
    assert damaged_counts[OS] == OS_FINDINGS, (
        "the original os rows are still there -- this is not a move, it is a duplication, "
        "which is why no count of the os register can see it"
    )
    phantom = ledger_rows(spark, damaged, SCA)
    assert phantom["id:os-00"]["status"] == STATUS_RESOLVED
    assert phantom["id:os-00"]["resolution_src"] == "disappeared"
    assert phantom["id:sca-09"]["status"] == STATUS_OPEN, (
        "and the five findings that really did disappear stayed open: the clock is now "
        "comparing them against an os scan they were never in"
    )
    assert scan_row(spark, damaged, "sca-2", SCA)["resolved_count"] == OS_FINDINGS, (
        "the delta reports six resolutions where five happened -- a plausible number for the "
        "wrong population, which is the failure this whole module is about"
    )
    assert scan_row(spark, damaged, "sca-2", SCA)["new_count"] == 0, (
        "and the register grew by six rows on a scan that recorded no new findings at all"
    )


# =================================================== (b) the scan-log filter, by itself


def test_the_scan_log_filter_alone_carries_the_disappearance_clock(
    spark, register, monkeypatch
):
    """**Failure of presence**: five remediations that happened and are nowhere in the register.

    ``scan_log_desc``'s scope filter perturbed BY ITSELF, with the prior filter and the refusal
    both left in place. Nothing is corrupted, nothing is refused, no row of any scope moves --
    ``resolved_count`` simply reads 0 where it should read 5, and every disappeared sca finding
    stays OPEN with a NULL ``resolved_at`` forever.

    **This is the silent one.** The two perturbations in the test above either raise or leave a
    count visibly larger than the population; this one leaves a register that is internally
    consistent, plausible, and wrong. The mechanism is one comparison: ``previous_scan`` off an
    unscoped log answers ``os-1``, every sca row's ``last_scan_id`` is ``sca-1``, and
    ``p_last_scan_id == expected_prev`` is what a finding has to satisfy before its absence
    counts as a disappearance. Nothing downstream can tell "nobody disappeared this week" from
    "the clock was asking the wrong scan".
    """
    tables = register()
    seed_both_scopes(spark, tables)
    scoped_log = run_pipeline.scan_log_desc(spark, tables, SCA)

    with monkeypatch.context() as patch:
        unfilter_the_scan_log(patch)
        unscoped_log = run_pipeline.scan_log_desc(spark, tables, SCA)
        assert [r["scan_id"] for r in unscoped_log] == ["os-1", "sca-1"], (
            "the perturbation bites here: the newest scan in the table is the OTHER scope's"
        )
        assert [r["scan_id"] for r in scoped_log] == ["sca-1"]
        truncated_sca_scan(spark, tables)

    assert scan_row(spark, tables, "sca-2", SCA)["resolved_count"] == 0, (
        f"{SCA_DROPPED} findings left the register and the scan reported none"
    )
    sca_rows = ledger_rows(spark, tables, SCA)
    assert len(sca_rows) == SCA_FINDINGS
    for key, row in sca_rows.items():
        assert row["status"] == STATUS_OPEN, key
        assert row["resolved_at"] is None, key
        assert row["resolution_src"] is None, key
    # Nothing else moved: the prior filter and the refusal are both still in place, so this
    # failure has no symptom anywhere except the number that is missing.
    assert scope_counts(spark, tables) == {OS: OS_FINDINGS, SCA: SCA_FINDINGS}
    assert all(row["status"] == STATUS_OPEN for row in ledger_rows(spark, tables, OS).values())


# ======================================================== (c) one key, two scopes, two rows


def test_one_key_two_scopes_two_rows(spark, register, monkeypatch):
    """The same ``vuln_key`` under two scopes is two findings with two clocks.

    ``ledger.vuln_key`` prefers the Wiz finding id, so writing bronze nodes carrying the same
    ``id`` under ``os`` and under ``sca`` is what actually produces one key in two populations
    -- the case ``brick/docs/register.md`` describes as the same CVE reaching a host through an
    OS package and
    a service through a library dependency. The dates are deliberately different so the two
    rows can be told apart by more than their ``scope`` column.

    Perturbation: the shipped MERGE statement with ``AND target.scope = source.scope`` struck
    out. That is **not a missing row, it is a wrong one** -- one row survives, carrying whichever
    scope merged last and that scope's clock, and the only visible symptom is a register that
    is one row smaller.
    """
    shared_id = "shared-1"
    os_birth = "2026-01-15T00:00:00Z"
    sca_birth = "2026-03-20T00:00:00Z"
    os_shared = node(shared_id, firstDetectedAt=os_birth)
    sca_shared = node(shared_id, firstDetectedAt=sca_birth)
    sca_other = node("sca-only")

    tables = register()
    run_scan(spark, tables, [os_shared], "os-1", TS["os-1"], OS)
    run_scan(spark, tables, [sca_shared, sca_other], "sca-1", TS["sca-1"], SCA)

    rows = spark.table(tables.ledger).where(F.col("vuln_key") == f"id:{shared_id}").collect()
    assert len(rows) == 2, "one key, two populations, two rows"
    by_scope = {r["scope"]: r.asDict() for r in rows}
    assert set(by_scope) == {OS, SCA}
    assert by_scope[OS]["first_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == os_birth
    assert by_scope[SCA]["first_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == sca_birth
    assert by_scope[OS]["first_scan_id"] == "os-1"
    assert by_scope[SCA]["first_scan_id"] == "sca-1"

    # Resolving it in one scope leaves the other open: two clocks, independently.
    run_scan(spark, tables, [sca_other], "sca-2", TS["sca-2"], SCA)
    resolved = {
        r["scope"]: r.asDict()
        for r in spark.table(tables.ledger)
        .where(F.col("vuln_key") == f"id:{shared_id}")
        .collect()
    }
    assert resolved[SCA]["status"] == STATUS_RESOLVED
    assert resolved[SCA]["resolution_src"] == "disappeared"
    assert resolved[OS]["status"] == STATUS_OPEN
    assert resolved[OS]["resolved_at"] is None

    # --- perturbation: the MERGE key loses its scope -----------------------------------
    folded = register()
    with monkeypatch.context() as patch:
        wrapper = drop_the_scope_from_the_merge_key(patch, spark)
        run_scan(spark, folded, [os_shared], "os-1", TS["os-1"], OS)
        run_scan(spark, folded, [sca_shared, sca_other], "sca-1", TS["sca-1"], SCA)
        assert wrapper.removed == 2, (
            f"the perturbation must have struck {MERGE_SCOPE_CONJUNCT!r} out of both MERGEs; "
            f"if the statement no longer contains it this test is measuring nothing"
        )

    collapsed = spark.table(folded.ledger).where(F.col("vuln_key") == f"id:{shared_id}").collect()
    assert len(collapsed) == 1, "without scope in the key the two findings fold into one row"
    assert collapsed[0]["scope"] == SCA, "whichever population merged last wins the row"
    assert collapsed[0]["first_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == sca_birth, (
        "and it takes that scope's clock with it -- the os finding's birth date is simply gone"
    )
    assert scope_counts(spark, folded) == {SCA: 2}, (
        "the os scope has left the register entirely, and the only symptom is that the ledger "
        "is one row smaller than the findings that went into it"
    )


# ================================================================== (d) a scoped rebuild


def test_a_scoped_rebuild_leaves_the_other_scope_byte_identical(spark, register):
    """``rebuild_ledger(scope='sca')`` is the most destructive statement in the pipeline, and
    every DELETE in it names the scope.

    Bronze, the ledger and the metrics table are shared, so an unscoped DELETE here would empty
    two registers that have nothing to do with the recovery being attempted -- and because only
    the replayed scope's bronze is read back, the other two would come back as EMPTY registers
    rather than as wrong ones. **Failure of presence**, of the whole-register kind.

    So the os side is compared byte for byte, ledger rows and every metrics family alike, and
    the sca side is checked to have actually been regenerated rather than merely left alone --
    a rebuild that deleted nothing would pass the os half of this test trivially.
    """
    tables = register()
    run_scan(spark, tables, sca_nodes(), "sca-1", TS["sca-1"], SCA)
    run_scan(spark, tables, os_nodes(), "os-1", TS["os-1"], OS)
    run_scan(spark, tables, sca_nodes(SCA_KEPT), "sca-2", TS["sca-2"], SCA)
    run_scan(spark, tables, os_nodes(OS_FINDINGS - 1), "os-2", TS["os-2"], OS)

    os_ledger_before = sorted_rows(spark.table(tables.ledger).where(F.col("scope") == OS))
    os_metrics_before = sorted_rows(spark.table(tables.metrics).where(F.col("scope") == OS))
    os_families_before = families_for(spark, tables, OS)
    sca_ledger_before = sorted_rows(spark.table(tables.ledger).where(F.col("scope") == SCA))
    sca_families_before = families_for(spark, tables, SCA)
    assert os_metrics_before, "the os scope has to have gold for this comparison to mean anything"

    replayed = run_pipeline.rebuild_ledger(spark, tables, SCA, SEVERITIES, "scan_ts")
    assert replayed == 2, "two sca scans in bronze, and only those two"

    assert sorted_rows(spark.table(tables.ledger).where(F.col("scope") == OS)) == os_ledger_before
    assert (
        sorted_rows(spark.table(tables.metrics).where(F.col("scope") == OS)) == os_metrics_before
    )
    assert families_for(spark, tables, OS) == os_families_before

    # The sca side was really deleted and really rebuilt: same ledger, same families, same
    # per-scan row counts. (The ledger comparison is the keystone `test_ledger_pipeline` pins
    # for a single-scope register; it holds here too, with an os scan interleaved between the
    # two sca scans that the replay must ignore.)
    assert sorted_rows(spark.table(tables.ledger).where(F.col("scope") == SCA)) == sca_ledger_before
    assert families_for(spark, tables, SCA) == sca_families_before
    assert {family for _, family in sca_families_before} == set(run_pipeline.METRICS_FAMILIES)
    assert {scan for scan, _ in sca_families_before} == {"sca-1", "sca-2"}


# ============================================================= (e) the guard is still live


def prior_row(vuln_key, scope, **over) -> tuple:
    """One hand-assembled ledger row, as a tuple in ``LEDGER_SCHEMA`` field order.

    Built from a dict of NULLs so a column added to the schema does not silently shift every
    value one place to the left -- which a hand-written tuple literal would do.
    """
    values = {field.name: None for field in LEDGER_SCHEMA.fields}
    values.update(
        vuln_key=vuln_key,
        scope=scope,
        severity="HIGH",
        status=STATUS_OPEN,
        first_seen=dt.datetime(2026, 4, 1),
        last_seen=dt.datetime(2026, 5, 1),
        reopened_count=0,
        first_scan_id="seed-1",
        last_scan_id="seed-1",
    )
    values.update(over)
    return tuple(values[field.name] for field in LEDGER_SCHEMA.fields)


def one_observation(spark, scope):
    """An ``observed()`` frame for one scope, built the way the pipeline builds one."""
    bronze = spark.createDataFrame(
        [("obs-1", TS["sca-2"], scope, 0, json.dumps(node("sca-00")))],
        "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING",
    ).withColumn("scan_ts", F.col("scan_ts").cast("timestamp"))
    return ledger_mod.observed(metrics.silver_findings(bronze, scope))


def test_refuse_foreign_scope_still_fires(spark):
    """``_refuse_foreign_scope`` refuses a two-scope prior, and it is REACHABLE now.

    It used to be a can't-happen: each scope had its own tables, so only a hand-assembled frame
    could trip it. One ledger for every scope makes it the proof that ``reconcile_scan``'s
    ``.where(scope == ...)`` ran -- one line, in one place, whose absence resolves two whole
    registers -- which is exactly why it must not be deleted as redundant. The plan that made it
    reachable asked for this test to be kept.

    The control matters as much as the refusal: the same call with the prior narrowed to the
    scope succeeds. A guard that raised on everything would pass the first half of this test
    and mean nothing.
    """
    prior = spark.createDataFrame(
        [prior_row("id:sca-00", SCA), prior_row("id:os-00", OS)], LEDGER_SCHEMA
    )
    current = one_observation(spark, SCA)

    with pytest.raises(RuntimeError) as exc:
        ledger_mod.reconcile(
            prior, current, scan_id="sca-2", scan_ts=TS["sca-2"], scope=SCA,
            prev_scan_id="seed-1", scanned_severities=SEVERITIES,
        )
    message = str(exc.value)
    assert "reconcile(scope='sca') was handed prior rows carrying scope 'os'" in message
    assert "Filter the prior to scope 'sca' before reconciling it." in message

    # The control: narrowed to one scope, the same call goes through and reconciles.
    touched = ledger_mod.reconcile(
        prior.where(F.col("scope") == SCA), current,
        scan_id="sca-2", scan_ts=TS["sca-2"], scope=SCA,
        prev_scan_id="seed-1", scanned_severities=SEVERITIES,
    )
    assert touched.count() == 1
    assert touched.collect()[0]["vuln_key"] == "id:sca-00"

    # And the observation side is guarded too: a foreign row on EITHER side is refused, which
    # is what makes this a check on the population rather than on one argument.
    with pytest.raises(RuntimeError) as obs_exc:
        ledger_mod.reconcile(
            prior.where(F.col("scope") == SCA), one_observation(spark, OS),
            scan_id="sca-2", scan_ts=TS["sca-2"], scope=SCA,
            prev_scan_id="seed-1", scanned_severities=SEVERITIES,
        )
    assert "was handed observation rows carrying scope 'os'" in str(obs_exc.value)


# ==================================================================== (f) what a page reads


def test_the_views_show_one_scope(spark, register, monkeypatch):
    """Every session view a notebook reads is one population, and the context's scope picks it.

    ``panels.register_views``' scope predicate always read ``scope``; until the table sets were
    merged it was reading a column that could only hold one value, so a dropped predicate would
    have changed nothing and no test could have seen it. It decides now -- silently, because
    blending grains that share a schema produces larger numbers rather than an error. This is
    the test that could not previously exist.

    Both directions, on the same register: the os context must not see the sca rows and the sca
    context must not see the os rows. One direction alone would pass against a view accidentally
    hard-filtered to the other scope.
    """
    tables = register()
    run_scan(spark, tables, sca_nodes(), "sca-1", TS["sca-1"], SCA)
    run_scan(spark, tables, os_nodes(), "os-1", TS["os-1"], OS)
    run_scan(spark, tables, sca_nodes(SCA_KEPT), "sca-2", TS["sca-2"], SCA)

    # Off Databricks `panels._param` falls through to the environment, so an ambient SCAN_ID,
    # CSV_PATH or TABLE_PREFIX on the machine running the suite would resolve a different
    # register or pin a different scan. Blanked rather than assumed absent.
    for name in ("SCAN_ID", "CSV_PATH", "TABLE_PREFIX", "SEVERITIES"):
        monkeypatch.setenv(name, "")

    expected_rows = {OS: OS_FINDINGS, SCA: SCA_FINDINGS}
    for scope in (OS, SCA):
        # `--scope` on argv rather than the SCOPE environment variable: `context` resolves the
        # scope through `run_pipeline.param`, where argv wins, and an ambient SCOPE on the
        # machine running the suite would otherwise decide what this test measures.
        ctx = panels.context(
            spark, [f"--scope={scope}"], tables=tables,
            group_by="subscription_name", rows="25", months="12",
        )
        assert ctx.scope == scope

        for view in ("v_mttr", "v_scans", "v_lifecycles"):
            frame = spark.table(view)
            assert frame.count() > 0, f"{view} is empty for {scope}; this would pass vacuously"
            assert {r["scope"] for r in frame.select("scope").distinct().collect()} == {scope}, (
                f"{view} under scope={scope} is showing another register's rows"
            )

        # `v_lifecycles` is the ledger one, and it is the one a blend would show up in as a
        # count: it is every finding this register has ever seen.
        assert spark.table("v_lifecycles").count() == expected_rows[scope]
        # `v_scans` is this scope's commit records and nothing else -- three scans exist in the
        # table, two of them sca's.
        assert {r["scan_id"] for r in spark.table("v_scans").collect()} == (
            {"sca-1", "sca-2"} if scope == SCA else {"os-1"}
        )
