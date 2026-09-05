# CLAUDE.md

Guidance for agents working in this repository.

## What this is

A **product**-register Streamlit dashboard over Wiz vulnerability findings: OS-level CVEs on
host workloads, severity breakdowns, MTTR / SLA remediation analytics with a persistent
scan history, and — in the GAS rebuild — Prioritization-to-Prediction program metrics
(remediation coverage, efficiency, capacity). Entry point is `app.py` (`st.navigation` / `st.Page`); pages live in
`wiz_dashboard/ui/pages/`, shared logic in `wiz_dashboard/{config,data,domain,models}`.

`gas_devsecops/` is a fourth register over the same design system: MTTR and remediation
analytics for SAST / SCA / secrets findings in source repositories, with `brick/devsecops/`
as its behavioural spec.

`gas/` holds a full Google Apps Script rebuild of the same product (Google Sheets ledger +
Drive archives + HtmlService SPA). The Python `wiz_dashboard/domain/` layer is its behavioral
spec: `gas/test/export_*.py` generate golden fixtures by running this code, and the TypeScript
ports are tested against them — after changing the Python domain layer, regenerate the fixtures
and run `cd gas && npm run check`. See `gas/README.md`.

`gas_shared/` is the one copy of the component base, stylesheets and design tokens that
`gas/`, `gas_ai/` and `gas_devsecops/` all draw with — plain ES modules and plain CSS,
imported by relative path, bundled by each app's own esbuild step, nothing installed. It
holds `ui/` (components, `index.js` the one barrel, `helpPage.js` a page and deliberately
not in the barrel), `shell/` (`app.js`'s shell — nav rail, appbar, boot splash, the flyout
panel — plus a generated `index.template.html`), `api.js`/`store.js`/`icons.js` (the RPC
bridge, the bootstrap/RPC cache, node-kind SVG), `appConfig.js` (the seam, below),
`styles/` (nine sheets, `tokens.base.css` first and `overrides.css` last), `test/contracts/`
(eleven spec factories the apps register from their own test files), and `measure.mjs` (the
wave's own before/after measurement — see `gas_shared/README.md`'s "Before / after"). Read
`gas_shared/README.md` before touching any of it; it is the design system's own spec, the
same way `wiz_dashboard/domain/` is `gas/`'s.

**The `appConfig` seam.** A shared module cannot reach sideways into an app — `ui/tip.js` has
no `../helpContent.js` to import, `store.js` cannot know which route is a register's front
door. Each app's `app.js` calls `configureApp(manifest)` as the FIRST statement of its module
body (productName, openingNoun, storagePrefix, defaultRoute, findHelpEntry, sync, …), and
every shared consumer calls `appConfig()` to read it back — **always inside a function, never
at module top level.** A top-level read runs during `import`, which under esbuild's bundling
order happens BEFORE `app.js`'s own body runs, and throws even on a correctly wired app.
`appConfig()` throws with nothing configured, on purpose: a default would silently hand one
app another app's front door.

**The contract-factory pattern.** `vitest.config.ts` in each app collects only that app's own
`test/` directory, so a shared rule cannot *be* a test file — it is a factory function in
`gas_shared/test/contracts/*.js` that an app's own `test/shared.test.js` calls with vitest's
`describe`/`it`/`expect` and that app's specifics (severity constants, route lists, the
manifest's copy). The same arithmetic or sweep then runs against three different brands /
route sets / section lists instead of being re-typed three times. Every assertion in there is
optional-with-a-named-skip where an app legitimately differs (no SLA table, no error log, no
`ctx.localSheets` given yet) — a silent pass is the failure mode these guard against, so a skip
always names why in the test summary rather than just not running.

**Traps this wave earned:**

