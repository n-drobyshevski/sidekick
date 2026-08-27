# The probe against the live tenant — what it found, and what it changes

**Tenant** `api.eu15.app.wiz.io` · **project scope** `1dfea0cf-834f-5522-b797-bee5aaf09251`
(VALUE-CHAIN) · **measured** 2026-08-27 at `0f9c549`, **re-measured the same day** at
`28c74f9` (§7) · branch `claude/wiz-sidekick-decsecops-x75ex3`

The register's two open questions are the ones [README.md](README.md) names under *The two
questions it exists to answer*. Both are now answered, and a third thing turned up that
nobody asked about: **the SAST query does not currently run against this tenant at all.**

**§1–§6 are the first pass and are left standing as the dated record that justified the
fix.** §7 is the second pass, after `28c74f9` acted on them: the SAST defect in §4 is
confirmed fixed, the probe traps in §5 are confirmed fixed (one with a regression), and the
secrets schema is taken the last step needed to write `Q_SECRETS`. Where the two passes
disagree, §7 wins.

> **Read the numbers as of the date above.** They are a dated observation of a production
> tenant, not an invariant, and no test can pin them. Where a claim *could* be held by a
> test, the test is named beside it.

Introspection is **open** on this tenant, so every schema answer below came from `__type`,
not from the candidate-probing fallback. The fallback never fired.

---

## 1. State

| Run | Result |
|---|---|
| `npm run probe -- --dry-run` | clean; variables as expected, no request sent |
| `npm run probe -- --roots --report` | 11 secret-shaped roots found |
| `npm run probe -- --schema --report` | `SASTFinding`: 43 fields, 4 temporal |
| `npm run probe -- --first=5 --report` | **sca 200 · sast HTTP 400 · secrets no document** |

Roughly 45 read-only GraphQL calls in total — more than the ~20 the four documented flags
imply, because the type/filter/enum introspections and the count queries behind §2–§4 are
not reachable from the flags. Nothing was written: no sheet, no Drive file, no Wiz object.

---

## 2. `SASTFinding` **does** expose a selectable timestamp

This reverses the standing note. `SASTFinding` has 43 fields, four of them temporal:

```
createdAt              DateTime!
updatedAt              DateTime!
firstDetectedAtSource  DateTime
rejectionExpiredAt     DateTime
```

`createdAt` is also **filterable** (`SASTFindingFilters.createdAt: SASTDateTimeFilter`),
which is what an incremental sync needs, and **sortable** — `SASTFindingOrderField` is the
two-value enum `CREATED_AT, SEVERITY`. Live values are real and well-spread:

```
OPEN  createdAt=2025-11-04T16:42:15.835767Z  updatedAt=2026-08-25T15:41:15.285598Z  firstDetectedAtSource=null
OPEN  createdAt=2025-11-05T05:17:27.108235Z  updatedAt=2026-08-22T02:55:27.314464Z  firstDetectedAtSource=null
```

`firstDetectedAtSource` was null on every row sampled.

### `SAST_FETCH_RESOLVED` still stays `false`, for a new reason

The old reason — "no timestamp to date them from" — is dead. Two new ones replace it:

- **There is no `resolvedAt` on `SASTFinding`.** Forty-three fields, none of them a
  resolution date. Turning the flag on buys a real *start* and leaves the *end* missing.
  `updatedAt` is a lossy proxy: it moves on any rescan, and the samples above show it doing
  exactly that.
- **`status: RESOLVED` returns `totalCount: 0`** in this scope. There is nothing to fetch.

So the decision in `wizQueries.ts` holds and the comment above it is now wrong. It should
say *no resolution date and no resolved rows*, not *no timestamps*.

---

## 3. The secrets root is `secretInstances`, and it **does** separate removed from rotated

Eleven secret-shaped roots exist; the register's is:

```
secretInstances(after: String, first: Int, filterBy: SecretInstanceFilters, orderBy: SecretInstanceOrder)
```

**The two events are independent axes on the node type** — which is exactly what the
register models:

