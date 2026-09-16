# Wiz Sidekick DevSecOps

Remediation analytics for **code-side** Wiz findings — SAST, SCA and secrets — as a Google
Apps Script web app. Sibling to the OS-vulnerabilities tool in [`../gas/`](../gas/) and the
AI-asset tool in [`../gas_ai/`](../gas_ai/).

Same architecture as both: a Google Sheet as the durable store, Drive for gzipped archives,
an HtmlService SPA, and a resumable job runner. Same "Audit Ledger" design system, with a
bright-yellow brand (`#ffcb13`) instead of Signal Blue or crimson — the severity palette is
deliberately identical across all three, so a severity means the same thing wherever you
read it.

## Status: Phase 2 complete — all ten pages lit, never deployed

**What is real:** everything from the shell to the screen. The domain layer (19 modules
ported from `brick/` against golden fixtures), the transport, the archives, the
journaled ledger commit, the sync battery, eight read models behind twenty RPCs, the standing
triggers, and all ten pages rendering real figures. `test/pagesLit.test.js` is the phase's
exit gate — seven criteria, and it passes.

The battery has been **exercised against the live tenant** (secrets and sast; `sca` skipped
as ~38 pages against a production API), with Sheets and Drive in memory: 1,931 secrets nodes
folded to 1,324 ledger rows, SAST's `createdAt` on 127/127 rows, and a second immediate sync
reporting new/resolved/reopened of 0/0/0. See [PROBE_FINDINGS.md](PROBE_FINDINGS.md) §12.

**What is not, and each is written down rather than implied:**

- **It has never been deployed.** There is no `.clasp.json` in this repo — the `scriptId`
  belongs to whoever deploys. Nothing has ever run inside Apps Script, against a real Google
  Sheet, or under the real quotas. The Setup section below is untested in that sense.
- **The secrets ledger key is an open question, not a decision.** The live fold showed 2.87
  occurrences per duplicated key where the repo-versus-branch twin model predicts 2. If the
  excess is the same credential-line in *different repositories*, the key merges genuine
  findings. PROBE_FINDINGS §12.2 names the read-only measurement that settles it.
- **UUID stability across Wiz's own rescans is still inferred**, not measured — the
  idempotency result above only covers an unchanged upstream.
- **The commit hash is fetched and discarded.** `Q_SAST` selects `commitHash` and `Q_SECRETS`
  `initialCommitHash`; `LEDGER_COLUMNS` has no column for either. That needs a schema bump.
- **`trend.ts`'s SLA-burn / open-past-SLA series still reads the bare `SLA_TARGETS` constant,
  never `effectiveSlaTargets`.** The settings-unification wave's P5 wired every other reader
  through an operator's saved window — `metrics.summarize`'s `buildMttr` (the headline `slaPct`
  and the per-severity `sla_target` table) and `scanJobs.dailyStats`'s durable snapshot — and
  named this one a deliberate gap rather than a missed call site: `loadTrend`'s
  `withOpenPastSla`/`withSlaBurn`/`cohortSlaAttainment` chain (`src/server/ledgerStore.ts`, read
  by the History page and by `mttrPageTrendSlice`) carries historical/backfill semantics — a
  saved window would reshape how already-past scans are judged, retroactively — that deserve
  their own package rather than reusing P5's pattern in the same hour it landed. Until that
  lands, this series will disagree with every other SLA figure in the app the moment an
  operator overrides a window.
- Several page sections are **honestly empty** because the read models do not publish the
  data: the history open-past-SLA trend and per-severity KM curves. Each page says which
  figure it cannot draw instead of drawing a zero.

