Here are the production-ready GraphQL queries for **Network Exposure**:

---

## 5. 🌐 Network Exposure — reachability and validated exposure

Two queries, not one, because they make two different claims. The whole design of this area
rests on keeping them apart, so read this section before either query.

| | Question | Evidence |
|---|---|---|
| **5.1 Host exposure** | Is the compute this AI asset runs on reachable from the internet? | `accessibleFrom.internet` on the VM / Cloud Run service, plus the public-exposure paths (ports, source ranges, application endpoints) |
| **5.2 Endpoint exposure** | Did Wiz's dynamic scanner connect to a live endpoint this asset serves, and does policy rate it a real exposure? | `portValidationResult: Open` **and** `exposureLevel_name ∈ {High, Medium}` |

### Why 5.1 exists at all

A **hosted** AI asset carries no reachability flags of its own. In the captured response
(`gas_ai/exemples/ai_exposure_host_response.js`) the `AI_AGENT` entity's properties bag has
no `accessibleFrom.*` key — not `false`, *absent* — while the Cloud Run revision it runs on
carries:

```json
"accessibleFrom.internet": true,
"openToAllInternet": true,
"numPortsOpenToInternet": 2,
"validatedOpenPorts": [80, 443]
```

The fact is one hop away. Before this query the app reported every hosted asset as
`UNDETERMINED` (see `gas_ai/src/domain/riskConditions.ts`) and nothing in the sync battery
could ever settle it — `kpis.internetUnknown` had no path down.

### Why reachable ≠ exposed

That same revision is open to `0.0.0.0/0` on ports 443 and 80. Both application endpoints it
serves come back:

```json
"portValidationResult": "Open",
"exposureLevel_name": "Low",
"exposureLevel_description": "Matched rule \"2XX HTTP status codes with SSO authentication\" from moderate exposure level policy"
```

Open, validated, behind SSO — **reachable and not an exposure**. Those endpoints arrive
through query 5.1, which filters on nothing, so anything that treated "the row came back" as
the finding would relabel them as validated exposures. `isRatedExposure` in
`gas_ai/src/domain/exposureQuery.ts` judges the level Wiz actually returned instead, and
`gas_ai/test/exposure.test.ts` pins this exact row.

---

### 5.1 — AI assets whose compute is internet-reachable

`RUNS` is walked in **reverse**: Wiz's edge is `host -RUNS-> asset`, and the graph model
spells the same fact `asset -HOSTED_ON-> host`.

```json
{
  "type": ["AI_AGENT", "AI_TOOL", "AI_AGENT_REGISTRY", "AI_GATEWAY", "AI_MODEL",
           "AI_PIPELINE", "AI_SERVICE", "MCP_SERVER", "AI_DATASET"],
  "select": true,
  "relationships": [
    {
      "type": [{ "type": "RUNS", "reverse": true }],
      "with": {
        "type": ["VIRTUAL_MACHINE", "SERVERLESS"],
        "select": true,
        "where": { "accessibleFrom.internet": { "EQUALS": true } }
      }
    }
  ]
}
```

### 5.2 — AI assets serving a validated, rated endpoint

```json
{
  "type": ["AI_AGENT", "AI_TOOL", "AI_DATASET", "AI_MODEL", "AI_GUARDRAIL",
           "AI_GATEWAY", "AI_PIPELINE", "AI_SERVICE", "MCP_SERVER"],
  "select": true,
  "relationships": [
    {
      "type": [{ "type": "SERVES" }],
      "with": {
        "type": ["ENDPOINT"],
        "select": true,
        "where": {
          "exposureLevel_name": { "EQUALS": ["High", "Medium"] },
          "portValidationResult": { "EQUALS": "Open" }
        }
      }
    }
  ]
}
```

Both halves of that filter carry weight. An open port behind SSO rates `Low` and is not an
exposure; a `High`-rated endpoint on a port that never answered is not one either.

