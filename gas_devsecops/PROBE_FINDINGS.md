# The probe against the live tenant — what it found, and what it changes

**Tenant** `api.eu15.app.wiz.io` · **project scope** `1dfea0cf-834f-5522-b797-bee5aaf09251`
(VALUE-CHAIN) · **measured** 2026-08-27 at `0f9c549`, **re-measured the same day** at
`28c74f9` (§7), `83d6b1e` (§8) and `24f541a` (§9) · branch
`claude/wiz-sidekick-decsecops-x75ex3`

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

- ~~**`Q_SECRETS`.**~~ Written in `83d6b1e`; §8.1 and §8.2 are the first time it was sent.
- **The SAST age-vs-MTTR decision** from §6, untouched by this pass. **Still open.**
- ~~**The `TEMPORAL` regex**, §7.4.~~ Fixed in `83d6b1e`, verified in §8.4.
- **No PARTIAL response has ever been reproduced live** across two passes, though the
  captured `brick/devsecops/sast_response.json` contains one. The tolerance stays; it is
  simply still unexercised outside the fixture. **Still true after three passes.**

---

# 8. Third pass — the first time `Q_SECRETS` was ever sent

**Re-measured** 2026-08-27, same tenant and project scope, at `83d6b1e`. Three runs:
`--dry-run` (three scopes now), `--schema --report`, `--first=5 --report`. Read-only.

## 8.1 The one inferred shape was wrong, and the schema says so out loud

`SecretInstanceFilters.codeToCloudPipelineStage` was the single field `buildFilter` sent on
inference rather than on reading — §7.3 printed only the three keys the probe had hardcoded,
so it was shaped after SCA's same-named field. **The inference does not hold:**

```
codeToCloudPipelineStage   SecretInstanceCodeToCloudPipelineStageFilter -> OBJECT { equals: [...] }
```

```
--- secrets ---
  REFUSED: HTTP 400: {"data":null,"errors":[{"message":"invalid type for variable: 'filterBy'",
           "extensions":{"code":"VALIDATION_INVALID_TYPE_VARIABLE","name":"filterBy"}}]}
```

Both readings agree. SCA spells the same field `[VulnerabilityCodeToCloudPipelineStage!]`, a
bare list; the secrets type wraps it in a filter. **Same field name, different kind, for the
third time in this document** — after `severity` in §4 and the `commitHash` /
`initialCommitHash` split in §7.3. The rule that keeps surviving contact: a field's shape in
one filter type predicts nothing about the same name in another.

The fix is one entry in `OBJECT_FILTERS.secrets`. That it is *sufficient* was verified rather
than assumed — the app's own bundled `Q_SECRETS` with only that key corrected:

```
as shipped : ["CODE"]              -> HTTP 400
corrected  : {"equals":["CODE"]}   -> HTTP 200, totalCount 691
```

Nothing else in the document or the filter is wrong. `--schema` now also prints a ready-made
`OBJECT_FILTERS entry:` line per filter type, so the value is copied from the schema rather
than retyped from a reading of it.

## 8.2 The population is sound, and the narrowing still applies

```
app filter (CODE + sev CRITICAL/HIGH + OPEN/RESOLVED)  691
CODE + status OPEN/RESOLVED, NO severity              1958
CODE only (the §3 baseline)                           1960
```

**1,960 against §3's 1,933 is 1.4% drift.** The drop to 691 is the severity filter, not lost
narrowing — worth stating because a register that fell from ~1,900 to ~700 for the wrong
reason would look identical from the outside.

`snippet` and `validationDetails` appear nowhere: not in the selection, not anywhere in the
raw payload. Both were checked directly rather than inferred from the document.

