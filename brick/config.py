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
    # Software composition analysis: CVEs in the libraries a repository depends on. Mirrors
    # brick/devsecops/sca_request.py's filterBy, minus its hardcoded projectIdV2.
    #
    # This is the SAME GraphQL connection `os` reads -- `vulnerabilityFindings`, filtered to the
    # code stage of the pipeline -- which is why it needs no new maths at all: the findings carry
    # a CVE and the same three exploit signals, so the ledger, Kaplan-Meier MTTR, the confusion
    # matrix and capacity all apply unchanged and mean the same thing they mean for `os`.
    #
    #   codeToCloudPipelineStage  CODE, i.e. the library as it appears in the repository, not
    #                             the copy of it baked into a container image further down the
    #                             pipeline. Without it a single dependency is counted once per
    #                             repo AND once per image built from that repo.
    #   isDefaultBranch           or every feature branch is its own asset, and the register
    #                             grows and shrinks with the team's branching habits.
    "sca": {
        **_BASE,
        "codeToCloudPipelineStage": ["CODE"],
        "isDefaultBranch": {"equals": True},
    },
    # Static analysis: weaknesses in first-party code. A different connection, a different
    # filter type, and -- see SastRiskRule below -- no exploit intelligence of any kind.
    #
    # `_BASE` deliberately does NOT apply. `status` and `hasFix` are VulnerabilityFindingFilters
    # keys and SASTFindingFilters has neither, so this scope cannot ask the API for resolved
    # findings the way the others do. The consequence is documented rather than hidden: SAST
    # closures are learned almost entirely by disappearance, `resolution_src` reads
    # `disappeared` for nearly every row, and the `snap_*` snapshot columns beside every MTTR
    # figure read ~0 resolved. That is the ledger working as designed, not a fault.
    "sast": {
        "resource": {"isDefaultBranch": {"equals": True}},
    },
}

DEFAULT_SCOPE = "os"

# ---- Sources: which API connection a scope reads ----
# A scope has always chosen a `filterBy`. Two of them now also choose a GraphQL connection and
# therefore a node shape, so that choice is named rather than left implicit in an `if`.
#
# `kind` is the discriminator, and there are exactly two dispatch sites on it: `ingest` picks
# the query document, `metrics` picks the silver projection. Both projections emit the SAME
# silver columns, which is what lets `ledger.py` -- the module most expensive to get wrong --
# stay completely unaware that a second source exists.


@dataclass(frozen=True)
class Source:
    """The API connection behind a scope.

    ``connection`` is the GraphQL field name, which is also the key the nodes arrive under in
    the response envelope, which is also what ``ingest.fetch_findings`` pages on. One string,
    three jobs -- so a scope cannot page one connection and read another.
    """

    kind: str
    connection: str
    #: Whether ``filterBy`` accepts a ``severity`` list. False means ``--severities`` cannot be
    #: pushed to the API, and ``ingest._severity_gate`` applies it to the returned nodes
    #: instead -- it has to be applied somewhere, because the scan log records the scope and
    #: the disappearance guard trusts it.
    severity_filter: bool = True


VULN_SOURCE = Source(kind="vulnerability", connection="vulnerabilityFindings")
# UNVERIFIED against the live tenant: whether SASTFindingFilters accepts `severity`. If it does
# not, flip `severity_filter` to False -- the scan still records its severity scope, so nothing
# about the disappearance guard changes; the only cost is pulling rows the run then discards.
SAST_SOURCE = Source(kind="sast", connection="sastFindings")

SOURCES = {
    "os": VULN_SOURCE,
    "all": VULN_SOURCE,
    "sca": VULN_SOURCE,
    "sast": SAST_SOURCE,
}

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

# ---- ...except for the scopes where a narrower member list is known to work ----
# The paragraph above is about a *union*, and a union fails as a whole: one member the tenant no
# longer has costs the entire request. That is an argument for asking for fewer members, not for
# asking for none -- and which members a scope actually returns is knowable.
#
# `sca` returns REPOSITORY_BRANCH and nothing else, and brick/devsecops/sca_response.json is the
# evidence: every node in that captured response carries a `vulnerableAsset` with `id`, `type`,
# `name`, `cloudPlatform`, `repositoryId` and `repositoryName` populated. So the code register
# asks for exactly the two members it needs and gets its asset columns, while `os` keeps the
# behaviour above untouched.
#
# This is what makes the P2P v5 asset family (metrics.asset_profile) computable for code: v5's
# unit of analysis is the asset, and for a code register the asset is the repository branch.
#
# A scope absent from this map falls back to FETCH_ASSET_FIELDS over the full member list.
SCOPE_ASSET_MEMBERS = {
    "sca": ("VulnerableAssetBase", "VulnerableAssetRepositoryBranch"),
}

