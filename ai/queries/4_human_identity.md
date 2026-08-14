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
| **`lastActivity: { BEFORE: "now-90d" }`** | ⚠️ **Unverified.** No capture in this repo uses this filter. Dormancy is available as a *returned property* instead — see "What is implemented" below. |
| **`mfaEnabled: false`** | ⚠️ **Wrong shape, and it does not matter.** No capture carries an `mfa*` field on any entity, so this filter is unverified — but MFA turned out not to be a property at all. It is a RULE: `IAM-159`, `IAM-048`, `IAM-208`, evaluated against `USER_ACCOUNT` and reported through `configurationFindings`. See 4.3 below. |
| **`accessType`** | Filter on the relationship edge — values: `READ`, `WRITE`, `ADMIN`, `HIGH_PRIVILEGE` |
| **`quick: true`** | Recommended for large tenants — trades completeness for speed |
| **Query 4.8 priority** | This is your **highest-value** query — combines 3 risk factors in one shot |
| **Your env relevance** | `AWSReservedSSO_FinanceAdmin` roles (8 issues) are prime candidates for 4.1 and 4.5 |
---

## ✅ What is implemented

The queries above are a design menu; one of them runs. This section is the reconciliation, so
the doc cannot drift from the sync.

### The step: `IDENTITY_ACCESS`

Query 4.1, **re-rooted and de-stamped**. `Q_IDENTITY_ACCESS` in
`gas_ai/src/server/wizQueriesAi.ts`, traversal in `gas_ai/src/domain/identityQuery.ts`:

```
AI asset  <-ALLOWS_ACCESS_TO-  ACCESS_ROLE_BINDING  -BOUND_TO->            USER_ACCOUNT / SERVICE_ACCOUNT
                                                    -PERMITS_ACCESS_ROLE-> ACCESS_ROLE[accessType Admin|High]
```

Three differences from 4.1 as written above, each of which was a way the old figure could have
been wrong:

1. **The root is the tenant-resolved AI type list**, not the literal `"AI_AGENT"`. A model with
   an admin binding, or an MCP server a contractor can reach, used to be uncollected with
   nothing on the page to say so. The traversal is therefore a `$query` **variable** rather
   than inline GraphQL text — a resolved type list must not be string-built into a document.
2. **The reverse leg is `reverse: true`** inside the relationship's type object, not
   `direction: INBOUND` at the relationship level. Both are accepted; the first is the form
   both console captures use in the variable position, which is where this now lives.
3. **`accessType` is read from the returned `ACCESS_ROLE`**, not stamped from the filter. The
   normalizer used to write `HIGH_PRIVILEGE` onto every edge, which flattened `ADMIN` into it
   and made "who is admin on an agent" unanswerable from the ledger. A tenant whose bag omits
   the field falls back to the old constant, so nothing regresses.

### Dormancy — 4.2, without a `lastActivity` filter

Wiz returns it as a **property**, not something to filter on:
`inactiveInLast90Days` and `inactiveTimeframe`, in the graph entity's properties bag. The
capture proves it: `gas_ai/exemples/agentic_identities_response.js:44`.

The catch was where the bag sits. A graphSearch entity carries `properties` flat; a
`cloudResourcesV2` node carries the resource fields flat and the bag one level deeper, under
`graphEntity`. `Q_PRINCIPALS` selected only the flat fields, so the whole identity vocabulary
— dormancy, `enabled`, `userDirectory` and the *real* `identityPurpose` — was one selection
away the entire time. It now selects `graphEntity { properties }`, and `entityField`
(`gas_ai/src/domain/graphTypes.ts`) reads all three roots.

Two consequences worth knowing:

- `identityPurpose` comes back as `IdentityPurposeAgentic` while the filter takes `AGENTIC`.
  Every consumer compares against the short form, so a traversal-reached agentic identity used
  to be labelled in the ledger and uncounted on the page. `normalizeIdentityPurpose` strips
  the prefix, the same way `normalizeDataFindingSeverity` handles `DataFindingSeverityCritical`.
- The stamp in `normalizePrincipalsPage` survives only as a fallback for a tenant that does not
  return the field — which is why that filter stays locked in `scanVars`.

### The total

`withHumanAccess` (`gas_ai/src/domain/graphEnrich.ts`) folds reach onto the AI asset at commit
and persists it (`human_access_json`), because the Inventory register and the combos matrix
read the `ai_assets` tab directly and never see an edge.

It counts **from the edges, never from the drawn stubs**. `withIdentityAccessNodes` suppresses
an asset that already carries a real `EXCESSIVE_ACCESS_FINDING` so one problem is not drawn
twice — right for a picture, silently wrong for a number, and the gap between the two would
move with CIEM coverage. `test/identityAccess.test.ts` pins that case.

KPIs: `humanReachable`, `humanReachableAdmin`, `humanIdentities` (distinct — one operator with
bindings on six agents is one person), `humanDormant`.

### Not implemented, and why

