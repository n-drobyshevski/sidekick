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