| Event | Field | Type |
|---|---|---|
| Secret **removed from code** | `status` → `RESOLVED`, `resolvedAt` | `FindingCommonStatus!`, `DateTime` |
| Credential **rotated / dead** | `validationStatus`, `lastValidatedAt`, `validationDetails` | `SecretInstanceValidationStatus!`, `DateTime` |

`SecretInstanceValidationStatus` = `UNKNOWN, VALID, INVALID, ERROR`. Other clocks on the
node: `firstSeenAt: DateTime!`, `lastSeenAt: DateTime!`, `lastModifiedAt`,
`lastUpdatedAt: DateTime!`. Both axes are filterable — `SecretInstanceFilters` carries
`firstSeenAt`, `lastUpdatedAt` and `resolvedAt` as `CommonDateFilter`
(`before` / `after` / `inLast` / `beforeLast`), plus `status`, `validationStatus`,
`projectId: [String!]`, `codeToCloudPipelineStage` and `isDefaultBranch`.

### The rotation axis is real in the schema and near-empty in the data

Project-scoped, all pipeline stages:

```
ALL                    394927
status OPEN            362937
status RESOLVED         31988
validation UNKNOWN     393443
validation VALID           300
validation INVALID        1184
validation ERROR             0
```

Removal is well-dated across 31,988 rows. Rotation is measured on **1,484 of 394,927 —
0.38%**. `resolutionReason` was `null` on every resolved row sampled. The design is right;
the tenant only feeds one of its two dates today, and the register has to publish the
rotation clock as mostly-unmeasured rather than mostly-unrotated. *Absent is never zero.*

### Scope matters more here than anywhere else

`codeToCloudPipelineStage: CODE` narrows **394,927 → 1,933**. Most secrets in this tenant
are cloud/runtime, not code. On the CODE population — the register's actual one:

```
ALL 1933 · OPEN 1859 · RESOLVED 72 · validation VALID 14 · INVALID 204
```

### The code-secrets clock is healthy, and the instant-close pathology does not apply

Resolved CODE secrets, `resolvedAt − firstSeenAt`, n=72 (the whole resolved population):

```
median 5.1460 d   p90 56.1260 d   max 300.013 d
under 1 minute : 0
under 1 hour   : 0
under 1 day    : 0
1 day or more  : 72
```

This is worth stating carefully, because the unscoped population looks like the opposite.
Sampled across *all* stages, secrets close 0.25s–63s after first being seen — the exact
born-and-closed-in-the-same-instant artifact that keeps `SAST_FETCH_RESOLVED` off. Scoped
to CODE, **not one of the 72 closes inside a day.** The artifact is a cloud-stage
phenomenon and is not a threat to the code-secrets MTTR. Narrowing to CODE is what makes
the difference, so that narrowing is load-bearing rather than tidy.

---

## 4. The two existing queries: SCA works, **SAST is refused**

> **Fixed in `28c74f9`; verified in §7.1.** SAST now returns HTTP 200 with `totalCount 127`.
> The diagnosis below is kept because it is the measurement that justified the fix.

```
--- sca ---
  5 node(s), hasNextPage true
  fields: id, name, detailedName, severity, status, firstDetectedAt, lastDetectedAt,
          resolvedAt, fixDate, fixedVersion, hasExploit, hasCisaKevExploit,
          epssProbability, vulnerableAsset, artifactType
  ALWAYS NULL in this sample: resolvedAt

--- sast ---
  REFUSED: HTTP 400: {"data":null,"errors":[{"message":"invalid type for variable: 'filterBy'",
           "extensions":{"code":"VALIDATION_INVALID_TYPE_VARIABLE","name":"filterBy"}}]}

--- secrets ---
  no document yet (see --roots above)
```

**SCA.** Healthy. `totalCount` printed as `null` only because `Q_SCA` never selects it —
`Q_SAST` does, `Q_SCA` does not. Asked for separately with the app's own filter:
**18,106** (OPEN 17,741 / RESOLVED 365). The always-null `resolvedAt` is a five-row
sampling artifact, not a schema gap; on a RESOLVED-only page it populates:

```
{"status":"RESOLVED","firstDetectedAt":"2026-02-02T15:48:16Z","resolvedAt":"2026-08-25T18:00:45Z","fixDate":"2025-12-03T23:15:08Z"}
```

