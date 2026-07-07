Here are the production-ready GraphQL queries for **Human Identity → AI Asset Access**:

---

## 4. 👤 Human Identity → AI Asset Access

### 4.1 — Users/Roles with Write or Admin Access to AI Agents

```graphql
query IdentitiesWithAccessToAIAgents(
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
          type: "ALLOWS_ACCESS_TO"
          direction: INBOUND
          with: {
            type: "ACCESS_ROLE_BINDING"
            select: false
            relationships: [
              {
                type: "BOUND_TO"
                with: {
                  type: ["USER_ACCOUNT", "SERVICE_ACCOUNT"]
                  select: true
                }
              }
              {
                type: "PERMITS_ACCESS_ROLE"
                with: {
                  type: "ACCESS_ROLE"
                  select: true
                  where: {
                    accessType: {
                      EQUALS: ["HIGH_PRIVILEGE", "ADMIN"]
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
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
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

### 4.2 — Inactive Users with Access to AI Agents

```graphql
query InactiveUsersWithAIAgentAccess(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "USER_ACCOUNT"
      select: true
      where: {
        lastActivity: {
          BEFORE: "now-90d"
        }
      }
      relationships: [
        {
          type: "ALLOWS_ACCESS_TO"
          with: {
            type: "AI_AGENT"
            select: true
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
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
        }
      }
    }
  }
}
```

---

### 4.3 — Users WITHOUT MFA Who Have Access to AI Agents

```graphql
query NoMFAUsersWithAIAgentAccess(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "USER_ACCOUNT"
      select: true
      where: {
        mfaEnabled: { EQUALS: false }
      }
      relationships: [
        {
          type: "ALLOWS_ACCESS_TO"
          with: {
            type: "AI_AGENT"
            select: true
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
        ... on CloudResource {
          status
          lastSeen
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
        }
      }
    }
  }
}
```

---

### 4.4 — External / Third-Party Identities with Access to AI Agents

```graphql
query ExternalIdentitiesWithAIAgentAccess(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "USER_ACCOUNT"
      select: true
      where: {
        isExternal: { EQUALS: true }
      }
      relationships: [
        {
          type: "ALLOWS_ACCESS_TO"
          with: {
            type: "AI_AGENT"
            select: true
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
        ... on CloudResource {
          status
          lastSeen
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
        }
      }
    }
  }
}
```

---

### 4.5 — Service Accounts with Admin/High Privileges Running AI Agents

```graphql
query PrivilegedServiceAccountsRunningAIAgents(
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
        ... on CloudResource {
          status
          firstSeen
          lastSeen
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

### 4.6 — Service Accounts Running AI Agents with Excessive Access Findings

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
        ... on CloudResource {
          status
          firstSeen
          lastSeen
          hasAdminPrivileges
          hasHighPrivileges
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
        }
      }
    }
  }
}
```

---

### 4.7 — Users Who Can Modify AI Agent Source Code Buckets

```graphql
query UsersWithWriteAccessToAIAgentCodeBuckets(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "BUCKET"
      select: true
      where: {
        tag: {
          key: "purpose"
          value: { EQUALS: "ai-agent-code" }
        }
      }
      relationships: [
        {
          type: "ALLOWS_ACCESS_TO"
          direction: INBOUND
          with: {
            type: ["USER_ACCOUNT", "SERVICE_ACCOUNT"]
            select: true
            where: {
              accessType: {
                EQUALS: ["WRITE", "ADMIN"]
              }
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
        ... on CloudResource {
          status
          isOpenToAllInternet
          hasSensitiveData
          cloudAccount { id name cloudProvider }
          projects { id name }
        }
      }
    }
  }
}
```

---

### 4.8 — Combined High-Risk: Inactive + No MFA + AI Agent Access

```graphql
query HighRiskIdentitiesWithAIAgentAccess(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "USER_ACCOUNT"
      select: true
      where: {
        OR: [
          {
            AND: [
              { mfaEnabled: { EQUALS: false } }
              { hasHighPrivileges: { EQUALS: true } }
            ]
          }
          {
            AND: [
              { lastActivity: { BEFORE: "now-90d" } }
              { hasHighPrivileges: { EQUALS: true } }
            ]
          }
        ]
      }
      relationships: [
        {
          type: "ALLOWS_ACCESS_TO"
          with: {
            type: "AI_AGENT"
            select: true
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
        ... on CloudResource {
          status
          lastSeen
          hasHighPrivileges
          hasAdminPrivileges
          cloudAccount { id name cloudProvider externalId }
          projects { id name }
        }
      }
    }
  }
}
```

---

## 📋 Query Summary — Human Identity → AI Asset Access

| Query | What it finds | OWASP Mapping | AARS Impact |
|---|---|---|---|
| 4.1 | Users/roles with **write/admin** access to AI agents | ASI03 Identity Abuse, LLM06 | Pillar B +10 |
| 4.2 | **Inactive users** (90d+) with AI agent access | ASI03, ISO 42001 A.9 | Pillar B +10 |
| 4.3 | Users with **no MFA** who can access AI agents | ASI03, 5Rs Restrict | Pillar B +10 |
| 4.4 | **External/third-party** identities with AI agent access | ASI04 Supply Chain, ASI03 | Pillar B +10 |
| 4.5 | Service accounts with **admin/high privileges** running agents | LLM06 Excessive Agency, ASI03 | Pillar A +20 |
| 4.6 | Service accounts with **excessive access findings** running agents | LLM06, wc-id-3123 | Pillar A +20 |
| 4.7 | Users with **write access to AI agent code buckets** | ASI04, LLM04 Data Poisoning | Pillar B +10 |
| 4.8 | **Combined**: inactive + no MFA + high privilege + AI access | ASI03, ASI09 Trust Exploitation | Pillar A+B +30 |

---

## ⚠️ Key Notes

| Point | Detail |
|---|---|
| **`ALLOWS_ACCESS_TO`** | Primary IAM edge in Wiz graph — connects identities to resources they can access |
| **`RUNS_AS`** | Connects AI_AGENT → SERVICE_ACCOUNT — the execution identity |
| **`lastActivity: { BEFORE: "now-90d" }`** | Relative date filter — adjust threshold as needed (30d, 60d, 90d) |
| **`mfaEnabled: false`** | Available on `USER_ACCOUNT` nodes — not on `SERVICE_ACCOUNT` |
| **`accessType`** | Filter on the relationship edge — values: `READ`, `WRITE`, `ADMIN`, `HIGH_PRIVILEGE` |
| **`quick: true`** | Recommended for large tenants — trades completeness for speed |
| **Query 4.8 priority** | This is your **highest-value** query — combines 3 risk factors in one shot |
| **Your env relevance** | `AWSReservedSSO_FinanceAdmin` roles (8 issues) are prime candidates for 4.1 and 4.5 |