**Two ways to slice it, and neither is nested inside the other.** The app header carries one
scope control with two dimensions: a **project** (where Wiz files the repository — business
units, support groups and leaves, read off `projects_json`) and a **business domain** (who the
tenant says owns it, from the repository's `Wiz/Domain` tag). Picking either clears the other,
because a header that carries two scopes cannot answer "what am I looking at" in one line.

**The project axis has two grains, and the app keeps them apart.** The tenant files every
repository under a **support group** — a project whose name's first segment is `CS`, `CE` or
`LU` — and under a **product**, one whose first segment is `product`. One support group holds
many products. Wiz reports all of them in a flat `projects[]` with no parent links, so that
containment lives in the tenant's naming and never in the payload: `src/domain/projectGrain.ts`
is the one place both rules are written down, and the client keeps a mirror of it that a test
holds equal.

Both grains are attached on read — `_supportGroup` and `_product`, beside `_domain`, at
`readModels.baseSnapshot` — rather than stored. A prefix rule is vocabulary, and vocabulary
changes; baked into the ledger a fourth prefix would cost a re-scan to correct, and because
reconcile merges those columns latest-wins-never-erased a stale value would keep winning even
then. Each falls back so rows already on the sheet still answer, and the product one refuses
the single case it can prove wrong: it takes `owner_project` unless that value is itself a
support group.

That column, `owner_project`, is what this replaced. It took "the first non-folder project",
which under this convention usually lands on the product — but not always: where Wiz reported
the support group as a leaf and returned it first, the same column held a support group. One
column, two grains, decided by API order, and every table on it headed "Owning project". The
three register pages now break down **By product** and **By support group**; the Repositories
cold zone rolls up by product with the support group as a column (the verdicts and the
coldest-share badge are calibrated on the finer population, so the roll-up stays there and the
group is the escalation path beside it); and the switcher gives each support group its own
heading with its products under it. Where a product's repositories name two different support
groups, nothing names one — a summary that hides a disagreement is worse than one that reports
it.

**One project is excluded from both, because it reaches everything.** Wiz files a repository
under every project that touches it, and the tenant's GitHub connector puts `GITHUB-DKTUNITED`
on all of them. As a switcher row that is "everything synced" under another name; as an
`owner_project` it is a bucket named after the organisation that owns the whole register. So
`src/domain/config.ts`'s `ORG_WIDE_PROJECTS` names it, `projectScope.ts::parseProjects` drops
it before the catalogue, the membership predicate or the unattributed count see it, and
`reconcile.ts::ownerProject` will not file a repository under it — a repository carrying only
that tag reads as **no owning project**, and is counted in the header's `have no project`
figure rather than quietly attributed to the organisation. The stored `projects_json` and
`tags_json` keep it, whole: this is an exclusion from the analysis, not from the observation.
A second connector tag is one edit to that list; it is spelled out rather than inferred from a
`GITHUB-` prefix, so a business unit named after a tool is never hidden by accident.

The domain arrives by a different route than the project, and the difference is the whole
design: `projects[]` is in all three query documents, so it rides in on every finding, but
**none of the three can select an asset's tags**. `VulnerableAssetRepositoryBranch` is the one
member of the `vulnerableAsset` union that Wiz's own console query omits `tags` from — it is
on the other twelve — and a field the schema lacks fails the whole document, so asking anyway
would stop SCA syncing. So `src/server/repoDomains.ts` graphSearches the tenant's tagged
repository entities separately, builds a repository-identity → domain map on the `domain_map`
tab, and attaches `_domain` to rows **on read**, never baked into the ledger. That is the same
shape `gas/src/server/supportGroups.ts` already uses for a `Wiz/provisioning` tag that lives on
a subscription findings carry without its tags.

Two consequences a reader meets on screen. The map is refreshed from **Settings → System →
Business domains**, on its own clock rather than with a sync — tagging changes when tagging
changes, not when findings do. And until it is refreshed there are no domains: the switcher
simply has no Domains group, the caption counts the rows as `have no domain`, and the Settings
card says *Never refreshed* rather than letting an unrefreshed map look like an untagged
tenant. An unreachable map degrades the same way rather than taking the pages down with it.

**The registers page server-side**, because SCA is 17,991 rows and the reader looks at fifty.
`src/server/readModels.ts`'s `registerRowsModel` (through `serverCache.ts`'s durable, 1-hour
memo) derives the full filtered/sorted set once and slices it per request: `page` and
`pageSize` are deliberately not in the cache key, while anything selecting which rows exist
is. The rule is the sibling's, and its reason is the same — without it every Next click
re-runs the whole pass to throw all but one page away.

