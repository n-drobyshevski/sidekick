# GAS apps — optimization axes and their expected relative gain

Research note, 2026-09-10, revision 2. Nothing here is implemented. It ranks the places
where the four Apps Script apps (`gas/`, `gas_ai/`, `gas_devsecops/`, `gas_hub/`) can be made
faster, with the measured or code-derived fact behind each and an honest estimate of what it
would move.

## Revision 2 — what the review of revision 1 found

Revision 1 was ranked on round-trip counts and row-pass counts and never priced two things
that turn out to dominate the paths it called "multi-second": Drive I/O and the fixed cost a
cache HIT still pays. It also asserted four platform behaviours from memory. The review
checked them against current documentation and published benchmarks (sources at the end).

**Weak points, in order of consequence:**

1. **Drive I/O was not priced at all, and it is probably THE cold-path term.** Every read of a
   snapshot, frame or durable read-model goes `getFolderById(root)` → `getFoldersByName` →
   `getFilesByName` → `getBlob`: four DriveApp calls, by NAME, per file. The `folderMemo` in
   `readModelStore.ts:96` covers only the WRITE path (`:141`); `l2Read` calls
   `readGzJsonNamed`, which re-resolves the folder every time (`archiveStore.ts:394-397`).
   A cold `bootstrap` is therefore ~12 Drive calls before any compute (snapshot 4, frame 4,
   one L2 probe 4), and a cold Executive adds four per durable model it probes. Revision 1
   attributed the "multi-second cold load" to compute. → new **Axis 15**.
2. **A cache hit is not free, and revision 1 treated it as such.** Even a fully cached
   `bootstrap` pays: two property reads in the access check, two in the cache stamp, one for
   the hub URL, four for `hasWizCredentials`, then `activeJobSummary` → `readTail(jobs)` →
   `SpreadsheetApp.openById` + two `getValues`. Against published latencies (Properties
   `getProperty` avg 30 ms, SpreadsheetApp read+write cycle ~800 ms) that is roughly 0.5–1 s
   of server time on the HIT path, plus the round trip. → new **Axis 16**.
3. **Axis 1 (persist bootstrap in `localStorage`) was ranked first without checking the
   thing it depends on.** HtmlService serves the app from an iframe on a per-script
   `n-<hash>-script.googleusercontent.com` origin with `allow-same-origin`, so storage works
   within one web app, and the repo's own preferences already rely on it (`ui/sheet.js:59`).
   What is NOT documented is whether that origin is stable across deployments and versions.
   The dependency stays; it now carries a two-line test before any build.
4. **Axis 4 (quadratic Kaplan–Meier) is right about the code and wrong to imply the tests
   would see it.** `gas_devsecops/test/remediation.test.ts:297` runs N = 200,000 with
   `(i % 500) + 1`, i.e. 500 distinct event times: 10⁸ comparisons, passes. Real `mttr_days`
   are continuous (`(resolved − first) / DAY_MS`, `ledgerCore.ts:341`), so distinct times ≈
   resolved rows and the same N is 10¹⁰. The axis stands; the proof it needs is a stress
   case with continuous times, which the suite does not have.
5. **Axis 9 understated hop latency.** `after(ms)` is documented as a MINIMUM; the actual
   delay "might vary". `CONTINUE_DELAY_MS = 30_000` is a floor, not the gap. The jobs tab's
   `updated_at` deltas can measure the real one; nothing has.
6. **Two platform caps revision 1 never mentioned.** CacheService holds at most 1,000 items
   and, over that, KEEPS the 900 farthest from expiry — the chunked scheme spends ≥ 2 items
   per payload and every scoped `cached()` call mints more. Properties read/write is
   50,000/day on consumer accounts (500,000 on Workspace); at ~9 reads per bootstrap RPC and
   2–4 per poll tick, a consumer deployment can meet that on a busy day.