# ---- The asset-category column, which is P2P v5's unit of comparison ----
# v5 compares vulnerability density, velocity and capacity across asset *categories* -- Windows,
# Linux/Unix, Mac, appliances. A code register has no operating systems, and the nearest thing
# that carries the same "assets of this kind behave alike" meaning is the language/ecosystem:
# a Java repo and an npm repo have different dependency counts, different fix cadences and
# different upgrade friction for reasons that are about the ecosystem, not the team.
#
# NULL for `os` and `all`, which have no language, so their asset rows fall into the single
# UNKNOWN group and the OVERALL row is the only one worth reading there.
ASSET_GROUP_UNKNOWN = "UNKNOWN"

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

# ---- Risk classification for static analysis, where none of the above exists ----
# A SAST finding is a weakness in first-party code. It has no CVE, so it has no KEV entry, no
# published exploit and no EPSS score -- the three signals RiskRule is made of are all NULL, and
# under that rule every SAST finding classifies as `unknown` and every rate is undefined.
#
# So this rule exists. It is OURS, and the distance from P2P is one step longer here than it is
# for the CVE registers, which is worth stating in full because the numbers look identical:
#
#   P2P    positive class = exploitation observed in the wild, against a CVE.
#   os/sca positive class = our rule over Wiz's exploit signals. One step: a prediction about
#          exploitation, made per CVE, by somebody whose job that is.
#   sast   positive class = our rule over a weakness CLASS. Two steps: from "this weakness is of
#          a kind that has historically been exploited across all software" to "this instance of
#          it, in this file, is worth fixing first". That second step is a genuine leap. The
#          weakness class says nothing about whether this particular call site is reachable,
#          whether the input is attacker-controlled, or whether the code ships at all.
#
# P2P is explicit that it offers no help here: volumes 1, 2 and 3 each say, verbatim, "We won't
# be discussing CWEs in this study." Nothing below is P2P-sanctioned. What is P2P-sanctioned is
# publishing the rule's sensitivity beside the rate it produces, which `metrics.rule_sensitivity`
# does for this rule exactly as it does for the other.


@dataclass(frozen=True)
class SastRiskRule:
    """The high-risk classifier for static-analysis findings: an **any-of** over three signals.

    Same shape as ``RiskRule`` on purpose -- frozen, inspectable, with a readable ``sentence()``
    -- because the two are read side by side and a classifier you cannot read is one you cannot
    audit. Each signal answers a different question, which is why it is an any-of:

      cwe         is this a KIND of weakness that gets exploited?  (external evidence)
      ai_verdict  does the scanner's own triage think this instance is real?  (vendor opinion)
      critical    did somebody already say this one is the worst tier?  (existing judgement)
    """

    cwe: bool = True
    ai_verdict: bool = True
    critical: bool = True

    def is_empty(self) -> bool:
        """True when no signal is enabled -- nothing is decidable, so everything is unknown."""
        return not (self.cwe or self.ai_verdict or self.critical)

    def sentence(self) -> str:
        """The rule as a sentence, for a report header."""
        parts = []
        if self.cwe:
            parts.append("CWE in the Top 25")
        if self.ai_verdict:
            parts.append("AI triage says exploitable")
        if self.critical:
            parts.append("severity CRITICAL")
        return " or ".join(parts) if parts else "no signal enabled"


DEFAULT_SAST_RISK_RULE = SastRiskRule()

# MITRE's CWE Top 25 Most Dangerous Software Weaknesses, 2024 edition.
#
# **Provenance, because this is the one input that claims external evidence.** MITRE computes the
# list annually by scoring CWEs on the frequency and severity of the CVEs mapped to them over a
# two-year window, with CISA KEV membership weighted in. That makes it the closest thing to
# "weakness classes that get exploited in the wild" that exists as a citable list -- which is
# exactly the role CISA KEV plays in `RiskRule`, one level of abstraction up.
#
# It is a snapshot and it ages: re-derive it against the current year's publication rather than
# trusting this tuple indefinitely. The year is in the name of the constant for that reason.
CWE_TOP_25_2024 = (
    "CWE-79",   # Cross-site Scripting
    "CWE-787",  # Out-of-bounds Write
    "CWE-89",   # SQL Injection
    "CWE-352",  # Cross-Site Request Forgery
    "CWE-22",   # Path Traversal
    "CWE-125",  # Out-of-bounds Read
    "CWE-78",   # OS Command Injection
    "CWE-416",  # Use After Free
    "CWE-862",  # Missing Authorization
    "CWE-434",  # Unrestricted Upload of File with Dangerous Type
    "CWE-94",   # Code Injection
    "CWE-20",   # Improper Input Validation
    "CWE-77",   # Command Injection
    "CWE-287",  # Improper Authentication
    "CWE-269",  # Improper Privilege Management
    "CWE-502",  # Deserialization of Untrusted Data
    "CWE-200",  # Exposure of Sensitive Information to an Unauthorized Actor
    "CWE-863",  # Incorrect Authorization
    "CWE-918",  # Server-Side Request Forgery
    "CWE-119",  # Improper Restriction of Operations within the Bounds of a Memory Buffer
    "CWE-476",  # NULL Pointer Dereference
    "CWE-798",  # Use of Hard-coded Credentials
    "CWE-190",  # Integer Overflow or Wraparound
    "CWE-400",  # Uncontrolled Resource Consumption
    "CWE-306",  # Missing Authentication for Critical Function
)