```
--- row 1 ---
  name/type      Aiven Service Password / SAAS_API_KEY   severity HIGH confidence High
  path:line      /resources/json/prod/eu/kconnect-updated.txt:6
  initialCommit  04182c373862053a7808541abf3e5e6947c8b17a
  REMOVED clock  status=OPEN  resolvedAt=null
  ROTATED clock  validationStatus=UNKNOWN  lastValidatedAt=null
  resource       dktunited/prodcom-jdbc-kafka-connect (REPOSITORY)
  id=d8e667c9-0d1c-5c36-a084-be66318ffd1d  secretDataId=0dd42a12-52f3-50e1-9b3f-c3053ca9d45d

--- row 2 ---
  name/type      Aiven Service Password / SAAS_API_KEY   severity HIGH confidence High
  path:line      /resources/json/prod/eu/kconnect-updated.txt:5
  initialCommit  04182c373862053a7808541abf3e5e6947c8b17a
  id=9cfe9b0d-d96e-5f38-80c2-d048387ac228  secretDataId=0dd42a12-52f3-50e1-9b3f-c3053ca9d45d
```

`ALWAYS NULL in this sample: resolvedAt, lastValidatedAt` — expected, since all five rows are
`OPEN` / `UNKNOWN`. §3 established both populate on rows that have them.

## 8.3 Two facts moved from unconfirmed to measured

**`secretDataId` is the dedup key.** One 500-row page of the CODE register:

```
rows 500   distinct id 500   distinct secretDataId 131     -> 3.82 rows per distinct secret
secretDataId values covering >1 row: 77
max rows under one secretDataId: 158   (8 distinct paths, 2 repo entities)
```

The two rows in §8.2 are one credential at lines 5 and 6 of one file. Key the ledger on
`secretDataId`; §7.3's caution is discharged.

**`PUBLIC_KEY` is zero here, so that worry is discharged too** — but the same table shows a
different one:

```
type                    CODE      share    app-filter
SAAS_API_KEY            1128    57.6%       328
CLOUD_KEY                210    10.7%       171
PASSWORD                 209    10.7%         0
CERTIFICATE              160     8.2%         0
PRIVATE_KEY              156     8.0%       156
DB_CONNECTION_STRING      87     4.4%        28
GIT_CREDENTIAL            10     0.5%         8
PUBLIC_KEY                 0     0.0%         0
SSH_AUTHORIZED_KEY         0     0.0%         0
PRESIGNED_URL              0     0.0%         0
```

**The severity filter silently deletes two entire categories.** `PASSWORD` 209 → 0 and
`CERTIFICATE` 160 → 0: every one of them sits below HIGH. `DEFAULT_FETCH_SEVERITIES =
CRITICAL, HIGH` is inherited from the vulnerability registers, where it is a reasonable
default. On secrets it produces a secrets register containing no passwords. That should be a
decision this register makes, not one it inherits.

## 8.4 The regex fix holds in both halves

```
SASTFinding exposes 43 fields. Temporal-looking ones:
  createdAt              DateTime!
  updatedAt              DateTime!
  firstDetectedAtSource  DateTime
  rejectionExpiredAt     DateTime

Sortable fields naming a time: CREATED_AT
```

Four fields, not §7.4's thirteen; `filePath` and `status` absent; and the order-enum line
still names `CREATED_AT`. Both halves at once, which is what §7.4 said one regex with `i`
could not do.

## 8.5 The asymmetry is now printed rather than discovered

```
SASTFindingFilters.severity            SASTSeverityFilter           -> OBJECT { equals: [...] }
VulnerabilityFindingFilters.severity   [VulnerabilitySeverity!]     -> bare LIST
SecretInstanceFilters.severity         SecretInstanceSeverityFilter -> OBJECT { equals: [...] }
```

Three registers, one field name, two kinds — on one screen. This output existing is the
reason §4's defect cannot recur quietly. SAST holds at **totalCount 127**; **SCA has not
drifted at all: 18,053, identical to §7.1**. `partialErrors: []` on both.

## 8.6 A duplicate the register has, and the fix that would make it worse

`BASE.secrets` carries no `isDefaultBranch`, while SCA and SAST both do. There is real
duplication — **18 of 176 `(secretDataId, path)` pairs appear under both `REPOSITORY` and
`REPOSITORY_BRANCH`**, roughly 10% of the page.

The obvious fix is wrong:

```
app filter, as shipped (no isDefaultBranch)    691
app filter + isDefaultBranch {equals:true}     245
app filter + isDefaultBranch {equals:false}      0
```

