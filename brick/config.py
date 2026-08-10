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
