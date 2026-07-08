{
  "data": {
    "issues": {
      "nodes": [
        {
          "id": "a5523624-7d66-438b-b53f-e6d9472b0f5c",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2026-06-24T04:04:04.354694Z",
          "updatedAt": "2026-07-08T11:21:57.950708Z",
          "dueAt": "2026-09-22T04:04:04.354694Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "slug": "cs-tetrix",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "slug": "value-chain",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
              "name": "shipperbox",
              "slug": "shipperbox",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "slug": "provisioning-cs-tetrix",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "MBI"
              }
            }
          ],
          "assignee": null,
          "status": "OPEN",
          "severity": "MEDIUM",
          "entitySnapshot": {
            "id": "6bc2694f-35e0-53d5-8f9d-59bc49694422",
            "type": "AI_AGENT",
            "status": "Active",
            "name": "StockBuddy",
            "cloudPlatform": "GCP",
            "region": "europe-west1",
            "subscriptionName": "shipperbox",
            "subscriptionId": "8cc292ad-4c44-51e0-a76c-7e923b745eb2",
            "subscriptionExternalId": "shipperbox-yt2h",
            "nativeType": "aiplatform#ReasoningEngine",
            "kubernetesClusterId": null,
            "kubernetesClusterName": "",
            "kubernetesNamespaceName": "",
            "tags": {},
            "resourceGroupId": null,
            "externalId": "projects/787922697915/locations/europe-west1/reasoningEngines/4870528647791902720"
          },
          "notes": null,
          "environments": [
            "PRODUCTION"
          ],
          "serviceTickets": null,
          "applicationServices": null,
          "sourceRules": [
            {
              "id": "wc-id-3217",
              "tagsV2": [],
              "name": "Managed AI Agent with high privileges or sensitive data access",
              "query": {
                "as": "scoped_entity",
                "relationships": [
                  {
                    "type": [
                      {
                        "type": "ACTING_AS"
                      }
                    ],
                    "with": {
                      "relationships": [
                        {
                          "optional": true,
                          "type": [
                            {
                              "reverse": true,
                              "type": "ENTITLES"
                            }
                          ],
                          "with": {
                            "blockExpanded": false,
                            "blockName": "Sensitive Data Access",
                            "relationships": [
                              {
                                "optional": true,
                                "type": [
                                  {
                                    "type": "ALLOWS_ACCESS_TO"
                                  }
                                ],
                                "with": {
                                  "relationships": [
                                    {
                                      "optional": true,
                                      "type": [
                                        {
                                          "type": "HAS_DATA_FINDING"
                                        }
                                      ],
                                      "with": {
                                        "select": true,
                                        "type": [
                                          "DATA_FINDING"
                                        ],
                                        "where": {
                                          "severity": {
                                            "EQUALS": [
                                              "DataFindingSeverityCritical",
                                              "DataFindingSeverityHigh"
                                            ]
                                          }
                                        }
                                      }
                                    }
                                  ],
                                  "select": true,
                                  "type": [
                                    "DATA_RESOURCE"
                                  ],
                                  "where": {
                                    "_or": [
                                      {
                                        "publicAccessTypes": {
                                          "IS_SET": false
                                        }
                                      },
                                      {
                                        "publicAccessTypes": {
                                          "LIST_DOES_NOT_CONTAIN_ANY": [
                                            "Data"
                                          ]
                                        }
                                      }
                                    ],
                                    "hasSensitiveData": {
                                      "EQUALS": true
                                    }
                                  }
                                }
                              }
                            ],
                            "type": [
                              "IAM_BINDING"
                            ],
                            "where": {
                              "accessTypes": {
                                "EQUALS": [
                                  "Data"
                                ]
                              }
                            }
                          }
                        },
                        {
                          "optional": true,
                          "type": [
                            {
                              "reverse": true,
                              "type": "ENTITLES"
                            }
                          ],
                          "with": {
                            "blockExpanded": false,
                            "blockName": "Has High Permissions",
                            "relationships": [
                              {
                                "optional": true,
                                "type": [
                                  {
                                    "type": "ALLOWS"
                                  }
                                ],
                                "with": {
                                  "select": true,
                                  "type": [
                                    "ACCESS_ROLE_PERMISSION"
                                  ],
                                  "where": {
                                    "accessTypes": {
                                      "EQUALS": [
                                        "HighPrivilege"
                                      ]
                                    }
                                  }
                                }
                              },
                              {
                                "optional": true,
                                "type": [
                                  {
                                    "type": "ALLOWS_ACCESS_TO"
                                  }
                                ],
                                "with": {
                                  "type": [
                                    "SUBSCRIPTION",
                                    "CLOUD_ORGANIZATION"
                                  ]
                                }
                              }
                            ],
                            "type": [
                              "IAM_BINDING"
                            ],
                            "where": {
                              "accessTypes": {
                                "EQUALS": [
                                  "HighPrivilege"
                                ]
                              }
                            }
                          }
                        }
                      ],
                      "select": true,
                      "type": [
                        "PRINCIPAL"
                      ],
                      "where": {
                        "_or": [
                          {
                            "hasAccessToSensitiveData": {
                              "EQUALS": true
                            }
                          },
                          {
                            "hasAdminPrivileges": {
                              "EQUALS": false
                            },
                            "hasHighPrivileges": {
                              "EQUALS": true
                            }
                          }
                        ]
                      }
                    }
                  }
                ],
                "select": true,
                "type": [
                  "AI_AGENT"
                ]
              },
              "type": "SECURITY_GRAPH",
              "enabled": true,
              "enabledForHBI": true,
              "enabledForLBI": true,
              "enabledForMBI": true,
              "enabledForUnattributed": true,
              "builtin": true,
              "severity": "MEDIUM",
              "createdBy": null,
              "sourceCloudConfigurationRule": null,
              "serviceTickets": [],
              "resolutionRecommendation": "###Identity and Permission Management\n*Apply least-privilege principles to the agent's service account\n*Remove or scope down IAM bindings that grant data access to sensitive resources\n*Use separate service accounts for agents requiring different levels of data access\n\n###Agent Configuration Controls\n*Restrict which tools and actions the agent can invoke\n*Implement guardrails to limit data access scope during agent execution\n*Validate that agent tools only access intended resources\n\n###Monitoring and Auditing\n*Enable logging for all data access by the agent's service account\n*Monitor for anomalous data access patterns or unexpected resource queries\n*Alert on attempts to access sensitive resources outside normal agent  workflows ",
              "description": "This AI Agent operates under a principal with IAM permissions granting high privileges or data access to resources containing data findings (e.g., PII, credentials, confidential data).\n\nAI Agents with high privileges or access to sensitive data resources may be exploited through prompt injection or tool manipulation to access and exfiltrate confidential information, leading to data breaches, unauthorized access, compliance violations, and significant security incidents.",
              "risks": [
                "UNPROTECTED_DATA",
                "AI_SECURITY"
              ],
              "threats": [],
              "validatedAsExploitable": false
            }
          ],
          "commentThread": {
            "id": "840db991-361e-513f-8189-632d6f1d719a",
            "hasComments": false
          },
          "privilegedActionRequests": null
        },
        {
          "id": "552a8fec-d4e9-409c-a2cc-009aeb524f58",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2026-06-20T18:37:07.003597Z",
          "updatedAt": "2026-07-08T11:21:57.950708Z",
          "dueAt": "2026-09-18T18:37:07.003597Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "slug": "cs-tetrix",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "slug": "value-chain",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
              "name": "shipperbox",
              "slug": "shipperbox",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "slug": "provisioning-cs-tetrix",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "MBI"
              }
            }
          ],
          "assignee": null,
          "status": "OPEN",
          "severity": "MEDIUM",
          "entitySnapshot": {
            "id": "d4b7a294-8700-57e3-ba01-cc43ef8c85dd",
            "type": "AI_AGENT",
            "status": "Active",
            "name": "Agent FCR to JSON Return",
            "cloudPlatform": "GCP",
            "region": "us-west1",
            "subscriptionName": "shipperbox",
            "subscriptionId": "8cc292ad-4c44-51e0-a76c-7e923b745eb2",
            "subscriptionExternalId": "shipperbox-yt2h",
            "nativeType": "aiplatform#ReasoningEngine",
            "kubernetesClusterId": null,
            "kubernetesClusterName": "",
            "kubernetesNamespaceName": "",
            "tags": {},
            "resourceGroupId": null,
            "externalId": "projects/787922697915/locations/us-west1/reasoningEngines/2742630600417476608"
          },
          "notes": null,
          "environments": [
            "PRODUCTION"
          ],
          "serviceTickets": null,
          "applicationServices": null,
          "sourceRules": [
            {
              "id": "wc-id-3217",
              "tagsV2": [],
              "name": "Managed AI Agent with high privileges or sensitive data access",
              "query": {
                "as": "scoped_entity",
                "relationships": [
                  {
                    "type": [
                      {
                        "type": "ACTING_AS"
                      }
                    ],
                    "with": {
                      "relationships": [
                        {
                          "optional": true,
                          "type": [
                            {
                              "reverse": true,
                              "type": "ENTITLES"
                            }
                          ],
                          "with": {
                            "blockExpanded": false,
                            "blockName": "Sensitive Data Access",
                            "relationships": [
                              {
                                "optional": true,
                                "type": [
                                  {
                                    "type": "ALLOWS_ACCESS_TO"
                                  }
                                ],
                                "with": {
                                  "relationships": [
                                    {
                                      "optional": true,
                                      "type": [
                                        {
                                          "type": "HAS_DATA_FINDING"
                                        }
                                      ],
                                      "with": {
                                        "select": true,
                                        "type": [
                                          "DATA_FINDING"
                                        ],
                                        "where": {
                                          "severity": {
                                            "EQUALS": [
                                              "DataFindingSeverityCritical",
                                              "DataFindingSeverityHigh"
                                            ]
                                          }
                                        }
                                      }
                                    }
                                  ],
                                  "select": true,
                                  "type": [
                                    "DATA_RESOURCE"
                                  ],
                                  "where": {
                                    "_or": [
                                      {
                                        "publicAccessTypes": {
                                          "IS_SET": false
                                        }
                                      },
                                      {
                                        "publicAccessTypes": {
                                          "LIST_DOES_NOT_CONTAIN_ANY": [
                                            "Data"
                                          ]
                                        }
                                      }
                                    ],
                                    "hasSensitiveData": {
                                      "EQUALS": true
                                    }
                                  }
                                }
                              }
                            ],
                            "type": [
                              "IAM_BINDING"
                            ],
                            "where": {
                              "accessTypes": {
                                "EQUALS": [
                                  "Data"
                                ]
                              }
                            }
                          }
                        },
                        {
                          "optional": true,
                          "type": [
                            {
                              "reverse": true,
                              "type": "ENTITLES"
                            }
                          ],
                          "with": {
                            "blockExpanded": false,
                            "blockName": "Has High Permissions",
                            "relationships": [
                              {
                                "optional": true,
                                "type": [
                                  {
                                    "type": "ALLOWS"
                                  }
                                ],
                                "with": {
                                  "select": true,
                                  "type": [
                                    "ACCESS_ROLE_PERMISSION"
                                  ],
                                  "where": {
                                    "accessTypes": {
                                      "EQUALS": [
                                        "HighPrivilege"
                                      ]
                                    }
                                  }
                                }
                              },
                              {
                                "optional": true,
                                "type": [
                                  {
                                    "type": "ALLOWS_ACCESS_TO"
                                  }
                                ],
                                "with": {
                                  "type": [
                                    "SUBSCRIPTION",
                                    "CLOUD_ORGANIZATION"
                                  ]
                                }
                              }
                            ],
                            "type": [
                              "IAM_BINDING"
                            ],
                            "where": {
                              "accessTypes": {
                                "EQUALS": [
                                  "HighPrivilege"
                                ]
                              }
                            }
                          }
                        }
                      ],
                      "select": true,
                      "type": [
                        "PRINCIPAL"
                      ],
                      "where": {
                        "_or": [
                          {
                            "hasAccessToSensitiveData": {
                              "EQUALS": true
                            }
                          },
                          {
                            "hasAdminPrivileges": {
                              "EQUALS": false
                            },
                            "hasHighPrivileges": {
                              "EQUALS": true
                            }
                          }
                        ]
                      }
                    }
                  }
                ],
                "select": true,
                "type": [
                  "AI_AGENT"
                ]
              },
              "type": "SECURITY_GRAPH",
              "enabled": true,
              "enabledForHBI": true,
              "enabledForLBI": true,
              "enabledForMBI": true,
              "enabledForUnattributed": true,
              "builtin": true,
              "severity": "MEDIUM",
              "createdBy": null,
              "sourceCloudConfigurationRule": null,
              "serviceTickets": [],
              "resolutionRecommendation": "###Identity and Permission Management\n*Apply least-privilege principles to the agent's service account\n*Remove or scope down IAM bindings that grant data access to sensitive resources\n*Use separate service accounts for agents requiring different levels of data access\n\n###Agent Configuration Controls\n*Restrict which tools and actions the agent can invoke\n*Implement guardrails to limit data access scope during agent execution\n*Validate that agent tools only access intended resources\n\n###Monitoring and Auditing\n*Enable logging for all data access by the agent's service account\n*Monitor for anomalous data access patterns or unexpected resource queries\n*Alert on attempts to access sensitive resources outside normal agent  workflows ",
              "description": "This AI Agent operates under a principal with IAM permissions granting high privileges or data access to resources containing data findings (e.g., PII, credentials, confidential data).\n\nAI Agents with high privileges or access to sensitive data resources may be exploited through prompt injection or tool manipulation to access and exfiltrate confidential information, leading to data breaches, unauthorized access, compliance violations, and significant security incidents.",
              "risks": [
                "UNPROTECTED_DATA",
                "AI_SECURITY"
              ],
              "threats": [],
              "validatedAsExploitable": false
            }
          ],
          "commentThread": {
            "id": "568509b0-38a2-5860-9132-0d0cf6cd8a38",
            "hasComments": false
          },
          "privilegedActionRequests": null
        },
        {
          "id": "33504749-eeb2-4186-ac95-1815f8630615",
          "type": "TOXIC_COMBINATION",
          "resolutionNote": null,
          "resolvedAt": null,
          "resolutionReason": null,
          "resolvedBy": null,
          "createdAt": "2026-06-20T18:37:07.003597Z",
          "updatedAt": "2026-07-08T11:21:57.950708Z",
          "dueAt": "2026-09-18T18:37:07.003597Z",
          "rejectionExpiredAt": null,
          "validatedAsExploitable": false,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "slug": "cs-tetrix",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "slug": "value-chain",
              "isFolder": true,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
              "name": "shipperbox",
              "slug": "shipperbox",
              "isFolder": false,
              "businessUnit": "",
              "riskProfile": {
                "businessImpact": "LBI"
              }
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "slug": "provisioning-cs-tetrix",