7. **Compression of the `doGet` document is unknown.** Revision 1 quoted gzip sizes as if
   they were on the wire. Whether `googleusercontent` gzips HtmlService output is not
   documented; one DevTools look at `content-encoding` settles it and changes Axis 11's
   weight either way.
8. **Structure.** No axis named the measurement that proves it worked, and none carried a
   cost. Both are added below; the repo's own rule is "a fix that does not move the number is
   a finding".
9. **Axis 2's "merge the three overview RPCs into one" trades a real thing away.** Today
   insights paint before grouping. One combined endpoint waits for the slowest section.
   Concurrent calls keep the progressive paint; the merge does not. The proposal is
   corrected to concurrent.

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

## The numbers we have

| fact | value | where |
|---|---|---|
| server bundle parsed on EVERY execution | gas 457 KB · gas_ai 885 KB · gas_devsecops 316 KB | `dist/server.js` |
| of which dry-run fixture, dead on live runs | gas 39 KB · gas_ai 68 KB | `sampleData.ts` bundled via `scanJobs`/`syncJobs` import |
| first document (index + styles + js_app), raw / gzip | gas 397 / 116 KB · gas_ai 818 / 243 KB · gas_devsecops 393 / 119 KB · gas_hub 140 / 37 KB | `dist/` (wire compression unverified, see weak point 7) |
| Chart.js partial, fetched by RPC on first chart route | 211 KB raw / 72 KB gzip (gas) | `dist/js_charts.html` |
| RPCs before first data on the default route | gas 2 serial · gas_ai 2 serial · gas_devsecops 3 | `appShell.boot` → `route()` |
| RPCs on gas OS-vulnerabilities page | 4–5, the first three SERIAL | `pages/overview.js` |
| DriveApp calls per named file read | 4 (root by id, subfolder by name, file by name, blob) | `archiveStore.ts:27-40, 394` |
| Drive calls on a cold `bootstrap` | ~12 | snapshot + frame + one L2 probe |
| property reads on a HIT `bootstrap` | ~9 | access 2, stamp 2, hub 1, credentials 4 |
| Sheets calls on a HIT `bootstrap` | `openById` + 2 `getValues` | `activeJobSummary` → `readTail(jobs)` |
| warm entries per pass | 14 (one severity scope) or 25 (two) | `api.ts:warmReadModelsInner` |
| `capacityHindcast` on 20k rows / 24 scans | 142 ms warm (was 636 ms) | `program.test.ts:633` |
| gas_ai live sync | ~71 API calls, ~2 min, page size 100 | `CLAUDE.md`, `wizQueriesAi.ts:30` |
| per-page jobs checkpoint | gas / gas_devsecops: every page · gas_ai: every 8 s | `scanJobs.ts`, `syncJobs.ts:130` |

## Platform facts, from documentation and published benchmarks

| item | value | source |
|---|---|---|
| Properties read/write per day | 50,000 consumer · 500,000 Workspace | quotas page |
| URL Fetch calls per day | 20,000 · 100,000 | quotas page |
| triggers total runtime per day | 90 min · 6 h | quotas page |
| simultaneous executions | 30 per user · 1,000 per script | quotas page |
| script runtime | 6 min per execution | quotas page |
| Properties value / store | 9 KB per value · 500 KB per store | quotas page |
| CacheService | 100 KB per key · 250-char key · 6 h max TTL · **1,000 items, then keeps the 900 farthest from expiry** · expiry "only a suggestion" | Cache class reference |
| `Properties.getProperty` | avg 30 ms (20–84), 100 samples, 2023 | ziritione.org benchmark |
| `Properties.setProperty` | avg 62 ms (43–231) | same |
| `CacheService.get` / `put` | avg 3 ms / 93 ms | same |
| read+write cycle, 100 B | Cache ~63 ms · Properties ~80 ms · SpreadsheetApp ~800+ ms, 2024 | poehnelt.com benchmark |
| `google.script.run` round trip | 400–1,500 ms per call, community figure | dev.to / community thread |
| execution hop overhead | "3 to 5 seconds per execution hop" for container start + auth | tanaike, 2026 |
| `timeBased().after(ms)` | a MINIMUM; "actual duration might vary" | ClockTriggerBuilder reference |
| Sheets API vs SpreadsheetApp | reads ~35 % cheaper, writes ~19 % cheaper (2018, runtime unstated) | tanaikech benchmark |
| HtmlService sandbox | IFRAME mode, `allow-same-origin` + `allow-scripts`; no CSP documented | HTML Service restrictions |
| iframe origin | `n-<hash>-0lu-script.googleusercontent.com/userCodeAppPanel`; per-web-app storage isolation confirmed by users, hash stability undocumented | community threads |
| loopback fan-out | `UrlFetchApp.fetch` to own `/exec`, `timeoutSeconds: 1`, needs "Anyone" access, ~30 concurrent connections | tanaike gist |

