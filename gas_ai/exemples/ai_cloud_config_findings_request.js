/** Before you start: npm install isomorphic-fetch */
require('isomorphic-fetch');

const token = 'WIZ_SERVICE_ACCOUNT_TOKEN';
const apiEndpoint = 'https://api.eu15.app.wiz.io/graphql';
const variables = {
  "first": 60,
  "filterBy": {
    "status": [
      "OPEN"
    ],
    "frameworkCategory": [
      "wct-id-1998"
    ],
    "resource": {
      "projectId": [
        "1dfea0cf-834f-5522-b797-bee5aaf09251"
      ],
      "nameV2": {},
      "region": {}
    }
  },
  "fetchTotalCount": true,
  "orderBy": {
    "field": "SEVERITY",
    "direction": "DESC"
  }
};
const query = `
  query CloudConfigurationFindingsTable($filterBy: ConfigurationFindingFilters, $orderBy: ConfigurationFindingOrder, $first: Int, $after: String, $quick: Boolean, $fetchTotalCount: Boolean!) {
    configurationFindings(
      filterBy: $filterBy
      orderBy: $orderBy
      first: $first
      after: $after
      quick: $quick
    ) {
      nodes {
        id
        name
        deleted
        analyzedAt
        firstSeenAt
        severity
        result
        status
        remediation
        source
        targetExternalId
        ignoreRules {
          id
          tags {
            key
            value
          }
        }
        subscription {
          id
          cloudProvider
          name
          externalId
          cloudProvider
          sourceDeployments {
            id
            name
            status
          }
        }
        resource {
          id
          name
          type
          status
          projects {
            id
            name
            riskProfile {
              businessImpact
            }
          }
        }
        sourceMappedIacFindings {
          id
          name
        }
        rule {
          id
          shortId
          graphId
          name
          description
          remediationInstructions
          risks
          threats
          tags {
            key
            value
          }
          opaPolicy
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount @include(if: $fetchTotalCount)
      maxCountReached @include(if: $fetchTotalCount)
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