**No PARTIAL result was observed.** `partialErrors: []` on SCA; SAST never returned data.
The captured `brick/devsecops/sast_response.json` has one, so the tolerance in `post()`
earns its place — this run simply did not reproduce it.

### The SAST defect: an object filter sent as an array

The document is sound and the declared type name is right — `sastFindings` really does take
`filterBy: SASTFindingFilters`. The defect is in `buildFilter`, and it is a shape mismatch:

```
SASTFindingFilters.severity   SASTSeverityFilter   { equals: [FindingSeverity!], notEquals: [...] }
SASTFindingFilters.status     SASTStatusFilter     { equals: [FindingCommonStatus!], ... }
SASTFindingFilters.projectId  [String!]            ← correct as sent
```

`wizQueries.ts` sends `severity: ["CRITICAL","HIGH"]` where the schema wants
`severity: {equals:["CRITICAL","HIGH"]}`. The `status` line has the same latent bug — it is
dormant only because `SAST_FETCH_RESOLVED` is `false`, and would break the moment it flips.

Proof it is the whole cause — the app's **own bundled `Q_SAST`**, unmodified, with only the
filter shape corrected:

```
filterBy = {"resource":{"isDefaultBranch":{"equals":true}},"severity":{"equals":["CRITICAL","HIGH"]},"projectId":["1dfea0cf-…"]}
HTTP 200  errors: (none)
5 node(s), totalCount 127, hasNextPage true
ALWAYS NULL in this sample: originalSeverity, resolutionReason
```

`resource.isDefaultBranch: {equals: true}` was already correct (`SASTBooleanFilter`).

**The fix is SAST-only, and that is the trap.** The two filter types genuinely disagree:

```
VulnerabilityFindingFilters.severity   [VulnerabilitySeverity!]    ← a list; SCA is correct
SASTFindingFilters.severity            SASTSeverityFilter          ← an object; SAST is wrong
```

A shared `buildFilter` applying the SCA convention to both is how the two drifted. Fixing
SAST by changing the shared helper for everyone would break SCA, which works today.

**`test/wizQueries.test.js:32` pins the broken shape** (`severity: ["CRITICAL","HIGH"]` for
SAST). Per the working-discipline rule, that test may be edited — the claim it encoded is
"SAST takes a severity list", and the tenant falsifies it with
`VALIDATION_INVALID_TYPE_VARIABLE` above. The reason belongs in the test when it changes.

---

## 5. Three traps in the probe itself

> **All three fixed in `28c74f9`; verified in §7.4.** The order-enum fix overshot and is
> now over-broad in the other direction — see §7.4 before trusting the printed field list.

None of these affect the findings above; all three cost time to find.

- **`.env.local` swallows inline comments.** The parser at `probe.mjs:48` uses a greedy
  `(.*)\s*$`, so `WIZ_PROJECT_ID_V2=<uuid>   # VALUE-CHAIN, pre-filled` yields a 101-char
  project ID — the UUID *plus the comment*. `gas_ai` never notices because its
  `dev/.env.local` overrides the key with a bare value. Strip comments when copying
  credentials across, or the filter is silently scoped to a project that does not exist.
- **`--roots --report` writes no report.** `ROOTS_ONLY` exits at `probe.mjs:236`, before the
  `writeFileSync` at 333. Only `--schema` and the full run produce a file, and the full run
  overwrites the schema run's copy.
- **The order-enum summary line under-reports.** The probe prints
  `Sortable fields naming a time: (none)` while `sastOrderFields` in the same report reads
  `["CREATED_AT","SEVERITY"]`. `TEMPORAL` (`probe.mjs:179`) is lowercase-anchored with no
  `i` flag, so it never matches a SCREAMING_SNAKE enum value. The stored data is right; only
  the printed line is wrong.

---

## 6. What the first pass left open

- ~~Fix the SAST filter shape, SAST-only, and re-run `--scope=sast`.~~ **Done** in
  `28c74f9`, verified in §7.1.
