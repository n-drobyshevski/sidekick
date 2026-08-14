# `graphSearch` response schema

Ground truth for every `graphSearch` traversal in `gas_ai/src/server/wizQueriesAi.ts`.
Captured 2026-08-14 from the Wiz console's per-entity expansion of one AI agent; the full
scrubbed payload is `gas_ai/exemples/ai_agent_expand_response.js`, paired with its request.

Until this landed, the graphSearch shapes in `gas_ai/src/domain/syncNormalize.ts` were
*inferred* from the query selection sets — a gap flagged in `gas_ai/README.md` and in
`syncNormalize.ts`'s own header, with the sibling stubs in this directory left empty.

## Envelope

```jsonc
{
  "data": {
    "graphSearch": {
      "totalCount": 12,                    // only when the document selects it
      "pageInfo": { "endCursor": "1", "hasNextPage": false },
      "nodes": [
        {
          "entities": [ /* see below */ ],
          "aggregateCount": null           // null under quick: true
        }
      ]
    }
  }
}
```

One `nodes[]` entry is **one matched path**, not one entity. `entities` holds the selected
entities along that path.

## `entities` is positional

> `entities[i]` is the **i-th `select: true` node of the query, in depth-first pre-order**.
> A relationship leg marked `optional: true` that matched nothing contributes a literal
> `null` **holding its position**.

The array length therefore equals the query's selected-node count on every row, whether or
not anything matched. In the capture: 43 selected nodes, 43 entries, 4 non-null.

```
idx  query node                                     capture
  0  root AI_AGENT                                  the agent
  1  ACTING_AS      -> PRINCIPAL                    a SERVICE_ACCOUNT
  2    CONTAINS     -> EXCESSIVE_ACCESS_FINDING     the finding
  3  READS_DATA_FROM-> AI_DATASET|BUCKET            null
  4    READS_DATA_FROM -> BUCKET|DATABASE           null
  5      HAS_DATA_FINDING -> DATA_FINDING           null
  6    HAS_DATA_FINDING   -> DATA_FINDING           null
  7  STORES_DATA_IN -> BUCKET                       the staging bucket
  8    HAS_DATA_FINDING -> DATA_FINDING             null
```

Two consequences, both load-bearing:

1. **A node with `select: false` consumes no slot.** Its children keep their place in the
   walk and attach, positionally, to the nearest selected ancestor. `Q_IDENTITY_ACCESS`
   has this shape (`ACCESS_ROLE_BINDING` is unselected with two selected children).
   *Not directly observed* — the capture contains no unselected node. Confirm on the next
   live run; `expandAsset` reports `arityMismatches` precisely so a wrong assumption here
   is loud rather than silent.

2. **A returned `type` may be a concrete subtype of what the query asked for.** Slot 1
   asks for `PRINCIPAL` and the tenant returns `SERVICE_ACCOUNT`. Decoders must not assume
   the response type equals the requested type.

### Why type-matching is not a substitute

`syncNormalize.ts` identifies entities with `entities.find(e => e.kind === X)`. That is
sound for the sync battery, whose five traversals are 2–4 hop chains where each type occurs
at most once per path. It does not generalize: in this expansion `SERVICE_ACCOUNT` occupies
slots 11, 32 and 38, `DATA_RESOURCE` 12, 33 and 40, `DATA_FINDING` 5, 6, 8, 13 and 34, and
`AI_AGENT` both 0 and 15. Matching by type binds a nested tool's identity to the root agent
and hangs a store's finding on the wrong store — wrong edges, no error.

`gas_ai/src/domain/graphExpand.ts` decodes by position instead, deriving the traversal and
the slot list from one spec tree so the two cannot drift.

## Entity shape

Fields are whatever the document selected. Two selection sets are in use:

- **The console's** (this capture): `id`, `name`, `type`, `providerUniqueId`, `deletedAt`,
  `isRestricted`, a flat `properties` bag (~40 keys, cloud-specific), `typedProperties`
  behind a `GE*` inline fragment, `technologies[]`, `userMetadata`, and the
  `publicExposures` / `lateralMovementPaths` / `codeSourcePath` connections behind
  `@include` flags.
- **`gas_ai`'s** (`ENTITY_FIELDS` in `wizQueriesAi.ts`): `id`, `name`, `type`,
  `nativeType`, `cloudPlatform`, `region` on the interface, with `status`, `firstSeen`,
  `lastSeen`, `externalId`, the exposure/privilege booleans, `technology`, `cloudAccount`,
  `projects`, `tags` behind `... on CloudResource`. `DATA_ENTITY_FIELDS` adds
  `... on DataFinding { severity }`.

`CloudResource` is an **inline fragment** here — only the identity fields sit on the
`GraphEntity` interface. `DataFinding` is not a `CloudResource` at all, which is why its
`severity` needs its own fragment and why that fragment is deliberately isolated to the two
documents that select `DATA_FINDING`.

## Pagination

`pageInfo.hasNextPage` / `endCursor`, walked by the caller. The transport
(`wizClientAi.fetchGraphSearchPage`) always injects `quick: true`; under `quick`,
`aggregateCount` is null and results are approximate, so a `hasNextPage: true` on a
single-entity expansion is a signal worth surfacing rather than paging through.
