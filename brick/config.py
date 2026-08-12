"""Constants for the Databricks pipeline.

Deliberately duplicated rather than imported. ``brick/`` runs on a Spark cluster that has
neither ``wiz_dashboard`` nor Streamlit installed, so it stays self-contained. The sources of
truth these mirror:

* ``wiz_dashboard/config.py``      -- severity taxonomy, SLA targets, resolved statuses
* ``gas/src/domain/insights.ts``   -- EPSS priority threshold
* ``gas/src/domain/program.ts``    -- the risk rule and the capacity dead band

Change one of those and change this too.
"""

from dataclasses import dataclass

# ---- Deployment version ----
# The runtime modules are pasted into a flat Workspace folder by hand, one file at a time, and
# they move in lockstep: v2's silver frame gained columns that only v2's writers know to merge,
# the ledger is a module that did not exist in v1, and the reconciler reads constants defined
# below. A folder holding some v1 files and some v2 files therefore imports cleanly and then
# fails much later with something unrelated-looking -- the first real v2 run died on
# "A schema mismatch detected when writing to the Delta table" after ingesting 137,870
# findings, because v2's metrics.py was writing v2 silver through v1's run_pipeline.py.
#
# Every runtime module carries MODULE_VERSION, and run_pipeline.check_deployment() compares
# them before the run touches Spark. Bump this whenever the modules stop being
# mix-and-matchable with the previous release -- which is nearly always.
PIPELINE_VERSION = "2.3"
MODULE_VERSION = PIPELINE_VERSION

# ---- Severity taxonomy ----
SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"]

# Standard VM SLAs, in days.
SLA_TARGETS = {"CRITICAL": 7, "HIGH": 14, "MEDIUM": 30, "LOW": 90, "INFO": 180}

# Light-theme severity palette, mirrored from wiz_dashboard/config.py so a chart here and a
# chart in the Streamlit app agree. Each colour clears 3:1 against white as a graphical mark.
#
# It is a deliberate heat ramp, not a categorical palette, and it does NOT pass a categorical
# colourblind check: HIGH and MEDIUM sit ΔE 1.6 apart under deuteranopia and 6.7 apart even
# with normal vision. That is measured, not guessed. The consequence is a hard rule rather
# than a caveat -- **severity identity must never rest on colour alone.** Every chart in
# charts.py names the severity in an axis tick or a point label, and colour is redundant
# coding on top. A chart that would need the reader to tell #ea580c from #d97706 is wrong.
SEVERITY_COLORS = {
    "CRITICAL": "#dc2626",
    "HIGH": "#ea580c",
    "MEDIUM": "#d97706",
    "LOW": "#2563eb",
    "INFO": "#64748b",
    "UNKNOWN": "#475569",
}

# API-side statuses that mean remediated -- the MTTR stop-clock.
RESOLVED_STATUSES = {"RESOLVED", "REMEDIATED", "FIXED", "CLOSED"}

# App severity -> Wiz API enum for the GraphQL filterBy (the API spells INFO as INFORMATIONAL).
API_SEVERITY_VALUES = {
    "CRITICAL": "CRITICAL",
    "HIGH": "HIGH",
    "MEDIUM": "MEDIUM",
    "LOW": "LOW",
    "INFO": "INFORMATIONAL",
}

# What a scan pulls when nothing else is asked for.
DEFAULT_FETCH_SEVERITIES = ("CRITICAL", "HIGH")

# ---- Scopes: which population of findings a run measures ----
# The scope drives BOTH the API filter and the table names, from one parameter, so a table can
# never disagree with the population inside it. Every row also carries a `scope` column, so a
# row stays self-describing if the scopes are UNIONed later.
#
# What every scope shares, so the scopes stay comparable to each other.
#
#   status   Not about scoping at all. Without it the API returns only OPEN findings, and
#            every remediation metric silently collapses -- coverage 0%, efficiency undefined,
#            MTTR empty -- while looking like a real result.
#   hasFix   Restricts both scopes to findings a team could actually have remediated. It is
#            shared rather than OS-only so that remediation rates mean the same thing in each:
#            awaiting-vendor-fix findings would otherwise sit in `all`'s coverage denominator
#            and not in `os`'s, making `all` look worse for a reason that is not performance.
_BASE = {
    "status": ["OPEN", "RESOLVED"],
    "hasFix": True,
}