- Decide whether `createdAt` alone earns a SAST *age* register even with no resolution
  date. The tenant supports it; §2 argues it cannot support an MTTR. **Still open.**
- `Q_SECRETS` can now be written against a known root, node type and filter type. The
  rotation clock should ship as measured / unmeasured, per §3 — 0.38% coverage today.
  **Still open**, and §7.3 supplies the last schema facts it was missing.

---

# 7. Second pass — after the fix

**Re-measured** 2026-08-27, same tenant and project scope, at `28c74f9`. Four runs:
`--dry-run`, `--scope=sast --first=5 --report`, `--schema --report`, `--first=5 --report`.
Read-only as before; the report now **merges across runs** rather than overwriting, and
ended with 8 finding keys spanning all three `--report` runs.

## 7.1 The SAST defect is fixed, and the count is the predicted one

`--dry-run` prints the two shapes the schema asks for — an object for SAST, a bare list for
SCA, which is the asymmetry `OBJECT_FILTERS` now encodes:

```
--- sast ---                      --- sca ---
"severity": {"equals": [          "severity": ["CRITICAL","HIGH"]
  "CRITICAL","HIGH"]}
```

Live, against the tenant:

```
--- sast ---
  5 node(s), totalCount 127, hasNextPage true
```

**127, matching the corrected-filter measurement in §4 exactly.** No
`VALIDATION_INVALID_TYPE_VARIABLE`, no `errors` array, and `partialErrors: []` — still no
PARTIAL reproduced on this tenant, so the tolerance in `post()` remains untested by live
traffic and should stay.

**One number did move, and it is not SAST.** SCA reads **18,053**, against 18,106 in §4 —
53 fewer in about a day. `Q_SCA` now selects `totalCount` itself, so this is the probe's
own figure rather than the side query §4 had to run. A live register drifting by 0.3%
overnight is the expected behaviour, not a filter problem; it is recorded here so the next
reader does not mistake drift for a defect.

## 7.2 The three SAST timestamps come back populated

```
--- row 1 ---
  name        Unsafe XML Processing with XMLInputFactory in Java
  status      OPEN   severity HIGH
  createdAt             2025-11-04T16:42:15.835767Z
  updatedAt             2026-08-25T15:41:15.285598Z
  firstDetectedAtSource null
  filePath    tattoo/src/…/BoFlowReceiveExpeditionFromEWM.java:133
  commitHash  62e2d52bec055ad0e1bd9305da16e621f9c6a2df

--- row 2 ---
  name        Disabling XML External Entity Attacks in Java
  status      OPEN   severity HIGH
  createdAt             2025-11-04T17:04:09.795784Z
  updatedAt             2026-08-26T20:23:44.312088Z
  firstDetectedAtSource null
  filePath    src/main/java/…/Gs1Utils.java:33
  commitHash  5c1b88ba34071ab4d4815596551124c6f0d0a31f

populated across the page: createdAt 5/5, updatedAt 5/5, firstDetectedAtSource 0/5
```

`ALWAYS NULL in this sample: originalSeverity, resolutionReason, firstDetectedAtSource` —
nothing surprising in it. `resolutionReason` is null because every row is OPEN, and
`firstDetectedAtSource` was 0/5 in §2 as well, so the comment in `wizQueries.ts` calling it
null-on-every-row still holds.

**The nine-month spread is the finding.** Birth dates in Nov 2025, `updatedAt` in Aug 2026.
That is `updatedAt` tracking rescans, exactly as the comment claims and precisely why it
cannot stand in for a resolution date.

## 7.3 The secrets schema, taken the last step

**The filter shapes**, printed by the probe rather than inferred:

```
status:           SecretInstanceStatusFilter           -> send as an OBJECT { equals: [...] }
validationStatus: SecretInstanceValidationStatusFilter -> send as an OBJECT { equals: [...] }
severity:         SecretInstanceSeverityFilter         -> send as an OBJECT { equals: [...] }
```

**But `projectId` in the same filter type is a bare `[String!]`.** `SecretInstanceFilters`
mixes both conventions internally, so one field's shape says nothing about the next one's.
That is the §4 trap restated at finer grain: infer nothing, print it.

