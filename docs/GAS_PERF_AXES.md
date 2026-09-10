# GAS apps — optimization axes and their expected relative gain

Research note, 2026-09-10. Nothing here is implemented. It ranks the places where the four
Apps Script apps (`gas/`, `gas_ai/`, `gas_devsecops/`, `gas_hub/`) can be made faster, with
the measured or code-derived fact behind each and an honest estimate of what it would move.

## What is already done (so nobody re-proposes it)

- Two-level read-model cache: L1 `CacheService` (gzip + base64, 90 KB chunks, keyed by
  `BUILD_ID.DATA_VERSION.<config stamp>`), L2 Drive gzip files for time-invariant models,
  warmed at 08:00 / 12:00 / 16:00 by trigger (`serverCache.ts`, `readModelStore.ts`).
- Ledger read from a Drive snapshot, not the tab (`ledgerStore.loadState`); per-execution
  memos for scans / state / frame (gas), eleven memos in `gas_ai/syncStore.ts`, one
  `baseSnapshot()` for all eight models in `gas_devsecops/readModels.ts`.
- Client and CSS bundles minified and inlined; Chart.js split into its own partial fetched
  lazily over RPC on the first chart route (`chartsLoader.js`).
- One fat RPC per page section (`getExecutivePage`, `getRegisterPage`, `getInsights`); a
  session-scoped stale-while-revalidate cache (`store.swrCall`) with in-flight dedup.
- Scans walk pages under a 45 s first hop / 270 s continuation budget with Drive page
  archives; `program.ts` already parse-hoists (measured 636 ms → 149 ms on 20k rows).

## The numbers we have, and the one we do not

| fact | value | where |
|---|---|---|
| server bundle parsed on EVERY execution | gas 457 KB · gas_ai 885 KB · gas_devsecops 316 KB | `dist/server.js` |
| of which dry-run fixture, dead on live runs | gas 39 KB · gas_ai 68 KB | `sampleData.ts` bundled via `scanJobs`/`syncJobs` import |
| first document (index + styles + js_app), raw / gzip | gas 397 / 116 KB · gas_ai 818 / 243 KB · gas_devsecops 393 / 119 KB · gas_hub 140 / 37 KB | `dist/` |
| Chart.js partial, fetched by RPC on first chart route | 211 KB raw / 72 KB gzip (gas) | `dist/js_charts.html` |
| RPCs before first data on the default route | gas 2 serial · gas_ai 2 serial · gas_devsecops 3 | `appShell.boot` → `route()` |
| RPCs on gas OS-vulnerabilities page | 4–5, the first three SERIAL (`getInsights` → `getGrouping` → `getGroupTrend`) | `pages/overview.js` |
| PropertiesService read | ~10–50 ms each (code comment, not measured) | `serverCache.ts:8` |
| cold read-model recompute | "multi-second" (code comment, not measured) | `readModelStore.ts:6` |
| `capacityHindcast` on 20k rows / 24 scans | 142 ms warm (was 636 ms) | `program.test.ts:633` |
| gas_ai live sync | ~71 API calls, ~2 min, page size 100 | `CLAUDE.md`, `wizQueriesAi.ts:30` |
| per-page jobs checkpoint | gas / gas_devsecops: every page · gas_ai: every 8 s | `scanJobs.ts`, `syncJobs.ts:130` |

**Missing: any end-to-end timing.** `timedApi_` logs `{api, ms}` per call to the execution
log and `api.js` prints `[rpc] name Nms` to the console, but nothing aggregates either, and
nothing records `doGet` → first paint. Every "gain" below is therefore derived from structure
(how many round trips, how many passes over how many rows), against these priors for Apps
Script web apps: one `google.script.run` round trip ≈ 0.4–1.5 s (cold execution + script
load + the work), `doGet` ≈ 1–3 s. Axis 0 exists to replace the priors with a measurement.

## Gain bands used below

- **L** — removes ≥ 1 round trip or ≥ 1 s from a user-visible wait, on most page views.
- **M** — 100 ms to 1 s on a view, or seconds-to-a-minute off a scan.
- **S** — < 100 ms per view, or only on cache-miss paths.

---

## Axis 0 — Measure first

**Fact.** The two timing hooks exist but are write-only. Nothing tells us whether a page's
wait is the `doGet` document, the RPC round trip, the server compute, or the client paint.

