/*
 * Response to a `cloudConfigurationRules` walk — Wiz's cloud-configuration RULE CATALOGUE.
 * Captured 2026-08-14. Tenant identifiers are scrubbed; rule ids, shortIds, names and
 * external references are Wiz's own product vocabulary and are verbatim.
 *
 * NO PAIRED REQUEST FILE, and no filter. The captured page carries Tencent, Synapse and
 * Dockerfile-lint rules beside the AI ones, which is what an unfiltered walk looks like —
 * `Q_CONFIG_RULES` in src/server/wizQueriesAi.ts sends first/after and nothing else,
 * deliberately: the filter input's type name is unverified, and naming an input type wrong
 * fails the whole document while sending none cannot.
 *
 * ABRIDGED. The real walk returns `totalCount: 3858`; this file keeps the rows that matter to
 * this app plus enough neighbours to show what the catalogue is mostly made of. The last page's
 * pageInfo is preserved so the pagination shape is on record.
 *
 * WHAT IT CORRECTED. The Wiz Scans page used to say "MFA is still not collected: Wiz reports
 * it for human identities sourced from a connected IdP". Wrong. MFA is a RULE, not a
 * property — IAM-159, IAM-048 and IAM-208, all `subjectEntityType: USER_ACCOUNT` — so it is
 * reachable through `configurationFindings`, the root CONFIG_FINDINGS already uses, and
 * intersected with the people who can reach an AI asset it becomes a finding this register
 * can own. Dormancy is the same story: IAM-235 and IAM-291.
 *
 * IDP-012 is in this file on purpose. It matches the MFA name pattern and is evaluated
 * against an IDENTITY_PROVIDER — a real finding that says nothing about whether a PERSON has
 * MFA — so it is what the subject guard in src/domain/identityHygiene.ts exists to reject, and
 * test/identityHygiene.test.ts asserts it does.
 *
 * SUB-082 is here for the other consumer: src/client/js/codebook.js says in its own header
 * that tenant-specific shortIds arrive un-glossed and are governed by the cascade's fallback
 * price. This catalogue is the gloss.
 */
module.exports = {
  "data": {
    "cloudConfigurationRules": {
      "nodes": [
        // --- identity hygiene: what the matchers resolve -------------------------------
        {
          "id": "fbd630fa-e79f-4a26-8157-e12e69606b91",
          "name": "User should have MFA enabled",
          "shortId": "IAM-159",
          "subjectEntityType": "USER_ACCOUNT",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        },
        {
          "id": "a5084b6a-b397-47a6-9723-9c6e84d86c71",
          "name": "User with a console password should have MFA enabled",
          "shortId": "IAM-048",
          "subjectEntityType": "USER_ACCOUNT",
          "externalReferences": [
            {
              "id": "PC-OCI-IAM-585",
              "name": "OCI MFA is disabled for IAM users",
              "__typename": "CloudConfigurationRuleExternalReference"
            }
          ],
          "__typename": "CloudConfigurationRule"
        },
        {
          "id": "3b418f2e-044a-44a7-9a7e-84f8ba7bdf00",
          "name": "User with password-based authentication should have multi-factor authentication (MFA) enabled",
          "shortId": "IAM-208",
          "subjectEntityType": "USER_ACCOUNT",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        },
        {
          "id": "2ab617fa-b417-489f-921e-ef22e485eb00",
          "name": "User should not be inactive for more than 90 days",
          "shortId": "IAM-235",
          "subjectEntityType": "USER_ACCOUNT",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        },
        {
          "id": "de0489c2-10c5-4b5a-a698-1a9dcca622c3",
          "name": "User should have recent login activity",
          "shortId": "IAM-291",
          "subjectEntityType": "USER_ACCOUNT",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        },
        // --- the two the subject guard must REFUSE ------------------------------------
        {
          "id": "69a32ec3-6acd-4cb5-87cb-c038fbdc541a",
          "name": "WorkSpaces Directory should have multi-factor authentication enabled",
          "shortId": "IDP-012",
          "subjectEntityType": "IDENTITY_PROVIDER",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        },
        {
          "id": "3afa0bb5-72bb-45b4-b2cf-0131cf799fcb",
          "name": "Uninstalled Connected App should not be inactive for more than 90 days",
          "shortId": "ConnectedApp-011",
          "subjectEntityType": "SERVICE_ACCOUNT",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        },
        // --- the shortId gloss the AARS cascade has always lacked ----------------------
        {
          "id": "60442ee5-452a-48cb-8694-9061c920e10d",
          "name": "Vertex AI Metadata Store should be encrypted with a customer-managed key",
          "shortId": "SUB-082",
          "subjectEntityType": "REGION",
          "externalReferences": [
            {
              "id": "CKV_GCP_96",
              "name": "Ensure Vertex AI Metadata Store uses a CMK (Customer Managed Key)",
              "__typename": "CloudConfigurationRuleExternalReference"
            },
            {
              "id": "CKV2_GCP_25",
              "name": "Ensure Vertex AI featurestore uses a Customer Managed Key (CMK)",
              "__typename": "CloudConfigurationRuleExternalReference"
            }
          ],
          "__typename": "CloudConfigurationRule"
        },
        // --- AI-subject rules, for the "not on an AI asset" claim ---------------------
        {
          "id": "8bb9c278-a389-488d-b7a4-c42ef14b195a",
          "name": "Vertex AI Agent App cloud logging should be enabled",
          "shortId": "AIService-001",
          "subjectEntityType": "AI_SERVICE",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        },
        {
          "id": "4e223fa5-53ea-46e3-a8f6-6623b1c8fd99",
          "name": "Vertex AI dataset should be encrypted with a customer-managed key",
          "shortId": "AIDataset-001",
          "subjectEntityType": "AI_DATASET",
          "externalReferences": [
            {
              "id": "CKV_GCP_92",
              "name": "Ensure Vertex AI datasets uses a CMK (Customer Managed Key)",
              "__typename": "CloudConfigurationRuleExternalReference"
            }
          ],
          "__typename": "CloudConfigurationRule"
        },
        // --- and what the other ~3,845 rows look like --------------------------------
        {
          "id": "b67aaf63-08a2-4fa3-b47f-baf982ceedc5",
          "name": "Synapse workspaces auditing policy should be enabled",
          "shortId": "DatabaseServer-011",
          "subjectEntityType": "DB_SERVER",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        },
        {
          "id": "2d76b114-3b48-4ef9-868e-6eefbe69b0a3",
          "name": "Unpinned Package Version",
          "shortId": "T-IAC-Rule-ca162d14-e51d-4265-8272-864c445168db",
          "subjectEntityType": "IAC_BACKEND",
          "externalReferences": [],
          "__typename": "CloudConfigurationRule"
        }
      ],
      "pageInfo": {
        "hasNextPage": false,
        "endCursor": "eyJmaWVsZHMiOlt7IkZpZWxkIjoiTmFtZSIsIlZhbHVlIjoiWnlwcGVyIEluc3RhbGwgV2l0aG91dCBWZXJzaW9uIn1dfQ==",
        "__typename": "PageInfo"
      },
      "totalCount": 3858,
      "__typename": "CloudConfigurationRuleConnection"
    }
  }
};