**The one number still missing is ours.** `timedApi_` logs `{api, ms}` per call and `api.js`
prints `[rpc] name Nms`, but nothing aggregates either and nothing records `doGet` → first
paint. Axis 0 exists to replace the priors above with this deployment's own figures.

## Gain bands

- **L** — removes ≥ 1 round trip or ≥ 1 s from a user-visible wait, on most page views.
- **M** — 100 ms to 1 s on a view, or seconds-to-a-minute off a scan.
- **S** — < 100 ms per view, or only on cache-miss paths.

Each axis ends with **Proof:** the number that must move, and **Cost:** in engineer-days.

---

## Axis 0 — Measure first

**Fact.** Two timing hooks exist, both write-only. Nothing tells us whether a page's wait is
the `doGet` document, the round trip, Drive, Sheets, Properties, compute, or paint.

**Proposal.** Server: extend `timedApi_`'s log line with counters the services already
expose cheaply (Drive calls, Sheets reads, property reads, cache hit/miss) by wrapping the
four call sites in `archiveStore`, `sheetsDb`, `props` and `serverCache` with a
per-execution tally. Client: `performance.mark` at splash paint / bootstrap resolved / page
RPC resolved / first chart, reported once per session. Pull one week of both into a table by
endpoint and hit/miss. One DevTools look at the `content-encoding` of `/exec`.

**Gain.** None directly; decides the order of everything below. **Cost:** 0.5 day.

## Axis 15 — Drive files by id, not by name  (L on every cold path; new in rev. 2)

**Fact.** Weak point 1. Four DriveApp calls per file read, ~12 on a cold bootstrap, four more
per durable model a page probes. The scans row already carries `raw_ref` / `obs_ref` ids;
the snapshot, frame and read-model files have none stored anywhere. `readModelStore`'s
folder memo does not cover reads.

**Proposal.** Store the file id of each named file (snapshot, frame per scan, each durable
read-model) in Script Properties or on the scans row at write time, read with
`DriveApp.getFileById` (one call), and fall back to the name search only when the id is
absent or throws. Extend `folderMemo` to the read path as the cheap first step.

**Gain.** Removes ~75 % of Drive calls on every cache-miss and every L2 hit. If a DriveApp
call costs what the Properties/Sheets benchmarks suggest for a network-bound service
(hundreds of ms), that is 1–3 s off a cold Executive and off every first-visitor-of-the-hour
load. Likely the largest server-side win in this note.
**Proof:** Drive-call counter (Axis 0) on cold `bootstrap` drops from ~12 to ~3; cold
`{api:"bootstrap", ms}` drops by the same order. **Cost:** 1 day.

## Axis 16 — The hit-path floor  (M on EVERY RPC; new in rev. 2)

**Fact.** Weak point 2. ~9 property reads (avg 30 ms each) and one spreadsheet open plus two
range reads on a fully cached bootstrap; 4–5 property reads and the access check on every
other RPC; the same on every 3 s poll tick.