**A resolved finding's death date is not always a measurement**, and the registers say so per
row rather than in a footnote. Where `resolution_src` is `disappeared` the date is the scan
that first stopped seeing the finding — an upper bound whose error is the scan interval. On
SAST that is *every* closed row; on SCA and secrets it is most of them.

**The design that carried the risk.** Neither source register does three scopes in one
ledger: `gas/` has one, and `brick/`'s reconcile takes a `scope` but only stamps it,
because its caller hands it a prior already filtered down. Here the prior is one tab holding
all three, and every row of the other two is absent from any given scan by construction — so
a disappearance pass that did not filter by scope would resolve 19,949 findings as
remediated in one sync. `reconcile` filters the prior itself rather than trusting a calling
convention, and a mutation check in the suite confirms that removing the guard does exactly
that.

**Where the domain comes from.** Not greenfield.
[`../brick/`](../brick/) implements this product as a tested Spark
pipeline: real captured Wiz queries, a cross-scan lifecycle reconciler, Kaplan–Meier with
censoring and RMST, the P2P coverage/efficiency/capacity family, and ~6,400 lines of tests.
`test/reconcile.test.js` replays the behaviours its `test_ledger.py` names. The statistics
are ported from `gas/src/domain/remediation.ts` — with one correction the port found by
measuring: its KM quantile compares survival to the threshold exactly, and a running product
that mathematically lands on it can land one ULP above, so the p90 came back 10 where the
arithmetic says 9.

## Pages

Three lanes and a chrome tail. The IA lives in exactly one place — `PAGES` in
`src/client/js/app.js` — and `test/shared.test.js` forbids a second list.

**A sync is the act; a scan is the record it wrote.** You *run a sync*; it touches three
registers and saves *one scan per register*; you *browse scans*. So "Scan history", "Saved
scans", "Delete scans" and "first scan / last scan" are right — they name records — and "run
a scan" is wrong, because a scan is not a thing that runs. The control is the **Run sync**
button in the rail; the rail area around it is the sync zone, and nothing a reader sees calls
it a scan zone. Wiz's own detectors are a third thing — **the scanner** — never "the scan" on
its own. A lower bound is written the same way everywhere: prose says "at least N", a numeric
cell or tile says "≥ N", and ">" is never used for a bound, because "at least" is inclusive.
This paragraph is the only place the rule is written; `src/client/js/pages/history.js` points
here and `test/vocabulary.test.js` holds the copy to it.

| Route | Title | Lane | The one question |
|---|---|---|---|
| `executive` | Executive | Program | How fast is code risk closing, how much is open, where is it going? |
| `mttr` | MTTR & SLA | Program | How long does a finding live once you stop discarding what is still open? |
| `program` | Coverage & efficiency | Program | Did the effort land on what mattered, and can it keep up? |
| `sca` | Dependencies | Registers | Which third-party CVEs are open, and is there anything to upgrade to? |
| `sast` | Code | Registers | Which weaknesses are in our own code, and where? |
| `secrets` | Secrets | Registers | Which credentials are in the repository, and are they dead yet? |
| `repos` | Repositories | Data | Where does the backlog sit, which repos have gone cold, who owns them? |
| `history` | Scan history | Data | What was actually measured, when? |
| `data` | Storage | Data | What is stored, what can be exported, what can be reset? |
| `settings` | Settings | — | Register, SLA windows, the cold-zone mode, access, system. |

### Why SAST, SCA and secrets are three pages

Because their remediation clocks differ in kind. SCA cannot be fixed before a fixed version
exists, so its clock splits into "waiting for a vendor" and "actionable". SAST has no
vendor — and **no resolution date** either, so its death date comes from the finding
disappearing between scans rather than from the API, and the page says which end is
measured and which is estimated.

That question — whether SAST can carry an MTTR at all, or only an age — was open across
three probe passes and is now settled: it is a **genuine MTTR**. `createdAt` gives a real
birth date, and the ledger dates the death by disappearance with no guard on how the
resolution was learned (`brick/ledger.py`, pinned by
`test_mttr_is_measured_from_the_ledgers_own_dates`). The one caveat is that the death side is
observation-bounded — the scan that noticed overstates by up to one scan interval — so a
ledger started today reads near-zero until disappearances accrue. A secret leaves the register when the string leaves HEAD,
which is not the same as the credential being dead. One merged register would have to lie
about at least two of them, and the clock is the product.