| Query | Status |
|---|---|
| 4.3 **no MFA** | ✅ **Implemented, by a different mechanism than proposed.** Not a `where: { mfaEnabled }` on a graph query — MFA is a RULE. See "Identity hygiene" below. |
| 4.4 **external identities** | No query. Nothing distinguishes an external identity in what is collected. |
| 4.7 **write access to agent code buckets** | No query. The data-exposure chain walks the agent's own identity to classified stores; a human's write access to a source bucket is a different traversal. |
| 4.8 **combined** | Reachable but not filed as its own finding. Every term now exists on the asset: `humanAccess.admin` (privilege), `humanAccess.noMfaCount`, `humanAccess.inactiveCount` and `humanAccess.dormantFindingCount`. |

Read-only grants are **collected by nothing**: the traversal only asks for `ADMIN` and
`HIGH_PRIVILEGE`, so "N assets reachable" always means "reachable with rights worth naming".
The Scans area states that in its own note rather than letting the number imply otherwise.

---

## 🔄 Update — identity hygiene, and effective permissions

Two roots landed after the section above was written, and both change what "not implemented"
meant there.

### Identity hygiene — MFA and dormancy are RULES, not properties

The note table above asserted `mfaEnabled: false` as a graph-query filter on `USER_ACCOUNT`.
No capture ever carried such a field, and the reason turned out to be that Wiz does not model
it that way. `cloudConfigurationRules` (captured in
`gas_ai/exemples/ai_config_rules_response.js`) carries, against `subjectEntityType: USER_ACCOUNT`:

| shortId | name |
|---|---|
| `IAM-159` | User should have MFA enabled |
| `IAM-048` | User with a console password should have MFA enabled |
| `IAM-208` | User with password-based authentication should have MFA enabled |
| `IAM-235` | User should not be inactive for more than 90 days |
| `IAM-291` | User should have recent login activity |

So 4.3 and half of 4.2 are answered through `configurationFindings` — the root
`CONFIG_FINDINGS` already uses — filtered to those rule ids.

**The rules are matched, not hardcoded.** `gas_ai/src/domain/identityHygiene.ts` holds a
matcher table (`/multi-factor|\bMFA\b/i`, `/inactive for more than|recent login activity/i`)
guarded on `subjectEntityType === "USER_ACCOUNT"`, resolved against the synced catalogue on
every sync. There are at least three MFA rules and they are cloud-specific; a hardcoded triple
would silently under-report on a different cloud mix. It is still a heuristic over rule NAMES,
so the resolved set is listed on the Wiz Scans panel — a wrong or empty match has to be
visible.

The subject guard is load-bearing: `IDP-012` "WorkSpaces Directory should have multi-factor
authentication enabled" matches the name pattern and is evaluated against an
`IDENTITY_PROVIDER`. It is a real finding that says nothing about whether a *person* has MFA.

**The filter is the unverified part.** `ConfigurationFindingFilters.rule` is proven by no
capture. A rejection is handled by the existing optional-step machinery; a filter that is
accepted and then *ignored* is not, so `normalizeIdentityFindingsPage` verifies the first page
against the requested ids and aborts the step rather than filing the tenant's entire CSPM
register under "identity hygiene".

**Findings land in their own tab.** `ai_identity_findings`, never `ai_findings` — that tab
prices AARS pillar B through `buildAarsHintsFromFindings`, which keys by `resourceId`, and a
`USER_ACCOUNT` *is* a row in `ai_assets`. Folding them in would put an AI Asset Risk Score on
a person.

**The number is an intersection.** Not "how many people lack MFA", which is an IAM problem,
but how many of the people who can reach an AI asset do — `kpis.humanNoMfa`.

### Effective permissions — 4.1, upgraded rather than replaced

`entityEffectiveAccessEntries` (captured in `gas_ai/exemples/ai_effective_access_request.js`)
answers what a binding actually confers: `permissions` as real permission strings, and per path
the `principalPolicies` / `resourcePolicies` granting it — the remediation target.

It runs **beside** `IDENTITY_ACCESS`, not instead of it. That step produces the
`ALLOWS_ACCESS_TO` edges the Security Graph draws. And the two speak different vocabularies:

| Source | `accessType` values | Claim |
|---|---|---|
| binding traversal (4.1) | `ADMIN`, `HIGH_PRIVILEGE` | holds a role granting access |
| effective access | `DATA` | can actually reach the asset's data |

They are different axes that share a word, so they never share a field:
`humanAccess.identityIds` against `humanAccess.effectiveIds`. An identity only effective access
finds still counts as reach — that is what "effective" means — but the figure names which grade
of evidence it has.

### The catalogue itself

`CONFIG_RULES` syncs `cloudConfigurationRules` into `ai_config_rules`, unfiltered (the filter
input's type is unverified, and naming one wrong fails the document while sending none cannot).
~3,858 rules is ~39 pages against a battery that is otherwise ~10–20 calls, so the step is
**gated on a 30-day freshness check**: this list changes when Wiz ships rules, not when the
estate moves. A gated skip is recorded as *scheduled* and never joins `skippedSteps`, which
means "the tenant refused this".

Besides the hygiene matchers it gives the AARS codebook its missing gloss — `SUB-082` resolves
to "Vertex AI Metadata Store should be encrypted with a customer-managed key", which
`src/client/js/codebook.js` states in its own header it could not do.

### Still not implemented

| Query | Status |
|---|---|
| 4.4 **external identities** | No query. Nothing collected distinguishes an external identity. |
| 4.7 **write access to agent code buckets** | No query. Effective access is filtered to AI resource types; pointing it at buckets would answer this, and is the obvious next step. |
