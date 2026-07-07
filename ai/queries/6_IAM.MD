Here are the production-ready GraphQL queries for **IAM Over-Privilege (Pillar A + C combined)**:

---

## 6. 🔑 IAM Over-Privilege — Pillar A + C Combined

### 6.1 — AI Agents with High or Admin Privileges (Pre-computed Flag)

Fastest query — uses Wiz's pre-computed IAM analysis flags:

```graphql
query AIAgentsWithHighPrivileges(
  $first: Int
  $after: String
) {
  cloudResourcesV2(
    first: $first
    after: $after
    filterBy: {
      type: ["AI_AGENT"]
      hasHighPrivileges: { equals: true }
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      type
      nativeType
      cloudPlatform
      region
      status
      firstSeen
      lastSeen
      isAccessibleFromInternet
      hasAccessToSensitiveData
      hasAdminPrivileges
      hasHighPrivileges
      hasSensitiveData
      externalId
      cloudAccount { id name externalId cloudProvider }
      projects { id name businessImpact }
      tags { key value }
    }
  }
}
```

**Variables:**

```json
{ "first": 100, "after": null }
```

**Variant — Admin privileges only:**

```json
{
  "first": 100,
  "filterBy": {
    "type": ["AI_AGENT"],
    "hasAdminPrivileges": { "equals": true }
  }
}
```

---

### 6.2 — AI Agent → Service Account → Excessive Access Finding

Full graph path — agent execution identity flagged by Wiz CIEM for unused permissions:

```graphql
query AIAgentServiceAccountExcessiveAccess(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "AI_AGENT"
      select: true
      relationships: [
        {
          type: "RUNS_AS"
          with: {
            type: "SERVICE_ACCOUNT"
            select: true
            relationships: [
              {
                type: "HAS_FINDING"
                with: {
                  type: "EXCESSIVE_ACCESS_FINDING"
                  select: true
                }
              }
            ]
          }
        }
      ]
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      entities {
        id
        name
        type
        nativeType
        cloudPlatform
        region
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          isAccessibleFromInternet
          hasAccessToSensitiveData
          hasAdminPrivileges
          hasHighPrivileges
          cloudAccount { id name cloudProvider externalId }
          projects { id name businessImpact }
          tags { key value }
        }
      }
    }
  }
}
```

**Variables:**

```json
{
  "quick": true,
  "first": 100,
  "after": null
}
```

---

### 6.3 — AI Agent → Service Account → Sensitive Data Resource (Full IAM Chain)

Traces the complete privilege chain from agent to sensitive data:

```graphql
query AIAgentFullPrivilegeChainToSensitiveData(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "AI_AGENT"
      select: true
      relationships: [
        {
          type: "RUNS_AS"
          with: {
            type: "SERVICE_ACCOUNT"
            select: true
            where: {
              OR: [
                { hasAdminPrivileges: { EQUALS: true } }
                { hasHighPrivileges: { EQUALS: true } }
              ]
            }
            relationships: [
              {
                type: "ALLOWS_ACCESS_TO"
                with: {
                  type: [
                    "BUCKET"
                    "DATABASE"
                    "DATABASE_SERVER"
                    "VIRTUAL_MACHINE"
                  ]
                  select: true
                  where: {
                    hasSensitiveData: { EQUALS: true }
                  }
                }
              }
            ]
          }
        }
      ]
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      entities {
        id
        name
        type
        nativeType
        cloudPlatform
        region
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          isAccessibleFromInternet
          hasAdminPrivileges
          hasHighPrivileges
          hasAccessToSensitiveData
          hasSensitiveData
          cloudAccount { id name cloudProvider externalId }
          projects { id name businessImpact }
          tags { key value }
        }
      }
    }
  }
}
```

---

### 6.4 — AI Agent Using Lambda Tool with Excessive Permissions

AWS-specific — Bedrock agents invoking Lambda functions with over-privileged IAM:

```graphql
query AIAgentLambdaToolExcessivePermissions(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "AI_AGENT"
      select: true
      relationships: [
        {
          type: "USES"
          with: {
            type: "SERVERLESS"
            select: true
            where: {
              OR: [
                { hasAdminPrivileges: { EQUALS: true } }
                { hasHighPrivileges: { EQUALS: true } }
              ]
            }
          }
        }
      ]
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      entities {
        id
        name
        type
        nativeType
        cloudPlatform
        region
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          hasAdminPrivileges
          hasHighPrivileges
          hasAccessToSensitiveData
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
          tags { key value }
        }
      }
    }
  }
}
```

---

### 6.5 — AI Agent with Overly Permissive Execution Identity (wc-id-3123)

Directly maps to your 2 LOW severity issues (`agent-J`, `agent-K`):

```graphql
query AIAgentsOverlyPermissiveIdentity(
  $first: Int
  $after: String
) {
  cloudResourcesV2(
    first: $first
    after: $after
    filterBy: {
      type: ["AI_AGENT"]
      relatedIssue: {
        sourceRuleId: {
          equals: ["wc-id-3123"]
        }
        status: { equals: ["OPEN"] }
      }
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      type
      nativeType
      cloudPlatform
      region
      status
      firstSeen
      lastSeen
      hasAdminPrivileges
      hasHighPrivileges
      hasAccessToSensitiveData
      externalId
      cloudAccount { id name externalId cloudProvider }
      projects { id name businessImpact }
      tags { key value }
    }
  }
}
```

---

### 6.6 — AI Agent Service Account with Cross-Account / Cross-Subscription Access

Detects agents whose identity can access resources in OTHER cloud accounts — lateral movement risk:

```graphql
query AIAgentCrossAccountPrivileges(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "AI_AGENT"
      select: true
      relationships: [
        {
          type: "RUNS_AS"
          with: {
            type: "SERVICE_ACCOUNT"
            select: true
            relationships: [
              {
                type: "ALLOWS_ACCESS_TO"
                with: {
                  type: ["BUCKET", "DATABASE", "VIRTUAL_MACHINE"]
                  select: true
                  where: {
                    cloudAccount: {
                      id: {
                        notEquals: "SAME_ACCOUNT"
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      entities {
        id
        name
        type
        nativeType
        cloudPlatform
        region
        ... on CloudResource {
          status
          hasAdminPrivileges
          hasHighPrivileges
          hasAccessToSensitiveData
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
        }
      }
    }
  }
}
```

---

### 6.7 — AI Agent Service Account with Lateral Movement Path to Admin

Detects agents whose execution identity has a lateral movement path to admin privileges:

```graphql
query AIAgentLateralMovementToAdmin(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "AI_AGENT"
      select: true
      relationships: [
        {
          type: "RUNS_AS"
          with: {
            type: "SERVICE_ACCOUNT"
            select: true
            relationships: [
              {
                type: "HAS_FINDING"
                with: {
                  type: "LATERAL_MOVEMENT_FINDING"
                  select: true
                }
              }
            ]
          }
        }
      ]
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      entities {
        id
        name
        type
        nativeType
        cloudPlatform
        region
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          hasAdminPrivileges
          hasHighPrivileges
          hasAccessToSensitiveData
          cloudAccount { id name cloudProvider externalId }
          projects { id name businessImpact }
          tags { key value }
        }
      }
    }
  }
}
```

---

### 6.8 — IAM Roles Invoking Bedrock Without Guardrail (wc-id-2742 Full Detail)

Your 8 AWS issues — full detail with role ARN and account:

```graphql
query BedrockRolesNoGuardrailDetail(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "SERVICE_ACCOUNT"
      select: true
      where: {
        cloudPlatform: { EQUALS: "AWS" }
        nativeType: { EQUALS: "role" }
      }
      relationships: [
        {
          type: "ALLOWS_ACCESS_TO"
          with: {
            type: "AI_MODEL"
            select: true
            where: {
              cloudPlatform: { EQUALS: "AWS" }
            }
          }
        }
      ]
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      entities {
        id
        name
        type
        nativeType
        cloudPlatform
        region
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          hasAdminPrivileges
          hasHighPrivileges
          externalId
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
          tags { key value }
        }
      }
    }
  }
}
```

---

### 6.9 — Combined Highest Risk: High Privilege + Sensitive Data + No Guardrail

