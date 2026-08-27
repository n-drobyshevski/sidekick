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
- **The second clock is captured but not yet computed.** `fix_date` / `fix_observed_at` are
  on every ledger row; nothing derives `fix_available_at`, `mttr_actionable_days` or
  `awaiting_vendor_fix`. Reference: `gas/src/domain/ledgerCore.ts::baseRows`.
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
- **The secrets ledger key is `externalId`, not `(secretDataId, path)`.** That pair collides
  2.27:1 over the full register (one pair covering 49 rows); `externalId` and
  `(secretDataId, path, lineNumber, resource.id)` are the only unique candidates.
  `secretDataId` names the credential and is what rotation groups by — not the row key. Both
  unique candidates encode the line, so a line move reads as a new finding, and UUID
  stability across scans is inferred from a version-5 nibble rather than measured.
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