## Setup

1. `npm install`
2. Create the Apps Script project and point `.clasp.json` at it (git-ignored — the
   `scriptId` belongs to whoever deploys, not to the repo).
3. `npm run push`
4. In the Apps Script editor, run `setup()` once. It creates the ledger spreadsheet and the
   Drive archive folder, ensures every tab and header, and seeds `ALLOWED_USERS` with the
   owner. It also installs the standing triggers — one daily sync plus three staggered
   read-model warms — and records their schedule as a signature so a second `setup()` on an
   unchanged schedule adds nothing rather than accumulating duplicates against the 20-trigger
   quota. Budget: 4 standing + up to 2 transient (continuation and watchdog) = 6 of 20.
5. Set `WIZ_API_TOKEN`, or `WIZ_CLIENT_ID` + `WIZ_CLIENT_SECRET`, in Project Settings. Then
   open Settings → System and press **Test connection**: `hasCredentials` only means three
   Script Properties are non-empty, and the button is what turns that into a token exchange
   the tenant actually accepted.

   **A deployment made before the collection round cannot reach Wiz until the project is
   re-authorized**, and the symptom names a scope rather than a remedy: *"not authorized to
   call UrlFetchApp.fetch — required permissions: …/script.external_request"*, in the script
   owner's locale.

   `dist/appsscript.json` declares `oauthScopes` explicitly for exactly this reason. Both
   sibling projects rely on Apps Script inferring them and get away with it — but they called
   `UrlFetchApp` from their first push, so their first consent already covered it. This is the
   only one of the three that ever WIDENED an already-authorized project, and inference did
   not ask: the call is present in `dist/server.js`, the editor run failed with that message,
   and no consent prompt appeared anywhere. Declaring the scope makes the requirement a fact
   about the manifest, and a manifest change is what makes Apps Script re-ask.
   `test/manifestScopes.test.js` keeps the list honest in both directions — it fails if a
   service the bundle calls has no scope, and if a scope is declared that nothing calls.

   In order:

   1. `npm run push`, so the new manifest reaches the project.
   2. In the editor, run **`wizDiagnostic()`** and **accept the consent prompt**. Read the
      **Execution log** — that is where both diagnostics print, and it names which step
      failed.
   3. **Deploy → Manage deployments → Edit → New version.** `clasp push` changes the code the
      editor runs; the `/exec` URL keeps serving the version it was pinned to.
   4. Check the daily sync trigger still fires. A scope change is the one thing that can
      suspend an installable trigger with nothing in the UI to say so.
6. Run `deploymentDiagnostic()` if anything looks wrong; it reports every check at once
   rather than stopping at the first failure. `wizDiagnostic()` is its network-touching
   sibling: it does the real token exchange and one query, and names which of the two failed
   — they look identical from the app and have different remedies.

Access fails **closed**: an unset `ALLOWED_USERS` means owner-only, and the owner is allowed
by identity rather than by membership.

## Development

```
npm run dev        # http://localhost:8787 — rebuilds and re-boots on every page load
npm run probe      # read-only probe against the tenant (see below)
npm run check      # typecheck + vitest + build
npm run test:exact # the same suite under full module isolation
npm run which-build <stamp>   # which commits produced a deployed build id
```

### The probe

`npm run probe` answers "will the battery work here, and what does this tenant actually
offer" **without writing anything anywhere** — no sheet, no Drive file, no Wiz object. It
sends the app's own queries: `src/server/wizQueries.ts` is bundled and imported by
`probe.mjs`, which is why that file may never touch an Apps Script global. A probe that
quietly diverged from the battery would be worse than no probe.

```
npm run probe -- --dry-run     print exactly what would be sent; send nothing (no credentials needed)
npm run probe -- --roots       which query roots exist — this is how the secrets register gets found
npm run probe -- --schema      does SASTFinding expose a timestamp?
npm run probe -- --scope=sast  one register instead of all
npm run probe -- --first=25    rows per sample page (default 3)
npm run probe -- --report      also write probe-report.json (git-ignored)
```

