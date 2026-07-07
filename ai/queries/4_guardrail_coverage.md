Here are the production-ready GraphQL queries for **Guardrail Coverage (Pillar B)**:

---

## 4. 🛡️ Guardrail Coverage — Pillar B Queries

### 4.1 — AI Agents with `hasAccessToSensitiveData` and No Guardrail (Fastest)

Uses pre-computed flags — no graph traversal needed:

```graphql
query AIAgentsSensitiveDataNoGuardrailFlag(
  $first: Int
  $after: String
) {
  cloudResourcesV2(
    first: $first
    after: $after
    filterBy: {
      type: ["AI_AGENT"]
      hasAccessToSensitiveData: { equals: true }
      relatedIssue: {
        sourceRuleId: {
          equals: [
            "wc-id-3039"
          ]
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
      isAccessibleFromInternet
      hasAccessToSensitiveData
      hasAdminPrivileges
      hasHighPrivileges
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

---

### 4.2 — All AI Agents Without Any Guardrail (Graph Traversal)

Core graph query — finds agents with no `PROTECTED_BY` edge to any guardrail:

```graphql
query AIAgentsWithoutGuardrail(
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

### 4.3 — Privileged AI Agents Without Guardrail

High-priority subset — privileged agents with no guardrail:

```graphql
query PrivilegedAIAgentsWithoutGuardrail(
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
        OR: [
          { hasAdminPrivileges: { EQUALS: true } }
          { hasHighPrivileges: { EQUALS: true } }
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

### 4.4 — AWS Bedrock Agents Without Guardrail

AWS-specific — Bedrock agents with no guardrail configuration:

```graphql
query BedrockAgentsWithoutGuardrail(
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
        cloudPlatform: { EQUALS: "AWS" }
        nativeType: { EQUALS: "bedrock#agent" }
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

### 4.5 — GCP Vertex AI Agents Without Guardrail

GCP-specific — Vertex AI ReasoningEngine agents with no guardrail:

```graphql
query VertexAIAgentsWithoutGuardrail(
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
        cloudPlatform: { EQUALS: "GCP" }
        nativeType: { EQUALS: "aiplatform#ReasoningEngine" }
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

### 4.6 — IAM Roles Invoking AI Models Without Guardrail (AWS Bedrock)

Covers the `wc-id-2742` pattern — roles bypassing guardrails on model invocation:

```graphql
query IAMRolesInvokingModelsWithoutGuardrail(
  $first: Int
  $after: String
) {
  cloudResourcesV2(
    first: $first
    after: $after
    filterBy: {
      type: ["SERVICE_ACCOUNT"]
      cloudPlatform: { equals: ["AWS"] }
      relatedIssue: {
        sourceRuleId: {
          equals: ["wc-id-2742"]
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
      hasAdminPrivileges
      hasHighPrivileges
      externalId
      cloudAccount { id name externalId cloudProvider }
      projects { id name }
      tags { key value }
    }
  }
}
```

---

### 4.7 — AI Agents with Guardrail Misconfiguration (Output Filtering Disabled)

Finds agents where guardrail exists but output filtering is broken — maps to `wc-id-3127`:

```graphql
query AIAgentsMisconfiguredGuardrail(
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
          equals: [
            "wc-id-3127"
          ]
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

### 4.8 — Guardrail Inventory (What Guardrails Exist and What They Cover)

Inventory of all existing guardrails — to cross-reference against agent count:

```graphql
query AIGuardrailInventoryWithCoverage(
  $quick: Boolean
  $first: Int
  $after: String
) {
  graphSearch(
    quick: $quick
    first: $first
    after: $after
    query: {
      type: "AI_GUARDRAIL"
      select: true
      relationships: [
        {
          type: "PROTECTS"
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
        region
        ... on CloudResource {
          status
          firstSeen
          lastSeen
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

### 4.9 — Guardrail Coverage Ratio (Agents vs Guardrails per Project)

Run these two queries and compute the ratio per project:

**Step 1 — Total agents per project:**

```graphql
query TotalAIAgentsPerProject(
  $first: Int
  $after: String
) {
  cloudResourcesV2(
    first: $first
    after: $after
    filterBy: {
      type: ["AI_AGENT"]
      status: { equals: ["Active"] }
    }
  ) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      projects { id name }
    }
  }
}
```

**Step 2 — Agents WITH guardrail per project:**

```graphql
query AIAgentsWithGuardrailPerProject(
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
        status: { EQUALS: "Active" }
      }
      relationships: [
        {
          type: "PROTECTED_BY"
          with: {
            type: "AI_GUARDRAIL"
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
        ... on CloudResource {
          projects { id name }
          cloudAccount { id name cloudProvider }
        }
      }
    }
  }
}
```

**Coverage ratio formula:**

```python
coverage_pct = (agents_with_guardrail / total_agents) * 100
# Your env: 3 guardrails / 71 agents = ~4.2% coverage ⚠️
```

---

## 📋 Query Summary — Guardrail Coverage (Pillar B)

| Query | What it finds | Control Mapped | AARS Impact |
|---|---|---|---|
| 4.1 | Agents with sensitive data + open guardrail issue | `wc-id-3039` | Pillar B +10 |
| 4.2 | **All** agents with no guardrail (graph) | `wc-id-3038`, `wc-id-3039` | Pillar B +10 |
| 4.3 | **Privileged** agents with no guardrail | `wc-id-3038` | Pillar B +10 |
| 4.4 | AWS Bedrock agents without guardrail | `wc-id-2905`, `wc-id-2906` | Pillar B +10 |
| 4.5 | GCP Vertex AI agents without guardrail | `wc-id-3217`, `wc-id-3230` | Pillar B +10 |
| 4.6 | IAM roles invoking models without guardrail | `wc-id-2742` | Pillar B +10 |
| 4.7 | Agents with **misconfigured** guardrail (output filtering) | `wc-id-3127` | Pillar B +10 |
| 4.8 | Guardrail inventory + what they protect | — | Coverage baseline |
| 4.9 | **Coverage ratio** agents vs guardrails per project | — | AARS denominator |

---

## 🎯 Priority Execution Order

```
1. Run 4.9 (Step 1 + Step 2) → compute coverage ratio baseline
   → Your env: ~4.2% (3 guardrails / 71 agents) ⚠️ CRITICAL gap

2. Run 4.3 → privileged agents without guardrail (highest risk)

3. Run 4.4 → AWS Bedrock specific (maps to your 8 wc-id-2742 issues)

4. Run 4.5 → GCP Vertex specific (maps to your 13 wc-id-3217 issues)

5. Run 4.7 → misconfigured guardrails (guardrail exists but broken)

6. Run 4.8 → full guardrail inventory (only 3 in your env)
```

---

## ⚠️ Key Notes

| Point | Detail |
|---|---|
| **`PROTECTED_BY`** | Edge from AI_AGENT → AI_GUARDRAIL — verify in Graph Explorer |
| **`negate: true`** | Inverts the relationship — finds agents where the edge does NOT exist |
| **Your env coverage** | Only **3 guardrails** for **71 agents** = **4.2% coverage** — the lowest possible Pillar B score |
| **`wc-id-3038`** | "Highly privileged AI agent not protected by AI guardrails" — HIGH severity |
| **`wc-id-3039`** | "AI Agent with sensitive data not protected by AI guardrails" — MEDIUM severity |
| **`wc-id-2742`** | "Allow model invoke without guardrail" — your 8 AWS issues |
| **`relatedIssue` filter** | Fastest way to find assets with specific open control violations without graph traversal |
| **`quick: true`** | Use for large tenants — may miss some edges but significantly faster |