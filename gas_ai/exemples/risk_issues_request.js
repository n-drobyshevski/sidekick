/**
 * Wiz UI export — "Risk Issues" filtered to Wiz for Risk Assessment > AI Security.
 * Captured 2026-08-13, tenant-wide (no project scope), 98 issues:
 * 0 critical / 0 high / 88 medium / 10 low.
 *
 * This is the ground truth for Q_ISSUES + aiIssuesVariables in
 * src/server/wizQueriesAi.ts. Two differences from the older, project-scoped
 * exemples/toxic_combos_request.js capture, and both are load-bearing:
 *
 *   filterBy.frameworkCategory  (not riskEqualsAny) carries wct-id-1998
 *   filterBy.type               carries CLOUD_CONFIGURATION *and* TOXIC_COMBINATION
 *
 * The UI exported this as Python; it is transcribed to the fetch form its four
 * sibling captures use. The document is verbatim except for the threat-detection,
 * AI-analysis, forensics and privileged-action fragment bodies, which are elided:
 * every one of them is gated behind an @include flag that these variables set to
 * false, so they contribute nothing to this response. Everything the register
 * reads is present.
 *
 * Before you start: npm install isomorphic-fetch
 */
require('isomorphic-fetch');

const token = 'WIZ_SERVICE_ACCOUNT_TOKEN';
const apiEndpoint = 'https://api.eu15.app.wiz.io/graphql';

const variables = {
  "fetchSecurityScoreImpact": false,
  "fetchThreatDetectionDetails": false,
  "fetchTotalCount": false,
  "fetchActorsAndResourcesGraphEntities": false,
  "fetchCloudAccountsAndCloudOrganizations": false,
  "fetchCommentThread": false,
  "fetchThreatCenterActors": false,
  "fetchTdrLogic": false,
  "fetchSecuritySubCategories": false,
  "fetchThreatDetectionAiAnalysis": false,
  "fetchThreatAnalysisConclusion": true,
  "deferThreatAnalysis": false,
  "fetchPrivilegedActionRequests": true,
  "includeSignals": false,
  "fetchThreatDetectionAiAnalysisInvestigation": false,
  "fetchLegacyInvestigationProcess": false,
  "fetchForensicsAiAnalysis": false,
  "fetchMandiantMtdInvestigationIds": false,
  "allowedAiMarkdownEntityTypes": [],
  "fetchAiMarkdownGraphEntities": false,
  "fetchThreatCenterAdvisories": false,
  "fetchTenant": false,
  "fetchAiRemediationAnalysis": true,
  "first": 40,
  "filterBy": {
    "status": [
      "OPEN",
      "IN_PROGRESS"
    ],
    "frameworkCategory": [
      "wct-id-1998"
    ],
    "type": [
      "CLOUD_CONFIGURATION",
      "TOXIC_COMBINATION"
    ]
  },
  "orderBy": {
    "field": "SEVERITY_EXPLOITABLE",
    "direction": "DESC"
  }
};

const query = `
  query IssuesTable($filterBy: IssueFilters, $filterScope: IssueFiltersScope, $first: Int, $after: String, $orderBy: IssueOrder, $fetchTotalCount: Boolean = true, $fetchAiRemediationAnalysis: Boolean = false, $fetchTenant: Boolean = false, $securityScoreImpactSelection: SecurityScoreImpactSelection, $fetchSecurityScoreImpact: Boolean = false, $fetchSecuritySubCategories: Boolean = false, $fetchCloudAccountsAndCloudOrganizations: Boolean = false, $fetchCommentThread: Boolean = false, $fetchPrivilegedActionRequests: Boolean = false) {
    issues: issuesV2(
      filterBy: $filterBy
      first: $first
      after: $after
      orderBy: $orderBy
      filterScope: $filterScope
    ) {
      nodes {
        ...IssueTableRecord
        aiRemediationAnalysis @include(if: $fetchAiRemediationAnalysis) {
          verdict
          recommendedSeverity
        }
        tenant @include(if: $fetchTenant) {
          id
          name
        }
        sourceRules {
          ...SourceRuleFields
          securitySubCategories @include(if: $fetchSecuritySubCategories) {
            id
            title
            category {
              id
              name
              framework {
                id
                name
                enabled
              }
            }
          }
        }
        cloudAccounts @include(if: $fetchCloudAccountsAndCloudOrganizations) {
          id
          name
          externalId
          cloudProvider
        }
        cloudOrganizations @include(if: $fetchCloudAccountsAndCloudOrganizations) {
          id
          name
          externalId
          cloudProvider
        }
        commentThread @include(if: $fetchCommentThread) {
          id
          hasComments
        }
        privilegedActionRequests @include(if: $fetchPrivilegedActionRequests) {
          ...PendingUpdateIssueStatusRequest
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount @include(if: $fetchTotalCount)
    }
  }

  fragment IssueTableRecord on Issue {
    id
    type
    resolutionNote
    resolvedAt
    resolutionReason
    ...IssueResolvedBy
    createdAt
    updatedAt
    resolvedAt
    dueAt
    rejectionExpiredAt
    validatedAsExploitable
    projects {
      id
      name
      slug
      isFolder
      businessUnit
      riskProfile {
        businessImpact
      }
    }
    assignee {
      ...IssueAssignee
    }
    status
    severity
    resolutionReason
    entitySnapshot {
      id
      type
      status
      name
      cloudPlatform
      region
      subscriptionName
      subscriptionId
      subscriptionExternalId
      nativeType
      kubernetesClusterId
      kubernetesClusterName
      kubernetesNamespaceName
      tags
      resourceGroupId
      externalId
    }
    notes {
      id
      text
    }
    environments
    serviceTickets {
      id
      externalId
      name
      url
    }
    applicationServices {
      id
      displayName
    }
  }

  fragment IssueResolvedBy on Issue {
    id
    resolvedBy {
      user {
        id
        email
        name
      }
      serviceAccount {
        id
        name
        type
      }
    }
  }

  fragment IssueAssignee on Identity {
    id
    name
    primaryEmail
  }

  fragment SourceRuleFields on IssueSourceRule {
    ... on CloudConfigurationRule {
      id
      tags {
        key
        value
      }
      builtin
      createdBy {
        id
        name
      }
      name
      description
      subjectEntityType
      hasAutoRemediation
      cloudProvider
      securityScoreImpact(selection: $securityScoreImpactSelection) @include(if: $fetchSecurityScoreImpact)
      risks
      threats
      control {
        id
        resolutionRecommendation
        name
        severity
      }
    }
    ... on Control {
      id
      tagsV2 {
        key
        value
      }
      name
      query
      type
      enabled
      enabledForHBI
      enabledForLBI
      enabledForMBI
      enabledForUnattributed
      builtin
      severity
      createdBy {
        id
        name
        email
      }
      sourceCloudConfigurationRule {
        id
        name
      }
      serviceTickets {
        id
        externalId
        name
        url
      }
      resolutionRecommendation
      description
      securityScoreImpact(selection: $securityScoreImpactSelection) @include(if: $fetchSecurityScoreImpact)
      risks
      threats
      validatedAsExploitable
    }
  }

  fragment PendingUpdateIssueStatusRequest on PrivilegedActionRequest {
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
        status
      }
    }
    subject {
      ... on Issue {
        id
        status
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
