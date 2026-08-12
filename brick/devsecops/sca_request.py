"""
# Python 3.9+
pip(3) install requests
"""
import base64
import json
import requests

# Standard headers
HEADERS_AUTH = {"Content-Type": "application/x-www-form-urlencoded"}
HEADERS = {"Content-Type": "application/json"}

CLIENT_ID = "SERVICE_ACCOUNT_CLIENT_ID"
CLIENT_SECRET = "SERVICE_ACCOUNT_CLIENT_SECRET"

# Uncomment the following section to define the proxies in your environment,
#   if necessary:
# http_proxy  = "http://"+user+":"+passw+"@x.x.x.x:abcd"
# https_proxy = "https://"+user+":"+passw+"@y.y.y.y:abcd"
# proxyDict = {
#     "http"  : http_proxy,
#     "https" : https_proxy
# }

# The GraphQL query that defines which data you wish to fetch.
QUERY = """
    query GroupedVulnerabilityFindingsTable($filterBy: VulnerabilityFindingFilters, $groupBy: [VulnerabilityFindingGroupBy!]!, $orderBy: VulnerabilityFindingsGroupedByValuesOrder, $fetchTotalCount: Boolean = true, $first: Int, $after: String, $groupByParameters: VulnerabilityFindingGroupByParameters) {
      vulnerabilityFindingsGroupedByValues(
        filterBy: $filterBy
        groupBy: $groupBy
        orderBy: $orderBy
        first: $first
        after: $after
        groupByParameters: $groupByParameters
      ) {
        nodes {
          ...VulnerabilityFindingsGroupByTableNode
        }
        totalCount @include(if: $fetchTotalCount)
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    
        fragment VulnerabilityFindingsGroupByTableNode on VulnerabilityFindingsGroupedByValues {
      ...VulnerabilityFindingsGroupedByValuesFragment
      name
      originFinding {
        id
        name
        origin
        externalId
        policyId
        sourceUrl
        vulnerableAsset {
          ...VulnerableAssetDetails
        }
      }
      originFindingPolicy {
        id
        externalId
        origin
        name
      }
      origin
      sourceMappedCodeFinding {
        id
        name
        vulnerableAsset {
          ...VulnerableAssetDetails
        }
        locationPath
        artifactType {
          ...SBOMArtifactTypeFragment
        }
        detailedName
        severity
        relatedSourceMappedIssueAnalytics {
          ...VulnerabilityFindingRelatedIssueAnalyticsFragment
        }
      }
      sourceMappedCodeRepository {
        id
        name
      }
      sourceMappedCodeResource {
        providerUniqueId
        id
        name
        type
        properties
      }
    }
    

        fragment VulnerabilityFindingsGroupedByValuesFragment on VulnerabilityFindingsGroupedByValues {
      id
      project {
        id
        name
        slug
        isFolder
      }
      baseContainerImage {
        type
        providerUniqueId
        id
        name
      }
      vcsOrganization {
        id
        name
        cloudProvider
      }
      locationPath
      artifactPackagePath
      kubernetesCluster {
        id
        name
      }
      containerService {
        type
        providerUniqueId
        id
        name
      }
      kubernetesNamespace {
        type
        providerUniqueId
        id
        name
      }
      computeInstanceGroup {
        id
        name
      }
      applicationService {
        id
        displayName
      }
      environment
      cloudPlatform
      vulnerableAsset {
        ...VulnerableAssetDetails
      }
      vulnerableAssetType
      vulnerableAssetTags {
        key
        value
      }
      cloudAccount {
        id
        externalId
        name
        cloudProvider
      }
      resourceGroup {
        providerUniqueId
        id
        name
        type
        properties
      }
      containerRegistry {
        name
        vertexId
        externalId
      }
      containerRepository {
        vertexId
        externalId
        name
      }
      vcsRepository {
        id
        name
      }
      vcsCodeAuthor {
        providerUniqueId
        id
        name
        type
      }
      codeApplication {
        providerUniqueId
        id
        name
        type
        properties
      }
      codeModule {
        providerUniqueId
        id
        name
        type
        properties
      }
      detailedName
      fixedVersion
      recommendedVersion
      artifactType {
        ...SBOMArtifactTypeFragment
      }
      detectionMethod
      analytics {
        vulnerableAssetCount
        totalFindingCount
        criticalSeverityFindingCount
        highSeverityFindingCount
        mediumSeverityFindingCount
        lowSeverityFindingCount
        informationalSeverityFindingCount
      }
      virtualMachineImage {
        type
        providerUniqueId
        id
        name
        properties
      }
      operatingSystemDistribution {
        id
        name
        icon
      }
    }
    

        fragment VulnerableAssetDetails on VulnerableAsset {
      ... on VulnerableAssetBase {
        id
        type
        name
        cloudPlatform
        externalId
      }
      ... on VulnerableAssetVirtualMachine {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetServerless {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetContainerImage {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
        registry {
          vertexId
          name
        }
        repository {
          vertexId
          name
        }
        executionControllers {
          ...VulnerableAssetExecutionControllerDetails
        }
        graphEntity {
          ...VulnerabilityContainerImageGraphEntityExecutionContext
        }
        tagReferences
        imageTags
      }
      ... on VulnerableAssetContainer {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
        executionControllers {
          ...VulnerableAssetExecutionControllerDetails
        }
      }
      ... on VulnerableAssetRepository {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetRepositoryBranch {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        repositoryId
        repositoryName
        tags
      }
      ... on VulnerableAssetIde {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetEndpoint {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetPaaSResource {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetVirtualMachineImage {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetNetworkAddress {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
        address
        addressType
      }
      ... on VulnerableAssetCommon {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetDevice {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
      ... on VulnerableAssetArtifact {
        subscriptionId
        subscriptionName
        subscriptionExternalId
        tags
      }
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
      ide
    }
    

        fragment VulnerabilityFindingRelatedIssueAnalyticsFragment on VulnerabilityFindingRelatedIssueAnalytics {
      issueCount
      informationalSeverityCount
      lowSeverityCount
      mediumSeverityCount
      highSeverityCount
      criticalSeverityCount
    }
"""

