"""Pull vulnerability findings out of the Wiz GraphQL API.

Plain ``requests`` rather than ``wiz_sdk`` (which ``os_vulns.py`` uses): the SDK is not on a
stock Databricks cluster, and all this needs is an OAuth token and a paginated POST.

Nothing here touches Spark -- ``fetch_findings`` yields raw node dicts and the caller decides
what to do with them. That keeps the network half testable on its own.
"""

from __future__ import annotations

import copy
import json
import os
import time
from typing import Any, Dict, Iterator, List, Optional, Sequence

import requests

import dbx
from config import (
    API_SEVERITY_VALUES,
    DEFAULT_FETCH_SEVERITIES,
    DEFAULT_SCOPE,
    FETCH_ASSET_FIELDS,
    SCOPE_ASSET_MEMBERS,
    SCOPES,
    SOURCES,
)

# Wiz's shared auth endpoint. Tenants on a dedicated region override it via a job parameter.
# See config.PIPELINE_VERSION: every runtime module must come from the same upload.
MODULE_VERSION = "2.3"

DEFAULT_AUTH_URL = "https://auth.app.wiz.io/oauth/token"
AUDIENCE = "wiz-api"

DEFAULT_PAGE_SIZE = 500
DEFAULT_TIMEOUT_SECONDS = 120
MAX_RETRIES = 4
# Statuses worth another attempt: throttling and the transient 5xx family.
RETRY_STATUS = {429, 500, 502, 503, 504}

# ``vulnerableAsset`` is a UNION, not an object: its fields can only be reached through inline
# fragments on each concrete member. Selecting `vulnerableAsset { id name ... }` directly is a
# GraphQL validation error and the server answers 400 -- which is exactly how this first failed
# against a live tenant.
#
# It is not asked for at all by default -- see ``config.FETCH_ASSET_FIELDS``, which is where the
# reason and the consequences are written down. Everything below is kept so that flipping the
# constant is the whole job.
#
# The member list and the per-member field availability are both taken from the live query in
# ``os_vulns.py`` (its ``... on VulnerableAsset*`` fragments), so they match a schema that is
# known to work. Two members genuinely lack some of the fields; asking anyway would 400 again.
_ASSET_FIELDS = (
    "id",
    "type",
    "name",
    "cloudPlatform",
    "subscriptionName",
    "subscriptionExternalId",
)
_ASSET_MEMBERS = (
    "VulnerableAssetBase",
    "VulnerableAssetVirtualMachine",  # the one `scope=os` actually returns
    "VulnerableAssetServerless",
    "VulnerableAssetContainerImage",
    "VulnerableAssetContainer",
    "VulnerableAssetRepositoryBranch",
    "VulnerableAssetIde",
    "VulnerableAssetEndpoint",
    "VulnerableAssetPaaSResource",
    "VulnerableAssetVirtualMachineImage",
    "VulnerableAssetNetworkAddress",
    "VulnerableAssetCommon",
    "VulnerableAssetDevice",
)
_ASSET_OMISSIONS = {
    "VulnerableAssetRepositoryBranch": {"subscriptionName", "subscriptionExternalId"},
    "VulnerableAssetNetworkAddress": {"id", "type", "name", "cloudPlatform"},
}


def asset_members(scope: str = DEFAULT_SCOPE) -> tuple:
    """Which ``vulnerableAsset`` union members this scope asks for -- possibly none.

    A union fails as a whole, so one member the tenant no longer has costs the entire request.
    That is what ``FETCH_ASSET_FIELDS`` is off for, and it is also why the answer is per-scope:
    a scope that returns exactly one member can ask for exactly that one and be safe.
    ``config.SCOPE_ASSET_MEMBERS`` holds the overrides and the evidence for each.
    """
    override = SCOPE_ASSET_MEMBERS.get(scope)
    if override:
        return tuple(override)
    return tuple(_ASSET_MEMBERS) if FETCH_ASSET_FIELDS else ()