SCOPES = {
    # OS-package CVEs on host workloads: the population the Streamlit dashboard measures.
    # Mirrors os_vulns.VARIABLES["filterBy"], minus its hardcoded projectIdV2 -- that is one
    # tenant's project and is exposed here as an opt-in `project_id` parameter instead.
    "os": {
        **_BASE,
        "detectionMethod": ["OS"],
        "assetType": ["VIRTUAL_MACHINE"],
        "assetIsRepresentativeResource": False,
        "detailedNameV2": {"notEquals": ["openssl", "python", "vim"]},
    },
    # Every detection method and asset type -- container SBOM, code libraries, OS, the lot.
    # What still differs from "os" beyond the type/asset restriction: the openssl/python/vim
    # exclusions and the representative-resource filter are OS-view policy and are not applied
    # here, so `all` counts a few things `os` deliberately drops.
    "all": dict(_BASE),
}

DEFAULT_SCOPE = "os"

# ---- Where this deployment's tables live ----
# Deployment-specific, and the only two constants in this file that are. They are the defaults
# the **read-only notebooks** open with, so somebody who just wants to read a number does not
# have to know the namespace by heart.
#
# `run_pipeline.resolve_namespace` deliberately does NOT fall back to these: the write path
# still refuses to run without an explicit `--catalog`, because a default that succeeds is the
# wrong failure mode when the thing being written maps unpatched CVEs to named hosts. Reading
# the wrong catalog shows you an empty page; writing to it is a disclosure.
#
# `datalake_insight_analytics` is read-only to the service principal -- the writable one is the
# preprod catalog below, which is where the pipeline actually lands.
DEFAULT_CATALOG = "preprod_datalake_insight_analytics"
DEFAULT_SCHEMA = "industry"

# ---- Ingest: whether to ask for the asset behind each finding ----
# OFF, because the live tenant rejects it: the `vulnerableAsset` union members this query used
# are no longer in the schema, and the whole request 400s -- not the sub-selection, the request.
# One unavailable field costs the entire scan, so it is not asked for.
#
# A flag rather than a deletion, because this is a *tenant's* schema and not a decision: keeping
# `ingest._asset_selection` and its member list intact means turning the columns back on is one
# constant, not an archaeology exercise against `os_vulns.py`.
#
# What goes NULL when this is False: asset_id, asset_name, asset_type, cloud, subscription_name,
# subscription_ext_id -- so the estate breakdowns and every by-subscription panel have nothing
# to group on. `panels.attributability` is the page that says so out loud, and it will read 0%
# populated, which is the honest answer rather than a broken one.
#
# What is unaffected: MTTR, SLA, coverage, efficiency, capacity and the whole ledger. They read
# severity, status, timestamps and the exploit signals, none of which live on the asset. Identity
# is unaffected too -- `vuln_key` prefers the finding id, which is still selected, and only falls
# back to the asset-bearing hash when that is absent.
FETCH_ASSET_FIELDS = False

# ---- Risk classification (Prioritization to Prediction) ----
# FIRST's own guidance: 0.1 is the point where EPSS starts to be worth acting on.
EPSS_PRIORITY_THRESHOLD = 0.1


@dataclass(frozen=True)
class RiskRule:
    """The high-risk classifier: an **any-of** rule over the exploit signals Wiz attaches.

    Any-of rather than a single source because P2P vol. 9 (pp. 22-24) found CISA KEV alone
    covers only ~19% of what is actually exploited in the wild -- the strategies that perform
    fire when a CVE shows up in ANY of several sources.

    Frozen and inspectable so an operator can see, and change, what "high risk" means.
    """

    kev: bool = True
    exploit: bool = True
    epss: bool = True
    epss_threshold: float = EPSS_PRIORITY_THRESHOLD

    def is_empty(self) -> bool:
        """True when no signal is enabled -- nothing is decidable, so everything is unknown."""
        return not (self.kev or self.exploit or self.epss)

    def sentence(self) -> str:
        """The rule as a sentence, for a report header. A classifier you cannot read is one
        you cannot audit."""
        parts = []
        if self.kev:
            parts.append("CISA KEV")
        if self.exploit:
            parts.append("public exploit")
        if self.epss:
            parts.append(f"EPSS >= {self.epss_threshold:.2f}")
        return " or ".join(parts) if parts else "no signal enabled"


DEFAULT_RISK_RULE = RiskRule()

# ---- Capacity ----
# The dead band around zero net flow that still counts as "keeping up". P2P v3 Fig. 22 splits
# firms into falling behind / maintaining / gaining ground without a sharp cut, and a
# one-finding swing should not flip a monthly verdict.
NET_CAPACITY_BAND_PCT = 2

# The row label used for the all-severities aggregate in the gold tables.
OVERALL = "OVERALL"