**Proposal.** Add `performance.mark` at splash paint / bootstrap resolved / page RPC resolved /
first chart, ship them once per session to a tiny `api_perfSample` (or just `console.info`
on the client), and pull `{api, ms}` lines from the execution log into a table by endpoint
and cache hit/miss. One week of that decides the order of everything below.

**Gain.** None directly. Cost: half a day. Without it, the L estimates below are priors.

## Axis 1 — Paint from a persisted bootstrap, then revalidate  (L, every reload)

**Fact.** `store.js` holds `bootstrapData` and the SWR cache in module memory only. Every full
page load (reload, deep link, return from the hub, after every `refresh()` when a scan ends)
blocks the splash on `api_bootstrap`, then blocks the page on its own RPC: two serial round
trips before any figure is on screen, on every app but the gas_ai graph route.

**Proposal.** Persist the bootstrap envelope and the last payload per `swrCall` key in
`localStorage`, keyed by the build stamp the envelope already carries. On boot, paint from the
stored copy immediately and let the existing `swrCall`/`onFresh` path repaint if the live
answer differs. `activeJob`, `hasCredentials` and the hub URL stay live (they already sit
outside the cached core for this reason).

**Gain.** First meaningful paint goes from `doGet + 2 RPCs` to `doGet` on every warm reload;
roughly 1–3 s per load by the priors. Largest single perceived win available.
**Cost / risk.** Medium. Stale-until-revalidated views need the existing "updating" dim
idiom; payload size (gas_ai inventory can be 300–400 KB) needs a per-key cap; a settings
change that does not bump `DATA_VERSION` must still invalidate (the same class of bug
`domainTagStamp` fixed server-side).

## Axis 2 — Collapse serial RPC chains  (L on the pages that have them)

**Fact.** Only `gas_ai/pages/graph.js` overlaps its page RPC with bootstrap. Everywhere else
`route()` runs after `await bootstrap()`. `gas/pages/overview.js` then runs three RPCs in
series (`getInsights` → `getGrouping` → `getGroupTrend`). `gas_devsecops` spends a third boot
RPC on `api_getJobStatus` that its siblings read off the bootstrap envelope.

**Proposal.** Fire the default route's page RPC in parallel with bootstrap (the graph page's
pattern, generalised in `appShell`); merge overview's chain into one endpoint or issue the
three concurrently; put `activeJob` in gas_devsecops's bootstrap.

**Gain.** One round trip off every first view (≈ 0.4–1.5 s), two off the OS-vulnerabilities
page. Cheapest L on the list.
**Cost / risk.** Low. The overview chain has a data dependency (`grouping` needs the insights
view) that a combined endpoint resolves server-side.

## Axis 3 — Keep clock-dependent models warm across the hour  (M–L, first visitor per hour)

**Fact.** The KM family, `openPastSla`, aging buckets, capacity and `executiveWeekTrend`
drift with `Date.now()`, so they are L1-only with a 1 h TTL and cannot be durable. The warm
runs three times a day. So on most hours the first Executive or MTTR visitor pays the full
recompute — the one `readModelStore.ts` calls "multi-second" — and `mttrTrend` is documented
as the heaviest model in the app.

**Proposal.** Either of two: (a) censor at the ledger clock instead of wall clock, as
`gas_devsecops/readModels.ts` already does (`atLedgerClock`, `asOfSource`), which makes the
models time-invariant between scans and therefore durable; or (b) ship `age_days` as a
client-side derivation from `first_seen` and cache the rows. (a) is the smaller change and
the sibling has already argued it through.

**Gain.** Removes the multi-second cold path for everyone but the first visitor after a
scan; also frees warm budget (the warm already logs "ran out of budget … left cold").
**Cost / risk.** Medium. The Executive hero would read "as of last scan" rather than "as of
now" — a product decision, already taken one way in gas_devsecops.

## Axis 4 — Kaplan–Meier: the quadratic core  (M on miss paths, L for the warm)

