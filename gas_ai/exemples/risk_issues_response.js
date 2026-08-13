/*
 * Response to exemples/risk_issues_request.js — Wiz "Risk Issues", AI Security
 * category, captured 2026-08-13. The live page carried 40 of 98 nodes; this is a
 * six-node trim that keeps one of every shape the normalizer has to survive:
 *
 *   4a8b7ef5  AI_AGENT (managed)      wc-id-3217  bare: no tickets, notes or AI verdict
 *   fc0226fa  AI_AGENT (hosted, VM)   wc-id-3230  entitySnapshot.status "Inactive", tags
 *   ea0706fd  AI_AGENT (managed)      wc-id-3217  serviceTickets + aiRemediationAnalysis
 *   e0f2bf67  SERVICE_ACCOUNT (AWS)   wc-id-2742  non-AI_AGENT entity, tickets + verdict
 *   be792ea6  SERVICE_ACCOUNT (AWS)   wc-id-2742  notes[]: ignored-by-design, then expired
 *   6934f5a0  SERVICE_ACCOUNT (AWS)   wc-id-2742  rich entitySnapshot.tags, no tickets
 *
 * Every node here is severity MEDIUM and type TOXIC_COMBINATION — that is what the
 * tenant returned, even though the filter also requests CLOUD_CONFIGURATION.
 *
 * Elided for size: each sourceRules[].query holds a ~150-line security-graph query
 * body the register never reads; it is replaced by an "_elided" marker so this file
 * stays valid JSON. Nothing else is altered.
 */
{
  "data": {
    "issues": {
      "nodes": [
        {
          "id": "4a8b7ef5-46c1-47a7-b09f-7928be9fb980",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2026-07-28T22:12:51.194629Z",
          "updatedAt": "2026-08-13T10:30:01.04991Z",
          "dueAt": "2026-10-26T22:12:51.194629Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "slug": "cs-tetrix",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "LBI" }
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "owner-CS-TETRIX-cloud",
              "slug": "provisioning-cs-tetrix",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "MBI" }
            }
          ],
          "assignee": null,
          "status": "OPEN",
          "severity": "MEDIUM",
          "entitySnapshot": {
            "id": "ac449388-507d-5eb3-99ef-6f63a41c4a96",
            "type": "AI_AGENT",
            "status": "Active",
            "name": "pprod-vc-self-training-supervisor-agent",
            "cloudPlatform": "GCP",
            "region": "europe-west3",
            "subscriptionName": "vc-self-training-preprod-mkez",
            "subscriptionId": "cc58d576-5da3-508d-af83-7121b2803fbb",
            "subscriptionExternalId": "vc-self-training-preprod-mkez",
            "nativeType": "aiplatform#ReasoningEngine",
            "kubernetesClusterId": null,
            "kubernetesClusterName": "",
            "kubernetesNamespaceName": "",
            "tags": {},
            "resourceGroupId": null,
            "externalId": "projects/389127772956/locations/europe-west3/reasoningEngines/3898410835256541184"
          },
          "notes": null,
          "environments": ["PRODUCTION"],
          "serviceTickets": null,
          "applicationServices": null,
          "aiRemediationAnalysis": null,
          "sourceRules": [
            {
              "id": "wc-id-3217",
              "tagsV2": [],
              "name": "Managed AI Agent with high privileges or sensitive data access",
              "query": { "_elided": "security-graph query body" },
              "type": "SECURITY_GRAPH",
              "enabled": true,
              "builtin": true,
              "severity": "MEDIUM",
              "createdBy": null,
              "sourceCloudConfigurationRule": null,
              "serviceTickets": [],
              "resolutionRecommendation": "###Identity and Permission Management\n*Apply least-privilege principles to the agent's service account\n*Remove or scope down IAM bindings that grant data access to sensitive resources\n*Use separate service accounts for agents requiring different levels of data access",
              "description": "This AI Agent operates under a principal with IAM permissions granting high privileges or data access to resources containing data findings (e.g., PII, credentials, confidential data).",
              "risks": ["UNPROTECTED_DATA", "AI_SECURITY"],
              "threats": [],
              "validatedAsExploitable": false
            }
          ],
          "privilegedActionRequests": null
        },
        {
          "id": "fc0226fa-7296-49d9-b863-acabf5b5b855",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2026-05-22T14:44:47.470684Z",
          "updatedAt": "2026-08-13T10:29:28.115209Z",
          "dueAt": "2026-08-20T14:44:47.470684Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "c4c815fb-70d0-5107-9d25-e5f17c889251",
              "name": "CS-INFRA-HIGHWAY",
              "slug": "cs-infra-highway",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "LBI" }
            },
            {
              "id": "e585c9d1-1723-5c9e-bbdc-47b0258c58aa",
              "name": "owner-CS-INFRA-HIGHWAY-cloud",
              "slug": "provisioning-cs-infra-highway",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "MBI" }
            }
          ],
          "assignee": null,
          "status": "OPEN",
          "severity": "MEDIUM",
          "entitySnapshot": {
            "id": "36341fba-70e0-5191-a266-df086d644148",
            "type": "AI_AGENT",
            "status": "Inactive",
            "name": "Gemini CLI",
            "cloudPlatform": "GCP",
            "region": "europe-west4",
            "subscriptionName": "sap-nonprod",
            "subscriptionId": "0667c757-490c-5dda-94cf-84d99cc3cbe1",
            "subscriptionExternalId": "sap-nonprod-xk4u",
            "nativeType": "hostedAiAgent",
            "kubernetesClusterId": null,
            "kubernetesClusterName": "",
            "kubernetesNamespaceName": "",
            "tags": { "Wiz/Domain": "SAP" },
            "resourceGroupId": null,
            "externalId": "CloudPlatform/VirtualMachine##8989096712799956790##Gemini CLI##NPM"
          },
          "notes": null,
          "environments": ["PRODUCTION"],
          "serviceTickets": null,
          "applicationServices": null,
          "aiRemediationAnalysis": null,
          "sourceRules": [
            {
              "id": "wc-id-3230",
              "tagsV2": [],
              "name": "AI Agent hosted on VM/serverless with high privileges or sensitive data access",
              "query": { "_elided": "security-graph query body" },
              "type": "SECURITY_GRAPH",
              "enabled": true,
              "builtin": true,
              "severity": "MEDIUM",
              "createdBy": null,
              "sourceCloudConfigurationRule": null,
              "serviceTickets": [],
              "resolutionRecommendation": "###Compute Identity Management\n*Apply least-privilege principles to the service account used by agent compute\n*Remove or scope down IAM bindings that grant data access to sensitive resources",
              "description": "This hosted AI Agent runs on compute infrastructure (container, VM, or serverless) operating under an identity with IAM permissions to access resources containing high or critical severity data findings.",
              "risks": ["UNPROTECTED_DATA", "AI_SECURITY"],
              "threats": [],
              "validatedAsExploitable": false
            }
          ],
          "privilegedActionRequests": null
        },
        {
          "id": "ea0706fd-edd8-4006-b400-b6a336d14bc3",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2026-04-08T04:23:50.845525Z",
          "updatedAt": "2026-08-13T10:30:01.04991Z",
          "dueAt": "2026-07-07T04:23:50.845525Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "deb2ab55-2b14-5a11-92d1-e2259a5f4635",
              "name": "CE-INNOVATION",
              "slug": "ce-innovation",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "LBI" }
            },
            {
              "id": "118b4659-51ac-5fd6-97ac-99deb051f08f",
              "name": "owner-CE-INNOVATION-cloud",
              "slug": "provisioning-ce-innovation",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "MBI" }
            }
          ],
          "assignee": null,
          "status": "OPEN",
          "severity": "MEDIUM",
          "entitySnapshot": {
            "id": "f78a372c-fff8-53b7-bc58-06556462ff42",
            "type": "AI_AGENT",
            "status": "Active",
            "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
            "cloudPlatform": "GCP",
            "region": "us-west1",
            "subscriptionName": "innovation-portfolio-hmjd",
            "subscriptionId": "71499e9f-2eed-532f-9b80-cbc5bca0d464",
            "subscriptionExternalId": "innovation-portfolio-hmjd",
            "nativeType": "aiplatform#ReasoningEngine",
            "kubernetesClusterId": null,
            "kubernetesClusterName": "",
            "kubernetesNamespaceName": "",
            "tags": {},
            "resourceGroupId": null,
            "externalId": "projects/1012702616935/locations/us-west1/reasoningEngines/4396973387755290624"
          },
          "notes": null,
          "environments": ["PRODUCTION"],
          "serviceTickets": [
            {
              "id": "f43621c3-32ac-4584-bbe7-7354bcc3b3e5",
              "externalId": "slackThread/T6U6X43D5/C0AGUF82MM1/1775622232.097139",
              "name": "Decathlon Digital (C0AGUF82MM1) - 1775622232.097139",
              "url": "https://decathlondigital.slack.com/archives/C0AGUF82MM1/p1775622232097139"
            }
          ],
          "applicationServices": null,
          "aiRemediationAnalysis": {
            "verdict": "REMEDIATE",
            "recommendedSeverity": "MEDIUM"
          },
          "sourceRules": [
            {
              "id": "wc-id-3217",
              "tagsV2": [],
              "name": "Managed AI Agent with high privileges or sensitive data access",
              "query": { "_elided": "security-graph query body" },
              "type": "SECURITY_GRAPH",
              "enabled": true,
              "builtin": true,
              "severity": "MEDIUM",
              "createdBy": null,
              "sourceCloudConfigurationRule": null,
              "serviceTickets": [],
              "resolutionRecommendation": "###Identity and Permission Management\n*Apply least-privilege principles to the agent's service account",
              "description": "This AI Agent operates under a principal with IAM permissions granting high privileges or data access to resources containing data findings.",
              "risks": ["UNPROTECTED_DATA", "AI_SECURITY"],
              "threats": [],
              "validatedAsExploitable": false
            }
          ],
          "privilegedActionRequests": null
        },
        {
          "id": "e0f2bf67-f2dc-48f6-86c4-c168615d1a1a",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2026-03-13T22:22:46.911524Z",
          "updatedAt": "2026-08-13T10:29:28.224635Z",
          "dueAt": "2026-06-11T22:22:46.911524Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "a85bfd9e-4ef1-5277-baf1-ec3162da515a",
              "name": "CS-RFID-SUPPLIER",
              "slug": "cs-rfid-supplier",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "LBI" }
            },
            {
              "id": "d8789c20-fc0c-52bb-9645-849864354bb7",
              "name": "owner-CS-RFID-SUPPLIER-cloud",
              "slug": "provisioning-cs-rfid-supplier",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "MBI" }
            }
          ],
          "assignee": null,
          "status": "OPEN",
          "severity": "MEDIUM",
          "entitySnapshot": {
            "id": "48906b02-7933-52bb-9826-e8d52563a7fd",
            "type": "SERVICE_ACCOUNT",
            "status": "Active",
            "name": "AWSReservedSSO_DKTFinopsAdministrator_781e09fd9eba825a",
            "cloudPlatform": "AWS",
            "region": "",
            "subscriptionName": "hpc068-rfidprodv2-prod",
            "subscriptionId": "1d1214c1-8da3-5073-8aea-d51dfa8840b9",
            "subscriptionExternalId": "540621235896",
            "nativeType": "role",
            "kubernetesClusterId": null,
            "kubernetesClusterName": "",
            "kubernetesNamespaceName": "",
            "tags": {},
            "resourceGroupId": null,
            "externalId": "arn:aws:iam::540621235896:role/aws-reserved/sso.amazonaws.com/eu-west-1/AWSReservedSSO_DKTFinopsAdministrator_781e09fd9eba825a"
          },
          "notes": null,
          "environments": ["PRODUCTION"],
          "serviceTickets": [
            {
              "id": "a0d3c700-1f69-4bb9-87cd-4b457998de7a",
              "externalId": "slackThread/T6U6X43D5/C0AGUF82MM1/1773440602.863019",
              "name": "Decathlon Digital (C0AGUF82MM1) - 1773440602.863019",
              "url": "https://decathlondigital.slack.com/archives/C0AGUF82MM1/p1773440602863019"
            }
          ],
          "applicationServices": null,
          "aiRemediationAnalysis": {
            "verdict": "REMEDIATE",
            "recommendedSeverity": "MEDIUM"
          },
          "sourceRules": [
            {
              "id": "wc-id-2742",
              "tagsV2": [],
              "name": "Allow model invoke without Guardrail for user or role",
              "query": { "_elided": "security-graph query body" },
              "type": "SECURITY_GRAPH",
              "enabled": true,
              "builtin": true,
              "severity": "MEDIUM",
              "createdBy": null,
              "sourceCloudConfigurationRule": null,
              "serviceTickets": [],
              "resolutionRecommendation": "### Attach guardrails to Bedrock Agents\n* Every Bedrock Agent should have a `guardrailConfiguration` attached.\n* Use `guardrailIdentifier` and `guardrailVersion` to specify the guardrail.",
              "description": "This user or role has permissions to invoke AI models without enforcing guardrails.",
              "risks": ["AI_SECURITY"],
              "threats": [],
              "validatedAsExploitable": false
            }
          ],
          "privilegedActionRequests": null
        },
        {
          "id": "be792ea6-2d2a-4e5a-8e64-10d0af928ced",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2025-07-23T00:53:27.769916Z",
          "updatedAt": "2026-08-13T10:29:28.224635Z",
          "dueAt": "2026-01-31T23:00:00Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "08d1f788-e90a-59f9-97f3-230b50b2149b",
              "name": "CE-DATA-TRANSPORT-CUSTOMS",
              "slug": "ce-data-transport-customs",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "LBI" }
            },
            {
              "id": "b805779e-2dc6-58ba-8a4b-768a16561299",
              "name": "project-dataltc-transportcustoms-dataplatform",
              "slug": "project-dataltc-transportcustoms-dataplatform",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "MBI" }
            }
          ],
          "assignee": null,
          "status": "OPEN",
          "severity": "MEDIUM",
          "entitySnapshot": {
            "id": "a7aa796e-420a-591e-8e57-9c38ce958a5e",
            "type": "SERVICE_ACCOUNT",
            "status": "Active",
            "name": "BIGDATA-LAMBDA-DATALTC-TRANSPORTCUSTOMS-PR",
            "cloudPlatform": "AWS",
            "region": "",
            "subscriptionName": "hpc027-ppfgbigdata-prod",
            "subscriptionId": "2e757db9-7d6a-5232-beb8-66fb68f644ce",
            "subscriptionExternalId": "585305677161",
            "nativeType": "role",
            "kubernetesClusterId": null,
            "kubernetesClusterName": "",
            "kubernetesNamespaceName": "",
            "tags": {
              "First-level-support": "CS-BIGDATA-TECH",
              "PROJECT": "dataltc-transportcustoms-prd",
              "Program": "dataltc-transportcustoms",
              "SUPPORT_GROUP": "CE-DATA-TRANSPORT-CUSTOMS",
              "Terraform": "true"
            },
            "resourceGroupId": null,
            "externalId": "arn:aws:iam::585305677161:role/BIGDATA-LAMBDA-DATALTC-TRANSPORTCUSTOMS-PR"
          },
          "notes": [
            {
              "id": "408e4277-e28b-42aa-a63a-b9fb3119e879",
              "text": "Status was updated to OPEN on 2026-02-01 as ignore date expired"
            },
            {
              "id": "6befcec1-cb61-4e94-bb21-90bae6f8a73d",
              "text": "Ignored (By Design) by MANSUY.\nExplanation: Reason: Guardrails Are Currently Ignored\n\nShort-term Implementation Gap (3-month window)\nGuardrails are not required during the initial communication phase with each project team.\n\nIgnored until: Feb 1, 2026"
            }
          ],
          "environments": ["PRODUCTION"],
          "serviceTickets": null,
          "applicationServices": null,
          "aiRemediationAnalysis": null,
          "sourceRules": [
            {
              "id": "wc-id-2742",
              "tagsV2": [],
              "name": "Allow model invoke without Guardrail for user or role",
              "query": { "_elided": "security-graph query body" },
              "type": "SECURITY_GRAPH",
              "enabled": true,
              "builtin": true,
              "severity": "MEDIUM",
              "createdBy": null,
              "sourceCloudConfigurationRule": null,
              "serviceTickets": [],
              "resolutionRecommendation": "### Attach guardrails to Bedrock Agents\n* Every Bedrock Agent should have a `guardrailConfiguration` attached.",
              "description": "This user or role has permissions to invoke AI models without enforcing guardrails.",
              "risks": ["AI_SECURITY"],
              "threats": [],
              "validatedAsExploitable": false
            }
          ],
          "privilegedActionRequests": null
        },
        {
          "id": "6934f5a0-6541-4eed-a496-76f8e9dc00c8",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2026-01-06T22:10:15.904327Z",
          "updatedAt": "2026-08-13T10:29:28.224635Z",
          "dueAt": "2026-04-06T22:10:15.904327Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "eabb651c-cc40-545a-89e0-6e7ef287a430",
              "name": "CS-DATA-DISPATCH-FULFILMENT",
              "slug": "cs-data-dispatch-fulfilment",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "LBI" }
            },
            {
              "id": "ef53cc6b-97c6-5d10-a593-c30658781d9e",
              "name": "project-aigen-weatherforecast-dataplatform",
              "slug": "project-aigen-weatherforecast-dataplatform",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": { "businessImpact": "MBI" }
            }
          ],
          "assignee": null,
          "status": "OPEN",
          "severity": "MEDIUM",
          "entitySnapshot": {
            "id": "74bd2210-ad0a-5fcc-ac84-f25c4b52b658",
            "type": "SERVICE_ACCOUNT",
            "status": "Active",
            "name": "BIGDATA-AI-AIGEN-WEATHERFORECAST-PP",
            "cloudPlatform": "AWS",
            "region": "",
            "subscriptionName": "hpc026-ppfgbigdata-preprod",
            "subscriptionId": "664ca06c-ee6f-5343-b62c-aba4c8ea3664",
            "subscriptionExternalId": "614303399241",
            "nativeType": "role",
            "kubernetesClusterId": null,
            "kubernetesClusterName": "",
            "kubernetesNamespaceName": "",
            "tags": {
              "First-level-support": "CS-BIGDATA-TECH",
              "PROJECT": "aigen-weatherforecast-ai-ppd",
              "Program": "aigen-weatherforecast",
              "SUPPORT_GROUP": "CS-DATA-DISPATCH-FULFILMENT",
              "TF_WORKSPACE": "BI-TECH/dataops-aigen-weatherforecast-ppd",
              "Terraform": "true",
              "map-migrated": "mig4XTV72XNXE"
            },
            "resourceGroupId": null,
            "externalId": "arn:aws:iam::614303399241:role/BIGDATA-AI-AIGEN-WEATHERFORECAST-PP"
          },
          "notes": null,
          "environments": ["PRODUCTION"],
          "serviceTickets": null,
          "applicationServices": null,
          "aiRemediationAnalysis": null,
          "sourceRules": [
            {
              "id": "wc-id-2742",
              "tagsV2": [],
              "name": "Allow model invoke without Guardrail for user or role",
              "query": { "_elided": "security-graph query body" },
              "type": "SECURITY_GRAPH",
              "enabled": true,
              "builtin": true,
              "severity": "MEDIUM",
              "createdBy": null,
              "sourceCloudConfigurationRule": null,
              "serviceTickets": [],
              "resolutionRecommendation": "### Attach guardrails to Bedrock Agents\n* Every Bedrock Agent should have a `guardrailConfiguration` attached.",
              "description": "This user or role has permissions to invoke AI models without enforcing guardrails.",
              "risks": ["AI_SECURITY"],
              "threats": [],
              "validatedAsExploitable": false
            }
          ],
          "privilegedActionRequests": null
        }
      ],
      "pageInfo": {
        "hasNextPage": true,
        "endCursor": "eyJmaWVsZHMiOlt7IkZpZWxkIjoiU2V2ZXJpdHkiLCJWYWx1ZSI6MjAwfSx7IkZpZWxkIjoiVmFsaWRhdGVkRXhwbG9pdGFibGUiLCJWYWx1ZSI6ZmFsc2V9LHsiRmllbGQiOiJDcmVhdGVkQXQiLCJWYWx1ZSI6IjIwMjUtMDYtMjhUMDE6MDk6MTkuOTIyMDMzWiJ9XX0="
      }
    }
  }
}
