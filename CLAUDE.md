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
- **Severity defaults are per scope, and `secrets` is not `CRITICAL, HIGH`.** That default is
  inherited from the vulnerability registers, where it is a volume control. On secrets it
  deletes `PASSWORD` 209→0 and `CERTIFICATE` 160→0 — every one sits below HIGH — giving a
  secrets register with no passwords in it. `DEFAULT_FETCH_SEVERITIES` is a
  `Record<Scope, string[]>`; secrets reaches to MEDIUM, provisionally, until the probe's
  type × severity crosstab confirms those rows are not LOW.
- **The second clock is computed, and `awaiting_vendor_fix` is SCOPE-GUARDED.**
  `baseRows` (`src/domain/ledgerCore.ts`) derives `fix_available_at`,
  `mttr_actionable_days` and `awaiting_vendor_fix` from the `fix_date` / `fix_observed_at`
  the schema has been capturing since day one. The guard is the load-bearing part: "open
  with no fix available" is true of every SAST finding and every secret, neither of which
  has a vendor, so without it 2,085 rows sit awaiting a vendor forever — out of every
  actionable clock, in every exposure count, and the two halves of the page disagree in a
  way that reads as broken arithmetic rather than a category error.
- **Three scopes in one ledger, and DISAPPEARANCE IS THE DANGEROUS PART.** Neither source
  does this: `gas/` has one register, and `brick/devsecops`'s reconcile takes a `scope` but
  only stamps it — its caller hands it a prior already filtered down. Here the prior is one
  tab holding 17,991 SCA rows, 127 SAST and 1,958 secrets, and every row of the other two
  scopes is absent from any given scan BY CONSTRUCTION. So `reconcile` takes `scope`,
  filters the prior ITSELF rather than trusting a calling convention, and refuses an
  observation carrying the wrong one; every scan helper is scoped too, so the first SAST
  scan resolves nothing by absence with fifty SCA scans behind it. The mutation check is
  worth keeping: drop that one `continue` and 19,949 findings resolve as remediated.
- **SCA and SAST ADOPT the Wiz id; secrets DERIVES — and the filter is why.** Both are
  gated to `isDefaultBranch {equals: true}`, so one entity per finding reaches the
  register. Secrets could not use that gate (`245 + 0 != 691`, §8.6, because a
  REPOSITORY-level entity has the flag ABSENT rather than false), which is exactly why it
  has 187 twins. Broaden either filter and the assumption breaks with it.
- **A missing feature must not be able to look like a remediation event.** `sync.ts`'s live
  source REFUSES when called rather than returning an empty page — an empty page would
  write a scan row claiming it covered the scope, and the next scan's disappearance pass
  would resolve the whole register against it. Same family as the probe's false zero.
- **`BASE.sca` carries `hasFix: true`, so a WITHDRAWN fix reads as a remediation.** The
  finding leaves the filtered population, and leaving the population is what
  disappearance-resolution means. Nothing in the ledger distinguishes it from a real fix.
  Recorded in `sync.ts`, not fixed: dropping `hasFix` is a population change and belongs in
  its own measured round. `gas/`'s `REMEDIATION_ROLLOUT_ISO` exists to date exactly this.
- **A reopen RE-DERIVES `first_seen` from the API rather than keeping the stored value**,
  inherited from `gas/`. If Wiz does not reset `firstDetectedAt` on a re-detection, a
  reopened episode's MTTR is inflated by the whole first episode. Five probe passes have
  never observed a reopen — none ran two scans — so the behaviour is held still and pinned,
  with the open question in the test.
- **Kaplan-Meier's crossing comparison needed a float tolerance, and `gas/` still lacks
  it.** `S(t)` is a running product, so a curve that mathematically lands on the threshold
  can land one ULP above: on ten events at times 1..10, `S(9)` is `0.10000000000000002`
  and the p90 reported 10 instead of 9. Benign in direction, not in kind — the answer
  depends on accumulation order. `CROSSING_EPSILON` in `src/domain/remediation.ts`.
- **Three scopes, one ledger, and `scope` is part of the key.** The same CVE arriving through
  a dependency and through a host image is two findings with two clocks.