**245 + 0 ≠ 691.** The missing 446 rows are `REPOSITORY`-level entities whose flag is neither
true nor false but *absent* — a repository is not a branch, so the predicate does not apply
to it. Copying SCA's `isDefaultBranch: {equals: true}` would cut the register by 65% and read
as deduplication while actually being *absent collapsed to false*, the same failure the AI
register learned as **absent is never zero**. The 10% that is genuinely duplicated wants
deduplication on `(secretDataId, path)`, not a branch filter.

## 8.7 What is still open after the third pass

- ~~**One entry in `OBJECT_FILTERS.secrets`**~~ — done in `24f541a`; the register returns
  rows for the first time in §9.1.
- **Whether `DEFAULT_FETCH_SEVERITIES` is right for secrets** (§8.3). **Settled in §9.2, and
  the answer is no** — the provisional MEDIUM is still too high.
- **The repo/branch duplicate** (§8.6). **Still open**, and §9.5 measures how much of the
  identity collision it accounts for.
- **The SAST age-vs-MTTR decision**, open since §6. **Settled outside this document** — see
  the README: it is a genuine MTTR, observation-bounded on the death side.
- ~~**A refused scope writes no entry to `probe-report.json`.**~~ Closed in `24f541a`; §9.3
  reports that the mechanism has still never fired, and §9.1 the case it does not cover.

---

# 9. Fourth pass — the register returns rows, and the probe says it does not

**Re-measured** 2026-08-27, same tenant and project scope, at `24f541a`. Three runs:
`--dry-run`, `--first=5 --report` (now also paging a type × severity crosstab), and
`--schema --report`. Read-only.

## 9.1 The secrets register works. The probe reports it as empty

The shapes are right — `--dry-run` prints `{"equals":["CODE"]}` for secrets and a bare
`["CODE"]` for SCA. But the live run prints:

```
--- secrets ---
  0 node(s), hasNextPage undefined
```

**That zero is a defect in the probe, not in the register.** `probe.mjs:402`:

```js
const conn = r.data.sastFindings ?? r.data.vulnerabilityFindings ?? {};
```

`secretInstances` is absent from the chain, so `conn` falls through to `{}` and every field
reads empty. Line 440 has the correct `r.data.secretInstances ?? {}`, which is why the
crosstab in the very same run returned real numbers.

Sending the app's own `Q_SECRETS` with its own `buildVariables`, unmodified:

```
severities requested: ["CRITICAL","HIGH","MEDIUM"]
HTTP 200  errors: (none)
5 node(s), totalCount 843, hasNextPage true
```

**843, not 691.** Both diagnostic branches are excluded: the severity default *is* reaching
the query, and the shape fix *did* take. §9.2's crosstab confirms it arithmetically —
CRITICAL+HIGH sums to exactly 691 and +MEDIUM to exactly 843.

**This is a worse failure than the refusal hole `24f541a` closed.** A refusal now records
`{refused: true, error, variables}`. This records:

```json
"secrets": { "count": 0, "totalCount": null, "sample": null }
```

No error, no flag, nothing to notice — a confident false zero on the *success* path, which
reads exactly like a register that is legitimately empty. The refusal fix guarded the branch
that announces itself and left the one that does not.

## 9.2 The provisional MEDIUM is still too high — settled

```
type                      CRITI   HIGH  MEDIU    LOW  INFOR
CERTIFICATE                   0      0      0      0    160
CLOUD_KEY                     0    171      0     39      0
DB_CONNECTION_STRING          0     28      0     41     17
GIT_CREDENTIAL                0      8      0      0      2
PASSWORD                      0      0    107     17     84
PRIVATE_KEY                   0    156      0      0      0
SAAS_API_KEY                  0    328     45    641    114

categories with NOTHING at CRITICAL/HIGH: CERTIFICATE, PASSWORD
```

§8.3 established that `PASSWORD` and `CERTIFICATE` sit *below* HIGH. It did not establish
that they sit *at* MEDIUM, and they do not:

- **`CERTIFICATE`: all 160 rows are INFORMATIONAL.** Not one is MEDIUM. The default captures
  **0 of 160** — the category is still entirely absent from the register.
- **`PASSWORD`: 107 MEDIUM, 17 LOW, 84 INFORMATIONAL.** The default captures **107 of 208,
  51%** — half the passwords in the estate are still excluded.

