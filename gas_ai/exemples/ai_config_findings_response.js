{
  "data": {
    "configurationFindings": {
      "nodes": [
        {
          "id": "49df7b5b-062f-553d-bac5-0973ed9920a6",
          "name": "Vertex AI Metadata Store is not encrypted with a customer-managed key",
          "deleted": false,
          "analyzedAt": "2026-07-07T15:59:10.110596369Z",
          "firstSeenAt": "2026-07-07T15:59:28.164073Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
          "source": "WIZ_CSPM",
          "targetExternalId": "vc-smp-innovation-stg-t5zy/europe-west1",
          "ignoreRules": null,
          "subscription": {
            "id": "5158ac86-8442-5dd0-baaf-fcd13456eed8",
            "cloudProvider": "GCP",
            "name": "vc-smp-innovation-stg-t5zy",
            "externalId": "vc-smp-innovation-stg-t5zy",
            "sourceDeployments": [
              {
                "id": "9fbbd355-3b03-4c3b-ba09-a9bf66fe594b",
                "name": "gcp-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "aa675813-9c5c-581a-a3d1-eaaddbe05282",
            "name": "europe-west1 (vc-smp-innovation-stg-t5zy)",
            "type": "REGION",
            "status": "Active",
            "projects": [
              {
                "id": "13991eea-38da-5fbe-8503-282de383f44f",
                "name": "provisioning-CE-INDUS-SUPPLY",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              },
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "d8dbfd47-bd02-54a6-aed3-f167779aedd8",
                "name": "CE-INDUS-SUPPLY",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "60442ee5-452a-48cb-8694-9061c920e10d",
            "shortId": "SUB-082",
            "graphId": "d354eff1-2df7-5e21-80c5-19489a284f00",
            "name": "Vertex AI Metadata Store should be encrypted with a customer-managed key",
            "description": "This rule checks whether the Vertex AI Metadata Store is encrypted with a customer-managed key.  \nThis rule fails if `kms_key_name` is not configured.  \nEncrypting the Vertex AI Metadata Store with a customer-managed key provides additional control over the encryption keys used to secure data, enhancing data security and compliance with regulatory requirements.\n>**Note**  \n>GCP Vertex AI Metadata Store encryption configuration can be set only during the creation process.   \n",
            "remediationInstructions": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
            "risks": [
              "AI_SECURITY",
              "UNPROTECTED_DATA"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result = \"pass\"\n\nresult = \"skip\" {\n\tis_null(input.vertexAIMetadataStoreConfiguration)\n} else = \"fail\" {\n\tnot input.vertexAIMetadataStoreConfiguration.encryption_spec.kms_key_name\n}\n\ncurrentConfiguration := \"'kms_key_name' is not configured\"\nexpectedConfiguration := \"'kms_key_name' should be configured\""
          }
        },
        {
          "id": "0f27cb54-215e-5a36-a9ca-1224886ad3ce",
          "name": "Vertex AI Metadata Store is not encrypted with a customer-managed key",
          "deleted": false,
          "analyzedAt": "2026-06-23T21:01:05.927113953Z",
          "firstSeenAt": "2026-06-23T21:01:17.695684Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
          "source": "WIZ_CSPM",
          "targetExternalId": "packstory-e1kf/europe-west1",
          "ignoreRules": null,
          "subscription": {
            "id": "e9611b7a-2041-5862-b896-10a497cc1eeb",
            "cloudProvider": "GCP",
            "name": "packstory-e1kf",
            "externalId": "packstory-e1kf",
            "sourceDeployments": [
              {
                "id": "9fbbd355-3b03-4c3b-ba09-a9bf66fe594b",
                "name": "gcp-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "4fd52007-ec29-5da0-b707-f480fc5b5582",
            "name": "europe-west1 (packstory-e1kf)",
            "type": "REGION",
            "status": "Active",
            "projects": [
              {
                "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "name": "CS-TETRIX",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
                "name": "provisioning-CS-TETRIX",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "60442ee5-452a-48cb-8694-9061c920e10d",
            "shortId": "SUB-082",
            "graphId": "d354eff1-2df7-5e21-80c5-19489a284f00",
            "name": "Vertex AI Metadata Store should be encrypted with a customer-managed key",
            "description": "This rule checks whether the Vertex AI Metadata Store is encrypted with a customer-managed key.  \nThis rule fails if `kms_key_name` is not configured.  \nEncrypting the Vertex AI Metadata Store with a customer-managed key provides additional control over the encryption keys used to secure data, enhancing data security and compliance with regulatory requirements.\n>**Note**  \n>GCP Vertex AI Metadata Store encryption configuration can be set only during the creation process.   \n",
            "remediationInstructions": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
            "risks": [
              "AI_SECURITY",
              "UNPROTECTED_DATA"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result = \"pass\"\n\nresult = \"skip\" {\n\tis_null(input.vertexAIMetadataStoreConfiguration)\n} else = \"fail\" {\n\tnot input.vertexAIMetadataStoreConfiguration.encryption_spec.kms_key_name\n}\n\ncurrentConfiguration := \"'kms_key_name' is not configured\"\nexpectedConfiguration := \"'kms_key_name' should be configured\""
          }
        },
        {
          "id": "5d96c65b-1751-5e49-8dc3-02761091766f",
          "name": "Vertex AI Metadata Store is not encrypted with a customer-managed key",
          "deleted": false,
          "analyzedAt": "2026-06-19T10:27:23.07498382Z",
          "firstSeenAt": "2026-06-12T19:42:35.348482Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
          "source": "WIZ_CSPM",
          "targetExternalId": "packaging-data-55fy/europe-west4",
          "ignoreRules": null,
          "subscription": {
            "id": "1894e556-5353-5bbc-bcc3-4a60b98464cc",
            "cloudProvider": "GCP",
            "name": "packaging-data-55fy",
            "externalId": "packaging-data-55fy",
            "sourceDeployments": [
              {
                "id": "9fbbd355-3b03-4c3b-ba09-a9bf66fe594b",
                "name": "gcp-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "d1582112-4890-5cf2-a9fa-94906b2edb01",
            "name": "europe-west4 (packaging-data-55fy)",
            "type": "REGION",
            "status": "Active",
            "projects": [
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "8c15c43d-7249-5591-a9e3-e9b26f041885",
                "name": "provisioning-LU-PACKAGING-BU",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              },
              {
                "id": "d774f04d-c0f8-5d3e-9034-43be92a276db",
                "name": "LU-PACKAGING-BU",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "60442ee5-452a-48cb-8694-9061c920e10d",
            "shortId": "SUB-082",
            "graphId": "d354eff1-2df7-5e21-80c5-19489a284f00",
            "name": "Vertex AI Metadata Store should be encrypted with a customer-managed key",
            "description": "This rule checks whether the Vertex AI Metadata Store is encrypted with a customer-managed key.  \nThis rule fails if `kms_key_name` is not configured.  \nEncrypting the Vertex AI Metadata Store with a customer-managed key provides additional control over the encryption keys used to secure data, enhancing data security and compliance with regulatory requirements.\n>**Note**  \n>GCP Vertex AI Metadata Store encryption configuration can be set only during the creation process.   \n",
            "remediationInstructions": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
            "risks": [
              "AI_SECURITY",
              "UNPROTECTED_DATA"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result = \"pass\"\n\nresult = \"skip\" {\n\tis_null(input.vertexAIMetadataStoreConfiguration)\n} else = \"fail\" {\n\tnot input.vertexAIMetadataStoreConfiguration.encryption_spec.kms_key_name\n}\n\ncurrentConfiguration := \"'kms_key_name' is not configured\"\nexpectedConfiguration := \"'kms_key_name' should be configured\""
          }
        },
        {
          "id": "71f52567-cc5a-5241-8528-fa8ea2cf311a",
          "name": "Vertex AI Metadata Store is not encrypted with a customer-managed key",
          "deleted": false,
          "analyzedAt": "2026-06-19T10:27:22.601690657Z",
          "firstSeenAt": "2026-06-12T19:42:35.275935Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
          "source": "WIZ_CSPM",
          "targetExternalId": "packaging-data-55fy/europe-west1",
          "ignoreRules": null,
          "subscription": {
            "id": "1894e556-5353-5bbc-bcc3-4a60b98464cc",
            "cloudProvider": "GCP",
            "name": "packaging-data-55fy",
            "externalId": "packaging-data-55fy",
            "sourceDeployments": [
              {
                "id": "9fbbd355-3b03-4c3b-ba09-a9bf66fe594b",
                "name": "gcp-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "cc87c492-d826-5e6f-9e0e-7314d7073f97",
            "name": "europe-west1 (packaging-data-55fy)",
            "type": "REGION",
            "status": "Active",
            "projects": [
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "8c15c43d-7249-5591-a9e3-e9b26f041885",
                "name": "provisioning-LU-PACKAGING-BU",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              },
              {
                "id": "d774f04d-c0f8-5d3e-9034-43be92a276db",
                "name": "LU-PACKAGING-BU",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "60442ee5-452a-48cb-8694-9061c920e10d",
            "shortId": "SUB-082",
            "graphId": "d354eff1-2df7-5e21-80c5-19489a284f00",
            "name": "Vertex AI Metadata Store should be encrypted with a customer-managed key",
            "description": "This rule checks whether the Vertex AI Metadata Store is encrypted with a customer-managed key.  \nThis rule fails if `kms_key_name` is not configured.  \nEncrypting the Vertex AI Metadata Store with a customer-managed key provides additional control over the encryption keys used to secure data, enhancing data security and compliance with regulatory requirements.\n>**Note**  \n>GCP Vertex AI Metadata Store encryption configuration can be set only during the creation process.   \n",
            "remediationInstructions": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
            "risks": [
              "AI_SECURITY",
              "UNPROTECTED_DATA"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result = \"pass\"\n\nresult = \"skip\" {\n\tis_null(input.vertexAIMetadataStoreConfiguration)\n} else = \"fail\" {\n\tnot input.vertexAIMetadataStoreConfiguration.encryption_spec.kms_key_name\n}\n\ncurrentConfiguration := \"'kms_key_name' is not configured\"\nexpectedConfiguration := \"'kms_key_name' should be configured\""
          }
        },
        {
          "id": "8f488b7d-75e5-52bc-a165-cbe12e1849d1",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:37:28.087642157Z",
          "firstSeenAt": "2026-03-25T11:22:06.228067Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::606734290611:policy/NetworkOwnerPermissionBoundary \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::606734290611:policy/NetworkOwnerPermissionBoundary",
          "ignoreRules": null,
          "subscription": {
            "id": "2ac4d4da-2bf5-5e65-820b-74ea44b405b7",
            "cloudProvider": "AWS",
            "name": "hpc407-logtech-sandbox-archi",
            "externalId": "606734290611",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "0adffb9e-fcfe-52d8-ae8c-4942713d2306",
            "name": "NetworkOwnerPermissionBoundary",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "9bea2317-0e1f-5de0-bd03-7879383635bc",
                "name": "provisioning-FORCED-VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              },
              {
                "id": "b9983deb-f3ba-51c1-873a-c696ce8cad46",
                "name": "FORCED-VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "2443be1e-c445-5247-8ec0-d4ea309dd24c",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:40:33.671489794Z",
          "firstSeenAt": "2026-03-25T11:21:50.138748Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::874276771045:policy/NetworkOwnerPermissionBoundary \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::874276771045:policy/NetworkOwnerPermissionBoundary",
          "ignoreRules": null,
          "subscription": {
            "id": "130585b0-0594-5f24-b81b-1b507e80d9ca",
            "cloudProvider": "AWS",
            "name": "hpc109-inix",
            "externalId": "874276771045",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "07afd24a-d8c9-5f79-be1d-57c8c257ce36",
            "name": "NetworkOwnerPermissionBoundary",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "name": "CS-TETRIX",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
                "name": "provisioning-CS-TETRIX",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "ced6efdb-5a2b-5d93-bf4d-e70a918caf13",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:36:07.150619048Z",
          "firstSeenAt": "2026-03-25T11:21:43.756196Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::469022461258:policy/NetworkOwnerPermissionBoundary \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::469022461258:policy/NetworkOwnerPermissionBoundary",
          "ignoreRules": null,
          "subscription": {
            "id": "8795d7a5-fa5c-594c-8adf-5138ae7f8b33",
            "cloudProvider": "AWS",
            "name": "hpc395-rfidprod-staging",
            "externalId": "469022461258",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "3d99aa28-01ab-5f6a-b5e8-caec531a9361",
            "name": "NetworkOwnerPermissionBoundary",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "a85bfd9e-4ef1-5277-baf1-ec3162da515a",
                "name": "CS-RFID-SUPPLIER",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "d8789c20-fc0c-52bb-9645-849864354bb7",
                "name": "provisioning-CS-RFID-SUPPLIER",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "ab2bbf1b-a95a-5a8e-9433-170befecdbc7",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:36:28.885509302Z",
          "firstSeenAt": "2026-03-25T11:20:48.805101Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::864981714133:policy/NetworkOwnerPermissionBoundary \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::864981714133:policy/NetworkOwnerPermissionBoundary",
          "ignoreRules": null,
          "subscription": {
            "id": "98798005-198a-56de-9ce8-7a3c5397b862",
            "cloudProvider": "AWS",
            "name": "hpc998-kronos-poc",
            "externalId": "864981714133",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "e86bcd29-f2bb-53b6-bd4b-34c9c55fa417",
            "name": "NetworkOwnerPermissionBoundary",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "1ba14696-9710-5ad1-8230-d4e501da1827",
                "name": "CE-FORECAST-UNITED",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "c7344251-92e2-5a18-b75d-4d5440eea7c3",
                "name": "provisioning-CE-FORECAST-UNITED",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "58ec5350-62d0-5327-bf32-9a15daaf7485",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:38:24.747588533Z",
          "firstSeenAt": "2026-03-25T11:20:28.23842Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::854940831191:policy/NetworkOwnerPermissionBoundary \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::854940831191:policy/NetworkOwnerPermissionBoundary",
          "ignoreRules": null,
          "subscription": {
            "id": "f6ea921b-8657-5c32-889f-0a4e47184867",
            "cloudProvider": "AWS",
            "name": "hpc423-rfidprod-prod",
            "externalId": "854940831191",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "a8bfd15b-1a8f-5cec-998c-c415bd42608f",
            "name": "NetworkOwnerPermissionBoundary",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "a85bfd9e-4ef1-5277-baf1-ec3162da515a",
                "name": "CS-RFID-SUPPLIER",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "d8789c20-fc0c-52bb-9645-849864354bb7",
                "name": "provisioning-CS-RFID-SUPPLIER",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "cfedc320-57e2-5ecc-88fa-e9fa2f148f3f",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:37:26.223542954Z",
          "firstSeenAt": "2026-03-25T11:20:16.495976Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::604532548553:policy/NetworkOwnerPermissionBoundary \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::604532548553:policy/NetworkOwnerPermissionBoundary",
          "ignoreRules": null,
          "subscription": {
            "id": "4747761e-958e-506f-a70f-ce12f7c13701",
            "cloudProvider": "AWS",
            "name": "hpc394-brf-switch-prod",
            "externalId": "604532548553",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "1c3bb0d8-8124-5172-8332-1002d8ca00b2",
            "name": "NetworkOwnerPermissionBoundary",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "name": "CS-TETRIX",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
                "name": "provisioning-CS-TETRIX",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "0164fdac-a7a9-5207-b524-64b01f099ba1",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:36:17.83099236Z",
          "firstSeenAt": "2026-03-25T11:18:54.177971Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::072835807254:policy/NetworkOwnerPermissionBoundary \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::072835807254:policy/NetworkOwnerPermissionBoundary",
          "ignoreRules": null,
          "subscription": {
            "id": "15c73f3d-dd7b-5005-bc81-9aa87167fe90",
            "cloudProvider": "AWS",
            "name": "hpc393-brf-switch-preprod",
            "externalId": "072835807254",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "6c9f8f4a-d1c6-52b2-b445-02f4d600ac5f",
            "name": "NetworkOwnerPermissionBoundary",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "name": "CS-TETRIX",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
                "name": "provisioning-CS-TETRIX",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "7952e34b-487d-56e7-a7a5-2f1a3e0d6635",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:36:24.723278543Z",
          "firstSeenAt": "2026-03-25T11:18:07.608933Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::540621235896:policy/AccountAdmin \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::540621235896:policy/AccountAdmin",
          "ignoreRules": null,
          "subscription": {
            "id": "1d1214c1-8da3-5073-8aea-d51dfa8840b9",
            "cloudProvider": "AWS",
            "name": "hpc068-rfidprodv2-prod",
            "externalId": "540621235896",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "74ca247a-9804-5d65-923d-880623386331",
            "name": "AccountAdmin",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "a85bfd9e-4ef1-5277-baf1-ec3162da515a",
                "name": "CS-RFID-SUPPLIER",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "d8789c20-fc0c-52bb-9645-849864354bb7",
                "name": "provisioning-CS-RFID-SUPPLIER",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "dc8a5364-0966-5562-b592-1f89189fedf4",
          "name": "IAM policy allows Bedrock model invocation without guardrail condition",
          "deleted": false,
          "analyzedAt": "2026-06-19T06:36:03.076419339Z",
          "firstSeenAt": "2026-03-25T11:17:53.258544Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn arn:aws:iam::540621235896:policy/NetworkOwnerPermissionBoundary \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
          "source": "WIZ_CSPM",
          "targetExternalId": "arn:aws:iam::540621235896:policy/NetworkOwnerPermissionBoundary",
          "ignoreRules": null,
          "subscription": {
            "id": "1d1214c1-8da3-5073-8aea-d51dfa8840b9",
            "cloudProvider": "AWS",
            "name": "hpc068-rfidprodv2-prod",
            "externalId": "540621235896",
            "sourceDeployments": [
              {
                "id": "dff41f4f-c0c0-4039-808e-2390d5b55e49",
                "name": "aws-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "resource": {
            "id": "eb72b2ca-3e13-573d-a2d8-468aee9f0a47",
            "name": "NetworkOwnerPermissionBoundary",
            "type": "RAW_ACCESS_POLICY",
            "status": null,
            "projects": [
              {
                "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "name": "VALUE-CHAIN",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "a85bfd9e-4ef1-5277-baf1-ec3162da515a",
                "name": "CS-RFID-SUPPLIER",
                "riskProfile": {
                  "businessImpact": "LBI"
                }
              },
              {
                "id": "d8789c20-fc0c-52bb-9645-849864354bb7",
                "name": "provisioning-CS-RFID-SUPPLIER",
                "riskProfile": {
                  "businessImpact": "MBI"
                }
              }
            ]
          },
          "sourceMappedIacFindings": null,
          "rule": {
            "id": "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
            "shortId": "IAM-267",
            "graphId": "becce3e9-81e3-59d5-8c4e-672008f0c934",
            "name": "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
            "description": "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions.  \nThis rule fails if a policy statement contains:\n* `Effect` is set to `Allow`\n* `Action` includes Bedrock invoke actions (`bedrock:invokemodel`, `bedrock:invokemodelwithresponsestream`, `bedrock:*`, or `*`)\n* `Resource` includes foundation models (containing patterns like `anthropic.claude`, `nova`, `titan`, etc., or `*`)\n* No `Condition` with `GuardrailIdentifier` is specified\n* No separate `Deny` statement exists in the same policy that enforces a `GuardrailIdentifier` condition on all Bedrock invoke actions with `Resource: *`\n\nA policy is considered compliant if it includes a `Deny` statement that covers all Bedrock invoke actions (`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, or `bedrock:*`/`*`) with `Resource: *` and a `GuardrailIdentifier` condition (e.g., `StringNotEquals`), since Deny always overrides Allow in AWS IAM and effectively enforces guardrail usage.\n\nAmazon Bedrock foundation models can process sensitive data and generate potentially harmful content. Using guardrails helps enforce security controls, content filtering, and usage policies when invoking these models. It is recommended to always specify guardrail conditions in IAM policies that grant Bedrock model invocation permissions to ensure proper governance and risk management of AI/ML workloads.\n",
            "remediationInstructions": "Perform the following command to update the IAM policy to include guardrail conditions for Bedrock model invocation via AWS CLI:\n```\naws iam create-policy-version \\\n    --policy-arn {{policyArn}} \\\n    --set-as-default \\\n    --policy-document '{\n    \"Version\": \"2012-10-17\",\n    \"Statement\": [\n        {\n            \"Effect\": \"Allow\",\n            \"Action\": [\n                \"bedrock:InvokeModel\",\n                \"bedrock:InvokeModelWithResponseStream\"\n            ],\n            \"Resource\": \"*\",\n            \"Condition\": {\n                \"StringEquals\": {\n                    \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\"\n                }\n            }\n        }\n    ]\n}'\n```\n\n>**Note**\n>* Replace <YOUR_GUARDRAIL_ID> with the ID of your Bedrock guardrail.\n>* The guardrail must be created and configured in Amazon Bedrock before it can be referenced in the policy.\n>* Make sure to review and include any other necessary permissions in your policy document.\n>* The policy above is a basic example. You might want to restrict the Resource field to specific model ARNs instead of using \"*\".",
            "risks": [
              "AI_SECURITY"
            ],
            "threats": null,
            "tags": null,
            "opaPolicy": "package wiz\n\ndefault result := \"pass\"\n\n# Models that require guardrail protection\nmodelPatterns := [\n    \"anthropic.claude\",\n    \"nova\",\n    \"titan\",\n    \"command\",\n    \"deepseek\",\n    \"llama\",\n    \"mistral\",\n    \"palmyra\",\n    \"foundation-model\"\n]\n\n# Check if action is a Bedrock invoke action (when Action is an array)\nisBedrockInvokeAction(statement) {\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodel\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}\n\n# Check if action is a Bedrock invoke action (when Action is a string)\nisBedrockInvokeAction(statement) {\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodel\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:invokemodelwithresponsestream\"\n}{\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}\n\n# Check if resource targets foundation models (when Resource is an array)\ntargetsFoundationModel(statement) {\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}{\n    is_array(statement.Resource)\n    resource := statement.Resource[_]\n    contains(lower(resource), modelPatterns[_])\n}\n\n# Check if resource targets foundation models (when Resource is a string)\ntargetsFoundationModel(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_string(statement.Resource)\n    contains(lower(statement.Resource), modelPatterns[_])\n}\n\n# Check if statement has guardrail condition\nhasGuardrailCondition(statement) {\n    statement.Condition != null\n    conditionJson := json.marshal(statement.Condition)\n    contains(lower(conditionJson), \"guardrailidentifier\")\n}\n\n# Check if statement targets all resources (Resource is \"*\")\ntargetsAllResources(statement) {\n    is_string(statement.Resource)\n    statement.Resource == \"*\"\n}{\n    is_array(statement.Resource)\n    statement.Resource[_] == \"*\"\n}\n\n# Check if a Deny statement covers ALL Bedrock invoke actions.\n# Unlike isBedrockInvokeAction (which matches ANY invoke action), this requires\n# the statement to cover both InvokeModel and InvokeModelWithResponseStream,\n# either via a wildcard (\"*\" or \"bedrock:*\") or by listing both actions explicitly.\ncoversAllBedrockInvokeActions(statement) {\n    is_string(statement.Action)\n    statement.Action == \"*\"\n}{\n    is_string(statement.Action)\n    lower(statement.Action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    statement.Action[_] == \"*\"\n}{\n    is_array(statement.Action)\n    action := statement.Action[_]\n    lower(action) == \"bedrock:*\"\n}{\n    is_array(statement.Action)\n    invokeModel := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodel\"]\n    count(invokeModel) > 0\n    invokeStream := [a | a := statement.Action[_]; lower(a) == \"bedrock:invokemodelwithresponsestream\"]\n    count(invokeStream) > 0\n}\n\n# Check if a Deny statement covers Bedrock invoke actions with a guardrail condition.\n# A Deny with a guardrail condition (e.g. StringNotEquals on GuardrailIdentifier)\n# effectively enforces guardrail usage, since Deny overrides Allow in AWS IAM.\n# The Deny must:\n# - target all resources (\"*\") to ensure full coverage\n# - cover ALL Bedrock invoke actions (not just one of them)\nhasDenyGuardrailForInvokeActions {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"deny\"\n    coversAllBedrockInvokeActions(stmt)\n    targetsAllResources(stmt)\n    hasGuardrailCondition(stmt)\n}\n\n# Find statements that allow Bedrock invocation without guardrail\nviolatingStatements[stmt] {\n    stmt := input.Statement[_]\n    lower(stmt.Effect) == \"allow\"\n\n    isBedrockInvokeAction(stmt)\n    targetsFoundationModel(stmt)\n\n    not hasGuardrailCondition(stmt)\n    not hasDenyGuardrailForInvokeActions\n}\n\nresult := \"fail\" {\n    count(violatingStatements) > 0\n}\n\ncurrentConfiguration := \"Found statements allowing Bedrock model invocation without guardrails\"\nexpectedConfiguration := \"Bedrock InvokeModel permissions should include GuardrailIdentifier condition\"\n"
          }
        },
        {
          "id": "4d7a5db3-0458-5eb9-8bfb-7042c5a62d64",
          "name": "Vertex AI Metadata Store is not encrypted with a customer-managed key",
          "deleted": false,
          "analyzedAt": "2026-06-19T10:17:38.28437891Z",
          "firstSeenAt": "2026-03-24T15:19:49.039653Z",
          "severity": "MEDIUM",
          "result": "FAIL",
          "status": "OPEN",
          "remediation": "This action is not available via GCP CLI. \nFollow the following links:   \n>**Note**  \n>Before deleting the current Vertex AI Metadata Store, consider extracting its data since it will be deleted permanently.  \n\n1. [Delete](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.metadataStores/delete) the current Vertex AI Metadata Store.\n2. [Create](https://cloud.google.com/vertex-ai/docs/ml-metadata/configure) a new Vertex AI Metadata Store, encrypted with a customer-managed key.",
          "source": "WIZ_CSPM",
          "targetExternalId": "innovation-portfolio-hmjd/europe-west9",
          "ignoreRules": null,
          "subscription": {
            "id": "71499e9f-2eed-532f-9b80-cbc5bca0d464",
            "cloudProvider": "GCP",
            "name": "innovation-portfolio-hmjd",
            "externalId": "innovation-portfolio-hmjd",
            "sourceDeployments": [
              {
                "id": "9fbbd355-3b03-4c3b-ba09-a9bf66fe594b",
                "name": "gcp-main-org",
                "status": "ENABLED"
              }
            ]
          },
          "res