- **Removed is not rotated.** A secret leaving the register means the string left HEAD. The
  credential is live until `rotated_at` says otherwise.
- **A zero has to prove it looked.** The probe read its GraphQL connection off a hardcoded
  root chain that never learned `secretInstances`, so an 843-row register printed `0 node(s)`
  and wrote `{count: 0}` to the report with no error beside it — indistinguishable from a
  register that is genuinely empty. The refusal path had already been guarded; this one is
  silent, and guarding the failure that announces itself is not the same as guarding the one
  that does not. `resolveConnection` now finds the root in the response and REFUSES rather
  than returning an empty connection.
- **The secrets ledger key is DERIVED, never adopted, and this entry has now been wrong
  twice.** It first said `(secretDataId, path)`, which collides 2.27:1 with one pair covering
  49 rows. It then said `externalId`, because that is unique across the register — and
  §10.6, on the ungated 1,958-row population, showed it is unique BECAUSE IT PRESERVES THE
  REPO/BRANCH DUPLICATE: 187 keys span both `REPOSITORY` and `REPOSITORY_BRANCH`, and all
  187 carry two different `externalId`s, because Wiz splices the branch segment into its
  composite. The clocks on those twins genuinely disagree — median 19.9 days apart, max
  285.3, branch earlier in 135 and repository earlier in 52 — so neither type can be
  preferred. Key on `(secretDataId, path, lineNumber)`, fold the twins, take the earliest
  `firstSeenAt`, and write the discarded gap into the row (`twin_first_seen_spread_days`).
  The generalisation, which inverts the OS ledger's first rule: `vulnKey` prefers the Wiz
  `id` because THERE it is stable per finding; here every Wiz identifier is stable per ROW,
  and the row is not the finding. Uniqueness is not identity. `secretDataId` names the
  credential and is what rotation groups by — not the row key. The key still encodes the
  line, so a line move reads as a new finding, and UUID stability across scans is still
  inferred from a version-5 nibble (§10.8 strengthened it — one `id` spanning nine months of
  scans — without making it a controlled test).
- **A flag that does nothing produces a run that looks like it measured something.**
  `--roots --crosstab --report` returned a one-key report with no crosstab and no warning:
  `--roots` short-circuits, and `--crosstab` was never a flag at all — `has()` only asks
  about names it already knows. The probe now REFUSES an unrecognised argument and the
  `--roots` exit names the sections it skipped. Same family as the false zero above: the
  output has to say what it did not do.
- **The `scans` row is the COMMIT RECORD and it lands LAST — that is the battery's whole
  design.** A scan that dies mid-walk appends no row, so it never becomes a `prevScanId`, so
  the next scan still measures against the last COMPLETE scan of that scope. Not a check
  anywhere; the shape of the thing. It matters more here than in either sibling because
  `reconcile` resolves by ABSENCE, so a partial population is indistinguishable from a
  remediated one — the failure is not an error, it is a remediation programme that never
  happened. Priced on the dev fixture's 94 SCA findings: commit the in-flight step on the
  failure path and a scan row appears reading `total: 32` (62 findings never enter the ledger,
  so the next scan meets them as NEW with their real age gone); let `readSyncStepPages` skip a
  page it cannot read — the behaviour shipped until now — and the next scan commits with
  `resolved_count: 47`. The two guards are INDEPENDENT, which is how the first mutation was
  found to be defeated by the second rather than by the rule it was aimed at.
- **A budget is a choice; an execution limit is not, and confusing them made the battery
  unable to commit.** `COMMIT_RESERVE_MS` was measured against the hop's own yield point
  rather than the platform's ceiling, so `now + 120s > now + 45s` held on the first page of
  every scan and `startScan` always deferred to a trigger. Every spec expecting a committed
  row failed at once, which is the only reason it was found before deployment.
- **A store's row shape and its tab headers were forked from different siblings, and nothing
  failed.** `writeGrid` projects a row onto the DECLARED headers and discards the rest, so
  `jobsStore`'s `sync_id` / `step_index` / `nodes_so_far` / `part_refs_json` were dropped on
  write and read back as defaults. A resumed hop would have restarted from page 0 with a null
  cursor, every hop, forever — a polite infinite re-fetch. No test covered `jobsStore` at all.
  The round-trip test now asserts WHOLE-ROW equality: a first attempt compared the fixture's
  keys against the headers and passed against the broken shape, because types do not exist at
  runtime.
