/*
 * Wiz console query: which human identities can effectively reach an AI asset's data, and
 * through which policy. Captured 2026-08-14 and scrubbed of tenant identifiers.
 *
 * NO PAIRED RESPONSE FILE. The response half of this capture was never taken, and its absence
 * is not evidence about the estate — the same caveat as ai_exposure_endpoint_request.js.
 *
 * WHAT THIS ROOT ADDS over the graphSearch traversal in Q_IDENTITY_ACCESS. That one walks the
 * BINDING topology — AI asset <-ALLOWS_ACCESS_TO- ACCESS_ROLE_BINDING -BOUND_TO-> USER_ACCOUNT
 * — and reads the role's accessType. It says someone HOLDS A ROLE. This says what the role
 * actually confers: `permissions` as real permission strings, and per path the
 * `principalPolicies` / `resourcePolicies` that grant it, which is what somebody would
 * actually go and change.
 *
 * TWO VOCABULARIES. This filter's `accessTypes: ["DATA"]` is NOT the binding traversal's
 * ADMIN / HIGH_PRIVILEGE. They are different axes that share a word, and gas_ai keeps them in
 * separate fields for the whole journey — humanAccess.identityIds against
 * humanAccess.effectiveIds. See src/domain/effectiveAccess.ts, and the header of
 * src/domain/riskConditions.ts for what happens when two consumers read one condition
 * differently.
 *
 * Q_EFFECTIVE_ACCESS in src/server/wizQueriesAi.ts is this document with four things removed,
 * each named there: `issueAnalytics` (an issues() join the console leaves UNGATED here while
 * the entity fragment spreads at six sites), `userMetadata`, `hasOriginalObject`, and
 * `paths[].path.entity` (the hop chain, which IDENTITY_ACCESS already draws as real edges).
 */
/** Before you start: npm install isomorphic-fetch */
require('isomorphic-fetch');

const token = 'WIZ_SERVICE_ACCOUNT_TOKEN';
const apiEndpoint = 'https://api.<dc>.app.wiz.io/graphql';
const variables = {
  "first": 20,
  "filterBy": {
    "grantedEntity": {},
    "grantedEntityType": {
      "equals": [
        "USER_ACCOUNT"
      ]
    },
    "resource": {},
    "resourceType": {
      "equals": [
        "AI_MODEL",
        "AI_DATASET",
        "AI_SERVICE",
        "AI_GUARDRAIL",
        "AI_AGENT",
        "AI_PIPELINE",
        "AI_TOOL",
        "MCP_SERVER"
      ]
    },
    "accessTypes": {
      "equals": [
        "DATA"
      ]
    },
    "projectId": [
      "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb"
    ]
  }
};
