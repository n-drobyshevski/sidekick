"""
# Python 3.9+
# To install the Wiz Python SDK package, refer to: https://docs.wiz.io/docs/python-sdk
"""

try:
    from wiz_sdk import WizAPIClient
except Exception:
    WizAPIClient = None


import json
import argparse
import concurrent.futures
import csv
import functools
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

####
# Configuration
####


# WIZ_CLIENT_ID = None     # Your Service Account Client ID
# WIZ_CLIENT_SECRET = None # Your Service Account Client Secret


# The GraphQL query that defines which data you wish to fetch.
QUERY = """
    query VulnerabilityFindingsTable($filterBy: VulnerabilityFindingFilters, $first: Int, $after: String, $orderBy: VulnerabilityFindingOrder = {direction: DESC, field: CREATED_AT}, $includeRelatedIssueAnalytics: Boolean = false, $includeRelatedSourceMappedIssueAnalytics: Boolean = false, $includeTotalCount: Boolean = false, $includePostureIssues: Boolean = false, $fetchPrivilegedActionRequests: Boolean = false) {
      vulnerabilityFindings(
        filterBy: $filterBy
        first: $first
        after: $after
        orderBy: $orderBy
      ) {
        nodes {
          ...VulnerabilityFindingFragment
          ...DuplicateFindingBadge
          transitivity
          rootComponent {
            name
          }
          isHighProfileThreat
          vendorSeverity
          nvdSeverity
          weightedSeverity
          hasExploit
          usedInCodeResult
          hasCisaKevExploit
          cisaKevReleaseDate
          cisaKevDueDate
          score
          epssSeverity
          epssPercentile
          epssProbability
          categories
          hasInitialAccessPotential
          isClientSide
          affectedBySettings
          codeLibraryLanguage
          exploitabilityValidationStatus
          cvssv2 {
            attackVector
            attackComplexity
            confidentialityImpact
            integrityImpact
            privilegesRequired
            userInteractionRequired
            vectorString
            scope
          }
          cvssv3 {
            attackVector
            attackComplexity
            confidentialityImpact
            integrityImpact
            privilegesRequired
            userInteractionRequired
            vectorString
            scope
          }
          effectiveAvailabilityImpact
          cnaScore
          vendorScore
          relatedIssueAnalytics @include(if: $includeRelatedIssueAnalytics) {
            ...VulnerabilityFindingRelatedIssueAnalyticsFragment
          }
          relatedSourceMappedIssueAnalytics @include(if: $includeRelatedSourceMappedIssueAnalytics) {
            ...VulnerabilityFindingRelatedIssueAnalyticsFragment
          }
          postureIssues @include(if: $includePostureIssues) {
            ...PostureIssuePopoverListRecord
          }
          privilegedActionRequests @include(if: $fetchPrivilegedActionRequests) {
            ...PendingUpdateVulnerabilityFindingStatusRequest
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
        totalCount @include(if: $includeTotalCount)
      }
    }
   
        fragment VulnerabilityFindingFragment on VulnerabilityFinding {
      id
      name
      detailedName
      description
      severity
      status
      fixedVersion
      detectionMethod
      firstDetectedAt
      firstDetectedAtSource
      lastDetectedAt
      resolvedAt
      validatedInRuntime
      runtimeValidationResult
      reachability
      hasTriggerableRemediation
      remediationPullRequestAvailable
      dataSourceName
      fixDate
      fixDateBefore
      publishedDate
      version
      versionResolutionPrimarySource {
        type
        version
      }
      isOperatingSystemEndOfLife
      recommendedVersion
      locationPath
      artifactType {
        ...SBOMArtifactTypeFragment
      }
      projects {
        id
        name
        slug
        isFolder
      }
      ignoreRules {
        id
      }
      note {
        id
        text
      }
      layerMetadata {
        id
        details
        isBaseLayer
        layerHash
      }
      vulnerableAsset {
        ... on VulnerableAssetBase {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          hasLimitedInternetExposure
          hasWideInternetExposure
          isAccessibleFromVPN
          isAccessibleFromOtherVnets
          isAccessibleFromOtherSubscriptions
          nativeType
          externalId
          providerUniqueId
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetVirtualMachine {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          operatingSystem
          operatingSystemDistribution {
            ...VulnerabilityFindingOperatingSystemDistribution
          }
          imageName
          imageId
          imageNativeType
          hasLimitedInternetExposure
          hasWideInternetExposure
          isAccessibleFromVPN
          isAccessibleFromOtherVnets
          isAccessibleFromOtherSubscriptions
          computeInstanceGroup {
            id
            externalId
            name
            replicaCount
            tags
          }
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetServerless {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          operatingSystemDistribution {
            ...VulnerabilityFindingOperatingSystemDistribution
          }
          hasLimitedInternetExposure
          hasWideInternetExposure
          isAccessibleFromVPN
          isAccessibleFromOtherVnets
          isAccessibleFromOtherSubscriptions
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetContainerImage {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          operatingSystemDistribution {
            ...VulnerabilityFindingOperatingSystemDistribution
          }
          hasLimitedInternetExposure
          hasWideInternetExposure
          isAccessibleFromVPN
          isAccessibleFromOtherVnets
          isAccessibleFromOtherSubscriptions
          repository {
            vertexId
            name
          }
          registry {
            vertexId
            name
          }
          scanSource
          executionControllers {
            ...VulnerableAssetExecutionControllerDetails
          }
          graphEntity {
            ...VulnerabilityContainerImageGraphEntityExecutionContext
          }
          nativeType
          tagReferences
          imageTags
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetContainer {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          operatingSystemDistribution {
            ...VulnerabilityFindingOperatingSystemDistribution
          }
          hasLimitedInternetExposure
          hasWideInternetExposure
          isAccessibleFromVPN
          isAccessibleFromOtherVnets
          isAccessibleFromOtherSubscriptions
          executionControllers {
            ...VulnerableAssetExecutionControllerDetails
          }
          nativeType
          isUsedOnPrem
        }
        ... on VulnerableAssetRepositoryBranch {
          id
          type
          name
          cloudPlatform
          repositoryId
          repositoryName
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetIde {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          hasLimitedInternetExposure
          hasWideInternetExposure
          isAccessibleFromVPN
          isAccessibleFromOtherVnets
          isAccessibleFromOtherSubscriptions
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetEndpoint {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          hasLimitedInternetExposure
          hasWideInternetExposure
          isAccessibleFromVPN
          isAccessibleFromOtherVnets
          isAccessibleFromOtherSubscriptions
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetPaaSResource {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetVirtualMachineImage {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          operatingSystemDistribution {
            ...VulnerabilityFindingOperatingSystemDistribution
          }
          hasLimitedInternetExposure
          hasWideInternetExposure
          isAccessibleFromVPN
          isAccessibleFromOtherVnets
          isAccessibleFromOtherSubscriptions
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetNetworkAddress {
          subscriptionId
          subscriptionName
          subscriptionExternalId
          tags
          address
          addressType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetCommon {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
        }
        ... on VulnerableAssetDevice {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
          subscriptionId
          tags
          nativeType
          isUsedOnPrem
          resourceGroupExternalId
          operatingSystem
          operatingSystemDistribution {
            ...VulnerabilityFindingOperatingSystemDistribution
          }
        }
      }
      sourceMappedCodeFindings {
        id
        remediationPullRequestAvailable
      }
    }
   


        fragment SBOMArtifactTypeFragment on SBOMArtifactType {
      group
      codeLibraryLanguage
      osPackageManager
      hostedTechnology {
        id
        name
        icon
      }
      plugin
      custom
      ciComponent
    }
   


        fragment VulnerabilityFindingOperatingSystemDistribution on Technology {
      id
      name
      icon
    }
   


        fragment VulnerableAssetExecutionControllerDetails on VulnerableAssetExecutionController {
      id
      entityType
      externalId
      providerUniqueId
      name
      subscriptionExternalId
      subscriptionId
      subscriptionName
      ancestors {
        id
        name
        entityType
        externalId
        providerUniqueId
      }
    }
   


        fragment VulnerabilityContainerImageGraphEntityExecutionContext on GraphEntity {
      id
      providerUniqueId
      type
      containerImageExecutionContextAnalyticsV3 {
        totalResourceCount
        nativeType {
          nativeType
          count
        }
      }
    }
   


        fragment DuplicateFindingBadge on VulnerabilityFinding {
      id
      origin
      duplicateOf {
        id
        name
        origin
        vulnerableAsset {
          ... on VulnerableAssetBase {
            id
            name
          }
        }
      }
    }
   


        fragment VulnerabilityFindingRelatedIssueAnalyticsFragment on VulnerabilityFindingRelatedIssueAnalytics {
      issueCount
      informationalSeverityCount
      lowSeverityCount
      mediumSeverityCount
      highSeverityCount
      criticalSeverityCount
    }
   


        fragment PostureIssuePopoverListRecord on PostureIssue {
      id
      name
      type
      entity {
        providerUniqueId
        id
        type
      }
    }
   


        fragment PendingUpdateVulnerabilityFindingStatusRequest on PrivilegedActionRequest {
      ...PendingStatusRequestBanner
      ...PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams
    }
   


        fragment PendingStatusRequestBanner on PrivilegedActionRequest {
      id
      type
      status
      createdAt
      createdBy {
        id
        name
        email
      }
      params {
        ... on PrivilegedActionRequestUpdateIssueStatusParams {
          issueStatus: status
        }
        ... on PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams {
          findingStatus: status
        }
        ... on PrivilegedActionRequestCreateIgnoreRuleParams {
          ignoreRuleName: name
        }
      }
    }
   


        fragment PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams on PrivilegedActionRequest {
      id
      params {
        ... on PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams {
          status
        }
      }
      subject {
        ... on VulnerabilityFinding {
          id
          status
        }
      }
    }
"""


