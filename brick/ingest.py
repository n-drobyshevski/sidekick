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
    SCOPES,
)

# Wiz's shared auth endpoint. Tenants on a dedicated region override it via a job parameter.
DEFAULT_AUTH_URL = "https://auth.app.wiz.io/oauth/token"
AUDIENCE = "wiz-api"

DEFAULT_PAGE_SIZE = 500
DEFAULT_TIMEOUT_SECONDS = 120
MAX_RETRIES = 4
# Statuses worth another attempt: throttling and the transient 5xx family.
RETRY_STATUS = {429, 500, 502, 503, 504}

# A trimmed subset of ``os_vulns.QUERY`` -- only the fields the metrics actually consume.
# See ``os_vulns.py`` for the full-fidelity query the Streamlit app uses.
#
# The three exploit-intelligence fields are load-bearing and easy to overlook: hasCisaKevExploit,
# hasExploit and epssProbability are what make coverage and efficiency computable at all. Drop
# them and every finding classifies as "unknown".
QUERY = """
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
      vulnerableAsset {
        id
        type
        name
        cloudPlatform
        subscriptionName
        subscriptionExternalId
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""


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


def get_token(
    client_id: str,
    client_secret: str,
    *,
    auth_url: str = DEFAULT_AUTH_URL,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> str:
    """Exchange client credentials for a Wiz API bearer token."""
    response = requests.post(
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
    response.raise_for_status()
    token = response.json().get("access_token")
    if not token:
        raise RuntimeError("Wiz auth returned no access_token")
    return token


def severity_filter(severities: Sequence[str]) -> List[str]:
    """App severities -> the API's enum values (INFO is spelled INFORMATIONAL server-side)."""
    wanted = [s.strip().upper() for s in severities if s.strip()]
    return [API_SEVERITY_VALUES.get(s, s) for s in wanted]


def _post(
    api_url: str, token: str, variables: Dict[str, Any], timeout: int
) -> Dict[str, Any]:
    """One GraphQL POST, retrying the transient failures with exponential backoff."""
    last_error: Optional[Exception] = None
    for attempt in range(MAX_RETRIES):
        if attempt:
            time.sleep(2**attempt)
        try:
            response = requests.post(
                api_url,
                json={"query": QUERY, "variables": variables},
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
        response.raise_for_status()
        payload = response.json()
        if payload.get("errors"):
            raise RuntimeError(f"Wiz GraphQL errors: {json.dumps(payload['errors'])[:500]}")
        return payload
    raise RuntimeError(f"Wiz API unreachable after {MAX_RETRIES} attempts") from last_error


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

    api_severities = severity_filter(severities)
    if api_severities:
        filter_by["severity"] = api_severities
    if project_id:
        filter_by["projectIdV2"] = {"equals": [project_id]}
    return filter_by


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
) -> Iterator[Dict[str, Any]]:
    """Yield every finding node, walking the cursor-paginated connection.

    A generator rather than a list: a full register runs to hundreds of thousands of findings,
    and the caller writes each page to bronze instead of holding them all in the driver.
    """
    filter_by = build_filter(scope, severities, project_id)

    cursor: Optional[str] = None
    pages = 0
    while True:
        payload = _post(
            api_url,
            token,
            {"filterBy": filter_by, "first": page_size, "after": cursor},
            timeout,
        )
        connection = (payload.get("data") or {}).get("vulnerabilityFindings") or {}
        yield from connection.get("nodes") or []

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