Credentials go in `.env.local` or `dev/.env.local` (both git-ignored; `dev/` wins per key):

```
WIZ_API_URL=https://api.<dc>.app.wiz.io/graphql
WIZ_API_TOKEN=...          # or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET
WIZ_PROJECT_ID_V2=...      # optional; scopes every query
WIZ_DOMAIN_TAG_KEY=...     # optional; the repository tag whose value is a business domain
                           # (default Wiz/Domain) — see "Two ways to slice it" below
```

**The two questions it exists to answer.**

1. *Does `SASTFinding` expose a selectable timestamp?* The pagination cursor in the captured
   response base64-decodes to `{"Field":"finding_severityOrder","Value":"4_2026-07-02T…Z"}`,
   so a server-side date demonstrably exists — the documented selection set just does not
   offer one. If it turns out to be selectable, SAST gets a real remediation clock and
   `SAST_FETCH_RESOLVED` can be turned on. If not, the current design stands. The probe
   introspects the type, and falls back to probing candidate field names one at a time and
   reading the refusal when introspection is closed.
2. *What is the secrets root called, and does it distinguish removed from rotated?* There was
   no capture of a secret finding anywhere in this repository, so `Q_SECRETS` was `null`
   rather than a guess — a plausible document would typecheck, ship, and then measure the
   wrong population. **Answered, and the query is now written from the schema:** the root is
   `secretInstances`, and removal (`status`/`resolvedAt`) and rotation
   (`validationStatus`/`lastValidatedAt`) are independent axes on the node type.

**Both are answered as of 2026-08-27** — see [PROBE_FINDINGS.md](PROBE_FINDINGS.md).
Briefly: `SASTFinding` *does* expose `createdAt`, but no `resolvedAt` and no resolved rows,
so `SAST_FETCH_RESOLVED` stays `false` for a new reason; the secrets root is
`secretInstances` and it *does* separate removed (`resolvedAt`) from rotated
(`validationStatus`). The same run found the SAST query refused by this tenant with
`VALIDATION_INVALID_TYPE_VARIABLE` — `filterBy.severity` is an object filter, not a list.

That defect is **fixed in `28c74f9` and verified** — SAST returns `totalCount 127`, and the
three timestamps come back populated (PROBE_FINDINGS.md §7). `Q_SECRETS` is now unblocked:
§7.3 has the identity fields and the filter shapes, including the trap that
`SecretInstanceVcsDetails` spells the commit `initialCommitHash`, not `commitHash`.

**`Q_SECRETS` has now been sent (§8), and one filter key is still wrong.**
`SecretInstanceFilters.codeToCloudPipelineStage` is an OBJECT `{equals:[...]}`, not the bare
list SCA uses for the same field name, so `secretInstances` is refused with
`VALIDATION_INVALID_TYPE_VARIABLE` until `"codeToCloudPipelineStage"` joins
`OBJECT_FILTERS.secrets`. With that one key corrected the query returns 691 rows and the
document itself is sound. `--schema` now prints the send-shape for **every** field of all
three filter types, which is what makes this class of defect visible before it ships.

**That key landed, and the register now returns 843 rows (§9)** — but the probe still
prints `0 node(s)` for it, because `probe.mjs:402` omits `secretInstances` from the
connection chain and falls through to `{}`. Do not read that zero as an empty register.
Two defaults are unsettled: the severity gate excludes every `CERTIFICATE` and half the
`PASSWORD` rows in the estate (§9.2), and the ledger key `(secretDataId, path)` collides
2.27:1 — `externalId` is unique across the whole register (§9.5).

**Both are resolved as of §10.** `resolveConnection()` reads the root off the response, so a
zero has to prove it looked; the severity gate is off and the register is the whole CODE
population, **1,958 rows** including every `CERTIFICATE` and `PASSWORD`. One correction:
§9.5's recommendation of `externalId` as the ledger key is **superseded** — it is unique
because it *preserves* the repo/branch duplicate, and the two twins carry `firstSeenAt`
a median of 20 days apart. Key on `(secretDataId, path, lineNumber)` with the earliest
`firstSeenAt` (§10.6, §10.7).