def _asset_selection(indent: str = " " * 6, members: Sequence[str] = _ASSET_MEMBERS) -> str:
    """The ``vulnerableAsset`` sub-selection: one inline fragment per union member.

    Generated rather than hand-written so the field list stays in one place and a member that
    lacks a field cannot silently acquire it.
    """
    blocks = []
    for member in members:
        fields = [f for f in _ASSET_FIELDS if f not in _ASSET_OMISSIONS.get(member, ())]
        body = "".join(f"{indent}    {f}\n" for f in fields)
        blocks.append(f"{indent}  ... on {member} {{\n{body}{indent}  }}\n")
    return f"{indent}vulnerableAsset {{\n" + "".join(blocks) + f"{indent}}}"


# A trimmed subset of ``os_vulns.QUERY`` -- only the fields the metrics actually consume.
# See ``os_vulns.py`` for the full-fidelity query the Streamlit app uses.
#
# The three exploit-intelligence fields are load-bearing and easy to overlook: hasCisaKevExploit,
# hasExploit and epssProbability are what make coverage and efficiency computable at all. Drop
# them and every finding classifies as "unknown".
_QUERY_TEMPLATE = """
query BrickVulnerabilityFindings(
  $filterBy: VulnerabilityFindingFilters
  $first: Int
  $after: String
) {
  vulnerabilityFindings(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
      detailedName
      severity
      status
      firstDetectedAt
      lastDetectedAt
      resolvedAt
      fixDate
      fixedVersion
      hasExploit
      hasCisaKevExploit
      epssProbability
%s
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""


# `artifactType` carries the ecosystem a finding was detected in, which is P2P v5's asset
# category for a code register (see config.ASSET_GROUP_UNKNOWN). Asked for ONLY by the scopes
# that group on it, on exactly the reasoning behind FETCH_ASSET_FIELDS: a field this tenant
# might not have costs the whole request, so no scope pays for a column it does not read.
_ARTIFACT_SELECTION = """      artifactType {
        codeLibraryLanguage
      }"""

_ARTIFACT_SCOPES = frozenset({"sca"})


def build_query(with_assets: bool = FETCH_ASSET_FIELDS, *, scope: str = DEFAULT_SCOPE) -> str:
    """The vulnerability-findings query for a scope.

    The `%s` slot is filled with the asset fragments or with nothing at all -- an empty string
    rather than an empty ``vulnerableAsset {}``, which is itself a syntax error.

    ``with_assets`` is kept as a positional so the existing callers and tests read unchanged; a
    scope with an entry in ``config.SCOPE_ASSET_MEMBERS`` overrides it, because that entry is a
    statement about which members exist rather than a preference.
    """
    members = asset_members(scope) if scope in SCOPE_ASSET_MEMBERS else (
        tuple(_ASSET_MEMBERS) if with_assets else ()
    )
    blocks = [_asset_selection(members=members)] if members else []
    if scope in _ARTIFACT_SCOPES:
        blocks.append(_ARTIFACT_SELECTION)
    return _QUERY_TEMPLATE % ("\n".join(blocks))


QUERY = build_query()


# The static-analysis query. Trimmed from ``brick/devsecops/sast_request.py`` to the fields the
# metrics consume, and otherwise left exactly as that reference script has it -- which matters
# more here than it does for the query above, because this one is the only evidence available
# that a given selection actually validates against the tenant.
#
# **There are no timestamps in it, and that is not an oversight.** The reference query selects
# none, so none is known to exist on ``SASTFinding``. The consequence is that every SAST
# lifetime is dated from observation: `first_seen` is the scan that first returned the finding
# and `resolved_at` is the scan that stopped returning it. MTTR is therefore meaningless until
# the register has run for a while, and reads as near-zero before then -- the same failure the
# README's backfill section describes for a ledger started today.
#
# The captured response's `endCursor` decodes to a sort key of
# `finding_severityOrder = "4_2026-07-02T23:39:17.79412Z"`, so a timestamp does exist server
# side. If it turns out to be selectable, add it here and to ``SAST_NODE_SCHEMA``; nothing else
# has to change, because `metrics.silver_sast` already reads the column and the ledger already
# prefers an API date over an observed one.
_SAST_QUERY_TEMPLATE = """
query BrickSastFindings(
  $filterBy: SASTFindingFilters
  $first: Int
  $after: String
) {
  sastFindings(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
      status
      severity
      originalSeverity
      filePath
      startLine
      codeLibraryLanguage
      origin
      resolutionReason
      resource {
        id
        name
        type
      }
      weaknesses {
        id
      }
      aiAnalysis {
        verdict
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""

SAST_QUERY = _SAST_QUERY_TEMPLATE

#: Scope -> the GraphQL document that scope's source is queried with.
_QUERIES = {"vulnerability": lambda scope: build_query(scope=scope), "sast": lambda _: SAST_QUERY}


def query_for(scope: str = DEFAULT_SCOPE) -> str:
    """The GraphQL document for a scope, chosen by its source's ``kind``.

    One of exactly two dispatch sites on ``Source.kind``; the other is
    ``metrics.silver_findings``. Keeping them to two is what stops "which source is this?" from
    spreading through the pipeline.
    """
    source = SOURCES.get(scope)
    if source is None:
        raise RuntimeError(f"unknown scope {scope!r} -- expected one of {sorted(SOURCES)}")
    return _QUERIES[source.kind](scope)


def secret(scope: Optional[str], key: str, env_var: str) -> str:
    """A credential from the Databricks secret scope, falling back to an environment variable.

    The fallback is what lets this module import and run off-cluster (tests, a laptop) where
    ``dbutils`` does not exist. Raises rather than returning an empty string -- a blank
    credential fails later with a far less obvious error.
    """
    value = dbx.secret_value(scope, key) or os.environ.get(env_var, "")
    if not value:
        raise RuntimeError(
            f"No credential for {key!r}: set secret {scope or '<scope>'}/{key} "
            f"or the {env_var} environment variable."
        )
    return value


def new_session() -> requests.Session:
    """One pooled HTTPS connection for a whole run.

    A full register is hundreds of sequential pages -- 137,870 findings at ``DEFAULT_PAGE_SIZE``
    is ~276 of them -- and a bare ``requests.post`` opens, negotiates TLS with and closes a
    connection for every single one. A ``Session`` keeps one connection alive across all of
    them, which is the whole of the saving: the requests themselves are unchanged, so nothing
    downstream can tell the difference.

    Not shared at module level: a session holds sockets, and a long-lived notebook that imports
    this module should not be holding one open between runs.
    """
    return requests.Session()


def get_token(
    client_id: str,
    client_secret: str,
    *,
    auth_url: str = DEFAULT_AUTH_URL,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    session: Optional[requests.Session] = None,
) -> str:
    """Exchange client credentials for a Wiz API bearer token."""
    response = (session or requests).post(
        auth_url,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "audience": AUDIENCE,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=timeout,
    )
    # Same reasoning as _post: an auth rejection explains itself in the body (bad audience,
    # unknown client, wrong tenant region), and raise_for_status would discard all of it.
    if response.status_code >= 400:
        raise RuntimeError(
            f"Wiz auth returned {response.status_code} for {auth_url}\n"
            f"{describe_errors(response.text)}"
        )
    token = response.json().get("access_token")
    if not token:
        raise RuntimeError("Wiz auth returned no access_token")
    return token


def severity_filter(severities: Sequence[str]) -> List[str]:
    """App severities -> the API's enum values (INFO is spelled INFORMATIONAL server-side)."""
    wanted = [s.strip().upper() for s in severities if s.strip()]
    return [API_SEVERITY_VALUES.get(s, s) for s in wanted]


def _post(
    api_url: str,
    token: str,
    variables: Dict[str, Any],
    timeout: int,
    session: Optional[requests.Session] = None,
    query: Optional[str] = None,
) -> Dict[str, Any]:
    """One GraphQL POST, retrying the transient failures with exponential backoff.

    ``session`` is an optional pooled connection -- see ``new_session``. Absent, this falls back
    to ``requests.post``, which is a fresh connection per call and is what the caller gets if it
    does not care.

    ``query`` defaults to the vulnerability-findings document, so callers that predate a second
    source read unchanged.
    """
    document = query or QUERY
    last_error: Optional[Exception] = None
    poster = session or requests
    for attempt in range(MAX_RETRIES):
        if attempt:
            time.sleep(2**attempt)
        try:
            response = poster.post(
                api_url,
                json={"query": document, "variables": variables},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                timeout=timeout,
            )
        except requests.RequestException as exc:
            last_error = exc
            continue
        if response.status_code in RETRY_STATUS:
            last_error = RuntimeError(f"Wiz API returned {response.status_code}")
            continue
        # Not raise_for_status(): it reports the status and throws the body away, and for a
        # GraphQL 400 the body IS the diagnosis -- the rejected field or filter key, by name.
        # An API error you cannot read is a bug in the client.
        if response.status_code >= 400:
            raise RuntimeError(
                f"Wiz API returned {response.status_code} for {api_url}\n"
                f"{describe_errors(response.text)}"
            )
        payload = response.json()
        # A GraphQL 200 can still carry errors -- a partial failure reports here, not in the
        # status code.
        if payload.get("errors"):
            raise RuntimeError(f"Wiz GraphQL errors:\n{describe_errors(response.text)}")
        return payload
    raise RuntimeError(f"Wiz API unreachable after {MAX_RETRIES} attempts") from last_error


def describe_errors(body: str, limit: int = 2000) -> str:
    """Pull the readable part out of a GraphQL error body.

    Wiz replies with ``{"errors": [{"message": ...}]}``; the messages name the offending field
    or filter key, which is the whole story for a 400. Falls back to the raw text when the body
    is not the shape we expect, because a truncated raw body still beats "400 Client Error".
    """
    try:
        errors = (json.loads(body) or {}).get("errors")
    except (ValueError, AttributeError):
        errors = None
    if not isinstance(errors, list) or not errors:
        return body[:limit] if body else "(empty response body)"

    lines = []
    for error in errors:
        if not isinstance(error, dict):
            lines.append(str(error))
            continue
        message = error.get("message") or json.dumps(error)
        extensions = error.get("extensions") or {}
        code = extensions.get("code") if isinstance(extensions, dict) else None
        lines.append(f"  - {message}" + (f"  [{code}]" if code else ""))
    return "\n".join(lines)[:limit]


def build_filter(
    scope: str = DEFAULT_SCOPE,
    severities: Sequence[str] = DEFAULT_FETCH_SEVERITIES,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """The GraphQL ``filterBy`` for a scope.

    Pure and separately testable, because this dict decides which population every downstream
    metric is computed over -- a wrong key here is not an error, it is a plausible-looking
    number about the wrong thing.
    """
    if scope not in SCOPES:
        raise RuntimeError(f"unknown scope {scope!r} -- expected one of {sorted(SCOPES)}")
    filter_by: Dict[str, Any] = copy.deepcopy(SCOPES[scope])
    source = SOURCES[scope]

    api_severities = severity_filter(severities)
    if api_severities and source.severity_filter:
        filter_by["severity"] = api_severities
    if project_id:
        # The two filter types spell the project restriction differently, and the reference
        # scripts are the evidence for each: sca_request.py passes
        # `projectIdV2: {equals: [...]}` and sast_request.py passes a bare `projectId: [...]`.
        if source.kind == "sast":
            filter_by["projectId"] = [project_id]
        else:
            filter_by["projectIdV2"] = {"equals": [project_id]}
    return filter_by


def _severity_gate(severities: Sequence[str]):
    """A predicate keeping only the nodes in this run's severity scope, or None for "keep all".

    Reads ``severity`` and falls back to ``originalSeverity``, matching ``metrics.silver_sast``
    -- a node the projection would call HIGH must not be dropped here for having a blank
    primary severity. A node with neither is **kept**: it will land as UNKNOWN, which is a row
    somebody can see, where dropping it is a row nobody can.
    """
    wanted = set(severity_filter(severities))
    if not wanted:
        return None

    def keep(node: Dict[str, Any]) -> bool:
        value = node.get("severity") or node.get("originalSeverity")
        return value is None or str(value).strip().upper() in wanted

    return keep


def fetch_findings(
    api_url: str,
    token: str,
    *,
    scope: str = DEFAULT_SCOPE,
    severities: Sequence[str] = DEFAULT_FETCH_SEVERITIES,
    project_id: Optional[str] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    max_pages: Optional[int] = None,
    session: Optional[requests.Session] = None,
) -> Iterator[Dict[str, Any]]:
    """Yield every finding node, walking the cursor-paginated connection.

    A generator rather than a list: a full register runs to hundreds of thousands of findings,
    and the caller writes each page to bronze instead of holding them all in the driver.

    ``session`` pools the connection across pages; one is opened here when the caller does not
    supply one, so the saving is the default rather than something a caller has to remember.

    **The walk is sequential and has to stay that way.** Each request needs the previous page's
    ``endCursor``, and the order nodes arrive in is recorded as ``seq`` and consumed by
    ``ledger.observed``'s first-wins de-duplication -- so fetching pages concurrently would not
    merely be hard, it would change which duplicate wins.
    """
    filter_by = build_filter(scope, severities, project_id)
    query = query_for(scope)
    source = SOURCES[scope]
    connection_name = source.connection
    # A source whose filter type has no `severity` key cannot be asked to narrow, so the scope
    # is applied here instead. It has to be applied *somewhere*: `--severities` is recorded in
    # the scan log and drives the disappearance guard, so a run that ingested MEDIUM rows while
    # claiming to have scanned CRITICAL,HIGH would hand the next reconcile a scope its own data
    # contradicts. Costs the bandwidth of the rows it discards, and nothing else.
    keep = _severity_gate(severities) if not source.severity_filter else None
    session = session or new_session()

    cursor: Optional[str] = None
    pages = 0
    while True:
        payload = _post(
            api_url,
            token,
            {"filterBy": filter_by, "first": page_size, "after": cursor},
            timeout,
            session,
            query=query,
        )
        connection = (payload.get("data") or {}).get(connection_name) or {}
        nodes = connection.get("nodes") or []
        yield from (nodes if keep is None else [n for n in nodes if keep(n)])

        pages += 1
        page_info = connection.get("pageInfo") or {}
        cursor = page_info.get("endCursor")
        if not page_info.get("hasNextPage") or not cursor:
            return
        if max_pages is not None and pages >= max_pages:
            return


def extract_nodes(payload: Any) -> List[Dict[str, Any]]:
    """Pull finding nodes out of a saved GraphQL response envelope.

    Mirrors ``wiz_dashboard.data.transform.extract_nodes`` so the committed fixtures
    (``os_vulns_response_exemple.json``) can be replayed through this pipeline without a
    network call -- which is how the end-to-end test runs.
    """
    if isinstance(payload, list):
        return [n for n in payload if isinstance(n, dict)]
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, dict):
        findings = data.get("vulnerabilityFindings")
        if isinstance(findings, dict) and isinstance(findings.get("nodes"), list):
            return [n for n in findings["nodes"] if isinstance(n, dict)]
        for value in data.values():
            if isinstance(value, dict) and isinstance(value.get("nodes"), list):
                return [n for n in value["nodes"] if isinstance(n, dict)]
    if isinstance(payload.get("nodes"), list):
        return [n for n in payload["nodes"] if isinstance(n, dict)]
    return []
