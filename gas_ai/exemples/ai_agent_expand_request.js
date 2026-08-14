/*
 * The Wiz console's per-entity graph expansion for one AI agent, captured 2026-08-14 and
 * scrubbed of tenant identifiers. Paired with exemples/ai_agent_expand_response.js.
 *
 * The traversal below was NOT hand-copied into this file: it is the output of
 * toGraphEntityQuery(AGENT_EXPANSION, agentId) from src/domain/graphExpand.ts, which is
 * how that module's spec tree is shown to reproduce the console's query. The same tree
 * also yields the 43-entry slot list the response's
 * positional entities array is decoded against — one literal, so the query and the decoder
 * cannot drift.
 *
 * Q_AGENT_EXPANSION in src/server/wizQueriesAi.ts sends this same `query` value as a
 * $query variable, but asks for gas_ai's curated ENTITY_FIELDS rather than the console's
 * `properties` blob, and leaves the exposure/lateral-movement @include flags off.
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
      "AI_AGENT"
    ],
    "select": true,
    "where": {
      "_vertexID": {
        "EQUALS": "11111111-1111-5111-a111-111111111111"
      }
    },
    "relationships": [
      {
        "type": [
          {
            "type": "ACTING_AS"
          }
        ],
        "with": {
          "type": [
            "PRINCIPAL"
          ],
          "select": true,
          "relationships": [
            {
              "type": [
                {
                  "type": "CONTAINS"
                }
              ],
              "with": {
                "type": [
                  "EXCESSIVE_ACCESS_FINDING"
                ],
                "select": true
              },
              "optional": true
            }
          ]
        },
        "optional": true
      },
      {
        "type": [
          {
            "type": "READS_DATA_FROM"
          }
        ],
        "with": {
          "type": [
            "AI_DATASET",
            "BUCKET"
          ],
          "select": true,
          "relationships": [
            {
              "type": [
                {
                  "type": "READS_DATA_FROM"
                }
              ],
              "with": {
                "type": [
                  "BUCKET",
                  "DATABASE"
                ],
                "select": true,
                "relationships": [
                  {
                    "type": [
                      {
                        "type": "HAS_DATA_FINDING"
                      }
                    ],
                    "with": {
                      "type": [
                        "DATA_FINDING"
                      ],
                      "select": true
                    },
                    "optional": true
                  }
                ]
              },
              "optional": true
            },
            {
              "type": [
                {
                  "type": "HAS_DATA_FINDING"
                }
              ],
              "with": {
                "type": [
                  "DATA_FINDING"
                ],
                "select": true
              },
              "optional": true
            }
          ]
        },
        "optional": true
      },
      {
        "type": [
          {
            "type": "STORES_DATA_IN"
          }
        ],
        "with": {
          "type": [
            "BUCKET"
          ],
          "select": true,
          "relationships": [
            {
              "type": [
                {
                  "type": "HAS_DATA_FINDING"
                }
              ],
              "with": {
                "type": [
                  "DATA_FINDING"
                ],
                "select": true
              },
              "optional": true
            }
          ]
        },
        "optional": true
      },
      {
        "type": [
          {
            "type": "USES"
          }
        ],
        "with": {
          "type": [
            "AI_TOOL"
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
                  "SERVERLESS",
                  "WEB_SERVICE"
                ],
                "select": true,
                "relationships": [
                  {
                    "type": [
                      {
                        "type": "ACTING_AS"
                      }
                    ],
                    "with": {
                      "type": [
                        "SERVICE_ACCOUNT"
                      ],
                      "select": true,
                      "relationships": [
                        {
                          "type": [
                            {
                              "type": "ENTITLES",
                              "reverse": true
                            }
                          ],
                          "with": {
                            "type": [
                              "IAM_BINDING"
                            ],
                            "where": {
                              "accessTypes": {
                                "EQUALS": [
                                  "Data"
                                ]
                              }
                            },
                            "relationships": [
                              {
                                "type": [
                                  {
                                    "type": "ALLOWS_ACCESS_TO"
                                  }
                                ],
                                "with": {
                                  "type": [
                                    "DATA_RESOURCE"
                                  ],
                                  "select": true,
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
                                  },
                                  "relationships": [
                                    {
                                      "type": [
                                        {
                                          "type": "HAS_DATA_FINDING"
                                        }
                                      ],
                                      "with": {
                                        "type": [
                                          "DATA_FINDING"
                                        ],
                                        "select": true,
                                        "where": {
                                          "severity": {
                                            "EQUALS": [
                                              "DataFindingSeverityCritical",
                                              "DataFindingSeverityHigh"
                                            ]
                                          }
                                        }
                                      },
                                      "optional": true
                                    }
                                  ]
                                },
                                "optional": true
                              }
                            ]
                          },
                          "optional": true
                        }
                      ]
                    },
                    "optional": true
                  },
                  {
                    "type": [
                      {
                        "type": "ACTING_AS"
                      }
                    ],
                    "with": {
                      "type": [
                        "PRINCIPAL"
                      ],
                      "select": true
                    },
                    "optional": true
                  },
                  {
                    "type": [
                      {
                        "type": "INVOKES"
                      }
                    ],
                    "with": {
                      "type": [
                        "AI_AGENT"
                      ],
                      "select": true
                    },
                    "optional": true
                  }
                ]
              },
              "optional": true
            }
          ]
        },
        "optional": true
      },
      {
        "type": [
          {
            "type": "USES"
          }
        ],
        "with": {
          "type": [
            "AI_MODEL",
            "AI_SERVICE"
          ],
          "select": true,
          "relationships": [
            {
              "type": [
                {
                  "type": "USES"
                }
              ],
              "with": {
                "type": [
                  "AI_MODEL"
                ],
                "select": true,
                "relationships": [
                  {
                    "type": [
                      {
                        "type": "PROTECTS",
                        "reverse": true
                      }
                    ],
                    "with": {
                      "type": [
                        "AI_GUARDRAIL"
                      ],
                      "select": true
                    },
                    "optional": true
                  },
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
                      "select": true
                    },
                    "optional": true
                  },
                  {
                    "type": [
                      {
                        "type": "ACTING_AS"
                      }
                    ],
                    "with": {
                      "type": [
                        "PRINCIPAL"
                      ],
                      "select": true,
                      "relationships": [
                        {
                          "type": [
                            {
                              "type": "ALERTED_ON",
                              "reverse": true
                            }
                          ],
                          "with": {
                            "type": [
                              "EXCESSIVE_ACCESS_FINDING"
                            ],
                            "select": true
                          },
                          "optional": true
                        }
                      ]
                    },
                    "optional": true
                  }
                ]
              },
              "optional": true
            },
            {
              "type": [
                {
                  "type": "PRODUCES",
                  "reverse": true
                }
              ],
              "with": {
                "type": [
                  "AI_PIPELINE"
                ],
                "select": true,
                "relationships": [
                  {
                    "type": [
                      {
                        "type": "USES"
                      }
                    ],
                    "with": {
                      "type": [
                        "AI_MODEL"
                      ],
                      "select": true
                    },
                    "optional": true
                  },
                  {
                    "type": [
                      {
                        "type": "READS_DATA_FROM"
                      }
                    ],
                    "with": {
                      "type": [
                        "AI_DATASET",
                        "BUCKET"
                      ],
                      "select": true,
                      "relationships": [
                        {
                          "type": [
                            {
                              "type": "READS_DATA_FROM"
                            }
                          ],
                          "with": {
                            "type": [
                              "BUCKET",
                              "DATABASE"
                            ],
                            "select": true
                          },
                          "optional": true
                        }
                      ]
                    },
                    "optional": true
                  }
                ]
              },
              "optional": true
            }
          ]
        },
        "optional": true
      },
      {
        "type": [
          {
            "type": "PROTECTS",
            "reverse": true
          }
        ],
        "with": {
          "type": [
            "AI_GUARDRAIL"
          ],
          "select": true,
          "relationships": [
            {
              "type": [
                {
                  "type": "ALERTED_ON",
                  "reverse": true
                }
              ],
              "with": {
                "type": [
                  "CONFIGURATION_FINDING"
                ],
                "select": true
              },
              "optional": true
            }
          ]
        },
        "optional": true
      },
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
          "select": true
        },
        "optional": true
      },
      {
        "type": [
          {
            "type": "ALERTED_ON",
            "reverse": true
          }
        ],
        "with": {
          "type": [
            "CONFIGURATION_FINDING"
          ],
          "select": true
        },
        "optional": true
      },
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
            "SERVERLESS",
            "CONTAINER_IMAGE"
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
                "select": true
              },
              "optional": true
            },
            {
              "type": [
                {
                  "type": "ACTING_AS"
                }
              ],
              "with": {
                "type": [
                  "SERVICE_ACCOUNT"
                ],
                "select": true,
                "relationships": [
                  {
                    "type": [
                      {
                        "type": "ENTITLES",
                        "reverse": true
                      }
                    ],
                    "with": {
                      "type": [
                        "IAM_BINDING"
                      ],
                      "where": {
                        "accessTypes": {
                          "EQUALS": [
                            "Data"
                          ]
                        }
                      },
                      "relationships": [
                        {
                          "type": [
                            {
                              "type": "ALLOWS_ACCESS_TO"
                            }
                          ],
                          "with": {
                            "type": [
                              "DATA_RESOURCE"
                            ],
                            "select": true,
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
                            },
                            "relationships": [
                              {
                                "type": [
                                  {
                                    "type": "HAS_DATA_FINDING"
                                  }
                                ],
                                "with": {
                                  "type": [
                                    "DATA_FINDING"
                                  ],
                                  "select": true,
                                  "where": {
                                    "severity": {
                                      "EQUALS": [
                                        "DataFindingSeverityCritical",
                                        "DataFindingSeverityHigh"
                                      ]
                                    }
                                  }
                                },
                                "optional": true
                              }
                            ]
                          },
                          "optional": true
                        }
                      ]
                    },
                    "optional": true
                  }
                ]
              },
              "optional": true
            },
            {
              "type": [
                {
                  "type": "INSTANCE_OF",
                  "reverse": true
                }
              ],
              "with": {
                "type": [
                  "CONTAINER"
                ],
                "select": true,
                "relationships": [
                  {
                    "type": [
                      {
                        "type": "CONTAINS",
                        "reverse": true
                      }
                    ],
                    "with": {
                      "type": [
                        "DEPLOYMENT"
                      ],
                      "select": true,
                      "relationships": [
                        {
                          "type": [
                            {
                              "type": "CONTAINS",
                              "reverse": true
                            }
                          ],
                          "with": {
                            "type": [
                              "KUBERNETES_CLUSTER"
                            ],
                            "select": true,
                            "relationships": [
                              {
                                "type": [
                                  {
                                    "type": "ACTING_AS"
                                  }
                                ],
                                "with": {
                                  "type": [
                                    "SERVICE_ACCOUNT"
                                  ],
                                  "select": true,
                                  "relationships": [
                                    {
                                      "type": [
                                        {
                                          "type": "ENTITLES",
                                          "reverse": true
                                        }
                                      ],
                                      "with": {
                                        "type": [
                                          "IAM_BINDING"
                                        ],
                                        "select": true,
                                        "relationships": [
                                          {
                                            "type": [
                                              {
                                                "type": "ALLOWS_ACCESS_TO"
                                              }
                                            ],
                                            "with": {
                                              "type": [
                                                "DATA_RESOURCE"
                                              ],
                                              "select": true
                                            },
                                            "optional": true
                                          }
                                        ]
                                      },
                                      "optional": true
                                    }
                                  ]
                                },
                                "optional": true
                              }
                            ]
                          },
                          "optional": true
                        }
                      ]
                    },
                    "optional": true
                  }
                ]
              },
              "optional": true
            }
          ]
        },
        "optional": true
      },
      {
        "type": [
          {
            "type": "USES"
          }
        ],
        "with": {
          "type": [
            "MCP_SERVER"
          ],
          "select": true,
          "relationships": [
            {
              "type": [
                {
                  "type": "EXPOSES"
                }
              ],
              "with": {
                "type": [
                  "AI_TOOL"
                ],
                "select": true
              },
              "optional": true
            }
          ]
        },
        "optional": true
      }
    ]
  },
  "projectId": "bbbbbbbb-bbbb-5bbb-bbbb-bbbbbbbbbbbb"
};