**Proposal.** One `getProperties()` per execution, memoized (the CANCEL flag the scan loop
re-reads on purpose stays on `getProperty`). Publish `activeJob` into a CacheService key
from the scan loop so bootstrap and the poller never open the spreadsheet. Fold the
allowlists into the same single read.

**Gain.** ~0.3–0.8 s off the server side of every RPC that is a hit, which after the warm is
most of them; quota headroom on consumer accounts (weak point 6).
**Proof:** property-read counter per RPC goes from ~9 to 1; hit-path `{api:"bootstrap", ms}`
drops accordingly. **Cost:** 0.5 day.

## Axis 1 — Paint from a persisted bootstrap, then revalidate  (L, every reload)

**Fact.** `store.js` holds `bootstrapData` and the SWR cache in module memory only. Every
full load blocks the splash on `api_bootstrap`, then the page on its own RPC.

**Dependency, now stated.** Storage works within one web app (repo preferences already use
it; the sandbox carries `allow-same-origin`). Origin stability across deployments is
undocumented. Test first: write a marker, publish a new version, reload, read it. If the
marker survives, build; if not, the same design works with `sessionStorage` semantics only
(tab-lifetime), which still covers `refresh()` after a scan.

**Proposal.** Persist the bootstrap envelope and the last payload per `swrCall` key, keyed by
the build stamp the envelope carries and capped per key. Paint from the stored copy, let
`swrCall`/`onFresh` repaint if the live answer differs, and mark the interval "as of <last
scan> · updating" so a stale figure names itself — the screen has to say what it measured.

**Gain.** First meaningful paint goes from `doGet + 2 RPCs` to `doGet` on every warm reload;
1–3 s per load by the priors. **Proof:** client mark "bootstrap painted" moves to ≈ 0 ms
after `doGet`. **Cost:** 2 days.

## Axis 2 — Concurrent instead of serial RPC chains  (L on the pages that have them)

**Fact.** Only `gas_ai/pages/graph.js` overlaps its page RPC with bootstrap. Everywhere else
`route()` runs after `await bootstrap()`. `gas/pages/overview.js` runs three RPCs in series.
`gas_devsecops` spends a third boot RPC on `api_getJobStatus`.

**Proposal.** Fire the default route's page RPC in parallel with bootstrap (generalise the
graph page's prefetch in `appShell`); issue overview's three concurrently — NOT merged, so
insights still paints first (weak point 9); put `activeJob` in gas_devsecops's bootstrap.
The 30-simultaneous-executions cap is far above 3–4 concurrent calls.

**Gain.** One round trip off every first view, two off OS-vulnerabilities. **Proof:** client
mark "first page RPC resolved" moves earlier by one round trip. **Cost:** 1 day.

## Axis 3 — Keep clock-dependent models warm across the hour  (M–L, first visitor per hour)

**Fact.** KM, SLA, aging, capacity and week-trend models drift with `Date.now()`, so they are
L1-only with a 1 h TTL; the warm runs three times a day, so most hours the first Executive
or MTTR visitor pays the full recompute. gas_devsecops already censors at the ledger clock
(`atLedgerClock`, `asOfSource`), which makes the same models durable there.

**Proposal.** Censor at the ledger clock in gas and gas_ai too, and make the models durable.
Cost in accuracy: open ages read up to one scan interval (24 h) low, on figures published
in days.

**Gain.** Removes the cold path for everyone but the first visitor after a scan.
**Proof:** cold-path count per day in the `{api, ms}` log (calls over, say, 3 s) falls to the
number of scans. **Cost:** 2 days, plus the product decision.

## Axis 4 — Kaplan–Meier: the quadratic core  (M on miss paths, L for the warm budget)

**Fact.** `kmCurve()` (`remediation.ts:156-167`, duplicated in gas_devsecops) is O(E × N):
for every distinct event time it re-filters the whole `times` array. With continuous
`mttr_days`, E ≈ resolved rows. `getMttrPage` builds ~8–9 curves per call, `withKmMedian`
one per trend point, `executiveWeekTrend` two `kmMedianAsOf` passes. Weak point 4: the
existing stress test uses 500 distinct times and cannot see this.