The single most important query for AARS — all three Pillar A+C risk factors combined:

```graphql
query AIAgentTripleRisk(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "AI_AGENT"
      select: true
      where: {
        AND: [
          { hasHighPrivileges: { EQUALS: true } }
          { hasAccessToSensitiveData: { EQUALS: true } }
        ]
      }
      relationships: [
        {
          type: "PROTECTED_BY"
          with: {
            type: "AI_GUARDRAIL"
            select: false
          }
          negate: true
        }
      ]
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      entities {
        id
        name
        type
        nativeType
        cloudPlatform
        region
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          isAccessibleFromInternet
          hasAdminPrivileges
          hasHighPrivileges
          hasAccessToSensitiveData
          cloudAccount { id name cloudProvider externalId }
          projects { id name businessImpact }
          tags { key value }
        }
      }
    }
  }
}
```

---

## 📋 Query Summary — IAM Over-Privilege (Pillar A + C)

| Query | What it finds | Control Mapped | AARS Impact |
|---|---|---|---|
| 6.1 | Agents with `hasHighPrivileges = true` (pre-computed) | `wc-id-3217`, `wc-id-3230` | A +20, C +20 |
| 6.2 | Agent → SA → **Excessive Access Finding** | `wc-id-3123` | A +20 |
| 6.3 | Agent → SA (high priv) → **Sensitive resource** | `wc-id-3217`, `wc-id-3230` | A +20, C +20 |
| 6.4 | Agent → Lambda tool → **excessive permissions** | `wc-id-2878` | A +20 |
| 6.5 | Agents with open `wc-id-3123` issue | `wc-id-3123` | A +8 (LOW) |
| 6.6 | Agent SA with **cross-account** access | ASI03, LLM06 | A +25 |
| 6.7 | Agent SA with **lateral movement** path to admin | ASI03, ASI05 | A +30 |
| 6.8 | AWS roles invoking Bedrock **without guardrail** | `wc-id-2742` | A +20, B +10 |
| 6.9 | **Triple risk**: high priv + sensitive data + no guardrail | All pillars | A+B+C = +50 |

---

## 🎯 Priority Execution Order

```
1. Run 6.9  → triple risk combo — any result = immediate CRITICAL AARS
             → your env: all 27 MEDIUM issues likely appear here

2. Run 6.1  → fastest baseline — all high-privilege agents
             → use hasAdminPrivileges variant for admin-only subset

3. Run 6.3  → full IAM chain detail for confirmed risky agents
             → maps directly to wc-id-3217 and wc-id-3230

4. Run 6.2  → excessive access findings on service accounts
             → maps to wc-id-3123 (agent-J, agent-K)

5. Run 6.7  → lateral movement paths
             → escalates LOW issues to effective HIGH

6. Run 6.8  → Bedrock roles without guardrail
             → maps to your 8 AWS wc-id-2742 issues

7. Run 6.4  → Lambda tool over-privilege
             → AWS-specific, maps to wc-id-2878

8. Run 6.6  → cross-account access
             → most complex, run last
```

---

## ⚠️ Key Notes

| Point | Detail |
|---|---|
| **`hasHighPrivileges`** | Pre-computed by Wiz IAM analysis — covers both direct and inherited permissions |
| **`hasAdminPrivileges`** | Subset of `hasHighPrivileges` — wildcard or subscription-level permissions |
| **`RUNS_AS`** | Primary edge connecting AI_AGENT → SERVICE_ACCOUNT execution identity |
| **`HAS_FINDING` → `EXCESSIVE_ACCESS_FINDING`** | CIEM finding — Wiz analyzed actual usage vs granted permissions |
| **`HAS_FINDING` → `LATERAL_MOVEMENT_FINDING`** | Attack path finding — privilege escalation route exists |
| **Query 6.9** | Most valuable single query for AARS — combines all three risk dimensions |
| **Your env** | `agent-J` and `agent-K` → query 6.2 and 6.5; all 13 GCP managed agents → query 6.3 |
| **`quick: true`** | Recommended for all graph queries — prevents timeout on large tenants |
| **Pillar weighting** | High privilege (A) + sensitive data (C) together = 70% of AARS score — this query set covers both |