# Wiz Sidekick DevSecOps

Remediation analytics for **code-side** Wiz findings — SAST, SCA and secrets — as a Google
Apps Script web app. Sibling to the OS-vulnerabilities tool in [`../gas/`](../gas/) and the
AI-asset tool in [`../gas_ai/`](../gas_ai/).

Same architecture as both: a Google Sheet as the durable store, Drive for gzipped archives,
an HtmlService SPA, and a resumable job runner. Same "Audit Ledger" design system, with a
bright-yellow brand (`#ffcb13`) instead of Signal Blue or crimson — the severity palette is
deliberately identical across all three, so a severity means the same thing wherever you
read it.

## Status: Phase 1 — the interface base

**What is real:** the shell, the navigation, all ten routes, access control, the settings
store, the ledger schema, the build and the dev harness. `npm run check` is green.

**What is not:** the sync battery and the domain layer. Every page renders its composition —
the questions it will answer — and says plainly that no data is connected. That is
deliberate: a page drawing a plausible empty chart would be claiming a pipeline that does
not exist.

**Where the domain comes from.** Not greenfield.
[`../brick/devsecops/`](../brick/devsecops/) already implements this product as a tested
Spark pipeline: real captured Wiz queries for both scopes, a cross-scan lifecycle
reconciler, Kaplan–Meier with censoring and RMST, the P2P coverage/efficiency/capacity
family, and ~6,400 lines of tests. Phase 2 ports that to TypeScript against golden fixtures
exported from the Python — the same relationship `gas/` has to `wiz_dashboard/domain/`.

## Pages

Three lanes and a chrome tail. The IA lives in exactly one place — `PAGES` in
`src/client/js/app.js` — and `test/navGroups.test.js` forbids a second list.

| Route | Title | Lane | The one question |
|---|---|---|---|
| `executive` | Executive | Program | How fast is code risk closing, how much is open, where is it going? |
| `mttr` | MTTR & SLA | Program | How long does a finding live once you stop discarding what is still open? |
| `program` | Coverage & efficiency | Program | Did the effort land on what mattered, and can it keep up? |
| `sca` | Dependencies | Registers | Which third-party CVEs are open, and is there anything to upgrade to? |
| `sast` | Code | Registers | Which weaknesses are in our own code, and where? |
| `secrets` | Secrets | Registers | Which credentials are in the repository, and are they dead yet? |
| `repos` | Repositories | Data | Where does the backlog sit, which repos are footholds, who owns them? |
| `history` | Scan history | Data | What was actually measured, when? |
| `data` | Storage | Data | What is stored, what can be exported, what can be reset? |
| `settings` | Settings | — | Register, SLA windows, access, system. |

### Why SAST, SCA and secrets are three pages

Because their remediation clocks differ in kind. SCA cannot be fixed before a fixed version
exists, so its clock splits into "waiting for a vendor" and "actionable". SAST has no
vendor — but in this tenant it also has **no timestamps at all**, so its clock starts at
observation and the page says so. A secret leaves the register when the string leaves HEAD,
which is not the same as the credential being dead. One merged register would have to lie
about at least two of them, and the clock is the product.

## Setup

1. `npm install`
2. Create the Apps Script project and point `.clasp.json` at it (git-ignored — the
   `scriptId` belongs to whoever deploys, not to the repo).
3. `npm run push`
4. In the Apps Script editor, run `setup()` once. It creates the ledger spreadsheet and the
   Drive archive folder, ensures every tab and header, and seeds `ALLOWED_USERS` with the
   owner. It installs **no triggers** — there is no sync battery to schedule yet.
5. Set `WIZ_API_TOKEN`, or `WIZ_CLIENT_ID` + `WIZ_CLIENT_SECRET`, in Project Settings.
6. Run `deploymentDiagnostic()` if anything looks wrong; it reports every check at once
   rather than stopping at the first failure.

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
```

**The two questions it exists to answer.**

1. *Does `SASTFinding` expose a selectable timestamp?* The pagination cursor in the captured
   response base64-decodes to `{"Field":"finding_severityOrder","Value":"4_2026-07-02T…Z"}`,
   so a server-side date demonstrably exists — the documented selection set just does not
   offer one. If it turns out to be selectable, SAST gets a real remediation clock and
   `SAST_FETCH_RESOLVED` can be turned on. If not, the current design stands. The probe
   introspects the type, and falls back to probing candidate field names one at a time and
   reading the refusal when introspection is closed.
2. *What is the secrets root called, and does it distinguish removed from rotated?* There is
   no capture of a secret finding anywhere in this repository, so `Q_SECRETS` is `null`
   rather than a guess — a plausible document would typecheck, ship, and then measure the
   wrong population.

**Both are answered as of 2026-08-27** — see [PROBE_FINDINGS.md](PROBE_FINDINGS.md).
Briefly: `SASTFinding` *does* expose `createdAt`, but no `resolvedAt` and no resolved rows,
so `SAST_FETCH_RESOLVED` stays `false` for a new reason; the secrets root is
`secretInstances` and it *does* separate removed (`resolvedAt`) from rotated
(`validationStatus`). The same run found the SAST query refused by this tenant with
`VALIDATION_INVALID_TYPE_VARIABLE` — `filterBy.severity` is an object filter, not a list.

`npm run dev` runs the **real server bundle** in the browser against in-memory fakes for
SpreadsheetApp, DriveApp, Properties, Lock and Cache (`dev/gas-shims.js`), so no Google
account is needed. It seeds nothing in Phase 1.

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
