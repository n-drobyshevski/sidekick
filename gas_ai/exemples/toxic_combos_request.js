/** Before you start: npm install isomorphic-fetch */
require('isomorphic-fetch');

const token = 'WIZ_SERVICE_ACCOUNT_TOKEN';
const apiEndpoint = 'https://api.eu15.app.wiz.io/graphql';
const variables = {
  "fetchSecurityScoreImpact": false,
  "fetchThreatDetectionDetails": false,
  "fetchTotalCount": false,
  "fetchActorsAndResourcesGraphEntities": false,
  "fetchCloudAccountsAndCloudOrganizations": false,
  "fetchCommentThread": true,
  "fetchThreatCenterActors": false,
  "fetchTdrLogic": false,
  "fetchSecuritySubCategories": false,
  "fetchThreatDetectionAiAnalysis": false,
  "fetchPrivilegedActionRequests": true,
  "includeSignals": false,
  "fetchThreatDetectionAiAnalysisInvestigation": false,
  "fetchLegacyInvestigationProcess": false,
  "fetchForensicsAiAnalysis": false,
  "allowedAiMarkdownEntityTypes": [],
  "fetchAiMarkdownGraphEntities": false,
  "fetchThreatCenterAdvisories": false,
  "first": 40,
  "filterBy": {
    "project": [
      "1dfea0cf-834f-5522-b797-bee5aaf09251"
    ],
    "status": [
      "OPEN",
      "IN_PROGRESS"
    ],
    "riskEqualsAny": [
      "wct-id-1998"
    ],
    "type": [
      "TOXIC_COMBINATION"
    ]
  },
  "orderBy": {
    "field": "SEVERITY_EXPLOITABLE",
    "direction": "DESC"
  }
};
const query = `
  query IssuesTable($filterBy: IssueFilters, $filterScope: IssueFiltersScope, $first: Int, $after: String, $orderBy: IssueOrder, $fetchSecurityScoreImpact: Boolean = false, $fetchThreatDetectionDetails: Boolean = false, $securityScoreImpactSelection: SecurityScoreImpactSelection, $fetchTotalCount: Boolean = true, $fetchActorsAndResourcesGraphEntities: Boolean = false, $fetchCloudAccountsAndCloudOrganizations: Boolean = false, $fetchCommentThread: Boolean = false, $fetchThreatCenterActors: Boolean = false, $fetchTdrLogic: Boolean = false, $fetchSecuritySubCategories: Boolean = false, $fetchThreatDetectionAiAnalysis: Boolean = false, $fetchPrivilegedActionRequests: Boolean = false, $includeSignals: Boolean = false, $fetchThreatDetectionAiAnalysisInvestigation: Boolean = false, $fetchLegacyInvestigationProcess: Boolean = false, $fetchForensicsAiAnalysis: Boolean = false, $allowedAiMarkdownEntityTypes: [AiMarkdownEntityType!]! = [], $fetchAiMarkdownGraphEntities: Boolean! = false, $fetchThreatCenterAdvisories: Boolean = false) {
    issues: issuesV2(
      filterBy: $filterBy
      first: $first
      after: $after
      orderBy: $orderBy
      filterScope: $filterScope
    ) {
      nodes {
        ...IssueTableRecord
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
        threatDetectionDetails @include(if: $fetchThreatDetectionDetails) {
          id
          isAntiBurstThreat
          hasRetroactiveDetections
          ...ThreatDetectionDetailsActorsResources
          ...ThreatDetectionDetailsMainDetection
          ...ThreatDetectionDetailsThreatCenterAdvisories @include(if: $fetchThreatCenterAdvisories)
          ...ThreatDetectionDetailsAiAnalysis @include(if: $fetchThreatDetectionAiAnalysis)
          detections(first: 0) {
            totalCount
          }
          eventOrigin
          detectionSignals @include(if: $includeSignals) {
            ...DetectionSignalsFields
          }
        }
        threatCenterActors @include(if: $fetchThreatCenterActors) {
          id
          name
          type
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
    ... on CloudEventRule {
      id
      name
      cloudEventRuleType: type
      description
      ruleSeverity: severity
      builtin
      createdBy {
        id
        name
      }
      generateIssues
      generateFindings
      sourceType
      ...CloudEventRuleLogicFields @include(if: $fetchTdrLogic)
      securityScoreImpact(selection: $securityScoreImpactSelection) @include(if: $fetchSecurityScoreImpact)
      risks
      threats
      ...CloudEventRuleForensicsPolicyFields
      detectionSignals @include(if: $includeSignals) {
        ...DetectionSignalsFields
        ...DetectionSignalsSideEffects
      }
      ...CloudEventRulePostDetectionConfig @include(if: $includeSignals)
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
    

      fragment CloudEventRuleLogicFields on CloudEventRule {
    id
    params {
      ...CloudEventRuleParamsLogicFields
      ...CloudEventInlineRuleParamsLogicFields
      ...CloudEventSensorRuleLogicParams
    }
  }
    

      fragment CloudEventRuleParamsLogicFields on CorrelationCloudEventRuleParams {
    securityGraphContext {
      description
      inUse
    }
    detectionThresholds {
      inUse
    }
    behavioralBaselines {
      id
      builtInId
      title
      description
    }
    threatIntelligenceInformation {
      ...ThreatIntelligenceInformationFields
    }
  }
    

      fragment ThreatIntelligenceInformationFields on CloudEventRuleThreatIntelligenceInformation {
    description
  }
    

      fragment CloudEventInlineRuleParamsLogicFields on CloudEventRuleParams {
    securityGraphContext {
      description
      inUse
    }
    threatIntelligenceInformation {
      ...ThreatIntelligenceInformationFields
    }
  }
    

      fragment CloudEventSensorRuleLogicParams on WorkloadRuntimeRuleParams {
    threatIntelligenceInformation {
      ...ThreatIntelligenceInformationFields
    }
  }
    

      fragment CloudEventRuleForensicsPolicyFields on CloudEventRule {
    id
    sensorForensicsCollectionSupported
    sensorForensicsCollectionPolicy {
      id
    }
  }
    

      fragment DetectionSignalsFields on DetectionSignal {
    id
    name
    description
    category
  }
    

      fragment DetectionSignalsSideEffects on DetectionSignal {
    id
    sideEffect {
      severity
      severityOffset
      generateDetection
      generateIssue
    }
  }
    

      fragment CloudEventRulePostDetectionConfig on CloudEventRule {
    id
    postDetectionConfig {
      defaultGenerateIssue
      defaultGenerateDetection
    }
  }
    

      fragment ThreatDetectionDetailsActorsResources on ThreatDetectionIssueDetails {
    id
    actorsMaxCountReached
    actorsTotalCount
    actors {
      id
      name
      externalId
      providerUniqueId
      type
      nativeType
      graphEntity @include(if: $fetchActorsAndResourcesGraphEntities) {
        providerUniqueId
        id
        deletedAt
        type
        name
        properties
      }
    }
    resourcesTotalCount
    resourcesMaxCountReached
    resources {
      id
      name
      externalId
      providerUniqueId
      type
      nativeType
      graphEntity @include(if: $fetchActorsAndResourcesGraphEntities) {
        providerUniqueId
        id
        type
        deletedAt
        name
        properties
      }
    }
  }
    

      fragment ThreatDetectionDetailsMainDetection on ThreatDetectionIssueDetails {
    id
    mainDetection {
      id
      startedAt
      severity
      description(format: MARKDOWN)
      ruleMatch {
        rule {
          id
          name
          origins
          ruleSeverity: severity
        }
      }
    }
  }
    

      fragment ThreatDetectionDetailsThreatCenterAdvisories on ThreatDetectionIssueDetails {
    id
    threatCenterAdvisories(first: 10) {
      totalCount
      nodes {
        ...RelatedAdvisoryDetails
      }
    }
  }
    

      fragment RelatedAdvisoryDetails on ThreatCenterItem {
    id
    title
    iconUrl
  }
    

      fragment ThreatDetectionDetailsAiAnalysis on ThreatDetectionIssueDetails {
    id
    aiAnalysis {
      id
      status
      verdict
      confidenceLevel
      conclusion
      severity
      analyzedAt @skip(if: $fetchThreatDetectionAiAnalysisInvestigation)
      investigationProcess @include(if: $fetchLegacyInvestigationProcess)
      investigation @include(if: $fetchThreatDetectionAiAnalysisInvestigation) {
        summarySteps(allowedAiMarkdownEntityTypes: $allowedAiMarkdownEntityTypes) {
          ...AiAnalysisSummaryStep
        }
      }
      forensics @include(if: $fetchForensicsAiAnalysis) {
        ...ThreatAIAnalysisForensics
      }
    }
  }
    

      fragment AiAnalysisSummaryStep on AiAnalysisStep {
    id
    title {
      content
      markdownEntities {
        graphEntities @include(if: $fetchAiMarkdownGraphEntities) {
          ...AiAssistantCustomMarkdownGraphEntity
        }
      }
    }
    content {
      text
      pageLinkParams
      askAiQuery
      links {
        text
        href
      }
      graphQueryJson
      toolCall {
        ...AiAssistantMessageContentToolCall
      }
      customMarkdown {
        content
        markdownEntities {
          graphEntities @include(if: $fetchAiMarkdownGraphEntities) {
            ...AiAssistantCustomMarkdownGraphEntity
          }
        }
      }
    }
    impact
    actions {
      ... on AiAnalysisStepActionUpdateIssuesAssignee {
        label
        input
      }
      ... on AiAnalysisStepActionRequestRemediationPullRequest {
        input
      }
      ... on AiAnalysisStepActionCreateVcsRemediationIssue {
        label
        input
      }
      ... on AiAnalysisStepActionRunResponseAction {
        label
        input
        responseAction {
          ...ResponseActionDeployedInstanceFixAction
        }
        graphEntity {
          id
          name
          type
          providerUniqueId
        }
      }
      ... on AiAnalysisStepActionRequestIssueGreenAgentPullRequest {
        input
      }
    }
  }
    

      fragment AiAssistantCustomMarkdownGraphEntity on GraphEntity {
    providerUniqueId
    id
    name
    type
  }
    

      fragment AiAssistantMessageContentToolCall on AiAssistantMessageContentToolCall {
    id
    title
    params
    result
    status
    category
    toolId
    toolEngines
    clientSideToolCall {
      ... on AiAssistantCliCommand {
        command
        description
        output
      }
    }
  }
    

      fragment ResponseActionDeployedInstanceFixAction on ResponseActionDeployedInstance {
    id
    isDisruptive
    deployedItem {
      id
      deployment {
        id
        name
      }
      catalogItem {
        id
        name
        description
      }
      catalogItemVersion {
        id
        name
        revertible
      }
    }
  }
    

      fragment ThreatAIAnalysisForensics on ThreatAIAnalysisForensics {
    title {
      ...ThreatAIAnalysisForensicsCustomMarkdown
    }
    conclusion {
      ...ThreatAIAnalysisForensicsCustomMarkdown
    }
    findings {
      title {
        ...ThreatAIAnalysisForensicsCustomMarkdown
      }
      description {
        ...ThreatAIAnalysisForensicsCustomMarkdown
      }
      fileEvidence {
        path
        reasoning {
          ...ThreatAIAnalysisForensicsCustomMarkdown
        }
      }
      runtimeEvidence {
        reasoning {
          ...ThreatAIAnalysisForensicsCustomMarkdown
        }
        details {
          ... on ThreatAIAnalysisForensicsProcessEvidence {
            commandLine
          }
          ... on ThreatAIAnalysisForensicsNetworkEvidence {
            ip
            port
          }
          ... on ThreatAIAnalysisForensicsDNSEvidence {
            domain
          }
        }
      }
    }
  }
    

      fragment ThreatAIAnalysisForensicsCustomMarkdown on AiAssistantMessageContentCustomMarkdown {
    content
    markdownEntities {
      graphEntities {
        providerUniqueId
        id
        name
        type
      }
    }
  }
    

      fragment PendingUpdateIssueStatusRequest on PrivilegedActionRequest {
    ...PendingStatusRequestBanner
    ...PrivilegedActionRequestUpdateIssueStatusParams
  }
    

      fragment PendingStatusRequestBanner on PrivilegedActionRequest {
    id
    type
    status
    createdAt
    createdBy {
      ...ApprovalRequestCreatedBy
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
    

      fragment ApprovalRequestCreatedBy on SystemPrincipalV2 {
    id
    name
    email
    ... on ServiceAccount {
      type
      integration {
        id
        type
      }
    }
  }
    

      fragment PrivilegedActionRequestUpdateIssueStatusParams on PrivilegedActionRequest {
    id
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