So the guess was half-right on one category and wrong on the other, and the register still
contains no certificates and half its passwords. What the gate costs:

```
CRITICAL+HIGH        691
+MEDIUM              843   <- today's default
LOW 738 + INFORMATIONAL 377 = 1,115 excluded
CODE population    1,958   -> the register captures 43%
```

**The deeper problem is that severity is the wrong gate for this register.** It is Wiz's
judgement about a *detection* — 641 `SAAS_API_KEY` rows sit at LOW — not about whether a
credential is live. The secrets page asks "which credentials are in the repository, and are
they dead yet"; `validationStatus` and `confidence` speak to that and severity does not.
Dropping the severity filter entirely takes the register to 1,958, and the honest version of
this default is probably no severity gate at all.

## 9.3 The refusal mechanism is in, and has still never fired

**Nothing was refused this run** — all three scopes returned HTTP 200, so no
`{refused, error, variables}` key was written. That is correct behaviour rather than a gap,
but it means the mechanism added in `24f541a` is **still untested against a live refusal**.
§9.1 is precisely the case it does not cover.

## 9.4 SAST and SCA: shapes byte-identical, one count drifted

The `--dry-run` blocks were diffed against §8's rather than compared by eye:

```
=== sca : pass3 vs pass4 ===   IDENTICAL
=== sast : pass3 vs pass4 ===  IDENTICAL
```

`shapeBase` touched neither. **SAST holds at `totalCount 127`.** SCA reads **17,991 against
§8's 18,053** — 62 fewer, 0.34% in a day, the same drift already recorded in §7.1 and §8.5.
`partialErrors: []` on both; **no PARTIAL has been reproduced live in four passes.**

## 9.5 The ledger key does not survive a second page

`snippet` and `validationDetails` appear nowhere — checked against the raw response text,
not merely the parsed keys.

The identity reading does not hold. Two independent pages (500 + 343 = 843, the whole
register):

```
                                  page 1              page 2
id (the API's own)            1.00 rows/key       1.00 rows/key
secretDataId                  4.39                2.09
(secretDataId, path)          2.27                1.37     <- the ledger key as built
(secretDataId, path, line)    1.32                1.06
(sdId, path, line, resource)  1.00                1.00
externalId                    1.00                1.00
```

**`(secretDataId, path)` collides 2.27:1 on page 1**, with one pair covering 49 rows. It
improves on `secretDataId` alone (4.39) but it is not an identity, and a ledger keyed on it
would merge distinct findings. Two causes, measured:

```
residual on (secretDataId, path, line): 85 colliding keys
  of those, 56 span BOTH REPOSITORY and REPOSITORY_BRANCH
  => the repo/branch duplicate (§8.6) explains 66% of the residual
```

The remainder is one secret on several lines of a single file. So the pair conflates three
different things at once: distinct lines, and the repo/branch double-count.

Two candidates are unique across the entire register: **`externalId`** and
`(secretDataId, path, lineNumber, resource.id)`. `externalId` is Wiz's own composite —
`github.com##<repo>##<path>##<contentHash>##<lineIndex>` — and is the natural ledger key.

One inference, flagged as unverified: `id` and `secretDataId` both carry a version-5 nibble,
i.e. name-based UUIDs derived from content, which *would* make them stable across scans.
That is read off the UUID version, not measured — a single day of observation cannot
establish stability, and the ledger depends on it.

## 9.6 What is still open after the fourth pass

- **`secretInstances` into `probe.mjs:402`.** One line. Until then a working register reports
  as empty, and `probe-report.json` records a false zero with no error beside it.
- **The severity gate on secrets** (§9.2). MEDIUM is not the fix; the question is whether
  this register should gate on severity at all.
- **The ledger key** (§9.5) — `externalId`, or the four-part tuple. Not the pair.
- **The repo/branch duplicate** (§8.6), which §9.5 shows is two-thirds of the key collision.
- **UUID stability across scans** (§9.5), inferred from the version nibble and not measured.
- **No live PARTIAL in four passes**, and now a refusal mechanism that has never fired
  either. Both tolerances remain unexercised outside the fixture.
