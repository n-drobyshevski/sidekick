/*
 * Wiz console query: AI assets serving an endpoint the dynamic scanner found open and the
 * tenant's exposure-level policy rates High or Medium. Captured 2026-08-14 and scrubbed of
 * tenant identifiers.
 *
 * NO PAIRED RESPONSE FILE, and that absence is not a tenant with nothing to report — the
 * response half of this capture was simply never taken. Do not read the missing file as
 * evidence about the estate; the sibling exemples/ai_exposure_host_response.js is the only
 * captured response for this document.
 *
 * The traversal below is the output of toGraphEntityQuery(endpointExposureSpec(types)) from
 * src/domain/exposureQuery.ts. As with the host capture, `as: "scoped_entity"` is dropped
 * and the `type` list is the tenant-resolved one — note that the console sent a different
 * nine types here than it did for the host query (AI_GUARDRAIL in, AI_AGENT_REGISTRY out),
 * which is why neither list is treated as meaning anything.
 *
 * BOTH HALVES OF THE FILTER MATTER, and this is the pair the whole feature turns on:
 *
 *   portValidationResult: "Open"          Wiz's scanner connected.
 *   exposureLevel_name: [High, Medium]    policy rates what it found there.
 *
 * The host capture's own application endpoints are `Open` and rated `Low` — "Matched rule
 * '2XX HTTP status codes with SSO authentication' from moderate exposure level policy". An
 * open port behind SSO is reachable and is not an exposure. That is why the two queries are
 * two sync steps and two figures, and why domain/exposureQuery.isRatedExposure judges the
 * level Wiz returned rather than trusting that a filtered query returned the row at all.
 *
 * The document is `Q_AI_EXPOSURE` in src/server/wizQueriesAi.ts, shared with the host step.
 */
/** Before you start: npm install isomorphic-fetch */
require('isomorphic-fetch');

const token = 'WIZ_SERVICE_ACCOUNT_TOKEN';
const apiEndpoint = 'https://api.<dc>.app.wiz.io/graphql';
const variables = {
  "fetchTotalCount": false,
  "quick": true,
  "fetchPublicExposurePaths": true,
  "fetchInternalExposurePaths": false,
  "fetchIssueAnalytics": false,
  "fetchThreatAnalytics": false,
  "fetchLateralMovement": true,
  "fetchCodeSource": true,
  "fetchKubernetes": false,
  "fetchCost": false,
  "first": 100,
  "query": {
    "type": [
      "AI_AGENT",
      "AI_TOOL",
      "AI_DATASET",
      "AI_MODEL",
      "AI_GUARDRAIL",
      "AI_GATEWAY",
      "AI_PIPELINE",
      "AI_SERVICE",
      "MCP_SERVER"
    ],
    "select": true,
    "relationships": [
      {
        "type": [
          {
            "type": "SERVES"
          }
        ],
        "with": {
          "type": [
            "ENDPOINT"
          ],
          "select": true,
          "where": {
            "exposureLevel_name": {
              "EQUALS": [
                "High",
                "Medium"
              ]
            },
            "portValidationResult": {
              "EQUALS": "Open"
            }
          }
        }
      }
    ]
  },
  "projectId": "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb"
};