**Proposal.** Sort once, sweep once with a running at-risk count and tie groups; add a
stress case with continuous times (N = 20,000, ~10,000 distinct events) before the rewrite so
the improvement is a measured number.

**Gain.** 10–100× on the function; miss latency on MTTR/trend endpoints down 2–5×; warm
stops running out of budget. **Proof:** the new stress case's elapsed time before/after; the
warm log stops printing "ran out of budget". **Cost:** 1 day.

## Axis 5 — Parse the base once per execution  (M on miss paths)

**Fact.** `baseRows()` runs four `parseTs` per row and is rebuilt on every `loadBaseRows()` /
`scopedBaseRows()` call; `loadTrend` re-parses the base in five functions;
`attachBizDomains` re-parses `tags_json` per row at seven call sites. The one place this was
fixed measured `Date.parse` as "the whole cost".

**Proposal.** Memoize `baseRows` per execution beside `stateMemo`; carry numeric epochs on
the parsed row; parse `tags_json` once when the snapshot loads.

**Gain.** 20–40 % of miss-path compute on insights / trend / bootstrap. **Proof:** miss-path
`{api, ms}` for `getInsights` and `getMttrTrend`. **Cost:** 1 day.

## Axis 6 — Bound the synthetic trend backbone  (S–M, grows with register age)

**Fact.** `trendFromBase` seeds one synthetic point per calendar DAY from the earliest
`first_seen` to the first scan. Only `withKmMedian` caps at 48; four other point loops walk
every day; real scan points are never capped.

**Proposal.** Apply the same `kmSkipMask` thinning to every point loop; cap real points to a
window the chart can show. **Proof:** point count logged per trend build. **Cost:** 0.5 day.

## Axis 7 — Server bundle diet  (S per RPC, ×every RPC)

**Fact.** V8 loads the whole `server.js` per execution, including the dry-run fixture (39 /
68 KB) and the GraphQL query strings. `timedApi_` starts its clock AFTER the load, so this
cost is invisible today.

**Proposal.** Move the fixture out of the live bundle; then measure with a no-op `api_ping`
round trip across two deployments of different bundle size before doing more.

**Gain.** Unknown; V8 lazy-parses, so the prior is tens of ms per execution. **Proof:** the
`api_ping` A/B. **Cost:** 0.5 day.

## Axis 8 — Persist the Chart.js bundle across loads  (M on the first chart route per session)

**Fact.** `chartsLoader.js` memoizes the 211 KB bundle in memory only. Same storage
dependency as Axis 1; same CSP unknown the loader already lives with (the restrictions page
documents no CSP at all).

**Proposal.** Store the source string keyed by build stamp; execute through the existing
three-mechanism ladder. **Gain.** One round trip + 72 KB gzip per session. **Proof:** count of
`api_getChartsBundle` calls per session in the log. **Cost:** 0.5 day.

## Axis 9 — Scan pipeline: per-page overhead and hop gaps  (M per scan)

**Fact.** In gas and gas_devsecops every page does one Wiz POST, one Drive gzip create, and
one `updateJob` that READS THE WHOLE JOBS GRID to find one row. gas_ai throttles that to one
checkpoint per 8 s. Each hop then waits `after(30 s)`, which is a floor (weak point 5).

**Proposal.** Port the 8 s checkpoint; remember the job's row index inside the execution;
coalesce page archives into multi-page parts under a size cap; MEASURE the real hop gap from
`updated_at` deltas before touching the delay.

**Gain.** Per page ~100–500 ms of Sheets and Drive I/O; a 200-page scan saves 20–100 s, plus
whatever the real hop gap turns out to be. **Proof:** scan wall-clock in the scans row;
Drive/Sheets counters per hop. **Cost:** 1 day.

