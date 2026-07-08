/** Before you start: npm install isomorphic-fetch */
require('isomorphic-fetch');

const token = 'WIZ_SERVICE_ACCOUNT_TOKEN';
const apiEndpoint = 'https://api.eu15.app.wiz.io/graphql';
const variables = {
  "first": 40,
  "filterBy": {
    "projectId": [
      "1dfea0cf-834f-5522-b797-bee5aaf09251"
    ],
    "type": {
      "equals": [
        "SERVICE_ACCOUNT",
        "ACCESS_KEY"
      ]
    },
    "identityPurpose": {
      "equals": [
        "AGENTIC"
      ]
    },
    "property": []
  },
  "orderBy": {
    "field": "RELATED_ISSUE_SEVERITY",
    "direction": "DESC"
  }
};
const query = `
  query CloudIdentityPrincipals($first: Int, $after: String, $filterBy: CloudResourceV2Filters, $orderBy: CloudResourceOrder) {
    cloudResourcesV2(
      first: $first
      after: $after
      filterBy: $filterBy
      orderBy: $orderBy
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...PrincipalDetails
      }
    }
  }
    
      fragment PrincipalDetails on CloudResourceV2 {
    id
    name
    type
    nativeType
    deletedAt
    isAvailableOnGraph
    graphEntity {
      providerUniqueId
      id
      type
      properties
    }
    hasAccessToSensitiveData
    hasAdminPrivileges
    hasHighPrivileges
    hasSensitiveData
    projects {
      id
      name
      slug
      isFolder
    }
    technology {
      id
      icon
      name
      categories {
        id
        name
      }
      description
    }
    cloudAccount {
      id
      name
      cloudProvider
      externalId
    }
    issueAnalytics {
      issueCount
      informationalSeverityCount
      lowSeverityCount
      mediumSeverityCount
      highSeverityCount
      criticalSeverityCount
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