### The document

Both queries are sent through **one** GraphQL operation — `Q_AI_EXPOSURE` in
`gas_ai/src/server/wizQueriesAi.ts` — with a different `$query` variable, the way
`Q_RULE_ASSETS` is one document run once per toxic-combination rule. It is the Wiz console's
own `GraphSearch` operation **verbatim**: both named fragments (`PathGraphEntityFragment`,
`NetworkExposureFragment`), every `@include(if: $fetch*)` gate, and the unused `$controlId` /
`$issueId` arguments.

Two deliberate deviations:

- `$projectId` is `String`, not `String!` — the console sends it non-null because the
  operator had a project open; the sync runs tenant-wide unless `WIZ_PROJECT_ID_V2` says
  otherwise. `Q_AGENT_EXPANSION` already makes the same change.
- The operation is named `SidekickAiExposure`, matching every other document in that file.

The `@include` gates are kept rather than dropped (the house habit elsewhere) because they
are what holds `issueAnalytics` and `threatAnalytics` **off**. Selected plainly they would
add two `issues(filterBy: …)` joins per path entity on the widest selection set the app
sends. Keeping them and passing the capture's own flag values makes the request comparable to
one this tenant provably answered — the entire safety argument for a selection set this size.

`Q_AI_EXPOSURE` deliberately does **not** share `ENTITY_FIELDS` with the other five
graphSearch traversals. That constant's own doc comment explains why each addition is a way
to have all five rejected at once; a private selection set means a tenant that rejects
`publicExposures` skips these two optional steps and leaves the rest of the battery intact.

**Variables** (both steps, exactly as the captures send them):

```json
{
  "first": 100,
  "quick": true,
  "fetchPublicExposurePaths": true,
  "fetchLateralMovement": true,
  "fetchCodeSource": true,
  "fetchTotalCount": false,
  "fetchInternalExposurePaths": false,
  "fetchIssueAnalytics": false,
  "fetchThreatAnalytics": false,
  "fetchKubernetes": false,
  "fetchCost": false,
  "query": { "…": "5.1 or 5.2 above" },
  "projectId": null
}
```

---

### What the sync does with the answers

Sync steps `HOST_EXPOSURE` and `ENDPOINT_EXPOSURE` (`gas_ai/src/server/syncJobs.ts`), both
optional — an HTTP 400 skips the step and is recorded in the skipped-steps list the Wiz Scans
page shows.

- `normalizeHostExposurePage` emits the asset, the host, `asset -HOSTED_ON-> host`, the
  host's ports and source ranges, and one `ENDPOINT` node per `applicationEndpoints` entry
  with `host -SERVES-> endpoint`.
- `normalizeEndpointExposurePage` emits the asset, the endpoint and `asset -SERVES->
  endpoint`.
- `withExposureEvidence` (`gas_ai/src/domain/graphEnrich.ts`) folds all of it onto the AI
  asset **once, at commit** — per-page stamping would be overwritten by `mergeParts` — and it
  is persisted, because the Inventory register and the Toxic Combinations matrix read the
  `ai_assets` tab directly and never see the graph document.
- `conditionState(node, "INTERNET_EXPOSURE")` reads that evidence first, so one answer serves
  the Inventory, the combos matrix, the graph stub and AARS pillar D. It can only ever
  upgrade `null → true`.

The `lateralMovementPaths` and `codeSourcePath` legs are requested (they are part of the
verbatim document) and archived with every page, but nothing turns them into graph edges yet:
a lateral-movement path is an ordered list of hops with no declared relationship between them,
and the only capture returns `codeSourcePath: { totalCount: 0, nodes: null }`.

### Captures

- `gas_ai/exemples/ai_exposure_host_request.js` / `ai_exposure_host_response.js`
- `gas_ai/exemples/ai_exposure_endpoint_request.js` — request only; the response half was
  never taken, and its absence is **not** evidence that the tenant returned nothing.
