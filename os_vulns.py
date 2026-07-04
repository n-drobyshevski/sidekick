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
import copy
import csv
import functools
import sys
import time
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


# Page size for the cursor-paginated connection. The Wiz console defaults to 60, but
# ``vulnerabilityFindings`` accepts up to 5000 -- an outlier; most Wiz connections cap at
# 500. At ~118k findings that's ~24 sequential round trips instead of ~237, and the round
# trips are the dominant cost of a large scan. Page-size limits are tenant-shaped, so
# ``_fetch_all_findings`` probes the max on the first page and drops to the conservative
# fallback if the tenant rejects it.
PAGE_SIZE_MAX = 5000
PAGE_SIZE_FALLBACK = 500


# The variables sent along with the above query
VARIABLES = {
    "orderBy": {"field": "RELATED_ISSUE_SEVERITY", "direction": "DESC"},
    # The dashboard never reads these four expensive per-finding joins (they only ever
    # surfaced as raw rows in the drill-down's "All other fields" catch-all). Each is the
    # slowest part of a Wiz vuln query -- a server-side join run for every finding -- so
    # disabling them via their @include(if:...) guards is the single biggest speedup.
    "includeRelatedIssueAnalytics": False,
    "includeRelatedSourceMappedIssueAnalytics": False,
    "includeTotalCount": False,
    "includePostureIssues": False,
    "fetchPrivilegedActionRequests": False,
    # Baseline page size; ``_page_variables`` overrides this per page (max first, with a
    # fallback -- see PAGE_SIZE_MAX above). Kept here so a bare VARIABLES copy still pages.
    "first": PAGE_SIZE_FALLBACK,
    "filterBy": {
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
#
# NOTE: ``os_vulns_response_exemple.json`` (no "grouped" in its name) is a *separate*
# committed fixture: an exact mock of what the real live ``QUERY`` above returns --
# the flat ``vulnerabilityFindings`` connection with every requested field populated
# (cvssv3, epss, exploit flags, etc.). It documents the true live response shape but
# is not wired into ``fetch_findings`` (which uses ``SAMPLE_RESULTS`` for the "flat"
# dry-run sample, kept separately so MTTR/SLA/ledger demos are unaffected).
GROUPED_SAMPLE_PATH = Path(__file__).resolve().parent / "os_vulns_grouped_response_example.json"

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

    Returns the parsed ``os_vulns_grouped_response_example.json`` (the real Wiz
    ``vulnerabilityFindingsGroupedByValues`` shape). Degrades to ``_GROUPED_FALLBACK``
    if the file is missing or unparseable, so ``--dry-run`` never raises.
    """
    try:
        return json.loads(GROUPED_SAMPLE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _GROUPED_FALLBACK


# The Wiz SDK's own client (see ``wiz_sdk.common.DEFAULT_WIZ_API_TIMEOUT``) expects a
# single query to legitimately take up to 360s: it retries 429/500/502/503/504 responses
# internally with exponential backoff (1+2+4+8+16+32 = 63s of sleeping alone) before ever
# raising. A 60s outer deadline routinely aborted the SDK's own in-flight retry loop --
# that mismatch, not a genuinely dead connection, was the usual cause of the "did not
# respond within 60s" fallback-to-cache. 120s gives the SDK realistic room to recover from
# a transient rate-limit/5xx without making a truly hung socket block the dashboard for
# the SDK's full 360s budget.
DEFAULT_TIMEOUT_SECONDS = 120.0
# One extra attempt per page after a timeout, so a single transient stall (e.g. a slow DNS
# lookup or momentary network blip) doesn't have to fall all the way back to the disk
# cache. Retrying a *genuinely* hung socket is a no-op (it will simply time out again), so
# this stays cheap in the worst case.
_QUERY_MAX_RETRIES = 1


def fetch_findings(
    dry_run: bool = True,
    config: Optional[Dict[str, Any]] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    sample_shape: str = "grouped",
    progress: Optional[Any] = None,
    extra_filter_by: Optional[Dict[str, Any]] = None,
) -> Any:
    """Fetch the raw Wiz vulnerability-findings response.

    Importable entry point shared by the CLI (`main`) and the Streamlit app, so
    the app no longer has to shell out via runpy.

    Args:
        dry_run: when True, return bundled sample data without calling the API.
        config: optional ``{"wiz_client_id", "wiz_client_secret"}`` injected into the
            environment for the SDK when running live. An optional ``"wiz_api_timeout_seconds"``
            key overrides ``timeout_seconds`` (lets ops tune the deadline per-tenant via
            ``wiz_config.json`` without a code change).
        timeout_seconds: hard deadline for a single page's live API call. The blocking SDK
            call runs in a worker thread so a hung endpoint can't freeze the Streamlit
            server; exceeding the deadline retries once (see ``_QUERY_MAX_RETRIES``) and
            then raises ``TimeoutError``. Defaults to ``DEFAULT_TIMEOUT_SECONDS``.
        sample_shape: which dry-run sample to return -- ``"grouped"`` (default) yields
            the committed grouped-by-asset response (mirrors the real API); ``"flat"``
            yields the per-finding ``SAMPLE_RESULTS`` that powers MTTR/SLA/ledger offline.
            Ignored when ``dry_run`` is False.
        progress: optional ``callable(pages_done: int, findings_so_far: int, total: Optional[int])``
            invoked after each page is fetched (live mode only), so callers can surface
            live pagination progress. ``total`` is the connection's ``totalCount`` from
            the first page (or ``None`` when the server didn't report one), letting the
            caller render a real completion fraction. Exceptions raised by the callback
            are swallowed so a UI hiccup can never abort the scan.
        extra_filter_by: optional additional ``filterBy`` keys merged on top of the
            baseline ``VARIABLES`` filter for THIS call only (e.g.
            ``{"updatedAt": {"after": iso}}`` for an incremental refresh). Live mode
            only — dry-run samples ignore it (the offline delta comes from
            ``wiz_dashboard.data.demo.incremental_flat_sample``). When set, an
            errors-only first page raises ``WizDeltaFilterError`` instead of returning
            0 findings (see ``_fetch_all_findings``).

    Returns:
        The raw response object from the Wiz SDK (typically a dict), or a bundled
        sample (grouped or flat) in dry-run mode.

    Raises:
        RuntimeError: in live mode when ``wiz_sdk`` is not installed.
        TimeoutError: in live mode when the API does not respond within the deadline
            (after retries).
    """
    if dry_run:
        return _grouped_sample() if sample_shape == "grouped" else SAMPLE_RESULTS
    if WizAPIClient is None:
        raise RuntimeError(
            "wiz_sdk not installed; either install it or run with --dry-run"
        )
    # Pass credentials directly to the client (the SDK's documented pattern) rather than
    # relying on process env vars. Fall back to env-var/file config when none are supplied
    # so the SDK's own resolution still applies.
    conf = None
    if isinstance(config, dict):
        cid = config.get("wiz_client_id")
        secret = config.get("wiz_client_secret")
        if cid and secret:
            conf = {"wiz_client_id": cid, "wiz_client_secret": secret}
        # Let ops override the deadline per-tenant (e.g. a Wiz org with a lot of rate
        # limiting) via wiz_config.json without touching code.
        override = config.get("wiz_api_timeout_seconds")
        if override:
            try:
                timeout_seconds = float(override)
            except (TypeError, ValueError):
                pass
    client = WizAPIClient(conf=conf) if conf else WizAPIClient()
    # Walk every page of the cursor-paginated connection. A single query only returns
    # the first ``VARIABLES["first"]`` findings; without this loop the dashboard silently
    # caps at one page (the bug where the console shows more criticals than we load).
    # Re-wrap the merged nodes in the canonical envelope so the cached/disk-snapshot path
    # and ``extract_nodes`` treat a live fetch exactly like a dry-run sample.
    nodes = _fetch_all_findings(client, timeout_seconds, progress=progress,
                                extra_filter_by=extra_filter_by)
    return {"data": {"vulnerabilityFindings": {"nodes": nodes}}}


# Safety cap on page-walking so a misbehaving cursor can never loop forever. At the
# default page size (``VARIABLES["first"]``) this still allows tens of thousands of findings.
_MAX_PAGES = 1000


def _query_page(client, variables, timeout_seconds, max_retries: int = _QUERY_MAX_RETRIES) -> Any:
    """Run one blocking SDK query in a worker thread, abandoning it if it overruns.

    Keeps a hung Wiz endpoint from freezing the dashboard; ``shutdown(wait=False)`` avoids
    blocking on a thread we've already given up on -- the abandoned thread (and whatever
    socket it's holding) is left to die on its own rather than being awaited.

    Retries once (``max_retries``) after a short backoff before giving up: a stall caused by
    a momentary network blip or the SDK's own internal rate-limit backoff clears on the next
    attempt, while a genuinely dead connection will simply time out again just as fast --
    so the retry is cheap in the worst case but can save a whole scan from falling back to
    the disk cache over a one-off hiccup.
    """
    last_exc: Optional[BaseException] = None
    for attempt in range(max_retries + 1):
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            future = pool.submit(client.query, QUERY, variables)
            return future.result(timeout=timeout_seconds)
        except concurrent.futures.TimeoutError as exc:
            last_exc = exc
            if attempt < max_retries:
                # Cap the backoff so a small configured timeout (e.g. in tests) doesn't
                # sleep longer than the deadline it's retrying against.
                time.sleep(min(2.0, timeout_seconds))
                continue
        finally:
            pool.shutdown(wait=False)
    raise TimeoutError(
        f"Wiz API did not respond within {timeout_seconds:.0f}s "
        f"(after {max_retries + 1} attempt{'s' if max_retries else ''})"
    ) from last_exc


def _vulnerability_findings(page: Any) -> Dict[str, Any]:
    """Locate the ``vulnerabilityFindings`` connection (``nodes`` + ``pageInfo``) in one page.

    Coerces an SDK result / JSON string / dict into a plain dict, then walks it to find the
    connection payload. Returns ``{}`` when none is present.
    """
    if isinstance(page, str):
        try:
            page = json.loads(page)
        except Exception:
            return {}
    if not isinstance(page, (dict, list)):
        coerced = None
        for method in ("to_dict", "as_dict"):
            fn = getattr(page, method, None)
            if callable(fn):
                try:
                    cand = fn()
                    if isinstance(cand, (dict, list)):
                        coerced = cand
                        break
                except Exception:
                    pass
        if coerced is None:
            to_json = getattr(page, "to_json", None)
            if callable(to_json):
                try:
                    cand = json.loads(to_json())
                    if isinstance(cand, (dict, list)):
                        coerced = cand
                except Exception:
                    pass
        if coerced is None:
            data = getattr(page, "data", None)
            coerced = data if isinstance(data, (dict, list)) else {}
        page = coerced

    def walk(obj):
        if isinstance(obj, dict):
            vf = obj.get("vulnerabilityFindings")
            if isinstance(vf, dict) and "nodes" in vf:
                return vf
            if "nodes" in obj and isinstance(obj["nodes"], list):
                return obj
            for value in obj.values():
                found = walk(value)
                if found is not None:
                    return found
        elif isinstance(obj, list):
            for value in obj:
                found = walk(value)
                if found is not None:
                    return found
        return None

    return walk(page) or {}


class WizDeltaFilterError(RuntimeError):
    """The tenant returned no ``vulnerabilityFindings`` connection for a delta query.

    Raised only when an ``extra_filter_by`` (incremental) fetch gets an errors-only first
    page: for a plain full scan that shape is tolerated (0 findings), but for a delta it
    almost certainly means the injected filter (e.g. ``updatedAt``) was rejected — and
    silently returning 0 nodes would be indistinguishable from a genuinely empty delta,
    letting the caller re-persist a stale baseline as "fresh"."""


def _page_variables(cursor, page_size, *, want_total: bool,
                    extra_filter_by: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """``VARIABLES`` specialised for one page: cursor, page size, and optional totalCount.

    ``totalCount`` is one of the expensive server-side joins deliberately disabled in
    ``VARIABLES``; requesting it on the first page only is what lets the UI show a real
    progress fraction without paying that join again on every subsequent page.

    ``extra_filter_by`` merges additional keys into ``filterBy`` AFTER the deepcopy, so
    the baseline filters survive — critically ``status: ["OPEN","RESOLVED"]``, without
    which Wiz's default filter hides RESOLVED findings and an incremental fetch would
    silently miss every resolution.
    """
    variables = copy.deepcopy(VARIABLES)
    variables["after"] = cursor
    variables["first"] = page_size
    variables["includeTotalCount"] = bool(want_total)
    if extra_filter_by:
        variables["filterBy"].update(copy.deepcopy(extra_filter_by))
    return variables


def _fetch_all_findings(client, timeout_seconds, progress=None,
                        extra_filter_by: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Page through ``vulnerabilityFindings`` until ``hasNextPage`` is false, merging nodes.

    Pages at ``PAGE_SIZE_MAX``, deciding once on the first page whether the tenant accepts
    it: a rejected page size surfaces either as an exception or as a GraphQL errors-only
    payload (which ``_vulnerability_findings`` coerces to ``{}``), and either signal retries
    the first page at ``PAGE_SIZE_FALLBACK`` before giving up. Whatever size the first page
    settles on is kept for the rest of the walk.

    ``progress`` (optional ``callable(pages_done, findings_so_far, total)``) is invoked
    after each page so callers can surface live progress; ``total`` is the connection's
    ``totalCount`` from the first page, or ``None`` when the server didn't report one.
    Callback exceptions are swallowed so a flaky UI callback can never abort the fetch.

    ``extra_filter_by`` (per-invocation ``filterBy`` additions — the incremental-refresh
    seam) rides along on EVERY page, including both first-page fallback retries: a filter
    dropped on a retry would silently turn a delta into a partial full scan. When it is
    set and the first page still has no connection after the retries, the walk raises
    ``WizDeltaFilterError`` instead of "succeeding" with 0 nodes.
    """
    all_nodes: List[Dict[str, Any]] = []
    cursor: Optional[str] = None
    seen_cursors = set()
    pages = 0
    page_size = PAGE_SIZE_MAX
    total: Optional[int] = None
    for _ in range(_MAX_PAGES):
        first_page = pages == 0
        variables = _page_variables(cursor, page_size, want_total=first_page,
                                    extra_filter_by=extra_filter_by)
        try:
            connection = _vulnerability_findings(_query_page(client, variables, timeout_seconds))
        except Exception:
            # First page at the probed max: assume the tenant rejected the size (a timeout
            # is also plausibly a too-heavy page) and retry once at the safe fallback.
            # Anything after that is a genuine failure and propagates as before.
            if not (first_page and page_size > PAGE_SIZE_FALLBACK):
                raise
            page_size = PAGE_SIZE_FALLBACK
            variables = _page_variables(cursor, page_size, want_total=True,
                                        extra_filter_by=extra_filter_by)
            connection = _vulnerability_findings(_query_page(client, variables, timeout_seconds))
        if first_page and not connection and page_size > PAGE_SIZE_FALLBACK:
            # A rejected ``first`` can also come back as an errors-only payload with no
            # connection at all -- without this retry the scan would "succeed" with 0 rows.
            page_size = PAGE_SIZE_FALLBACK
            variables = _page_variables(cursor, page_size, want_total=True,
                                        extra_filter_by=extra_filter_by)
            connection = _vulnerability_findings(_query_page(client, variables, timeout_seconds))
        if first_page and not connection and extra_filter_by is not None:
            raise WizDeltaFilterError(
                "Wiz returned no vulnerabilityFindings connection for the delta query — "
                "the tenant may not support the injected filter "
                f"({', '.join(extra_filter_by)})."
            )
        if first_page:
            raw_total = connection.get("totalCount")
            total = raw_total if isinstance(raw_total, int) and raw_total >= 0 else None
        all_nodes.extend(connection.get("nodes") or [])
        pages += 1
        if callable(progress):
            try:
                progress(pages, len(all_nodes), total)
            except Exception:
                pass
        page_info = connection.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")
        # Guard against a missing/repeating cursor that would otherwise spin forever.
        if not cursor or cursor in seen_cursors:
            break
        seen_cursors.add(cursor)
    return all_nodes


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
