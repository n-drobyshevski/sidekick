/*
 * Response to exemples/ai_exposure_host_request.js, captured 2026-08-14. Tenant identifiers
 * are scrubbed: project and subscription ids, entity UUIDs, image digests, hostnames and
 * console URLs are synthetic. Everything structural is verbatim.
 *
 * ONE ELISION, marked where it occurs. Each `publicExposures[].path[]` entry repeats the
 * SERVERLESS entity's ENTIRE properties bag — the same ~40 keys already present on the
 * top-level entity, twice over. Those repeats are reduced to the identifying fields. No key
 * that any normalizer reads is affected, and none of the shapes change.
 *
 * WHAT THIS PROVES, and why the exposure steps exist:
 *
 * 1. THE AI ASSET CARRIES NO REACHABILITY OF ITS OWN. entities[0] is the AI_AGENT and its
 *    properties bag has no `accessibleFrom.*` key at all — not false, absent. Every hosted
 *    AI asset is in this state, which is why riskConditions.conditionState answered `null`
 *    for them and `kpis.internetUnknown` could never go down. entities[1], the Cloud Run
 *    revision it runs on, carries `accessibleFrom.internet: true`, `openToAllInternet: true`,
 *    `numPortsOpenToInternet: 2` and `validatedOpenPorts: [80, 443]`. The fact is one hop
 *    away, and this query is the hop.
 *
 * 2. REACHABLE IS NOT EXPOSED. That same revision is open to 0.0.0.0/0 on 443 and 80 — and
 *    BOTH application endpoints come back `exposureLevel_name: "Low"`, with
 *    `exposureLevel_description` naming the rule: "Matched rule '2XX HTTP status codes with
 *    SSO authentication' from moderate exposure level policy". They are also
 *    `portValidationResult: "Open"`. So: open ports, validated, behind SSO, not an exposure.
 *
 *    These endpoints reach the ledger through THIS query, which filters on nothing. Anything
 *    that treated "the row came back" as the finding would relabel them as validated
 *    exposures — the single most misleading thing this feature could do. domain/exposureQuery
 *    .isRatedExposure judges the level Wiz returned instead, and test/exposure.test.ts pins
 *    exactly this row.
 *
 * 3. `entities` IS POSITIONAL HERE TOO — two slots for the query's two `select: true` nodes,
 *    in pre-order (root AI asset, then the compute leg). With only two, over disjoint type
 *    sets, syncNormalize can safely read them BY TYPE; graphExpand.ts explains at length why
 *    that shortcut is unsound for a deep traversal.
 *
 * 4. The lateral-movement and code-source legs are requested and come back EMPTY on this
 *    tenant (`codeSourcePath: { totalCount: 0, nodes: null }`). Nothing normalizes them into
 *    edges; pages are archived by writeSyncPage so a normalizer can be written when a
 *    non-empty capture exists.
 */
