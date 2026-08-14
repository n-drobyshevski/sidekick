/*
 * Response to exemples/ai_agent_expand_request.js — the Wiz console's per-entity graph
 * expansion for one AI agent, captured 2026-08-14. Tenant identifiers are scrubbed:
 * project, subscription, entity UUIDs, numeric ids, service-account emails, bucket name
 * and console URLs are synthetic. Everything structural is verbatim.
 *
 * THIS IS THE REPO'S FIRST CAPTURED graphSearch RESPONSE. Until it landed,
 * ai/queries/reponse_schemas/ held two empty stubs and every graphSearch shape in
 * src/domain/syncNormalize.ts was inferred from the query selection sets — a gap flagged
 * in README.md and in syncNormalize.ts's own header.
 *
 * What it proves, and why src/domain/graphExpand.ts exists:
 *
 *   `entities` is POSITIONAL — a depth-first pre-order walk of every `select: true` node
 *   in the query, padded with a literal null wherever an `optional` leg found no match.
 *
 * 43 slots for 43 selected nodes; 4 matched, 39 null. The matched ones land exactly where
 * the query's pre-order puts them:
 *
 *   [0]  AI_AGENT                  root
 *   [1]  SERVICE_ACCOUNT           ACTING_AS -> PRINCIPAL (concrete subtype returned)
 *   [2]  EXCESSIVE_ACCESS_FINDING    CONTAINS ->
 *   [3-6] null                     the READS_DATA_FROM subtree, 4 selects, unmatched
 *   [7]  BUCKET                    STORES_DATA_IN ->
 *   [8]  null                        HAS_DATA_FINDING -> DATA_FINDING, unmatched
 *
 * Two consequences the rest of the tree had not accounted for:
 *
 *   1. Null padding is real, and normalizeCloudResource read raw["id"] with no guard on
 *      the element. Q_AGENT_SENSITIVE_DATA_ACCESS marks HAS_DATA_FINDING optional, so any
 *      classified store with no finding would have thrown a TypeError mid-sync. Fixed.
 *   2. Identifying entities by type (entities.find(e => e.kind === X)) cannot work on a
 *      traversal this wide: SERVICE_ACCOUNT appears in 3 subtrees here, DATA_RESOURCE in
 *      3, DATA_FINDING in 4, AI_AGENT in 2. Position is the only correct key.
 *
 * NOTE ON FIELDS: these entities carry the CONSOLE's selection set — a `properties` blob,
 * typedProperties, technologies, exposure paths. Q_AGENT_EXPANSION asks for gas_ai's
 * curated ENTITY_FIELDS instead (id/name/type/... on CloudResource), which is far smaller
 * and is what normalizeCloudResource reads. This file is evidence for the SHAPE of the
 * response envelope and the entities array, not for the per-entity field set.
 */
{
  "data": {
    "graphSearch": {
      "pageInfo": {
        "endCursor": "1",
        "hasNextPage": false,
        "__typename": "PageInfo"
      },
      "nodes": [
        {
          "entities": [
            {
              "providerUniqueId": "projects/100000000001/locations/europe-west1/reasoningEngines/1000000000000000001",
              "deletedAt": null,
              "isRestricted": false,
              "id": "11111111-1111-5111-a111-111111111111",
              "name": "example-agent",
              "type": "AI_AGENT",
              "properties": {
                "_productIDs": [
                  "aaaaaaaa-aaaa-5aaa-baaa-aaaaaaaaaaaa",
                  "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb",
                  "cccccccc-cccc-5ccc-bccc-cccccccccccc"
                ],
                "_vertexID": "11111111-1111-5111-a111-111111111111",
                "accessibleFrom.VPN": false,
                "accessibleFrom.internet": false,
                "accessibleFrom.otherSubscriptions": false,
                "accessibleFrom.otherVnets": false,
                "cloudPlatform": "GCP",
                "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/1000000000000000001?project=example-ai-a1b2",
                "configPath": null,
                "creationDate": "2026-08-03T13:38:32Z",
                "dataAccessReasoning": null,
                "deploymentType": "DeploymentTypePaaS",
                "directory": null,
                "discoveryMethods": "MethodCloudScanning",
                "executablePath": null,
                "externalId": "projects/100000000001/locations/europe-west1/reasoningEngines/1000000000000000001",
                "fullResourceName": null,
                "hasAccessToSensitiveData": false,
                "hasAdminPrivileges": false,
                "hasAdminSaaSPrivileges": false,
                "hasHighPrivileges": false,
                "hasHighSaaSPrivileges": false,
                "installationMethod": null,
                "instructions": null,
                "maxExposureLevel": 0,
                "name": "example-agent",
                "nativeType": "aiplatform#ReasoningEngine",
                "numAddressesOpenForHTTP": 0,
                "numAddressesOpenForHTTPS": 0,
                "numAddressesOpenForNonStandardPorts": 0,
                "numAddressesOpenForRDP": 0,
                "numAddressesOpenForSSH": 0,
                "numAddressesOpenForWINRM": 0,
                "openToAllInternet": false,
                "providerUniqueId": "projects/100000000001/locations/europe-west1/reasoningEngines/1000000000000000001",
                "publisher": null,
                "reasoning": null,
                "region": "europe-west1",
                "resourceGroupExternalId": null,
                "snippet": null,
                "status": "Active",
                "subscriptionExternalId": "example-ai-a1b2",
                "updatedAt": "2026-08-04T06:03:44Z",
                "zone": null
              },
              "typedProperties": {
                "description": "Example Agent - Risk Assessment",
                "__typename": "GEAiAgent"
              },
              "__typename": "GraphEntity",
              "userMetadata": null,
              "technologies": [
                {
                  "id": "13953",
                  "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation.svg",
                  "__typename": "Technology"
                }
              ],
              "publicExposures": {
                "nodes": [],
                "__typename": "NetworkExposureConnection"
              },
              "lateralMovementPaths": {
                "nodes": [],
                "__typename": "LateralMovementPathConnection"
              },
              "codeSourcePath": {
                "totalCount": 0,
                "nodes": null,
                "__typename": "GraphEntitySourcePathConnection"
              }
            },
            {
              "providerUniqueId": "100000000000000000001",
              "deletedAt": null,
              "isRestricted": false,
              "id": "22222222-2222-5222-a222-222222222222",
              "name": "projects/example-ai-a1b2/serviceAccounts/example-agent-identity@example-ai-a1b2.iam.gserviceaccount.com",
              "type": "SERVICE_ACCOUNT",
              "properties": {
                "_productIDs": [
                  "aaaaaaaa-aaaa-5aaa-baaa-aaaaaaaaaaaa",
                  "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb",
                  "cccccccc-cccc-5ccc-bccc-cccccccccccc"
                ],
                "_vertexID": "22222222-2222-5222-a222-222222222222",
                "clientId": "100000000000000000001",
                "cloudProviderURL": "https://console.cloud.google.com/iam-admin/serviceaccounts/details/100000000000000000001?project=example-ai-a1b2",
                "description": null,
                "displayName": "service account for example agent",
                "email": "example-agent-identity@example-ai-a1b2.iam.gserviceaccount.com",
                "enabled": true,
                "externalId": "example-agent-identity@example-ai-a1b2.iam.gserviceaccount.com",
                "externalOwners": "0",
                "fullResourceName": "//iam.googleapis.com/projects/example-ai-a1b2/serviceAccounts/example-agent-identity@example-ai-a1b2.iam.gserviceaccount.com",
                "hasAccessToSensitiveData": false,
                "hasAdminPrivileges": false,
                "hasAdminSaaSPrivileges": false,
                "hasHighPrivileges": false,
                "hasHighSaaSPrivileges": false,
                "iacStatus": "IacStatusInvalid",
                "iacStatusEvidenceCloudEventId": null,
                "iacVisibility": "IacVisibilityInvalid",
                "identityPurpose": "IdentityPurposeAgentic",
                "inactiveInLast90Days": false,
                "inactiveTimeframe": "Active",
                "managed": false,
                "name": "projects/example-ai-a1b2/serviceAccounts/example-agent-identity@example-ai-a1b2.iam.gserviceaccount.com",
                "namespace": null,
                "nativeType": "serviceaccount#instance",
                "providerUniqueId": "100000000000000000001",
                "region": null,
                "status": "Active",
                "subscriptionExternalId": "example-ai-a1b2",
                "updatedAt": "2026-08-14T01:14:10Z",
                "userDirectory": "GCP"
              },
              "typedProperties": {
                "__typename": "GEServiceAccount"
              },
              "__typename": "GraphEntity",
              "userMetadata": null,
              "technologies": [
                {
                  "id": "8023",
                  "icon": "https://assets.wiz.io/technology-icons/GCPServiceAccount.svg",
                  "__typename": "Technology"
                }
              ],
              "publicExposures": {
                "nodes": [],
                "__typename": "NetworkExposureConnection"
              },
              "lateralMovementPaths": {
                "nodes": [],
                "__typename": "LateralMovementPathConnection"
              },
              "codeSourcePath": {
                "totalCount": 0,
                "nodes": null,
                "__typename": "GraphEntitySourcePathConnection"
              }
            },
            {
              "providerUniqueId": null,
              "deletedAt": null,
              "isRestricted": false,
              "id": "33333333-3333-5333-a333-333333333333",
              "name": "GCP excessive access for service account projects/example-ai-a1b2/serviceAccounts/provisioning-sa@example-ai-a1b2.iam.gserviceaccount.com",
              "type": "EXCESSIVE_ACCESS_FINDING",
              "properties": {
                "_productIDs": [
                  "aaaaaaaa-aaaa-5aaa-baaa-aaaaaaaaaaaa",
                  "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb",
                  "cccccccc-cccc-5ccc-bccc-cccccccccccc"
                ],
                "_vertexID": "33333333-3333-5333-a333-333333333333",
                "cloudPlatform": "GCP",
                "cloudProviderURL": null,
                "currentConfiguration_policyName": "Service Account Token Creator",
                "description": "The service account `projects/example-ai-a1b2/serviceAccounts/provisioning-sa@example-ai-a1b2.iam.gserviceaccount.com` is currently assigned the `Service Account Token Creator` role, but it has `3` unused permissions. This role can therefore be **replaced** by the custom role in this finding without losing any functionality, while adhering to the principle of least privilege.",
                "externalId": "CloudEvents##UserDirectory/ServiceAccount##example-agent-identity@example-ai-a1b2.iam.gserviceaccount.com##UserDirectory/ServiceAccount##provisioning-sa@example-ai-a1b2.iam.gserviceaccount.com##roles/iam.serviceAccountTokenCreator",
                "name": "GCP excessive access for service account projects/example-ai-a1b2/serviceAccounts/provisioning-sa@example-ai-a1b2.iam.gserviceaccount.com",
                "remediationType": "ReplacePolicy",
                "severity": "SeverityMedium",
                "source": "CloudEvents",
                "sources": "CloudEvents",
                "suggestedConfiguration_policyName": "WizReduced-Service Account Token Creator",
                "updatedAt": "2026-06-28T06:57:40Z"
              },
              "typedProperties": {
                "__typename": "GEExcessiveAccessFinding"
              },
              "__typename": "GraphEntity",
              "userMetadata": null,
              "technologies": null,
              "publicExposures": {
                "nodes": [],
                "__typename": "NetworkExposureConnection"
              },
              "lateralMovementPaths": {
                "nodes": [],
                "__typename": "LateralMovementPathConnection"
              },
              "codeSourcePath": {
                "totalCount": 0,
                "nodes": null,
                "__typename": "GraphEntitySourcePathConnection"
              }
            },
            null,
            null,
            null,
            null,
            {
              "providerUniqueId": "https://www.googleapis.com/storage/v1/b/example-ai-a1b2-agent-staging",
              "deletedAt": null,
              "isRestricted": false,
              "id": "44444444-4444-5444-a444-444444444444",
              "name": "example-ai-a1b2-agent-staging",
              "type": "BUCKET",
              "properties": {
                "_productIDs": [
                  "aaaaaaaa-aaaa-5aaa-baaa-aaaaaaaaaaaa",
                  "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb",
                  "cccccccc-cccc-5ccc-bccc-cccccccccccc"
                ],
                "_vertexID": "44444444-4444-5444-a444-444444444444",
                "accessibleFrom.VPN": false,
                "accessibleFrom.internet": false,
                "accessibleFrom.otherSubscriptions": false,
                "accessibleFrom.otherVnets": false,
                "atRestEncryption": true,
                "cloudPlatform": "GCP",
                "cloudProviderURL": "https://console.cloud.google.com/storage/browser/example-ai-a1b2-agent-staging?project=example-ai-a1b2",
                "creationDate": "2026-03-30T15:44:36Z",
                "deploymentCoverage_cloudEvents_deploymentStatus": "NotInstalled",
                "deploymentCoverage_cloudEvents_isLastSeenInTheLastDay": false,
                "deploymentCoverage_cloudEvents_isLastSeenInTheLastWeek": false,
                "deploymentCoverage_cloudEvents_statusByOrigin_GCP_STORAGE_DATA_ACCESS_LOGS": "NotInstalled",
                "encrypted": true,
                "encryptedAtRest": true,
                "externalId": "gs://example-ai-a1b2-agent-staging",
                "fullResourceName": "//storage.googleapis.com/example-ai-a1b2-agent-staging",
                "hasSensitiveData": false,
                "iacStatus": "IacStatusInvalid",
                "iacStatusEvidenceCloudEventId": null,
                "iacVisibility": "IacVisibilityInvalid",
                "isPublic": false,
                "loggingEnabled": false,
                "maxExposureLevel": 0,
                "name": "example-ai-a1b2-agent-staging",
                "nativeType": "storage#bucket",
                "numAddressesOpenForHTTP": 0,
                "numAddressesOpenForHTTPS": 0,
                "numAddressesOpenForNonStandardPorts": 0,
                "numAddressesOpenForRDP": 0,
                "numAddressesOpenForSSH": 0,
                "numAddressesOpenForWINRM": 0,
                "openToAllInternet": false,
                "providerUniqueId": "https://www.googleapis.com/storage/v1/b/example-ai-a1b2-agent-staging",
                "publicExposure": "PublicExposureInvalid",
                "region": "europe-west1",
                "regionLocation": "BE",
                "regionType": "BucketRegionTypeSingleRegion",
                "resourceGroupExternalId": null,
                "retentionPeriod": 0,
                "sizeBytes": 104453527,
                "sizeGiB": 0,
                "status": "Active",
                "subscriptionExternalId": "example-ai-a1b2",
                "tags": {
                  "Wiz/Domain": "CROSS"
                },
                "uniformACL": false,
                "updateDate": "2026-06-09T12:47:01Z",
                "updatedAt": "2026-08-12T20:07:51Z",
                "versioningEnabled": false,
                "zone": null
              },
              "typedProperties": {
                "__typename": "GEBucket"
              },
              "__typename": "GraphEntity",
              "userMetadata": null,
              "technologies": [
                {
                  "id": "2745",
                  "icon": "https://assets.wiz.io/technology-icons/GoogleCloudStorage.svg",
                  "__typename": "Technology"
                }
              ],
              "publicExposures": {
                "nodes": [],
                "__typename": "NetworkExposureConnection"
              },
              "lateralMovementPaths": {
                "nodes": [],
                "__typename": "LateralMovementPathConnection"
              },
              "codeSourcePath": {
                "totalCount": 0,
                "nodes": null,
                "__typename": "GraphEntitySourcePathConnection"
              }
            },
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
          ],
          "aggregateCount": null,
          "__typename": "GraphSearchResult"
        }
      ],
      "__typename": "GraphSearchResultConnection"
    }
  }
}
