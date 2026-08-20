# What these query documents are, and what they are not

**Status: planning notes, not specifications. The code is the authority.**

These files were drafted before this repo held a single captured Wiz request or response.
They read as finished work — "production-ready GraphQL queries" — and they were confidently
wrong for as long as the code that copied them was. Both defects below shipped into the
battery from here, ran against a live tenant for the entire life of the app, and were found
only when a traversal was asked why it had never returned a row.

## The two defects

### 1. Shape — a quoted enum in GraphQL source is refused

Every `graphSearch` block in these documents writes its traversal as GraphQL **source text**
with quoted enum values:

```graphql
query: { type: "AI_AGENT", relationships: [{ type: "RUNS_AS", ... }] }
```

A live tenant refuses that, twice over:

```
GraphEntityType cannot represent value: "AI_AGENT"
GraphDirectedRelationshipTypeInput cannot represent value: "RUNS_AS"
```

The identical value is accepted when it arrives inside a `$query` **variable**, because the
variable is coerced against the schema rather than parsed as a literal. Note the second
message: `GraphDirectedRelationshipTypeInput` is an **input object**, not an enum, so a
relationship is `[{ type: "ACTING_AS", reverse: true }]` — a one-element array of an object —
and a bare string can never coerce to it, quoted or not.

**This defect is independent of the vocabulary one.** Every `graphSearch` block in these
files is refused as written, including the ones whose relationship names are correct.

### 2. Vocabulary — five of the twenty-three names exist

An introspection probe against the tenant returned its **100 relationship members**, and
those are now written down: **[`gas_ai/exemples/tenant_vocabulary.js`](../../gas_ai/exemples/tenant_vocabulary.js)**,
captured 2026-08-20 and re-runnable with `npm run probe -- --vocab-only`. Of the 23
relationship names `EDGE_TYPES` declares, five are relationships this tenant has —
`ALLOWS_ACCESS_TO`, `USES`, `BUILT_FROM`, `HAS_DATA_FINDING`, `SERVES` — and
`gas_ai/test/tenantVocabulary.test.js` now fails offline on any name the tenant lacks.

The names used throughout these documents map as follows:

| written in these docs | this tenant | walked from | direction |
|---|---|---|---|
| `RUNS_AS` | `ACTING_AS` | the agent | forward |
| `HAS_FINDING` | `CONTAINS` | the principal | forward |
| `PROTECTED_BY` | `PROTECTS` | the asset | **reversed** — the tenant's edge runs guardrail → asset |
| `BOUND_TO` | `ENTITLES` | the role binding | forward |
| `PERMITS_ACCESS_ROLE` | `ALLOWS` | the role binding | forward |

`USES_TOOL`, `USES_MODEL`, `USES_DATASET`, `CAN_INVOKE`, `STORED_IN`, `INVOKES_TOOL` and
`ENFORCES` are confirmed absent from this tenant and are produced by nothing in the live path.
`BUILT_FROM` is the exception and worth knowing: it **does** exist on the tenant, so the
supply-chain area's arrow is real vocabulary — what is missing is a payload anyone has seen
(`syncNormalize.ts` declines to guess the chain), not the name.

Near-misses are not substitutes. The tenant has `PERMITS` but not `PERMITS_ACCESS_ROLE`,
`HOSTS` but not `HOSTED_ON`, `INVOKES` but not `CAN_INVOKE`, and `STORES_DATA_IN` but not
`STORED_IN`. Each pair is close enough to read past, which is how the original five survived
review.

**`reverse` is a property of the standing point, not of the relationship.** `ENTITLES` is
reversed when walked from the principal and forward when walked from the binding. Getting it
wrong returns **zero rows, not an error**, which is why it survives review.

**This is not a translation table.** `CONTAINS` means "principal holds finding" in one
subtree and "cluster holds deployment" in another. Substituting name-for-name without the
standing point is how the next wrong query gets written.

## What is *not* affected

The `cloudResourcesV2` queries in these files — the pre-computed-flag ones such as
`hasHighPrivileges: { equals: true }` — are sound. They filter through `filterBy` and walk no
relationships, so neither defect touches them.

## Where the real queries live

| what | where |
|---|---|
| **What names this tenant actually has** | `gas_ai/exemples/tenant_vocabulary.js` — 100 relationships, 252 entity types, by introspection |
| Traversals, as `SelectSpec` values | `gas_ai/src/domain/agentPathQuery.ts`, `identityQuery.ts`, `exposureQuery.ts`, `lineageQuery.ts` |
| `SelectSpec` → the `$query` variable | `toGraphEntityQuery` in `gas_ai/src/domain/graphExpand.ts` |
| Every relationship name, with its standing point and its evidence | `HOP` in `gas_ai/src/domain/graphExpand.ts` |
| The test that refuses a name with no capture behind it | `gas_ai/test/graphExpand.test.ts`, *"every hop names the capture that proves it"* |
| The test that refuses a name **this tenant does not have** | `gas_ai/test/tenantVocabulary.test.js` — offline, against the file above |
| The GraphQL documents themselves | `gas_ai/src/server/wizQueriesAi.ts` |
| What an operator is told each step sends | `SCAN_AREAS` in `gas_ai/src/client/js/scanContent.js` |
| **The only wire evidence this repo holds** | `gas_ai/exemples/` — captured requests and responses |

References here name **files and symbols, not line numbers**, on purpose: the stale citation
`graphTypes.ts:183-212` in `ai/AARS_SCORING_ASSESSMENT.md` had drifted to `:202-231` while
still reading as precise. A symbol survives an edit; a line number quietly stops being true.

## Per-file status

| file | status |
|---|---|
| `4_guardrail_coverage.md` | **historical.** 6 `graphSearch` blocks, all refused; 5 also use `PROTECTED_BY` |
| `4_human_identity.md` | **historical.** 8 `graphSearch` blocks, all refused; 3 also use `RUNS_AS` / `BOUND_TO` / `PERMITS_ACCESS_ROLE` / `HAS_FINDING` |
| `6_IAM.MD` | **historical.** 7 `graphSearch` blocks, all refused; 5 also use `RUNS_AS` / `HAS_FINDING` / `PROTECTED_BY` |
| `5_internet.md` | **current.** Written from `gas_ai/exemples/ai_exposure_host_request.js` and its paired response, after both existed. Neither defect applies. |
| `reponse_schemas/3_graphsearch_response.md` | **current.** Documents the positional `entities` decoding contract that `graphExpand.ts` implements. |
| `1_ai_assets_discovery.md`, `2_toxic_combos.md`, `3.sensitive_data_access.md`, `3_model_integrity.md`, `reponse_schemas/1_…`, `reponse_schemas/2_…` | empty files, 0 bytes |

## If you are here to write a new traversal

Do not start from these documents. Start from `HOP` and `gas_ai/exemples/`, build a
`SelectSpec`, and let `toGraphEntityQuery` render it. If the name you need is not already in
`HOP`, it needs evidence — a capture, or a fresh `wizDiagnostic()` run, which prints every
relationship the tenant has. Never infer a vocabulary from a sample: reading a name's absence
from a handful of returned rows as absence from the schema is the mistake that produced this
page.