- **`wizQueries.ts` must stay transport-free, and a text assertion holds it.** `probe.mjs`
  bundles and imports it under plain Node so a read-only probe sends THE APP'S OWN QUERIES;
  the moment it reaches for a GAS global the probe stops being evidence about the battery.
  The check strips comments first — the file's own header names `UrlFetchApp` and
  `PropertiesService` while explaining why it must not use them.
- **`resolveConnection` catches a missing connection; only `ROOT_FIELDS` catches the WRONG
  one.** Rows that arrive, parse and carry a `pageInfo` are still another scope's population.
  Naming the expected root per scope turns that into a refusal — and caught a wrong fixture
  in the transport's own test the day it was added: sca answers under `vulnerabilityFindings`,
  not `scaFindings`.
- **The page-size fallback is narrower than the sibling's.** `gas/` retries at 250 on any
  throw; here only a `WizRefusedError` (a 4xx that is not about credentials) qualifies,
  because that is the only failure a smaller ask can fix. Measured: three specs failed against
  the broad form, each because the fallback swallowed the error the spec was about and spent a
  second round of calls doing it. A rejected token is never retried smaller — that reports a
  credentials problem as a data problem.
- **Trigger handlers in `dist/entry.js` are UNGATED, and a test says so.** An installable
  trigger runs with no active user, so `Session.getActiveUser().getEmail()` is `""` and any
  access check denies every firing silently — a multi-hop scan stops dead at its first budget
  expiry and looks exactly like a hang. Making them match the `api_` delegators is the
  obvious-looking refactor that breaks collection.
- **A status dot that is the ONLY readout has to carry words.** The rail dot was a hardcoded
  literal reading no field, while Settings showed a green pill for the same deployment — two
  surfaces, one fact, two stories. And above 800px `display:none` on the caption left nine
  pixels of `aria-hidden` colour with its explanation in a hover tip on a `<span>`. It is
  derived now (`railStatus.js`), the caption is visually hidden rather than removed, and the
  dot takes focus. `never scanned` beats `stale` in the precedence: two registers scanned an
  hour ago and one never looked at is not a fresh register.
- **`bootstrap.latestScan` is a max over the whole scans tab, so it lies about three
  registers.** It reports "fresh" whenever ANY scope ran. `lastScanByScope` ships all three
  and the rail takes the worst over the scopes Settings collects.
- **"Present" is not "connected", and a green pill said the second while meaning the first.**
  `hasWizCredentials()` is three non-empty Script Properties — no exchange, no call. The
  Settings row now reads "Stored, never verified" until a real token exchange plus one page
  succeeds, and `testConnection` drops the cached token first: a cached one outlives a revoked
  client secret by up to six hours, which is exactly the claim it exists to stop the app
  making.
- **A poller's first paint must not wait for its first interval.** Pressing Run scan produced
  no visible change for three seconds — on the one control whose whole job is to say something
  is now happening. Only the browser found it, and only with the continuation trigger frozen:
  in the dev harness just the FAKE clock expires, so 45 pages complete inside a few hundred
  milliseconds of real time and the card never gets a frame.
- **The accent is split and the split is load-bearing.** `--accent: #ffcb13` is 1.52:1 on
  white and 1.30:1 on the meter track — it is a FILL token and nothing else. Every accent
  fill carries `--accent-edge: rgba(0,0,0,.40)`, which lifts it to 3.49:1. Links, focus
  rings, accent ink and chart series all take `--accent-text: #7c4a0a` (7.39:1). The primary
  button stays graphite `#0a0a0a` — do NOT copy gas_ai's accent-filled button, white on this
  accent is 1.52:1. `test/tokens.test.js` holds all four.
- **The severity palette is byte-identical across all four surfaces.** A severity means the
  same thing everywhere; the brand deliberately does not.
- **A DEATH DATE IS NOT ALWAYS A MEASUREMENT, and the row has to say which.** Where
  `resolution_src` is `disappeared` the date is the scan that first stopped seeing the
  finding — an upper bound whose error is the scan interval. "Gone by 12 Aug" and "Resolved
  12 Aug" are the same pixel width, so the provenance rides in the WORD
  (`pages/registerModel.js`). It applies to all three registers, not only SAST: SAST is
  where it is always true, but qualifying only SAST implies the other two dates are exact.