# The variables sent along with the above query
VARIABLES = {
    "orderBy": {"field": "RELATED_ISSUE_SEVERITY", "direction": "DESC"},
    "includeRelatedIssueAnalytics": True,
    "includeRelatedSourceMappedIssueAnalytics": True,
    "includeTotalCount": False,
    "includePostureIssues": True,
    "fetchPrivilegedActionRequests": True,
    "first": 60,
    "filterBy": {
        "severity": ["CRITICAL"],
        "hasFix": True,
        "projectIdV2": {"equals": ["1dfea0cf-834f-5522-b797-bee5aaf09251"]},
        "assetType": ["VIRTUAL_MACHINE"],
        "detectionMethod": ["OS"],
        "status": ["OPEN", "RESOLVED"],
        "detailedNameV2": {"notEquals": ["openssl", "python", "vim"]},
        "assetIsRepresentativeResource": False,
    },
}


# Sample response for --dry-run / offline testing (flat per-finding shape).
#
# A realistic spread so the dashboard is fully populated offline: every severity,
# a mix of resolved (with resolvedAt) and still-open findings, SLA outcomes that
# both meet and miss their target, and varied assets / types / clouds / statuses so
# the filters have options. All names are CVE ids so the table's NVD link column
# activates. Dates are fixed absolute timestamps (not relative to "now") so MTTR and
# severity counts are deterministic; SLA targets are CRITICAL 7 / HIGH 14 / MEDIUM 30
# / LOW 90 / INFO 180 days (see config.SLA_TARGETS).
def _finding(
    fid, cve, severity, asset, atype, cloud, fixed, first, resolved=None, **extra
):
    """Build one sample finding. ``**extra`` merges rich Wiz fields onto the node
    (e.g. cvssv3, epssProbability, hasExploit, description); a ``vulnerableAsset``
    dict in ``extra`` deep-merges into the asset sub-object. Used to enrich a few
    findings so the details sheet's full-schema sections are visible under --dry-run."""
    node = {
        "id": fid,
        "name": cve,
        "severity": severity,
        "status": "RESOLVED" if resolved else "OPEN",
        "vulnerableAsset": {"name": asset, "type": atype, "cloudPlatform": cloud},
        "fixedVersion": fixed,
        "firstDetectedAt": f"{first}T00:00:00Z",
    }
    if resolved:
        node["resolvedAt"] = f"{resolved}T00:00:00Z"
    asset_extra = extra.pop("vulnerableAsset", None)
    if isinstance(asset_extra, dict):
        node["vulnerableAsset"].update(asset_extra)
    node.update(extra)
    return node