EXPLOITED_CWES = frozenset(CWE_TOP_25_2024)

# **The hierarchy problem, which is the weakest joint in this rule.** CWE is a tree, scanners
# report leaves, and the Top 25 is mostly interior nodes. brick/devsecops/sast_response.json
# shows it immediately: it contains CWE-23 (Relative Path Traversal), which is a child of
# Top-25 member CWE-22 and would not match by id. P2P vol. 9 names this exact difficulty --
# "the hierarchical nature of CWEs" -- as a reason it does not categorise this way.
#
# So a child is matched through its Top-25 ancestor. This map is **deliberately incomplete**: it
# holds the children actually seen in this tenant's findings, not a transcription of the CWE
# tree. An unmapped child does not match, which classifies it `low` rather than `high` -- so the
# gap costs coverage's numerator, silently, and grows with every scanner rule this map has not
# caught up with. `metrics.signal_breakdown` publishes `cwe_unmapped` for exactly this reason:
# it is the size of the doubt, and it is the number to watch before quoting a SAST rate.
CWE_ANCESTORS = {
    "CWE-23": "CWE-22",    # Relative Path Traversal        -> Path Traversal
    "CWE-36": "CWE-22",    # Absolute Path Traversal        -> Path Traversal
    "CWE-80": "CWE-79",    # Basic XSS                      -> Cross-site Scripting
    "CWE-83": "CWE-79",    # XSS in attributes              -> Cross-site Scripting
    "CWE-91": "CWE-94",    # XML Injection                  -> Code Injection
    "CWE-95": "CWE-94",    # Eval Injection                 -> Code Injection
    "CWE-470": "CWE-94",   # Unsafe Reflection              -> Code Injection
    "CWE-1321": "CWE-94",  # Prototype Pollution            -> Code Injection
    "CWE-88": "CWE-77",    # Argument Injection             -> Command Injection
    "CWE-611": "CWE-20",   # XML External Entity            -> Improper Input Validation
    "CWE-547": "CWE-798",  # Hard-coded security constants  -> Use of Hard-coded Credentials
    "CWE-259": "CWE-798",  # Hard-coded Password            -> Use of Hard-coded Credentials
    "CWE-321": "CWE-798",  # Hard-coded Cryptographic Key   -> Use of Hard-coded Credentials
    "CWE-1333": "CWE-400",  # Inefficient Regex Complexity  -> Uncontrolled Resource Consumption
    "CWE-732": "CWE-863",  # Incorrect Permission Assignment -> Incorrect Authorization
    "CWE-284": "CWE-862",  # Improper Access Control        -> Missing Authorization
}

# `aiAnalysis.verdict` values that count as the AI triage firing.
#
# UNVERIFIED against the live tenant: every node in the captured SAST response has
# `aiAnalysis: null`, so this enum is a guess at the vocabulary and the clause will simply never
# fire until it is corrected. That failure is quiet, which is why `signal_breakdown` publishes
# `ai_verdict_missing` -- a register where that equals the row count means either the field is
# not being returned or these are the wrong strings, and both are worth knowing.
AI_VERDICTS_HIGH = frozenset({"EXPLOITABLE", "TRUE_POSITIVE", "CONFIRMED", "VULNERABLE"})


def rule_for_scope(scope: str = DEFAULT_SCOPE):
    """The high-risk rule a scope is classified under.

    One function rather than a lookup at each call site, because getting it wrong is not an
    error -- it is a full page of plausible numbers. ``RiskRule`` against a SAST register
    classifies every finding `unknown` and reports 100% unclassified; ``SastRiskRule`` against
    a CVE register does the same in the other direction. Both look like data.
    """
    return DEFAULT_SAST_RISK_RULE if SOURCES.get(scope) is SAST_SOURCE else DEFAULT_RISK_RULE

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
    # Static-analysis risk inputs. NULL for every CVE-bearing scope (`os`, `all`, `sca`) and
    # populated only by `sast`, but they live on the shared ledger rather than a parallel one
    # for the same reason `has_kev` does: coverage and efficiency classify over the whole
    # ledger, including findings the API has stopped returning, so a signal not written down at
    # observation time cannot be recovered. One schema also keeps `ledger.py` -- the module
    # most expensive to get wrong -- unaware that a second source exists.
    #
    # `cwe` is a comma-separated list rather than an array. A finding can carry several
    # weaknesses, and an array survives neither the CSV register (see csvstore.py) nor a
    # spreadsheet; `metrics` splits it on the way into the classifier.
    "cwe",
    # The ecosystem the finding was found in (JAVA, JAVASCRIPT, ...). P2P v5's asset category,
    # which `metrics.asset_profile` groups on -- see ASSET_GROUP_UNKNOWN above.
    "language",
    "ai_verdict",
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
