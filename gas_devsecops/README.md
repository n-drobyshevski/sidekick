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
| `executive` | Сводка | Программа | How fast is code risk closing, how much is open, where is it going? |
| `mttr` | MTTR и SLA | Программа | How long does a finding live once you stop discarding what is still open? |
| `program` | Эффективность | Программа | Did the effort land on what mattered, and can it keep up? |
| `sca` | Зависимости | Реестры | Which third-party CVEs are open, and is there anything to upgrade to? |
| `sast` | Код | Реестры | Which weaknesses are in our own code, and where? |
| `secrets` | Секреты | Реестры | Which credentials are in the repository, and are they dead yet? |
| `repos` | Репозитории | Данные | Where does the backlog sit, which repos are footholds, who owns them? |
| `history` | История сканов | Данные | What was actually measured, when? |
| `data` | Данные | Данные | What is stored, what can be exported, what can be reset? |
| `settings` | Настройки | — | Register, SLA windows, access, system. |

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
npm run check      # typecheck + vitest + build
npm run test:exact # the same suite under full module isolation
npm run which-build <stamp>   # which commits produced a deployed build id
```

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
