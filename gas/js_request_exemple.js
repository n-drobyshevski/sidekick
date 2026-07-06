/** Before you start: npm install isomorphic-fetch */
require('isomorphic-fetch');

const token = 'WIZ_SERVICE_ACCOUNT_TOKEN';
const apiEndpoint = 'https://api.eu15.app.wiz.io/graphql';
const variables = {
  "fetchTotalCount": false,
  "groupBy": [
    "VULNERABLE_ASSET"
  ],
  "filterBy": {
    "hasFix": true,
    "assetType": [
      "VIRTUAL_MACHINE"
    ],
    "detectionMethod": [
      "OS"
    ],
    "detailedNameV2": {
      "notEquals": [
        "openssl",
        "python",
        "vim"
      ]
    },
    "assetIsRepresentativeResource": false
  },
  "first": 10
};
const query = `
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
  }
    

      fragment VulnerabilityFindingRelatedIssueAnalyticsFragment on VulnerabilityFindingRelatedIssueAnalytics {
    issueCount
    informationalSeverityCount
    lowSeverityCount
    mediumSeverityCount
    highSeverityCount
    criticalSeverityCount
  }
`;

fetch(apiEndpoint, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: query,
    variables: variables
  })
})
.then(res => res.json())
.then(res => {
  console.log(res.data); // your data is here!
});