**Identity** — the clocks were already known from §3; this is what was missing:

| Question | Field | Type |
|---|---|---|
| Which secret | `id` / `externalId` / `secretDataId` | `ID!` / `String!` / `String!` |
| | `name`, `type`, `confidence`, `rule`, `snippet` | `SecretDetectionRuleType!`, `SecretInstanceConfidence`, … |
| Where in the file | `path`, `lineNumber`, `startOffset`, `endOffset` | `String!`, `Int`, `Int`, `Int` |
| Which commit | `vcsDetails` → **`initialCommitHash`** | `SecretInstanceVcsDetails` → `String` |
| Which repository | `resource` → `id`/`name`/`type`/`externalId`/`nativeType`/`cloudPlatform` | `SecretInstanceResource!` |
| Which scope | `projects`, `codeToCloudPipelineStage`, `origin`, `scanType` | `[Project!]`, … |

Three things `Q_SECRETS` must not get wrong:

- **The commit field is `initialCommitHash`, not `commitHash`.** SAST's
  `SASTFindingVcsDetails` has `commitHash`; `SecretInstanceVcsDetails` has only
  `initialCommitHash` and `ciWorkflowRun`. Copying SAST's `vcsDetails { commitHash }` fails
  the **whole document**, the same way a wrong union member would. The semantics are also
  better here — it is the commit that *introduced* the secret, which is what dates it
  against history.
- **`secretDataId` is distinct from both `id` and `externalId`** and looks like the dedup
  key — what should collapse the same credential in five files into one rotation decision.
  Confirm it against data before the ledger key depends on it.
- **`SecretDetectionRuleType`** = `SAAS_API_KEY, PRIVATE_KEY, PUBLIC_KEY, PASSWORD,
  CERTIFICATE, CLOUD_KEY, SSH_AUTHORIZED_KEY, DB_CONNECTION_STRING, GIT_CREDENTIAL,
  PRESIGNED_URL`. `PUBLIC_KEY` is in there: not every row in this register is a live
  credential, and a rotation metric that counts them is measuring the wrong population.

## 7.4 The probe traps: all three fixed, one overshot

The comment-swallowing parser and the silent `--roots --report` are fixed. The order-enum
line is fixed too — it now reads `Sortable fields naming a time: CREATED_AT` where §5 had it
printing `(none)`.

**The same change regressed the field list directly above it.** "Temporal-looking ones" now
reports **13 of 43 fields**, including `relatedIssues`, `organization`, `filePath`, `status`,
`remediationInstructions` and `originToolData` — none of which are timestamps. The cause is
the `i` flag at `probe.mjs:240`:

```js
const TEMPORAL = /(^|[a-z_])(at|date|time|…)([A-Z_]|$)/i;
```

`i` makes `[a-z_]` and `[A-Z_]` each match *any* letter, which destroys the camelCase
boundary the pattern depended on: `filePath` matches as `P`+`at`+`h`, `status` as
`st`+`at`+`us`. It buys `CREATED_AT` at the cost of the anchoring.

Cosmetic for the stored data — `sastFields` and `sastOrderFields` are intact and §2's answer
is unaffected — but `sastTimestamps` now carries 13 entries instead of 4, and the printed
list is what a reader takes as "the timestamps SAST has". It currently claims `filePath` is
one. A case-sensitive alternation with a separate SCREAMING_SNAKE branch gets both cases;
one regex with `i` cannot.

## 7.5 What is still open after the second pass

- **`Q_SECRETS`.** Every schema fact it needs is now in §3 and §7.3. Ship the rotation clock
  as measured / unmeasured — 0.38% coverage — and key it on `secretDataId` only after
  confirming that field against data.
- **The SAST age-vs-MTTR decision** from §6, untouched by this pass.
- **The `TEMPORAL` regex**, §7.4. Low stakes, but it currently prints a false answer to the
  question this document exists to answer.
- **No PARTIAL response has ever been reproduced live** across two passes, though the
  captured `brick/devsecops/sast_response.json` contains one. The tolerance stays; it is
  simply still unexercised outside the fixture.