## Axis 17 — Parallel fan-out for the battery apps  (M–L per sync; new in rev. 2, with a hard caveat)

**Fact.** gas_devsecops walks three scopes sequentially in one job; gas_ai's battery is a
sequence of independent steps. A documented pattern runs work in parallel by having the
script `UrlFetchApp.fetch` its own `/exec` with `timeoutSeconds: 1`, each call becoming its
own execution (up to 30 concurrent), with a Sheets ledger for state.

**Caveat that may kill it here.** The pattern needs the web app deployed with "Anyone"
access, and the loopback arrives with no active user — exactly the anonymous caller the
access layer denies. It would need an internal-token path around `access.ts`, which widens
the surface the allowlists exist to close. Named as an axis because the gain is real;
recommended only if the access review accepts a signed internal call.

**Gain.** Scopes / steps that fit one hop each run in wall-clock parallel: gas_devsecops's
sync ≈ the slowest scope instead of the sum; gas_ai's ~2 min could approach the longest
step. **Proof:** sync wall-clock in the history row. **Cost:** 3 days plus the access review.

## Axis 10 — gas_ai sync page size  (M per sync)

**Fact.** Default `PAGE_SIZE` = 100 against 500 in the siblings; `PAGE_SIZE_WIDE` = 500
already exists as a per-step opt-in, kept narrow because `expandAsset` is the one call a
user waits on.

**Proposal.** Opt the bulk battery steps into the wide page. **Gain.** Up to ~5× fewer
calls on bulk steps; sync perhaps 2 min → ~1 min. **Proof:** `api_calls` in the sync history
row. **Cost:** 0.5 day.

## Axis 18 — Sheets Advanced Service for the big rewrites  (S–M per scan; new in rev. 2)

**Fact.** Scan commit overwrites `vuln_ledger` and `episodes` wholesale (18k × 23 cells); a
gas_ai persist rewrites up to 12 tabs. A 2018 benchmark put Sheets API reads ~35 % and writes
~19 % cheaper than SpreadsheetApp; the runtime it measured is not stated.

**Proposal.** Re-measure on V8 with one tab first; if the gap holds, route `overwrite` and
`readGrid` through `Sheets.Spreadsheets.Values.batchUpdate` / `batchGet`. Also the natural
place for gas to gain the blocked read its siblings have (`READ_BLOCK_CELLS`).

**Gain.** Seconds per scan commit; more valuable as headroom under the 6-minute cap than as
speed. **Proof:** commit-phase time in the scan log. **Cost:** 1–2 days.

## Axis 11 — Route-level code splitting in gas_ai  (S–M on doGet, gas_ai only)

**Fact.** gas_ai's first document is 818 KB raw because every page is statically imported;
`pages/aars.js` alone is 192 KB source, the graph stack 156 KB. Weak point 7: whether the
wire carries 818 KB or 243 KB is unverified, and it changes this axis's weight.

**Proposal.** Check `content-encoding` first. Then ship the heaviest pages as partials
fetched over RPC on first visit, exactly as `js_charts` already is.

**Gain.** Roughly halves gas_ai's first document; 50–150 ms of parse on a fast link, more
behind the corporate proxy path. **Proof:** `doGet` → splash-paint mark. **Cost:** 2 days.

## Axis 12 — Client cache hygiene  (S–M perceived)

**Fact.** `swrCall` is opt-in and many read sites use bare `call()`; revalidation compares by
double `JSON.stringify`; `refresh()` after a job throws away every cached RPC and re-runs the
whole boot with the splash.

**Proposal.** Make `swrCall` the default for GET-shaped calls; compare on a server-issued
stamp; after a job, invalidate only ledger-derived keys and re-render in place.
**Proof:** RPC count per session in the console log. **Cost:** 1 day.

## Axis 13 — Cheaper polling  (S user-facing, M for quota)