SAMPLE_RESULTS: Dict[str, Any] = {
    "data": {
        "vulnerabilityFindings": {
            "nodes": [
                # CRITICAL (SLA 7d): median ~5d (in SLA), with one breach + two open.
                _finding("dry-c1", "CVE-2026-1001", "CRITICAL", "web-prod-01", "VIRTUAL_MACHINE", "AWS", "1.2.3", "2026-04-01", "2026-04-04"),
                _finding("dry-c2", "CVE-2026-1002", "CRITICAL", "web-prod-02", "VIRTUAL_MACHINE", "AWS", "1.2.4", "2026-04-10", "2026-04-15"),
                # dry-c3 / dry-c4 / dry-h1 are enriched with the full Wiz field set so the
                # details sheet's scoring / exploitability / asset / tags sections demo offline.
                _finding(
                    "dry-c3", "CVE-2026-1003", "CRITICAL", "registry/api:2.1", "CONTAINER_IMAGE", "GCP", "2.2.0", "2026-03-20", "2026-04-01",
                    description="Heap overflow in libfoo allows unauthenticated remote code execution via a crafted request.",
                    detailedName="libfoo 1.4.2", recommendedVersion="2.2.0", detectionMethod="CONTAINER_IMAGE_SBOM",
                    publishedDate="2026-03-15T00:00:00Z", lastDetectedAt="2026-03-31T00:00:00Z",
                    hasExploit=True, hasCisaKevExploit=True, cisaKevReleaseDate="2026-03-18T00:00:00Z",
                    cisaKevDueDate="2026-04-08T00:00:00Z", validatedInRuntime=True, usedInCodeResult="USED",
                    epssSeverity="CRITICAL", epssPercentile=0.974, epssProbability=0.88,
                    weightedSeverity="CRITICAL", vendorSeverity="CRITICAL", nvdSeverity="CRITICAL", cnaScore=9.8,
                    cvssv3={"score": 9.8, "vectorString": "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"},
                    remediationPullRequestAvailable=True, hasTriggerableRemediation=True,
                    vulnerableAsset={
                        "id": "img-001", "externalId": "sha256:abc123ef",
                        "subscriptionName": "prod-registry", "subscriptionExternalId": "gcp-proj-prod",
                        "operatingSystem": "Debian 12", "hasWideInternetExposure": True,
                        "tags": {"team": "platform", "env": "prod", "pii": "false"},
                    },
                ),
                _finding(
                    "dry-c4", "CVE-2026-1004", "CRITICAL", "db-prod-01", "VIRTUAL_MACHINE", "Azure", "14.2", "2026-03-01",
                    description="Privilege escalation in the SQL engine lets a low-privileged role gain superuser.",
                    detailedName="postgres 14.1", recommendedVersion="14.2", detectionMethod="OS_PACKAGE",
                    publishedDate="2026-02-20T00:00:00Z", reachability="NETWORK",
                    hasExploit=True, hasCisaKevExploit=False, validatedInRuntime=False,
                    epssSeverity="MEDIUM", epssPercentile=0.62, epssProbability=0.21,
                    vendorSeverity="HIGH", nvdSeverity="CRITICAL", cnaScore=8.8,
                    cvssv3={"score": 8.8, "vectorString": "AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H"},
                    vulnerableAsset={
                        "id": "vm-azure-01", "externalId": "/subscriptions/xyz/db-prod-01",
                        "subscriptionName": "core-prod", "subscriptionExternalId": "azure-sub-001",
                        "operatingSystem": "Ubuntu 22.04", "hasLimitedInternetExposure": True,
                        "tags": {"env": "prod", "owner": "dba", "tier": "data"},
                    },
                ),
                _finding("dry-c5", "CVE-2026-1005", "CRITICAL", "edge-gw-01", "VIRTUAL_MACHINE", "AWS", "3.0.1", "2026-02-15"),
                # HIGH (SLA 14d): median ~19d (BREACHING), plus one open.
                _finding(
                    "dry-h1", "CVE-2026-2001", "HIGH", "api-staging-02", "VIRTUAL_MACHINE", "AWS", "5.1.0", "2026-04-01", "2026-04-17",
                    description="Authentication bypass in the API gateway under a race condition.",
                    detailedName="gateway 5.0.9", recommendedVersion="5.1.0", detectionMethod="OS_PACKAGE",
                    hasExploit=False, epssSeverity="MEDIUM", epssPercentile=0.71, epssProbability=0.34,
                    vendorSeverity="HIGH", nvdSeverity="HIGH",
                    cvssv3={"score": 7.5, "vectorString": "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"},
                    vulnerableAsset={
                        "subscriptionName": "staging", "externalId": "i-0abc123",
                        "operatingSystem": "Amazon Linux 2", "tags": {"env": "staging"},
                    },
                ),
                _finding("dry-h2", "CVE-2026-2002", "HIGH", "registry/worker:1.4", "CONTAINER_IMAGE", "GCP", "1.5.0", "2026-03-25", "2026-04-14"),
                _finding("dry-h3", "CVE-2026-2003", "HIGH", "batch-fn-01", "SERVERLESS", "AWS", "0.9.2", "2026-04-05", "2026-04-23"),
                _finding("dry-h4", "CVE-2026-2004", "HIGH", "cache-prod-03", "VIRTUAL_MACHINE", "Azure", "7.0.0", "2026-03-10", "2026-04-01"),
                _finding("dry-h5", "CVE-2026-2005", "HIGH", "web-prod-03", "VIRTUAL_MACHINE", "AWS", "1.3.0", "2026-04-20"),
                # MEDIUM (SLA 30d): median ~25d (in SLA), plus one open.
                _finding("dry-m1", "CVE-2026-3001", "MEDIUM", "analytics-01", "VIRTUAL_MACHINE", "GCP", "2.4.1", "2026-03-01", "2026-03-19"),
                _finding("dry-m2", "CVE-2026-3002", "MEDIUM", "registry/etl:3.0", "CONTAINER_IMAGE", "AWS", "3.1.0", "2026-03-10", "2026-04-04"),
                _finding("dry-m3", "CVE-2026-3003", "MEDIUM", "report-svc-02", "SERVERLESS", "Azure", "1.1.2", "2026-02-20", "2026-03-27"),
                _finding("dry-m4", "CVE-2026-3004", "MEDIUM", "queue-prod-01", "VIRTUAL_MACHINE", "AWS", "5.5.0", "2026-04-15"),
                # LOW (SLA 90d): both resolved well within target.
                _finding("dry-l1", "CVE-2026-4001", "LOW", "dev-box-07", "VIRTUAL_MACHINE", "GCP", "0.4.0", "2026-02-01", "2026-03-13"),
                _finding("dry-l2", "CVE-2026-4002", "LOW", "registry/docs:1.0", "CONTAINER_IMAGE", "AWS", "1.0.1", "2026-01-15", "2026-03-26"),
                # INFO (SLA 180d): one resolved.
                _finding("dry-i1", "CVE-2026-5001", "INFO", "legacy-vm-12", "VIRTUAL_MACHINE", "Azure", "8.0.0", "2026-01-05", "2026-05-05"),
            ]
        }
    }
}