# Which population a capacity row describes. The gold capacity table carries both, stacked,
# because they answer different questions and routinely disagree:
#
#   "all"        every finding -- how much of the backlog moves in a month.
#   "high_risk"  high-risk lifecycles only. This is the population P2P v3 defines net
#                remediation capacity over, and it is what gas/src/server/api.ts:859 passes
#                (`highRiskOnly: true`) on the production surface.
#
# Every query against the capacity table must filter on `population`, or it will read each
# month twice.
POPULATION_ALL = "all"
POPULATION_HIGH_RISK = "high_risk"

# ---- Lifecycle ledger (v2) ----
# Mirrors the disappearance modes in gas/src/domain/reconcile.ts, which is the reference
# implementation for the whole lifecycle layer. See ledger.py for what each rule does.
#
# When a finding was OPEN in the previous scan and is absent from this one, Wiz has told us
# nothing -- the finding simply stopped being returned. That is the ordinary shape of
# remediation, so it counts as resolved; the only question is *when*.
#
#   "scan_ts"   the timestamp of the scan that noticed the absence. Conservative: it
#               overstates MTTR by up to one scan interval, but every timestamp it writes was
#               actually observed. On a daily job the error is under 24h.
#   "midpoint"  halfway between the two scans. Halves the systematic bias at the cost of
#               recording a moment nobody observed.
#
# scan_ts is the default because an overstated MTTR is a visible, explainable error and an
# invented timestamp is not.
DISAPPEARANCE_RESOLUTION = "scan_ts"
DISAPPEARANCE_MODES = ("scan_ts", "midpoint")

# Lifecycle statuses stored on the ledger. Deliberately two-valued: a finding is either
# still costing us something or it is not. "reopened" is a counter, not a status -- a
# reopened finding IS open, and collapsing that into a third status would force every
# consumer to remember to include it.
STATUS_OPEN = "OPEN"
STATUS_RESOLVED = "RESOLVED"

# How a resolution was learned. The distinction is load-bearing rather than decorative:
# "api" is Wiz's own resolvedAt, "disappeared" is our inference, and a register whose
# resolutions are overwhelmingly inferred is telling you something about the data source.
# The gold MTTR table publishes the split per severity for exactly that reason.
RESOLUTION_API = "api"
RESOLUTION_DISAPPEARED = "disappeared"

# The durable ledger's columns, in table order. Mirrors gas/src/domain/reconcile.ts's
# LEDGER_COLUMNS, which is the reference implementation for the whole lifecycle layer.
#
# Two deliberate differences from that list:
#
#   component   ADDED. GAS does not persist it; it is cheap here, it is part of the vuln_key
#               hash basis, and the by-component breakdown reads it.
#   tags_json   OMITTED. GAS's domain-triage input, but brick's ingest query does not select
#               asset tags at all (see ingest._ASSET_FIELDS), so there is nothing to store.
#               Adding it is an ingest change, not a ledger one.
#
# has_kev / has_exploit / epss stay NULLABLE the whole way through -- see the correctness
# trap at the top of metrics.py. A NULL means "never captured", which is not "false".
LEDGER_COLUMNS = [
    "vuln_key",
    "scope",
    "cve",
    "component",
    "severity",
    "asset_id",
    "asset_name",
    "asset_type",
    "cloud",
    "subscription_name",
    "subscription_ext_id",
    "first_seen",
    "last_seen",
    "status",
    "resolved_at",
    "resolution_src",
    "reopened_count",
    "first_scan_id",
    "last_scan_id",
    # Vendor-fix capture. Nothing in v2 reads these yet -- the actionable clock
    # (mttr_actionable_days, awaiting_vendor_fix) is gas/src/domain/ledgerCore.ts::baseRows'
    # job and is out of scope here. They are captured anyway because they cannot be
    # recovered later: a finding resolved by disappearance is gone from the API entirely,
    # so a signal not written down at observation time is lost for good. Cheap now,
    # impossible afterwards.
    "fix_date",
    "fix_observed_at",
    # Exploit intelligence. Same durability argument, but these ARE read: coverage and
    # efficiency classify from the ledger, and the population they classify includes
    # findings that have since disappeared.
    "has_kev",
    "has_exploit",
    "epss",
    "risk_observed_at",
]

# The per-run log. Three jobs: it is the idempotency guard (a run whose scan_id is already
# here is a no-op), it records each scan's severity scope so reconciliation never
# resolves-by-disappearance a severity that was not scanned, and its first row dates the
# start of the observation window -- which is what lets capacity flag reconstructed months.
SCANS_COLUMNS = [
    "scan_id",
    "scan_ts",
    "scope",
    "severities",
    "total",
    "new_count",
    "resolved_count",
    "reopened_count",
]