**Fact.** Every 3 s poll is a full execution: script load, access check (2 property reads),
`readTail` on the jobs tab. Ten minutes of scan is 200 executions and ~800 property reads.

**Proposal.** Axis 16's CacheService job flag makes the poll a single 3 ms cache read; back
the interval off toward 10 s when nothing changed. **Proof:** property-read counter per poll
→ 0–1; trigger/execution minutes per scan. **Cost:** 0.5 day (mostly Axis 16).

## Axis 19 — Size the CacheService key space  (S, but a cliff; new in rev. 2)

**Fact.** Weak point 6. The warm writes 14–25 payloads of ≥ 2 items each; every scoped
`cached()` call (domain × support group × severity) mints more; `registerRows` is already
kept out for exactly this reason. Past 1,000 items the service keeps the 900 farthest from
expiry — the 6 h durable entries survive, the 1 h clock models go first.

**Proposal.** Log the item count the warm produces; count distinct scoped keys per day from
the `{api, ms}` log; if the sum approaches 1,000, stop caching scoped variants of the
heaviest models rather than let eviction pick.
**Proof:** item count per warm in the log. **Cost:** 0.25 day.

## Axis 14 — L1 cache format  (S per hit)

**Fact.** Every L1 hit pays `getAll` over chunks + base64 decode + `ungzip` + `JSON.parse`.
`CacheService.get` itself is ~3 ms; the decode is the cost.

**Proposal.** Store payloads under ~90 KB raw without gzip; repeat the unread-field audit that
already shed 4.3 KB from the Executive bootstrap. **Gain.** Tens of ms per hit; only after
Axis 0 says hits dominate. **Cost:** 0.5 day.

---

## Suggested order (revised)

1. Axis 0 (measure) and, in parallel, Axis 15 (Drive by id) and Axis 16 (hit-path floor):
   both are server-only, fixture-safe, and by the published latencies they remove more wall
   time than anything else.
2. Axis 2 (concurrent chains), then the Axis 1 origin test and, if it passes, Axis 1 and 8.
3. Axis 4 and 5 together (KM sweep + shared parsed base), then Axis 3, which the two make
   cheap enough to keep warm.
4. Axis 9, 10, 18 on the scan side; Axis 17 only after the access review; Axis 7, 11, 12,
   13, 14, 19 as measurement justifies.

## What this note deliberately does not claim

- No number for L/M/S is measured end-to-end on this deployment; the bands rest on
  round-trip, Drive-call and row-pass counts, on the two timings the code carries, and on
  third-party benchmarks of the platform services.
- The dev loop (`npm run check`) was not timed; `gas/` has no `node_modules` installed here.
- Correctness-adjacent trade-offs (ledger-clock censoring, stale-first painting, an internal
  loopback token) are named as decisions, not made.

## Sources

- Apps Script quotas: https://developers.google.com/apps-script/guides/services/quotas
- Cache class limits: https://developers.google.com/apps-script/reference/cache/cache
- ClockTriggerBuilder `after()`: https://developers.google.com/apps-script/reference/script/clock-trigger-builder
- HTML Service restrictions (IFRAME sandbox): https://developers.google.com/apps-script/guides/html/restrictions
- Properties / Cache latency benchmark (2023): https://www.ziritione.org/post/apps_script_performance/
- Key-value store latency benchmark (2024): https://justin.poehnelt.com/posts/apps-script-key-value-stores/
- Sheets API vs SpreadsheetApp benchmark (2018): https://tanaikech.github.io/2018/10/12/benchmark-reading-and-writing-spreadsheet-using-google-apps-script/
- Loopback parallel execution pattern: https://gist.github.com/tanaikech/343a86fbe631fdc3eda0987d5bb1f44a
- `google.script.run` latency, community figure: https://dev.to/stack_c285afb2fa0bef/google-apps-script-quota-limits-2026-every-error-every-fix-2p87
- localStorage isolation per web app: https://groups.google.com/g/google-apps-script-community/c/2wDmEQr3_CI