**Fact.** `kmCurve()` (`remediation.ts:156-167`, duplicated in gas_devsecops) is O(E × N):
for every distinct event time it re-filters the whole `times` array. Event times are
continuous floats, so E ≈ resolved rows. `getMttrPage` builds ~8–9 curves per call (per
severity + whole + two latency views), `withKmMedian` builds one per trend point ("the
trend's single heaviest op"), and `executiveWeekTrend` runs `kmMedianAsOf` twice.

**Proposal.** Sort once, sweep once: O(N log N) with a running at-risk count and tie groups.
Then the trend's per-point curves become cheap enough that the 48-point cap stops mattering.

**Gain.** On a 20k-row register with ~10k resolved, the inner loop is ~10⁸ comparisons per
curve; ×9 per MTTR call, ×48+ per trend. This is very likely the dominant term of every
cache-miss MTTR/trend compute and of the warm's budget. Expect 10–100× on the function and
a 2–5× drop in miss latency on those endpoints. Zero user-visible change on a cache hit.
**Cost / risk.** Low; the golden fixtures and `CROSSING_EPSILON` pin the answers.

## Axis 5 — Parse the base once per execution  (M on miss paths)

**Fact.** `baseRows()` runs four `parseTs` (two regexes + `Date.parse`) per row and is
rebuilt on every `loadBaseRows()` / `scopedBaseRows()` call; `loadState()` is memoized,
`baseRows` is not. `loadTrend` then re-parses the same base independently in five functions.
`attachBizDomains` re-parses `tags_json` per row at seven call sites. The one place this was
fixed (`program.ts`) measured `Date.parse` as "the whole cost".

**Proposal.** Memoize `baseRows` per execution beside `stateMemo`; carry numeric epochs on
the parsed row so the trend functions share one parsed array; parse `tags_json` once when
the snapshot is loaded.

**Gain.** Proportional to how many of the ~18 passes over 18k rows an endpoint makes;
20–40 % of miss-path compute on insights / trend / bootstrap by the program.ts precedent.
**Cost / risk.** Low–medium; purely internal, fixture-pinned.

## Axis 6 — Bound the synthetic trend backbone  (S–M, grows with register age)

**Fact.** `trendFromBase` seeds one synthetic point per calendar DAY from the earliest
`first_seen` to the first scan. Only `withKmMedian` caps at 48; `trendFromFrames`,
`withOpenPastSla`, `withSlaBurn`, `cohortSlaAttainment` walk every day, each O(N) per point
plus a sort per severity. Real scan points are never capped either.

**Proposal.** Apply the same `kmSkipMask` thinning to every point loop; cap real points to a
window the chart can show.

**Gain.** Bounded rather than growing; on a register whose oldest finding is two years old
that is ~700 points × 5 functions × N rows today. **Cost.** Low.

## Axis 7 — Server bundle diet  (S per RPC, ×every RPC)

**Fact.** V8 loads and parses the whole `server.js` for every execution, including
`sampleData.ts` (39 / 68 KB) that only the dry-run path imports, ~15–22 KB of GraphQL query
strings, and a 100–190 KB `api.ts`. `timedApi_` starts its clock AFTER the load, so this cost
is invisible in the existing log.

**Proposal.** Move the fixtures out of the live bundle (a Drive/HTML partial read only on
dry run, as `js_charts` already is for the client); measure before going further.

**Gain.** Unknown until measured; V8 lazy-parses, so the honest prior is tens of ms per
execution, but it is paid on every RPC and every poll tick. **Cost.** Low.

## Axis 8 — Persist the Chart.js bundle across loads  (M on the first chart route per session)

**Fact.** `chartsLoader.js` memoizes the 211 KB bundle in memory only; every full load that
reaches a chart route pays the RPC and the transfer again. The execution mechanism inside the
HtmlService sandbox is the documented unknown (inline / `new Function` / `blob:`).

**Proposal.** Store the source string in `localStorage` keyed by build stamp; execute through
the same three-mechanism ladder. Nothing about the CSP question changes.

**Gain.** One round trip + 72 KB gzip on the first chart route of every session. **Cost.**
Low. Contingent on the same CSP unknown the loader already lives with.

## Axis 9 — Scan pipeline: per-page overhead  (M per scan, seconds to a minute)

**Fact.** In gas and gas_devsecops every page does one Wiz POST, one Drive gzip create, and
one `updateJob` — which goes through `updateWhere` and READS THE WHOLE JOBS GRID to find one
row. gas_ai throttles that to one checkpoint per 8 s and spills parts only at hop yield.
Each continuation hop also idles `CONTINUE_DELAY_MS` = 30 s, and the first hop is capped at
45 s to keep the button snappy.

**Proposal.** Port gas_ai's 8 s checkpoint to the siblings, remember the job's row index
inside the execution, coalesce page archives into multi-page parts (keeping the "100k-finding
payload never sits in memory" rule by capping part size), and revisit the 30 s hop delay.

**Gain.** Per page ~100–500 ms of Sheets and Drive I/O; a 200-page scan saves 20–100 s,
plus 30 s per hop. Not user-latency, but trigger-runtime quota on consumer accounts is
90 min/day. **Cost.** Low–medium; the commit-last invariant must not move.

## Axis 10 — gas_ai sync page size  (M per sync)

**Fact.** Default `PAGE_SIZE` = 100 (fallback 50), against 500 in the siblings; ~71 calls and
~2 min per live sync. `PAGE_SIZE_WIDE` = 500 already exists as a per-step opt-in, chosen
narrow because `expandAsset` is the one call a user waits on.

**Proposal.** Opt the bulk battery steps into the wide page while leaving the interactive
expansion at 100.

**Gain.** Up to ~5× fewer calls on bulk steps; sync wall-clock perhaps 2 min → ~1 min; quota
headroom. **Cost.** Low; the fallback ladder already handles a refused 500.

## Axis 11 — Route-level code splitting in gas_ai  (S–M on doGet, gas_ai only)

**Fact.** gas_ai's first document is 818 KB raw / 243 KB gzip, 2.5× its siblings, because it
is 2.5× the hand-written code — `pages/aars.js` alone is 192 KB source, the graph stack 156
KB — all statically imported by `app.js`, so the Priorities reader downloads and parses the
AARS editor and the SVG layout engine every time.

**Proposal.** Ship the heaviest pages as partials fetched over RPC on first visit, exactly as
`js_charts` already is. Same CSP contingency as the charts loader.

**Gain.** Roughly halves gas_ai's first document; parse time ~50–150 ms on a fast link, more
behind the corporate proxy path the middlebox guard exists for. Gas and gas_devsecops gain
little. **Cost.** Medium.

## Axis 12 — Client cache hygiene  (S–M perceived)

**Fact.** `swrCall` is opt-in and many read sites use bare `call()` (all of gas Settings, the
scan pollers). Revalidation compares payloads by double `JSON.stringify`. The 3 s job poll in
gas_devsecops goes through `swrCall`, so each tick is a hit + refetch + two serialisations.
`refresh()` after a job completes throws away every cached RPC and re-runs the whole boot
with the splash.

**Proposal.** Make `swrCall` the default for GET-shaped calls; compare on a server-issued
stamp instead of serialising; after a job, invalidate only ledger-derived keys and re-render
in place.

**Gain.** Instant revisits everywhere they are not already; the post-scan re-boot stops
costing 2–3 round trips plus a splash. **Cost.** Low.

## Axis 13 — Cheaper polling  (S user-facing, M for quota)

**Fact.** Every 3 s poll is a full execution: script load, access check, a property read,
and a jobs-tab tail read. During a 10-minute scan that is 200 executions.

**Proposal.** Publish job progress into a `CacheService` entry from the scan loop (a single
`get`, no Sheets) and back the poll off from 3 s toward 10 s when nothing changed.

**Gain.** Little on latency; a meaningful cut in execution-time quota and in Sheets reads
while a scan runs. **Cost.** Low.

## Axis 14 — L1 cache format  (S per hit)

**Fact.** Every L1 hit pays `getAll` over chunks + base64 decode + `Utilities.ungzip` +
`JSON.parse`. Bootstrap already shed 4.3 KB of unread fields on the Executive route after a
measurement (8,716 of 13,068 bytes unread).

**Proposal.** Store payloads under ~90 KB raw without gzip; repeat the unread-field audit on
the other fat endpoints.

**Gain.** Tens of ms per hit; only worth doing after Axis 0 says hits dominate. **Cost.** Low.

---

## Suggested order

1. Axis 0 (measure), then in parallel the three cheap L's: Axis 2 (serial chains), Axis 1
   (persisted bootstrap), Axis 8 (persisted charts).
2. Axis 4 and 5 together (KM sweep + shared parsed base), then Axis 3 (durable clock models),
   which the two make cheap enough to warm fully.
3. Axis 9 and 10 on the scan side; Axis 7, 11, 12, 13, 14 as measurement justifies.

## What this note deliberately does not claim

- No number above for L/M/S is measured end-to-end; the bands rest on round-trip counts and
  row-pass counts, and on the two measurements the code carries (program.ts, edgeRoute.js).
- The dev-loop (`npm run check`) was not timed: `gas/` has no `node_modules` installed in
  this environment, so vitest could not run.
- Correctness-adjacent trade-offs (ledger-clock censoring, stale-first painting) are named as
  product decisions, not made here.