**That key is now implemented.** `src/domain/secretsLedger.ts` is the secrets normalizer: it
derives the key from the triple, folds the twins, and resolves every field they can disagree
about rather than taking whichever row the API returned first — earliest `first_seen`, latest
`last_seen`, OPEN beating RESOLVED, the worse severity, and `VALID` beating `INVALID` beating
`UNKNOWN` on the rotation axis. Because the fold *discards* a measurement, each row records
what it discarded: `twin_count`, `twin_first_seen_spread_days` and `source_external_ids`.
`test/secretsLedger.test.js` pins each rule to the section that measured it, and pins the
`externalId` key producing two findings where the ledger key produces one.

§10.9's probe defect is fixed in the same pass, along with one of the same family it did not
name: an unrecognised argument is now **refused** rather than ignored (`--crosstab` was never
a flag), `--roots` names the sections its short-circuit skipped, and the crosstab states
whether it counted the whole population or stopped early — a table read as a population has
to say that it is one.

### What the probe and the register will not select

`Q_SECRETS` deliberately omits `snippet` (the matched text) and `validationDetails`. The
durable store is a Google Sheet plus gzipped Drive archives, readable by everyone on the
allowlist and exportable to CSV by any of them — a wider audience than the repository the
secret sits in, and 1,859 of the 1,933 CODE-scoped instances are OPEN. A secrets tool that
copies live credentials into a spreadsheet has made the exposure worse. The register answers
*which secret, where, how old, is it dead* from type, path, line and commit; triage opens Wiz
for the value itself. `test/wizQueries.test.js` holds it.

`npm run dev` runs the **real server bundle** in the browser against in-memory fakes for
SpreadsheetApp, DriveApp, Properties, Lock and Cache (`dev/gas-shims.js`), so no Google
account is needed. It **does** seed now: `dev/sampleData.dev.ts` generates raw Wiz-shaped
nodes — 400 sca, 40 sast, 120 secrets including 6 twin pairs, over three synthetic scans — and
`devSeed.seedSampleLedger()` pushes them through the REAL `slimRecord` -> `persistSync` path,
so what the harness renders is what the battery produces rather than hand-written rows. Add
`?noseed` for an empty store, or `?dry` to force the sample dataset when credentials are
present. Note that with credentials in `.env.local` a plain page load runs a **real sync
against the tenant**; the banner on startup says which mode you are in.

`src/server/sampleData.ts` is the production counterpart and ships **empty** on purpose — a
register that can fabricate findings cannot be trusted to report that it has none. A test
reads that file as text and fails on any non-empty array literal.

### Constraints worth knowing

- **`dist/` is committed on purpose.** It enables a no-toolchain deploy — copy-paste into
  the Apps Script editor on a machine where npm is blocked.
- **`dist/entry.js` is hand-written** and never touched by the build. Apps Script can only
  call top-level functions, so every RPC needs a global delegating into the bundled `Server`
  namespace. `test/entryPoints.test.js` holds it against `src/server/api.ts` as text,
  because the failure is silent and production-only.
- **The `{ok, data}` envelope is built in `api.ts`, not in `entry.js`.** The dev harness
  dispatches straight into `Server.api` and never runs `entry.js`; an envelope built in the
  delegator would make the harness and the deployment disagree about what a failure is.
- **No backticks survive the build.** An SSL-inspecting proxy was observed comment-stripping
  the served bundle with a tokenizer that understands quotes but not backticks, so esbuild
  emits none and the build fails if a bare `//` survives in the output.
- **Chart.js ships as its own partial** (`js_charts.html`), fetched on demand. It is ~170 KB
  and most routes draw nothing.
- Icons are inline stroke SVGs on `currentColor`. The sandbox blocks icon fonts and CDNs.

## Layout

```
src/domain/    pure logic — severity, config, settings semantics. No GAS globals.
src/server/    Sheets/Drive stores, access control, the RPC surface
src/client/    the SPA: shell, pages, design tokens
dev/           the local browser harness
test/          vitest specs
dist/          entry.js + appsscript.json (hand-maintained) + committed build output
```