# Committed grouped-by-asset sample (the real Wiz response shape). Lives next to this
# module so the path resolves regardless of the working directory.
GROUPED_SAMPLE_PATH = Path(__file__).resolve().parent / "os_vulns_response_exemple.json"

# Minimal safety net if the committed grouped sample is missing/unreadable, so the
# dry-run never crashes. This is a fallback, NOT the demo data — the real sample is the
# 10-asset committed file loaded by ``_grouped_sample``.
_GROUPED_FALLBACK: Dict[str, Any] = {
    "data": {
        "vulnerabilityFindingsGroupedByValues": {
            "nodes": [
                {
                    "id": "grp-fallback-1",
                    "vulnerableAsset": {
                        "id": "fallback-asset-1",
                        "type": "VIRTUAL_MACHINE",
                        "name": "sample-vm-01",
                        "cloudPlatform": "AWS",
                    },
                    "analytics": {
                        "vulnerableAssetCount": 1,
                        "totalFindingCount": 1,
                        "criticalSeverityFindingCount": 1,
                        "highSeverityFindingCount": 0,
                        "mediumSeverityFindingCount": 0,
                        "lowSeverityFindingCount": 0,
                        "informationalSeverityFindingCount": 0,
                    },
                }
            ],
            "pageInfo": {"hasNextPage": False, "endCursor": None},
        }
    }
}