- **An unmeasured register is not a register of zeroes.** A hero of `0` over three stat
  cards of `0` states four facts about a population nobody has looked at. Every page checks
  "has this ever been scanned" before it checks "how many" — but a filter that matches
  nothing keeps its figures, because there the zero IS a measurement.
- **A portaled sheet outlives the page that opened it.** `app.js` closed the tip on every
  route change and never the sheet, so a filter drawer's SCRIM sat over the next page
  swallowing clicks with nothing on screen explaining why. Neither sibling app calls
  `closeActiveSheet()` either; neither had a page that opened one.
- **Severity sorts by MEANING, so ascending is worst-first.** The comparator ranks against
  `SEVERITY_ORDER`, where CRITICAL is 0. A register defaulting to descending opens on LOW.
- **A scan records the gate it APPLIED, not the one the settings hold now** (`runScan`'s
  `severities` override). The two differ across a settings change, and stamping today's gate
  on a replay of older scans makes the disappearance guard believe a severity was covered by
  a scan that never looked at it. The dev fixture models exactly that: scan 1 wide, scans 2-3
  narrow — which is also the only shape that leaves the guard something to protect.
- **The Access panel is not the boundary, and the tier is one `canEditAdmins()` call.**
  `google.script.run` reaches `api_saveAccess` from any allowed caller's console, so every
  endpoint re-checks; `getAccess` withholds the ROSTER from a non-editor rather than letting
  the client decline to draw it. `saveAdmins` is owner-only because an admin who could edit it
  could promote themselves permanently. `test/accessAdmin.test.ts` — which `access.ts` cited
  for a whole fork before anyone ported it — fails the moment that blurs.
- **A removal confirmation has to compare against the DISK, not against page load.** `gas/`
  computes it from the `getAccess` payload the page opened with and never refreshes it, so the
  first removal in a visit is confirmed and every one after it is silent. Fixed here; the
  baseline moves on every save.
- **Copying a page from `gas/` has two traps this chassis adds.** `el()` THROWS on `title`
  (the native-tooltip ban), and the fork already renamed the access CSS — `.access-remove`,
  `.access-add`, `.access-block__label` against `gas/`'s `.cond-remove`, `.sub-add`,
  `.scope-block`. The first fails loudly; the second renders an unstyled panel in silence.
  Check before assuming a class is missing: `button.link` looks absent to a `^\.link` grep and
  is defined in `base.css`, so "renamed" is a claim to verify rather than a default.
- **A test that stubs a global belongs in the ISOLATED vitest project.** The pure project runs
  `isolate: false` on a shared worker, so a module-scope `vi.stubGlobal("Session", …)` installs
  it for every other file in that worker. The classifier in `vitest.config.ts` detects
  `vi.stubGlobal` / `vi.mock` from the source, for the same reason it detects the other two: a
  hand-written list rots, and the failure does not look like a config mistake.
- **Settings is `gas_ai`'s shape: tabs over ONE batched save bar**, and what stays OUT of the
  bar is the design. The access roster writes Script Properties through its own endpoints, so
  it keeps its own Save; the experimental toggle writes localStorage and saves on change; the
  System tab is read-only, because credentials and project scope decide WHICH POPULATION every
  register measures. Two forms with one save model each is fine; two models inside one form is
  not. `settingsModel.js` is the DOM-free half and duplicates NO constants — the shared SLA
  windows arrive via `api_bootstrap`, because a client-side copy is a second place for the four
  sidekicks' byte-identical windows to drift, invisibly.
- **`setSettings` is a PATCH, not a whole-object write.** With four tabs behind one bar,
  sending everything makes two readers saving different tabs a minute apart have the second
  silently revert the first.
- **A settings key nothing reads is worse than no key.** `showExperimental` sat in the stored
  Settings while the rail, the router and the help sheet all read `experimental.js`
  (localStorage). It was written on every save and consulted by nobody, until it was removed —
  the failure it invites is the next reader wiring a control to it.
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