- **`npm run check:exact` uses POSIX `VAR=1 cmd`** (`test:exact`'s `GAS_TEST_FULL_ISOLATION=1
  vitest run`), which fails under npm's default Windows shell (`npm_config_script_shell=bash`
  was the four-times-repeated workaround). P9 fixed the script itself in all three
  `package.json`s to `node -e "process.env.X='1';require('child_process').execSync(...)"`,
  which needs no shell-specific env-var syntax at all; the workaround still works too, but is
  no longer necessary.
- **The dev harness serves a stale CSS bundle.** Bust it with `?dry&v=<n>`. A 0.0000%
  screenshot diff between two runs is a finding that the harness served the SAME bundle
  twice, not a pass.
- **A committed `dist/` going stale bit twice** (P4a: `gas_devsecops/dist/styles.html`
  missing 90 selectors; P4b: all three stale at `5ae4701`, `.rail-amp` in `gas_shared/`
  source and absent from every committed stylesheet) — both times because a `gas_shared/`
  change never triggers a rebuild here, and `gas/buildStamp.mjs`'s `sourceStamp()` only
  hashes `<root>/src`, so it stays green through exactly this class of defect. `npm run
  check-dist-fresh` (`checkDistFresh.mjs`, wired into `check`/`check:exact`, one per app)
  actually rebuilds and diffs the result against the committed bundle, modulo the
  `__BUILD_ID__` stamp, via `git show HEAD:<path>` — no second stamp mechanism, and no
  worktree touched.
- **`Number(null)` is `0`, and it is finite — the third time this bit.** `ui/figures.js`'s
  `relativeAge()` refuses null/undefined/blank/`[]`/`false` BEFORE any cast; the tempting
  "simplify the two branches" rewrite casts first and reads every one of them as epoch 0.
  `test/contracts/relativeAge.js`'s own perturbation reproduces the defective rewrite inline
  and shows it failing, rather than asserting the rule from a comment.
- **`portalsOpen()` answers two different questions with one counter, and the fix is not
  yours to make here — it belongs with `ui/sheet.js`.** `gas_shared/shell/navFlyout.js`'s own
  header has the full measurement: a PINNED nav panel is counted for the whole session, and
  the sheet's Tab trap (`if (portalsOpen()) return;`) stops wrapping while one is pinned
  (measured `{defaultPrevented: false, wrappedToFirst: false}` pinned vs `{true, true}`
  unpinned — `inert` still contains Tab to the sheet, only the wrap is lost). It stays because
  `gas_ai/pages/graph.js` (:726, :749) stands its own Escape handler down on the same count.
- **The dry-run fallback makes "disabled with a reason" a ONE-APP AFFORDANCE, not a parity
  gap.** `gas` and `gas_ai` fall back to `dryRunScan`/`dryRunSync` without credentials, so
  they have no disabled sync/scan button to explain; only `gas_devsecops` needs one, and its
  reason reaches the reader through the shared `tipAnchor()`/`.tip-disabled-wrap` mechanism
  (a disabled control does not reliably take the pointer/focus events a plain `title` or a
  bare tooltip needs). A scorecard or contract that expects all three to carry this is
  checking for a gap that was never there.
- **`gas_devsecops` still has no `navModel.js` test of its own** — `gas/test/navModel.test.js`
  and `gas_ai/test/navModel.test.js` exist; `gas_devsecops` has neither, and nothing here
  fixes that.

## Design Context

Before any UI or design work, read:

- **[PRODUCT.md](PRODUCT.md)** — register, users (security analysts + leadership), purpose,
  brand personality (precise, trustworthy, instrument-grade), anti-references, the five design
  principles, and the accessibility bar (WCAG 2.1 AA).
- **[DESIGN.md](DESIGN.md)** — the visual system: tokens, color and severity palette,
  typography, elevation, and components.

### Non-negotiable design constraints

- **shadcn/ui is emulated in CSS only** — no React, no component bridge. Native Streamlit
  theming (`.streamlit/config.toml`) is the source of truth for base surfaces, borders, radius,
  fonts, and the categorical chart palette. `wiz_dashboard/assets/styles.css` mirrors those
  values (Streamlit 1.58 does not expose its theme as `--st-*` vars to injected CSS) and styles
  only the bespoke widgets native theming can't express. Edit the two in sync.
- **Blue accent is `#2563eb`** (brand / data / focus). Primary buttons are a neutral near-black
  (`#0a0a0a`) by deliberate choice, not the blue `primaryColor`.
- **Light theme only** — pinned `base = "light"`; the CSS and severity palette are light-tuned.
- **Accessibility is load-bearing.** Never remove the focus-ring rules. Keep a
  `prefers-reduced-motion` alternative for every animation. Severity and status never carry
  meaning by color alone; pair color with a dot, glyph, or label. The severity *text* tokens are
  deliberately darkened from the *fill* tokens to clear 4.5:1 on pale tints — keep that split.

For design tasks, the Impeccable skill (`/impeccable <command>`) reads PRODUCT.md and DESIGN.md
automatically.

## Testing

`pytest` (pure-logic units run without a browser; app-level checks use Streamlit's `AppTest`).

## Working discipline

Each of these was learned by getting it wrong here. They survive context compaction only
because they are in this file.

- **Measure before asserting, and bisect when a cause is contested.** A test hang was blamed
  on CPU contention, then on the change under review; both were wrong, and a clean-HEAD `git
  worktree` settled it in one run. Reasoning about a contested cause is slower than testing it.
- **A fix that does not move the number you expected is a FINDING, not a success.** Unblocking
  a paginated query left `edge_count` byte-identical — which is how the real defect was found.
  Investigate the gap before claiming the win.
- **Never regenerate a golden snapshot without reading the diff line by line.** Additive is
  fine. A *removal* needs a stated reason before it is accepted.
- **Never make a failing test pass by editing the test** unless you can name the claim it
  encoded and show measurement falsifying that claim — then put that reason in the test. The
  bar is high on purpose: a test asserting the old contract is the normal way a real fix
  announces itself.
- **Report the honest number.** An attribution hop that recovered 7 of a possible 77 is a 7.
- **`Number(null)` is `0`, and it is finite — the cast is where "absent is never zero" stops
  being obvious.** This bit twice in one day, in unrelated packages: `cleanSettings` read a
  missing `syncSchedule` as the valid hour 0 and a missing `retentionDays` as "retain nothing",
  and a client `num(v, fallback)` helper rendered every genuinely-null figure (`density_p25`,
  `falling_behind_pct`) as a confident `0` instead of an em dash. `Number("")`, `Number([])` and
  `Number(false)` are 0 too. Refuse null/undefined/blank BEFORE the cast, never after, and let
  `Number.isFinite` guard only the values that were really numbers.
- **A guard that fires on nothing is a finding, not a pass.** Three separate packages here ran
  a deliberate perturbation and saw ZERO tests fail: a credential deny-list that was shadowed
  by an allow-list applied first, a durable-cache audit pinned to a list of names rather than
  to time-invariance, and an ordering (`DONE` before `afterPersist`) that two packages agreed
  on by accident and nothing held. In each case the fix was to find the one path where the
  guard actually bites and test THAT. Perturb every guard you write; if nothing breaks, the
  test is decorative.
- **Destructive commands get read twice.** `rm -rf` over a path that may contain a symlink or
  junction once deleted `node_modules/.bin` through it. Remove the link non-recursively first.
- **Commit locally; do not push or open a PR** unless asked. Message style is
  `<area>: <lowercase phrase stating the substance>` — the body explains the defect and the
  measurement that justifies the fix.

## gas_devsecops — the code register

A fourth register: MTTR and remediation analytics for **SAST, SCA and secrets** findings.
`gas_devsecops/` is the SPA; the domain layer is a Phase 2 port of `brick/devsecops/`, which
already implements the pipeline and is the behavioural spec (same relationship `gas/` has to
`wiz_dashboard/domain/`). Chassis forked from `gas_ai/`, analytics to be ported from `gas/`.

- **The clock is the product, and a clock has to say where it started.** Every figure states
  what it measured from and what it did with the rows it could not measure. Open findings
  stay in as right-censored observations; where the curve never reaches half, publish the
  lower bound, not a number.
- **SAST has a birth date and no death date, and that is enough.** This entry used to read
  "no timestamps in this tenant — none at all"; the live probe falsified it on 2026-08-27.
  `SASTFinding` exposes `createdAt: DateTime!`, filterable and sortable, and `Q_SAST` selects
  it. There is still no `resolvedAt` on the type and `status: RESOLVED` returns 0, so
  `SAST_FETCH_RESOLVED` stays `false` — for those two reasons, not the old one. The clock
  survives anyway: the ledger prefers the API birth date and dates the death by
  DISAPPEARANCE, so SAST gets a genuine MTTR rather than an age metric once two scans exist
  (`brick/devsecops/ledger.py`, pinned by `test_mttr_is_measured_from_the_ledgers_own_dates`).
  Caveat for the port: `brick`'s own `ingest.py:206` claims `silver_sast` already reads the
  column; it does not — `metrics.py:371` hard-codes `null_ts`.
- **The same field name carries DIFFERENT KINDS across filter types, and it has now cost the
  register twice.** `VulnerabilityFindingFilters.severity` is `[VulnerabilitySeverity!]`, a
  bare list; `SASTFindingFilters.severity` is `SASTSeverityFilter`, an object taking
  `{equals:[...]}`. Same for `codeToCloudPipelineStage`: a bare list on SCA, a
  `SecretInstanceCodeToCloudPipelineStageFilter` on secrets. And `vcsDetails` spells the
  commit `commitHash` on SAST but `initialCommitHash` on secrets. Each mismatch is refused
  with HTTP 400 `VALIDATION_INVALID_TYPE_VARIABLE`, which fetches zero rows while looking
  like an empty register — SAST shipped that way for a whole pass, secrets for one.
  `OBJECT_FILTERS` in `wizQueries.ts` holds the asymmetry as data and `shapeBase` routes
  EVERY list-valued key through it, because a table covering only part of the filter is
  worse than none: `codeToCloudPipelineStage` sat in `BASE` as a literal and bypassed the
  table entirely, so adding it to the table changed nothing. `npm run probe -- --schema`
  prints a ready-made `OBJECT_FILTERS entry:` per filter type — copy it, never infer it.
- **Severity defaults are per scope, and on `secrets` the gate is OFF.**
  `DEFAULT_FETCH_SEVERITIES.secrets = []`, and empty means all — `severityFilter([])` is `[]`
  and `buildFilter` then omits the `severity` key entirely. Two earlier answers were wrong in
  the same direction: `CRITICAL, HIGH` inherited from the vulnerability registers (where it is
  a volume control), then MEDIUM, on "PASSWORD and CERTIFICATE sit below HIGH" — true, and not
  the same as "they sit at MEDIUM". With the gate off the register is the whole CODE
  population, 1,958 rows = 691 CRIT+HIGH + 152 MED + 738 LOW + 377 INFO, and `CERTIFICATE`
  160/160 and `PASSWORD` 208/208 are finally in. Severity grades a DETECTION, not whether a
  credential is live — 641 `SAAS_API_KEY` rows are LOW — so the secrets pages segment by
  `validation_state` and `confidence` and never by severity. Volume was never the reason
  either: 1,958 rows is an eighth of SCA. `test/severityScope.test.js` pins the chain.
- **The second clock is computed, and it is only real on SCA.** This entry used to read
  "captured but not yet computed"; `ledgerCore.baseRows` now derives `fix_available_at`,
  `mttr_actionable_days`, `actionable_age_days` and `awaiting_vendor_fix` from `fix_date` /
  `fix_observed_at`. The part worth carrying: SAST and secrets have no vendor to wait on, so
  their `fix_available_at` collapses onto `first_seen` — which makes `mttr_actionable_days`
  identical to `mttr_days` there and `awaiting_vendor_fix` false by construction. Only SCA
  can leave `fix_available_at` null, and a null there is what puts a finding in the
  awaiting-vendor bucket rather than in the actionable one. A figure that averages the
  actionable clock across all three scopes is therefore two-thirds a restatement of MTTR.
- **Three scopes, one ledger, and `scope` is part of the key.** The same CVE arriving through
  a dependency and through a host image is two findings with two clocks.
- **Removed is not rotated.** A secret leaving the register means the string left HEAD. The
  credential is live until `rotated_at` says otherwise.
- **The tolerance for a GraphQL PARTIAL is no longer theoretical.** Seven passes saw none;
  the first live battery run hit one on every SAST fetch — `data` and `errors` together,
  message `"Resource not found"`, reproduced across two independent runs, so it is a standing
  condition of this tenant. The 127 rows still land with `first_seen` on all of them, which is
  the designed behaviour: a page carrying both nodes and errors has good nodes and a suspect
  COUNT. What the missing resource is remains unknown — the message names nothing.
- **A zero has to prove it looked.** The probe read its GraphQL connection off a hardcoded
  root chain that never learned `secretInstances`, so an 843-row register printed `0 node(s)`
  and wrote `{count: 0}` to the report with no error beside it — indistinguishable from a
  register that is genuinely empty. The refusal path had already been guarded; this one is
  silent, and guarding the failure that announces itself is not the same as guarding the one
  that does not. `resolveConnection` now finds the root in the response and REFUSES rather
  than returning an empty connection.
- **The secrets fold is NOT a twin any more, and that may make the key wrong.** The first
  live battery run (2026-09-03, PROBE_FINDINGS §12.2) folded 1,931 nodes to 1,324 rows:
  324 keys carrying duplicates but **607 nodes folded**, i.e. **2.87 occurrences per
  duplicated key, not 2**. The two-way model below predicts 324. 283 nodes are unexplained by
  it. The leading candidate is the same `(secretDataId, path, lineNumber)` in DIFFERENT
  REPOSITORIES — a copied config file does it — and since the key carries no `repo_id`, that
  would MERGE two genuine findings into one row with one clock and an owner decided by
  latest-wins. That is the opposite failure from the one the key was chosen to avoid, and no
  aggregate shows it: the row count merely looks better. Read-only measurement that settles
  it: group raw nodes by the triple and, for every group above two, print distinct
  `resource.type` and distinct repository id. Until then the 1,324 figure is provisional.
- **The secrets ledger key is `(secretDataId, path, lineNumber)` with the EARLIEST
  `firstSeenAt`, and `externalId` is unique for the wrong reason.** This entry recommended
  `externalId` on the evidence that it is unique; it still is, and keying on it would double
  the ledger. 187 keys span both `REPOSITORY` and `REPOSITORY_BRANCH`, and `externalId`
  differs on all 187 — Wiz builds it from the resource and the branch form inserts a branch
  segment — so it preserves the twin instead of resolving it. The two clocks disagree: the
  branch twin carries the earlier birth date in 135 of 187, the repo twin in 52, median gap
  19.9 d, max 285.3 d. So there is no resource type to prefer; keying on `externalId`, or
  taking `REPOSITORY` because it is the majority, records one secret twice and misdates 135
  of them by a median of three weeks. `secretDataId` names the credential and is what
  rotation groups by — not the row key. Every unique candidate encodes the line, so a line
  move still reads as a new finding, and UUID stability across scans is still inferred from a
  version-5 nibble rather than measured.
- **The accent is split and the split is load-bearing.** `--accent: #ffcb13` is 1.52:1 on
  white and 1.30:1 on the meter track — it is a FILL token and nothing else. Every accent
  fill carries `--accent-edge: rgba(0,0,0,.40)`, which lifts it to 3.49:1. Links, focus
  rings, accent ink and chart series all take `--accent-text: #7c4a0a` (7.39:1). The primary
  button stays graphite `#0a0a0a` — do NOT copy gas_ai's accent-filled button, white on this
  accent is 1.52:1. `test/tokens.test.js` holds all four.
- **The severity palette is byte-identical across all four surfaces.** A severity means the
  same thing everywhere; the brand deliberately does not.
- **`PAGES` in `app.js` is the only IA list**, and a labelled lane must hold two pages —
  `navModel` collapses a lane of one on the rail, but `renderStackedNav` below 800px draws
  the heading unconditionally, so a one-page lane restates its own link. `navGroups.test.js`
  caught exactly that during the fork.
- **The `{ok,data}` envelope lives in `api.ts`, not `dist/entry.js`.** `dev/boot.js`
  dispatches straight into `Server.api` and never runs the delegators.

## gas_ai — scoring conventions

The live-tenant figures live in `ai/AARS_LIVE_MEASUREMENTS.md` (dated, tenant-stamped, cannot
be pinned by tests). The seed-estate figures live in `ai/AARS_ASSESSMENT.md` and
`ai/AARS_SCORING_ASSESSMENT.md` and *are* pinned. Read the relevant one before re-measuring.

- **The iron rule, and its one exemption.** A TUNING change ships as a spec-neutral knob or an
  opt-in preset defaulting to today's behaviour — `DEFAULT_AARS_RULE`, `DEFAULT_PROBLEM_RULE`
  and `DEFAULT_POSTURE_RULE` do not move. A CORRECTNESS fix may change default behaviour, and
  proves it by leaving the pinned score vectors byte-identical.
- **Absent is never zero.** Wiz returns `null` for a flag it never evaluated; collapsing that to
  `false` is what made an unassessed asset render as a clean Tier 1. Distinguish measured /
  unmeasured / not-applicable (`src/domain/measurability.ts`), and keep the tri-state through
  the normalizer *and* the store round-trip.
- **A derivation knob joins its signature.** Anything changing WHICH rows are read (rather than
  how they price) must join `aars.derivationSignature` / `problemRule.vectorSignature`, or a
  persisted input is reused across the flip and the knob appears to do nothing.
- **Time is the best signal here, and this rule used to say the opposite.** It read "707 of 806
  issues carry no `dueAt`" — an artifact of synthetic rows deleted in `d301ab7`. Re-measured:
  `noDueAt = 0`. What the numbers actually say (`rankStats`, §3): the problem outcome alone has
  tie rate **1.000** and effective cardinality **1.00** — it separates zero pairs — while an
  overdue bucket scores **3.96** and age **3.86**. Normalising overdue by the SLA window is what
  destroys it; absolute buckets keep it. A fifth tree axis was still dropped, on distribution
  rather than on coverage.
- **Which time signal wins depends on the register, and overdue only wins on the narrow one.**
  The 3.96-over-3.86 above holds on the AI slice, which is the *only* slice where `dueAt`
  coverage is 100%. Measured over a wider category set (`AARS_LIVE_MEASUREMENTS.md` §6.3):
  `dueAt` coverage falls to **38.4%**, and at the whole-project ceiling to **26.4%**, while
  **age keeps 100% coverage by construction and its effective cardinality rises to 4.26**. So
  prefer `createdAt` age buckets for anything scored outside `wct-id-1998`, and read the pair
  above as a fact about that slice rather than about time. `>730d` is always empty here.
- **Non-agent assets get their own lattice**, rather than exclusion from posture.
- **Findings land in `ai/AARS_LIVE_MEASUREMENTS.md`.** Update it as they land, dated and
  tenant-stamped; do not open a new assessment document for them.

## gas_ai — environment traps

- `npm run check` runs from `gas_ai/`, not the repo root.
- **`npm run build` writes `dist/`, NOT `dev/server.dev.js`.** The dev bundle is rebuilt when
  `http://localhost:8787/` is requested. A stale bundle makes a working feature read `undefined`.
- **Live syncs hit a production security tenant** (~71 API calls, ~2 min). Prefer the read-only
  `node probe.mjs`; credentials in `gas_ai/.env.local`, proxied through `/_fetch`.
- A dev-server **500 with `Command failed: node esbuild.config.mjs` and empty stdout AND
  stderr** is a failed *spawn* under memory pressure, not a failed build. Restart it.
- **`TaskStop` kills the wrapper, not the child.** Check for orphaned vitest processes before
  concluding a test hangs; never kill the dev server or tsserver.
- `Utilities.sleep` in `dev/gas-shims.js` busy-waits on `Date.now()`, which the test harness
  freezes — an *infinite* loop, not a slow one. `window.__GAS_SHIM_INSTANT_SLEEP__` is the
  escape hatch and `test/gasEnv.ts` sets it.

## Compact Instructions

When compacting, preserve: which items in `ai/AARS_LIVE_MEASUREMENTS.md` §5 are committed,
the item in progress, and any `blocked:` entries written this session.