module.exports = {
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
              "providerUniqueId": null,
              "deletedAt": null,
              "isRestricted": false,
              "id": "aaaaaaaa-aaaa-5aaa-aaaa-aaaaaaaaaaaa",
              "name": "agent",
              "type": "AI_AGENT",
              "properties": {
                "_productIDs": [
                  "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb"
                ],
                "_vertexID": "aaaaaaaa-aaaa-5aaa-aaaa-aaaaaaaaaaaa",
                "cloudPlatform": "GCP",
                "cloudProviderURL": null,
                "configPath": null,
                "dataAccessReasoning": null,
                "deploymentType": "DeploymentTypeHosted",
                "directory": "/app",
                "discoveryMethods": "MethodWorkloadScanning",
                "executablePath": null,
                "externalId": "projects/example-proj/locations/europe-west1/services/datacost-agent-beta/revisions/datacost-agent-beta-00002-8bl##CloudPlatform/ContainerImage##europe-west1-docker.pkg.dev##example-proj/cloud-run-source-deploy/datacost-agent-beta@sha256:0000##/app",
                "fullResourceName": null,
                "hasAccessToSensitiveData": false,
                "hasAdminPrivileges": false,
                "hasAdminSaaSPrivileges": false,
                "hasHighPrivileges": false,
                "hasHighSaaSPrivileges": false,
                "installationMethod": null,
                "instructions": null,
                "maxExposureLevel": 0,
                "name": "agent",
                "nativeType": "hostedAiAgent",
                "providerUniqueId": null,
                "publisher": null,
                "reasoning": null,
                "region": "europe-west1",
                "resourceGroupExternalId": null,
                "snippet": "from google.adk.agents import Agent\\n...\\nroot_agent = Agent(name=\"datacost_agent\", model=\"gemini-2.5-flash\")",
                "status": "Active",
                "subscriptionExternalId": "example-proj",
                "tags": {
                  "Wiz/Domain": "EXAMPLE DOMAIN"
                },
                "updatedAt": "2026-08-11T11:57:54Z",
                "zone": null
              },
              "typedProperties": {
                "description": null,
                "__typename": "GEAiAgent"
              },
              "__typename": "GraphEntity",
              "userMetadata": null,
              "technologies": [
                {
                  "id": "14148",
                  "icon": "https://assets.wiz.io/technology-icons/ai-agent.svg",
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
              "providerUniqueId": "cccccccc-cccc-4ccc-cccc-cccccccccccc",
              "deletedAt": null,
              "isRestricted": false,
              "id": "dddddddd-dddd-5ddd-dddd-dddddddddddd",
              "name": "datacost-agent-beta-00002-8bl",
              "type": "SERVERLESS",
              "properties": {
                "_productIDs": [
                  "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb"
                ],
                "_vertexID": "dddddddd-dddd-5ddd-dddd-dddddddddddd",
                "accessibleFrom.VPN": false,
                "accessibleFrom.internet": true,
                "accessibleFrom.otherSubscriptions": false,
                "accessibleFrom.otherVnets": false,
                "cloudPlatform": "GCP",
                "cloudProviderURL": "https://console.cloud.google.com/run/detail/europe-west1/datacost-agent-beta/revisions?project=example-proj",
                "externalId": "projects/example-proj/locations/europe-west1/services/datacost-agent-beta/revisions/datacost-agent-beta-00002-8bl",
                "fullResourceName": "//run.googleapis.com/projects/example-proj/locations/europe-west1/revisions/datacost-agent-beta-00002-8bl",
                "handler": null,
                "hasAccessToSensitiveData": false,
                "hasAdminPrivileges": false,
                "hasAdminSaaSPrivileges": false,
                "hasHighPrivileges": false,
                "hasHighSaaSPrivileges": false,
                "hasSensitiveData": false,
                "kind": "GoogleCloudRunRevision",
                "maxExposureLevel": 2,
                "name": "datacost-agent-beta-00002-8bl",
                "nativeType": "run#revision",
                "numAddressesOpenForHTTP": 4294967295,
                "numAddressesOpenForHTTPS": 4294967295,
                "numAddressesOpenForNonStandardPorts": 0,
                "numAddressesOpenForRDP": 0,
                "numAddressesOpenForSSH": 0,
                "numAddressesOpenForWINRM": 0,
                "numAddressesOpenToInternet": 4294967295,
                "numPortsOpenToInternet": 2,
                "openToAllInternet": true,
                "providerUniqueId": "cccccccc-cccc-4ccc-cccc-cccccccccccc",
                "purposes": [
                  "AI",
                  "AIHost"
                ],
                "region": "europe-west1",
                "requiresAuth": false,
                "resourceGroupExternalId": null,
                "runtime": null,
                "status": "Active",
                "subscriptionExternalId": "example-proj",
                "tags": {
                  "Wiz/Domain": "EXAMPLE DOMAIN"
                },
                "updatedAt": "2026-08-03T18:50:11Z",
                "validatedOpenPorts": [
                  80,
                  443
                ],
                "zone": null
              },
              "typedProperties": {
                "__typename": "GEServerless"
              },
              "__typename": "GraphEntity",
              "userMetadata": null,
              "technologies": [
                {
                  "id": "8187",
                  "icon": "https://assets.wiz.io/technology-icons/GCPCloudRunRevision.svg",
                  "__typename": "Technology"
                }
              ],
              "publicExposures": {
                "nodes": [
                  {
                    "id": "eeeeeeee-eeee-5eee-eeee-eeeeeeeeeeee",
                    "portRange": "443",
                    "sourceIpRange": "0.0.0.0/0",
                    "destinationIpRange": "datacost-agent-beta.a.run.app",
                    "path": [
                      {
                        "providerUniqueId": null,
                        "id": "dddddddd-dddd-5ddd-dddd-dddddddddddd",
                        "name": "datacost-agent-beta-00002-8bl",
                        "type": "SERVERLESS",
                        // ELIDED: this repeats the entity's whole properties bag above.
                        "properties": {
                          "_vertexID": "dddddddd-dddd-5ddd-dddd-dddddddddddd",
                          "accessibleFrom.internet": true,
                          "openToAllInternet": true,
                          "validatedOpenPorts": [80, 443]
                        },
                        "typedProperties": {
                          "__typename": "GEServerless"
                        },
                        "__typename": "GraphEntity"
                      },
                      {
                        "providerUniqueId": null,
                        "id": "ffffffff-ffff-5fff-ffff-ffffffffffff",
                        "name": "datacost-agent-beta",
                        "type": "NETWORK_INTERFACE",
                        "properties": {
                          "_vertexID": "ffffffff-ffff-5fff-ffff-ffffffffffff",
                          "cloudPlatform": "GCP",
                          "directlyInternetFacing": true,
                          "externalId": "fakeid-nic/projects/example-proj/locations/europe-west1/services/datacost-agent-beta",
                          "name": "datacost-agent-beta",
                          "region": "europe-west1",
                          "status": "Active",
                          "subscriptionExternalId": "example-proj",
                          "updatedAt": "2026-06-19T10:17:41Z",
                          "wizMockResource": true
                        },
                        "typedProperties": {
                          "__typename": "GENetworkInterface"
                        },
                        "__typename": "GraphEntity"
                      }
                    ],
                    "applicationEndpoints": [
                      {
                        "providerUniqueId": null,
                        "id": "11111111-1111-5111-1111-111111111111",
                        "name": "https://datacost-agent-beta.a.run.app:443",
                        "type": "ENDPOINT",
                        "properties": {
                          "_vertexID": "11111111-1111-5111-1111-111111111111",
                          "allPorts": false,
                          "authenticationMethod": "SSO",
                          "authenticationServiceProvider": "Google",
                          "cloudPlatform": "GCP",
                          // The line the whole feature turns on: open, validated, and NOT an
                          // exposure — because policy rated what is behind the port.
                          "exposureLevel_description": "Matched rule \"2XX HTTP status codes with SSO authentication\" from moderate exposure level policy",
                          "exposureLevel_name": "Low",
                          "exposureLevel_value": 0,
                          "externalId": "https://datacost-agent-beta.a.run.app:443/",
                          "finalHost": "accounts.google.com",
                          "finalPort": 443,
                          "hasScreenshot": true,
                          "hasSensitiveData": false,
                          "host": "datacost-agent-beta.a.run.app",
                          "httpContentType": "text/html; charset=utf-8",
                          "httpGETStatus": "200 OK",
                          "httpGETStatusCode": 200,
                          "name": "https://datacost-agent-beta.a.run.app:443",
                          "port": 443,
                          "portEnd": 443,
                          "portRange": false,
                          "portStart": 443,
                          "portValidationResult": "Open",
                          "protocols": "HTTPS",
                          "scanSources": "SourceTypeDefault",
                          "status": null,
                          "subscriptionExternalId": "example-proj",
                          "updatedAt": "2026-08-14T06:28:51Z"
                        },
                        "typedProperties": {
                          "__typename": "GEEndpoint"
                        },
                        "__typename": "GraphEntity"
                      }
                    ],
                    "__typename": "NetworkExposure"
                  },
                  {
                    "id": "22222222-2222-5222-2222-222222222222",
                    "portRange": "80",
                    "sourceIpRange": "0.0.0.0/0",
                    "destinationIpRange": "datacost-agent-beta.a.run.app",
                    "path": [
                      {
                        "providerUniqueId": null,
                        "id": "dddddddd-dddd-5ddd-dddd-dddddddddddd",
                        "name": "datacost-agent-beta-00002-8bl",
                        "type": "SERVERLESS",
                        // ELIDED, as above.
                        "properties": {
                          "_vertexID": "dddddddd-dddd-5ddd-dddd-dddddddddddd",
                          "accessibleFrom.internet": true,
                          "openToAllInternet": true,
                          "validatedOpenPorts": [80, 443]
                        },
                        "typedProperties": {
                          "__typename": "GEServerless"
                        },
                        "__typename": "GraphEntity"
                      },
                      {
                        "providerUniqueId": null,
                        "id": "ffffffff-ffff-5fff-ffff-ffffffffffff",
                        "name": "datacost-agent-beta",
                        "type": "NETWORK_INTERFACE",
                        "properties": {
                          "_vertexID": "ffffffff-ffff-5fff-ffff-ffffffffffff",
                          "cloudPlatform": "GCP",
                          "directlyInternetFacing": true,
                          "name": "datacost-agent-beta",
                          "region": "europe-west1",
                          "status": "Active",
                          "wizMockResource": true
                        },
                        "typedProperties": {
                          "__typename": "GENetworkInterface"
                        },
                        "__typename": "GraphEntity"
                      }
                    ],
                    "applicationEndpoints": [
                      {
                        "providerUniqueId": null,
                        "id": "33333333-3333-5333-3333-333333333333",
                        "name": "http://datacost-agent-beta.a.run.app:80",
                        "type": "ENDPOINT",
                        "properties": {
                          "_vertexID": "33333333-3333-5333-3333-333333333333",
                          "allPorts": false,
                          "authenticationMethod": "SSO",
                          "authenticationServiceProvider": "Google",
                          "cloudPlatform": "GCP",
                          "exposureLevel_description": "Matched rule \"2XX HTTP status codes with SSO authentication\" from moderate exposure level policy",
                          "exposureLevel_name": "Low",
                          "exposureLevel_value": 0,
                          "externalId": "http://datacost-agent-beta.a.run.app:80/",
                          "finalHost": "accounts.google.com",
                          "finalPort": 443,
                          "hasScreenshot": true,
                          "hasSensitiveData": false,
                          "host": "datacost-agent-beta.a.run.app",
                          "httpContentType": "text/html; charset=utf-8",
                          "httpGETStatus": "200 OK",
                          "httpGETStatusCode": 200,
                          "name": "http://datacost-agent-beta.a.run.app:80",
                          "port": 80,
                          "portEnd": 80,
                          "portRange": false,
                          "portStart": 80,
                          "portValidationResult": "Open",
                          "protocols": "HTTP",
                          "scanSources": "SourceTypeDefault",
                          "status": null,
                          "subscriptionExternalId": "example-proj",
                          "updatedAt": "2026-08-14T06:28:51Z"
                        },
                        "typedProperties": {
                          "__typename": "GEEndpoint"
                        },
                        "__typename": "GraphEntity"
                      }
                    ],
                    "__typename": "NetworkExposure"
                  }
                ],
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
            }
          ],
          "aggregateCount": null,
          "__typename": "GraphSearchResult"
        }
      ],
      "__typename": "GraphSearchResultConnection"
    }
  }
};
