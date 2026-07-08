/** Before you start: npm install isomorphic-fetch */
require('isomorphic-fetch');

const token = 'WIZ_SERVICE_ACCOUNT_TOKEN';
const apiEndpoint = 'https://api.eu15.app.wiz.io/graphql';
const variables = {
  "fetchTotalCount": true,
  "fetchIacAnalytics": false,
  "filterBy": {
    "type": {
      "equals": [
        "AI_AGENT"
      ]
    },
    "property": [
      {
        "propertyName": "deploymentType",
        "valueFilter": {
          "stringArrayFilter": {
            "containsAny": [
              "DeploymentTypePaaS",
              "DeploymentTypeHosted"
            ]
          }
        }
      }
    ]
  },
  "orderBy": {
    "field": "FIRST_SEEN",
    "direction": "DESC"
  },
  "first": 40
};
const query = `
  query CloudResourcesTable($first: Int, $after: String, $filterBy: CloudResourceV2Filters, $orderBy: CloudResourceOrder, $fetchTotalCount: Boolean = true, $fetchIacAnalytics: Boolean = false) {
    cloudResourcesV2(
      first: $first
      after: $after
      filterBy: $filterBy
      orderBy: $orderBy
    ) {
      totalCount: totalServiceUsageResourceCount @include(if: $fetchTotalCount)
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...CloudResourceV2
        ...CloudResourceV2IacAnalytics @include(if: $fetchIacAnalytics)
      }
    }
  }
    
      fragment CloudResourceV2 on CloudResourceV2 {
    id
    name
    externalId
    type
    codeToCloudPipelineStage
    isAvailableOnGraph
    graphEntity {
      ...CloudResourceV2GraphEntityTableColumn
    }
    technology {
      ...CloudResourceV2Technology
    }
    cloudAccount {
      id
      name
      cloudProvider
      externalId
    }
    cloudPlatform
    status
    region
    regionLocation
    tags {
      key
      value
    }
    projects {
      id
      name
      isFolder
    }
    createdAt
    updatedAt
    deletedAt
    firstSeen
    versionDetails {
      versionsBehindLatest {
        major
        minor
        version
      }
    }
    typeFields {
      ... on CloudResourceV2VirtualMachine {
        instanceType
        operatingSystem
      }
      ... on CloudResourceV2Database {
        kind
      }
    }
    resourceGroup {
      id
      name
    }
    isOpenToAllInternet
    isAccessibleFromInternet
    hasAccessToSensitiveData
    hasAdminPrivileges
    hasHighPrivileges
    hasSensitiveData
    hasPqcVulnerableTelemetry
    nativeType
    iacDetails {
      iacStatus
      iacPlatform
    }
    iacVisibility
    iacModuleSource {
      ...CloudResourceV2GraphEntityTableColumn
    }
    owners {
      ...CloudResourceOwner
    }
  }
    

      fragment CloudResourceV2GraphEntityTableColumn on GraphEntity {
    id
    type
    providerUniqueId
    properties
    typedProperties {
      ... on GEKubernetesCluster {
        nodeCount
      }
    }
    name
    technologies {
      id
      icon
    }
    deletedAt
    userMetadata {
      note
      isInWatchlist
      isIgnored
    }
  }
    

      fragment CloudResourceV2Technology on Technology {
    id
    name
    icon
    description
    onlyServiceUsageSupported
    status
    businessModel
    isBillableWorkload
    ownerHeadquartersCountryCode
    ownerName
    popularity
    deploymentModel
    stackLayer
    categories {
      id
      name
    }
  }
    

      fragment CloudResourceOwner on CloudResourceOwner {
    type
    graphEntity {
      providerUniqueId
      id
      name
      type
      typedProperties {
        ... on GEIdentity {
          email
        }
      }
    }
    evidence {
      ... on IntegrationCloudResourceOwner {
        integrationType
      }
      ... on TagCloudResourceOwner {
        key
        value
      }
      ... on TaggingRuleCloudResourceOwner {
        rule {
          id
          name
        }
      }
      ... on ActivityCreatorCloudResourceOwner {
        cloudEvent {
          id
          timestamp
        }
        cloudEventName
        cloudEventTimestamp
      }
      ... on RecentLoginCloudResourceOwner {
        lastLoginTimestamp
      }
    }
  }
    

      fragment CloudResourceV2IacAnalytics on CloudResourceV2 {
    id
    iacAnalytics {
      resourceDeclarationCount
      moduleCallCount
      moduleUsageCount
      deploymentCount
      cloudResourceCount
      relatedCloudResourceIacStatus {
        driftedCount
        managedCount
        unmanagedCount
      }
      findingAnalytics {
        findingCount
        informationalSeverityCount
        lowSeverityCount
        mediumSeverityCount
        highSeverityCount
        criticalSeverityCount
      }
    }
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