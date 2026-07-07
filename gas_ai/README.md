# Wiz SIDEKICK AI (Google Apps Script)

An AI-asset security dashboard, sibling to the OS-vulnerabilities tool in `gas/`.
It rebuilds Wiz's security-graph view for the AI estate: agents, models, guardrails,
MCP servers and their supporting identities, data and compute — as a **depth-limited
node graph** with **toxic combinations highlighted** — plus an inventory scored with
the **AI Asset Risk Score (AARS)**, a toxic-combinations drill-down, and a concise
"what we scan with Wiz" coverage page.

Same architecture as `gas/`: a Google Sheet as the durable store, Drive for gzipped
archives, an HtmlService SPA, and a resumable sync job. Same "Audit Ledger" design
system, with a deep-crimson brand (`#be123c`) instead of Signal Blue — the severity
palette is deliberately identical across both tools.

## Pages

| Page | What it shows |
|---|---|
| **Security Graph** | The node graph. Seed it from "all toxic combinations", one combination pattern, or a single asset; a **depth slider (1–3)** bounds the server-side traversal; per-kind caps collapse high-fanout neighbors into "+N more" pills that expand on demand; a count indicator flags capped views. Toxic-combination members get a crimson halo + `TC` badge; missing guardrails render as a dashed amber stub. Keyboard: arrows walk edges/lanes, Enter opens details; a "View as table" fallback carries the same data. |
| **AI Inventory** | Every synced asset with AARS score/band, severity, combo membership, guardrail status; KPI cards (guardrail coverage %, critical/high counts). |
| **Toxic Combinations** | The 4 combination patterns with adjusted-vs-native severity, the 5Rs amplifier note, framework tags (OWASP LLM / Agentic / ML, 5Rs), affected assets, and the issue drill-down. |
| **Wiz Scans** | The coverage page: what Wiz scans (AI-SPM, toxic-combination engine, CIEM, DSPM, guardrail coverage, network exposure, identity, supply chain, compliance) and where the results land. |
| **Data / Settings** | Sync history, storage stats, reset; default depth, node budget, credential status. |

## How data flows

1. **Sync** (button or daily 05:00 UTC trigger) walks a battery of Wiz GraphQL queries:
   AI inventory (`cloudResourcesV2`), assets-per-toxic-rule (`relatedIssue` filter),
   guardrail gaps (`graphSearch` with `PROTECTED_BY` + `negate:true`), execution
   identity (`RUNS_AS`), CIEM findings (`HAS_FINDING`), and human/role access
   (`ALLOWS_ACCESS_TO`, INBOUND). Each execution runs under a wall-clock budget and
   resumes via a one-shot trigger if it runs long (at the documented tenant scale the
   whole battery is ~10–20 API calls and finishes in one hop).
2. **Normalize + enrich** (once per sync, persisted): responses become typed
   nodes/edges/issues; each asset gets its worst adjusted severity, combo membership,
   and an AARS score (3 pillars: toxic-combination participation 0–50, compliance
   gaps 0–30, data exposure ×1.1 → 0–22; bands 70/50/30/10 — see `ai/custom_score.md`,
   whose applied table pins the unit tests).
3. **Persist**: wholesale rewrite of the `ai_assets` / `ai_edges` / `ai_issues` tabs,
   a gzipped graph snapshot to Drive (the fast read path), then the `sync_history`
   row LAST — the commit record. No history row = the sync never happened.
4. **getGraph** resolves seeds/depth/filters server-side, projects a bounded subgraph
   (BFS + per-kind caps + node/edge budgets), lays it out deterministically
   (layered left-to-right: issues → AI assets → identities → data → compute), and
   caches the payload in CacheService keyed by params + data version — wiggling the
   depth slider never re-reads Sheets.

**Dry-run:** with no credentials configured, "Sync now" persists a bundled sample
dataset transcribed from the anonymized posture docs in `ai/` (14 named agents,
8 IAM roles, 29 issues in 4 combination groups, with the applied-table AARS scores).
The whole app is usable without any Wiz access.

## One-time setup

```bash
cd gas_ai
npm install
npm run check          # typecheck + vitest + build (incl. middlebox guard)
npx clasp login        # once per machine
npx clasp create --type webapp --title "Wiz SIDEKICK AI" --rootDir dist
#   → paste the scriptId into .clasp.json
npm run push
```

Then in the Apps Script editor:

1. Run `setup()` once — creates the "Wiz SIDEKICK AI Ledger" spreadsheet (all tabs),
   the `wiz-sidekick-ai` Drive folder skeleton, and the daily `trigger_dailySync`
   trigger, recording ids in Script Properties.
2. For live syncs, set Script Properties (Project Settings → Script Properties):
   `WIZ_API_URL` (e.g. `https://api.<region>.app.wiz.io/graphql`) and either
   `WIZ_API_TOKEN` or `WIZ_CLIENT_ID` + `WIZ_CLIENT_SECRET` (client-credentials;
   `WIZ_AUTH_URL` defaults to `https://auth.app.wiz.io/oauth/token`).
3. Run `wizDiagnostic()` — a secret-safe step-by-step check of the auth + query path.
4. Deploy as a web app. Verify dry-run first (no credentials), then set credentials
   and press "Sync now"; confirm the tabs populate and the graph renders.

## Development

```bash
npm run dev        # local harness at http://localhost:8787 (dry-run, in-memory GAS fakes)
npm test           # vitest (AARS applied-table parity, combos, projection, layout, normalizers)
npm run check      # the full gate; run before every push
```

Useful harness flags: `?noseed` (empty state), `?slow=400` (loading states).

### Constraints worth knowing

- **No template literals / no `//` inside client strings.** The build lowers template
  literals and a "middlebox guard" fails if a bare `//` survives comment-stripping —
  a corporate SSL-inspection proxy corrupts them in transit. Split URLs like
  `["https:", "", "host", "path"].join("/")` (see `icons.js`).
- **Zero graph dependencies.** The security graph is hand-rolled SVG over a
  deterministic layout computed in `src/domain/graphLayout.ts` — no Cytoscape/D3;
  the bundle ships inline in every page load, and DOM nodes give native keyboard
  focus. Layout and projection are pure and unit-tested.
- **Severity never follows the brand.** Crimson marks identity/interaction and
  toxic-combination membership (always paired with the `TC` glyph); severity is
  always a dot + label with the shared palette; AARS chips reuse severity tokens.
- **graphSearch response shapes are inferred**, not captured — the
  `ai/queries/reponse_schemas/` stubs are empty. Every sync archives its raw pages
  to Drive (`syncs/<sync_id>/step-N-page-*.json.gz`); after the first live sync,
  copy representative pages into `ai/queries/reponse_schemas/` and reconcile
  `src/domain/syncNormalize.ts` against them. Live AARS inputs are heuristic
  (`deriveAarsInput`) until real compliance data is wired; dry-run uses exact
  per-asset hints from `ai/custom_score.md`.

## Layout

```
src/domain/    pure logic: graph model, AARS, toxic combos, projection, layout, normalizers
src/server/    GAS: Sheets/Drive stores, Wiz client, sync battery, API endpoints
src/client/    SPA: shell, pages, SVG graph renderer, design tokens (styles.css)
dev/           local browser harness (no GAS account needed)
test/          vitest specs
dist/          entry.js + appsscript.json (hand-maintained) + committed build output
```