# The variables sent along with the above query
VARIABLES = {
  "fetchTotalCount": False,
  "groupBy": [
    "VULNERABLE_ASSET"
  ],
  "filterBy": {
    "isDefaultBranch": {
      "equals": True
    },
    "projectIdV2": {
      "equals": [
        "1dfea0cf-834f-5522-b797-bee5aaf09251"
      ]
    },
    "codeToCloudPipelineStage": [
      "CODE"
    ]
  },
  "first": 10
}


def query_wiz_api(query, variables, dc):
    """Query Wiz API for the given query data schema"""

    data = {"variables": variables, "query": query}

    try:
        # Uncomment the next first line and comment the line after that
        # to run behind proxies
        # result = requests.post(url=f"https://api.{dc}.app.wiz.io/graphql",
        #                        json=data, headers=HEADERS, proxies=proxyDict, timeout=180)
        result = requests.post(url=f"https://api.{dc}.app.wiz.io/graphql",
                               json=data, headers=HEADERS, timeout=180)

    except requests.exceptions.HTTPError as e:
        print(f"<p>Wiz-API-Error (4xx/5xx): {str(e)}</p>")
        return e

    except requests.exceptions.ConnectionError as e:
        print(f"<p>Network problem (DNS failure, refused connection, etc): {str(e)}</p>")
        return e

    except requests.exceptions.Timeout as e:
        print(f"<p>Request timed out: {str(e)}</p>")
        return e

    return result.json()


def request_wiz_api_token(client_id, client_secret):
    """Retrieve an OAuth access token to be used against Wiz API"""

    auth_payload = {
      'grant_type': 'client_credentials',
      'audience': 'wiz-api',
      'client_id': client_id,
      'client_secret': client_secret
    }
    try:
        # Uncomment the next first line and comment the line after that
        # to run behind proxies
        # response = requests.post(url="https://auth.app.wiz.io/oauth/token",
        #                         headers=HEADERS_AUTH, data=auth_payload,
        #                         proxies=proxyDict, timeout=180)
        response = requests.post(url="https://auth.app.wiz.io/oauth/token",
                                headers=HEADERS_AUTH, data=auth_payload, timeout=180)

    except requests.exceptions.HTTPError as e:
        print(f"<p>Error authenticating to Wiz (4xx/5xx): {str(e)}</p>")
        return e

    except requests.exceptions.ConnectionError as e:
        print(f"<p>Network problem (DNS failure, refused connection, etc): {str(e)}</p>")
        return e

    except requests.exceptions.Timeout as e:
        print(f"<p>Request timed out: {str(e)}</p>")
        return e

    try:
        response_json = response.json()
        token = response_json.get('access_token')
        if not token:
            message = f"Could not retrieve token from Wiz: {response_json.get('message')}"
            raise ValueError(message)
    except ValueError as exception:
        message = f"Could not parse API response {exception}. Check Service Account details " \
                    "and variables"
        raise ValueError(message) from exception

    response_json_decoded = json.loads(
        base64.standard_b64decode(pad_base64(token.split(".")[1]))
    )
    dc = response_json_decoded["dc"]
    return token, dc


def pad_base64(data):
    """Makes sure base64 data is padded"""
    missing_padding = len(data) % 4
    if missing_padding != 0:
        data += "=" * (4 - missing_padding)
    return data


def main():
    """Main function"""

    print("Getting token.")
    token, dc = request_wiz_api_token(CLIENT_ID, CLIENT_SECRET)
    HEADERS["Authorization"] = "Bearer " + token

    result = query_wiz_api(QUERY, VARIABLES, dc)
    print(result)  # your data is here!

    # The above code lists the first <x> items.
    # If paginating on a Graph Query,
    #   then use <'quick': False> in the query variables.
    # Uncomment the following section to paginate over all the results:
    # pageInfo = result['data']['vulnerabilityFindingsGroupedByValues']['pageInfo']
    # while (pageInfo['hasNextPage']):
    #     # fetch next page
    #     VARIABLES['after'] = pageInfo['endCursor']
    #     result = query_wiz_api(QUERY, VARIABLES, dc)
    #     print(result)
    #     pageInfo = result['data']['vulnerabilityFindingsGroupedByValues']['pageInfo']


if __name__ == '__main__':
    main()

