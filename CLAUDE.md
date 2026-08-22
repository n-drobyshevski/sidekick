# CLAUDE.md

Guidance for agents working in this repository.

## What this is

A **product**-register Streamlit dashboard over Wiz vulnerability findings: OS-level CVEs on
host workloads, severity breakdowns, MTTR / SLA remediation analytics with a persistent
scan history, and — in the GAS rebuild — Prioritization-to-Prediction program metrics
(remediation coverage, efficiency, capacity). Entry point is `app.py` (`st.navigation` / `st.Page`); pages live in
`wiz_dashboard/ui/pages/`, shared logic in `wiz_dashboard/{config,data,domain,models}`.

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
- **The problem tree stays at four axes.** A fifth, `dwell`, was specified and then dropped on
  measurement: 707 of 806 issues carry no `dueAt`, and the scorable remainder is 76% one bucket.
  Time is not a tiebreak and not an AARS pillar either. Reviving it needs a signal present on
  more than 12% of the register — see `ai/AARS_LIVE_MEASUREMENTS.md` §5.
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
