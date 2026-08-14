/*
 * Wiz console query: AI assets whose underlying compute is reachable from the internet.
 * Captured 2026-08-14 and scrubbed of tenant identifiers. Paired with
 * exemples/ai_exposure_host_response.js.
 *
 * The traversal below was NOT hand-copied into this file: it is the output of
 * toGraphEntityQuery(hostExposureSpec(types)) from src/domain/exposureQuery.ts, which is how
 * that module's spec is shown to reproduce the console's query. Two keys differ from what
 * the console literally sends, both deliberate:
 *
 *   - `as: "scoped_entity"` is dropped. It is a console-side alias for referring to the node
 *     in its own UI and carries nothing over the wire.
 *   - the `type` list is the TENANT-RESOLVED one (resolveAiResourceTypes), not the nine
 *     types the console happened to have selected. The sibling endpoint capture sends a
 *     DIFFERENT nine — it includes AI_GUARDRAIL and drops AI_AGENT_REGISTRY — which is an
 *     artifact of whoever built the two queries in the UI rather than a claim about which
 *     AI kinds can be hosted.
 *
 * WHAT THIS QUERY IS FOR. A hosted AI asset carries no reachability flags of its own; the
 * response proves it, and that is why riskConditions.ts reported UNDETERMINED for every one
 * of them and nothing in the battery could ever settle it. `ai/queries/5_internet.md` was an
 * empty file until this landed.
 *
 * The document is `Q_AI_EXPOSURE` in src/server/wizQueriesAi.ts — the console's operation
 * verbatim, both named fragments and every @include gate, with `$projectId` relaxed from
 * `String!` to `String` so the step can run tenant-wide. The flags below are sent unchanged.
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
      "AI_AGENT_REGISTRY",
      "AI_GATEWAY",
      "AI_MODEL",
      "AI_PIPELINE",
      "AI_SERVICE",
      "MCP_SERVER",
      "AI_DATASET"
    ],
    "select": true,
    "relationships": [
      {
        "type": [
          {
            "type": "RUNS",
            "reverse": true
          }
        ],
        "with": {
          "type": [
            "VIRTUAL_MACHINE",
            "SERVERLESS"
          ],
          "select": true,
          "where": {
            "accessibleFrom.internet": {
              "EQUALS": true
            }
          }
        }
      }
    ]
  },
  "projectId": "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb"
};
