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
import csv
import os
import sys
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
SAMPLE_RESULTS: Dict[str, Any] = {
    "data": {
        "vulnerabilityFindings": {
            "nodes": [
                {
                    "id": "dry-1",
                    "name": "sample-vuln",
                    "severity": "CRITICAL",
                    "vulnerableAsset": {"name": "vm-sample"},
                    "fixedVersion": "1.2.3",
                    "firstDetectedAt": "2026-05-27T00:00:00Z",
                }
            ]
        }
    }
}


def fetch_findings(dry_run: bool = True, config: Optional[Dict[str, Any]] = None) -> Any:
    """Fetch the raw Wiz vulnerability-findings response.

    Importable entry point shared by the CLI (`main`) and the Streamlit app, so
    the app no longer has to shell out via runpy.

    Args:
        dry_run: when True, return bundled ``SAMPLE_RESULTS`` without calling the API.
        config: optional ``{"wiz_client_id", "wiz_client_secret"}`` injected into the
            environment for the SDK when running live.

    Returns:
        The raw response object from the Wiz SDK (typically a dict), or
        ``SAMPLE_RESULTS`` in dry-run mode.

    Raises:
        RuntimeError: in live mode when ``wiz_sdk`` is not installed.
    """
    if dry_run:
        return SAMPLE_RESULTS
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
    return client.query(QUERY, VARIABLES)


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
        "--debug", action="store_true", help="Print diagnostic info about API response"
    )
    args = parser.parse_args()

    if args.dry_run:
        results = fetch_findings(dry_run=True)
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