@functools.lru_cache(maxsize=1)
def _grouped_sample() -> Dict[str, Any]:
    """Load the committed grouped-by-asset sample response (memoized).

    Returns the parsed ``os_vulns_response_exemple.json`` (the real Wiz
    ``vulnerabilityFindingsGroupedByValues`` shape). Degrades to ``_GROUPED_FALLBACK``
    if the file is missing or unparseable, so ``--dry-run`` never raises.
    """
    try:
        return json.loads(GROUPED_SAMPLE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _GROUPED_FALLBACK


def fetch_findings(
    dry_run: bool = True,
    config: Optional[Dict[str, Any]] = None,
    timeout_seconds: float = 60.0,
    sample_shape: str = "grouped",
) -> Any:
    """Fetch the raw Wiz vulnerability-findings response.

    Importable entry point shared by the CLI (`main`) and the Streamlit app, so
    the app no longer has to shell out via runpy.

    Args:
        dry_run: when True, return bundled sample data without calling the API.
        config: optional ``{"wiz_client_id", "wiz_client_secret"}`` injected into the
            environment for the SDK when running live.
        timeout_seconds: hard deadline for the live API call. The blocking SDK call
            runs in a worker thread so a hung endpoint can't freeze the Streamlit
            server; exceeding the deadline raises ``TimeoutError``.
        sample_shape: which dry-run sample to return -- ``"grouped"`` (default) yields
            the committed grouped-by-asset response (mirrors the real API); ``"flat"``
            yields the per-finding ``SAMPLE_RESULTS`` that powers MTTR/SLA/ledger offline.
            Ignored when ``dry_run`` is False.

    Returns:
        The raw response object from the Wiz SDK (typically a dict), or a bundled
        sample (grouped or flat) in dry-run mode.

    Raises:
        RuntimeError: in live mode when ``wiz_sdk`` is not installed.
        TimeoutError: in live mode when the API does not respond within the deadline.
    """
    if dry_run:
        return _grouped_sample() if sample_shape == "grouped" else SAMPLE_RESULTS
    if WizAPIClient is None:
        raise RuntimeError(
            "wiz_sdk not installed; either install it or run with --dry-run"
        )
    if isinstance(config, dict):
        if config.get("wiz_client_id"):
            os.environ["WIZ_CLIENT_ID"] = config["wiz_client_id"]
        if config.get("wiz_client_secret"):
            os.environ["WIZ_CLIENT_SECRET"] = config["wiz_client_secret"]
    client = WizAPIClient()
    # Run the blocking SDK call in a worker thread and abandon it if it overruns,
    # so a hung Wiz endpoint can never freeze the dashboard. shutdown(wait=False)
    # avoids blocking on a still-running thread once we've given up on it.
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = pool.submit(client.query, QUERY, VARIABLES)
    try:
        return future.result(timeout=timeout_seconds)
    except concurrent.futures.TimeoutError as exc:
        raise TimeoutError(
            f"Wiz API did not respond within {timeout_seconds:.0f}s"
        ) from exc
    finally:
        pool.shutdown(wait=False)


def main():
    """Fetch data from Wiz and format output (table/json/csv)."""

    def extract_nodes(results: Any) -> List[Dict[str, Any]]:
        # If the SDK returns an object (e.g., WizAPIResult), try to coerce to dict
        if not isinstance(results, (dict, list)):
            # try common container attributes/methods
            if hasattr(results, "data"):
                try:
                    results = getattr(results, "data")
                except Exception:
                    pass
            elif hasattr(results, "raw"):
                try:
                    results = getattr(results, "raw")
                except Exception:
                    pass
            elif hasattr(results, "to_dict"):
                try:
                    results = results.to_dict()
                except Exception:
                    pass
            elif hasattr(results, "as_dict"):
                try:
                    results = results.as_dict()
                except Exception:
                    pass
            elif hasattr(results, "json"):
                try:
                    jr = results.json()
                    if isinstance(jr, str):
                        try:
                            results = json.loads(jr)
                        except Exception:
                            results = jr
                    else:
                        results = jr
                except Exception:
                    pass

        if isinstance(results, dict):
            # common SDK response: {'data': {'vulnerabilityFindings': {'nodes': [...]}}}
            data = (
                results.get("data")
                if isinstance(results.get("data"), dict)
                else results
            )
            if isinstance(data, dict):
                # try to locate a dict that contains 'nodes'
                for v in data.values():
                    if isinstance(v, dict) and "nodes" in v:
                        return v.get("nodes") or []
                if "nodes" in data:
                    return data.get("nodes") or []
                if "vulnerabilityFindings" in data:
                    vf = data.get("vulnerabilityFindings") or {}
                    if isinstance(vf, dict) and "nodes" in vf:
                        return vf.get("nodes") or []
            if isinstance(results.get("data"), list):
                return results.get("data")
            return [results]
        if isinstance(results, list):
            return results
        return [results]

    def safe_get(item: Any, path: str, default: str = "") -> str:
        cur = item
        for p in path.split("."):
            if cur is None:
                return default
            if isinstance(cur, dict):
                cur = cur.get(p)
            else:
                cur = getattr(cur, p, None)
        if isinstance(cur, (dict, list)):
            try:
                return json.dumps(cur, ensure_ascii=False)
            except Exception:
                return str(cur)
        return str(cur) if cur is not None else default

    def format_json(results: Any, out_file: Optional[str] = None) -> None:
        if out_file:
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2, default=str, ensure_ascii=False)
        else:
            print(json.dumps(results, indent=2, default=str, ensure_ascii=False))

    def format_table(
        nodes: List[Dict[str, Any]], fields: List[str], out_stream
    ) -> None:
        headers = [f.split(".")[-1].replace("_", " ").title() for f in fields]
        rows = [[safe_get(node, f) for f in fields] for node in nodes]
        if not rows:
            print("No results.", file=out_stream)
            return
        widths = [
            max(len(h), max((len(str(r[i])) for r in rows), default=0))
            for i, h in enumerate(headers)
        ]
        fmt = "  ".join("{:" + str(w) + "}" for w in widths)
        print(fmt.format(*headers), file=out_stream)
        print("  ".join("-" * w for w in widths), file=out_stream)
        for r in rows:
            print(fmt.format(*[str(c) for c in r]), file=out_stream)

    def write_csv(
        nodes: List[Dict[str, Any]], fields: List[str], out_file: Optional[str] = None
    ) -> None:
        headers = [f.split(".")[-1].replace("_", " ").title() for f in fields]
        rows = [[safe_get(node, f) for f in fields] for node in nodes]
        if out_file:
            with open(out_file, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(headers)
                writer.writerows(rows)
        else:
            writer = csv.writer(sys.stdout)
            writer.writerow(headers)
            writer.writerows(rows)

    parser = argparse.ArgumentParser(
        description="Fetch and format vulnerability findings from Wiz"
    )
    parser.add_argument(
        "-f",
        "--format",
        choices=["json", "table", "csv"],
        default="table",
        help="Output format",
    )
    parser.add_argument(
        "-F",
        "--fields",
        default="id,name,severity,vulnerableAsset.name,fixedVersion,firstDetectedAt",
        help="Comma-separated fields for table/csv (dot notation)",
    )
    parser.add_argument(
        "-o", "--output", default=None, help="Output file path (for json or csv)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Use sample data without calling the Wiz API",
    )
    parser.add_argument(
        "--dry-run-shape",
        choices=["grouped", "flat"],
        default="grouped",
        help="Which --dry-run sample to use: 'grouped' (default, mirrors the real "
        "grouped-by-asset API response) or 'flat' (per-finding sample with MTTR/SLA data)",
    )
    parser.add_argument(
        "--debug", action="store_true", help="Print diagnostic info about API response"
    )
    args = parser.parse_args()

    if args.dry_run:
        results = fetch_findings(dry_run=True, sample_shape=args.dry_run_shape)
    else:
        try:
            results = fetch_findings(dry_run=False)
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)

    if args.format == "json":
        format_json(results, out_file=args.output)
        return

    nodes = extract_nodes(results)
    # If requested, print diagnostic info about the raw API response
    if args.debug:
        try:
            print("--- DEBUG: response type:", type(results), "---", file=sys.stderr)
            if isinstance(results, dict):
                print("Top-level keys:", list(results.keys()), file=sys.stderr)
                if "data" in results and isinstance(results["data"], dict):
                    print("data keys:", list(results["data"].keys()), file=sys.stderr)
                    d = results["data"]
                    for k, v in d.items():
                        if isinstance(v, dict):
                            print(
                                f"data['{k}'] keys: {list(v.keys())}", file=sys.stderr
                            )

                # show whether vulnerabilityFindings appears anywhere
                def find_vf(obj):
                    if isinstance(obj, dict):
                        for k, v in obj.items():
                            if k == "vulnerabilityFindings":
                                return v
                            res = find_vf(v)
                            if res is not None:
                                return res
                    return None

                vf = find_vf(results)
                if vf is None:
                    print(
                        "No vulnerabilityFindings key found in response",
                        file=sys.stderr,
                    )
                else:
                    if isinstance(vf, dict):
                        print(
                            "vulnerabilityFindings keys:",
                            list(vf.keys()),
                            file=sys.stderr,
                        )
                        if "nodes" in vf and isinstance(vf["nodes"], list):
                            print("len(nodes)=", len(vf["nodes"]), file=sys.stderr)
            else:
                print(
                    "Non-dict response repr (truncated):",
                    repr(results)[:1000],
                    file=sys.stderr,
                )
        except Exception as e:
            print("DEBUG error:", e, file=sys.stderr)
    fields = [f.strip() for f in args.fields.split(",") if f.strip()]
    if args.format == "table":
        out = open(args.output, "w", encoding="utf-8") if args.output else sys.stdout
        try:
            format_table(nodes, fields, out)
        finally:
            if args.output:
                out.close()
    else:  # csv
        write_csv(nodes, fields, args.output)


if __name__ == "__main__":
    main()
