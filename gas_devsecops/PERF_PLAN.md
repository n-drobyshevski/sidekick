# gas_devsecops performance plan — done; kept as the measurement record

Port of the `gas/` performance work (PRs #316–#325, 23 Sep 2026) to `gas_devsecops/`, executed
in PRs #327–#330. **Every step is merged or explicitly dropped** (see "Outcome" below). The file
stays rather than being deleted because code comments across `src/server/` and `test/` cite its
step numbers as the source of their measurements.

## Outcome (production, warm load, 23 Sep 2026 22:33)

| | Before (step-1 numbers below) | After |
|---|---|---|
| doGet | 6.4 s warm / 7.1 s cold, computing bootstrap inline | **2.2 s**; bootstrap inlined from cache in 525 ms (`dsBootCore1` peek 235 ms + live fields 286 ms), no Sheets reads |
| getExecutivePage | ~1.2 s server-side, 0.85 s of it opening the spreadsheet | **0.58 s** server-side, `dsMttr4` hit, no Sheets reads |
| Page-load RPCs | bootstrap + executive + id-less job status | executive only; the running-sync check reads the bootstrap (`syncProgress.resumePlan`, #330) |

Dropped by the numbers: the active-job display cache (34 ms) and base rows once per execution
(one derivation per execution). Warm continuation: port it from `gas/` only if a
`trigger_warmReadModels` log shows `Read-model warm: out of budget`.

## What `gas/` taught us (read this first)

- **Measure before fixing.** In `gas/`, three plausible hypotheses (network, the cold-zone model,
  generic I/O) were each wrong. The execution-log timing lines (#319) found the real causes in
  one deploy. Do the same here: instrument, deploy, read the log, then fix.
- **Synthetic benchmarks can hide the bug.** A benchmark with identical `mttr_days` on every row
  hid a quadratic Kaplan–Meier. Benchmark with realistic, fractional, mostly-distinct values.
- **GAS CPU is close to node; GAS I/O is not.** `baseRows` over 58k rows ran in ~0.3–0.5 s in
  GAS. What was slow: algorithms (quadratic KM), recomputation (the same derivation 5–27× per
  execution), the first Sheets access per execution (2–9 s to open the spreadsheet), and Drive
  downloads (0.5–2.6 s for the same file).
- **Results in `gas/`:** cold Executive 85–152 s → ~12 s; warm Executive ~1 s server-side;
  warm doGet touches no Sheets; full page load ~2.8 min → ~6 s; deploys no longer cold-start
  the cache.

Reference implementations live in `gas/` (and `gas_shared/server/inlineBoot.ts`). Port the
idea, not the file: `gas_devsecops` has its own `readModels.ts`, `readModelStore.ts`,
`serverCache.ts`, scopes (`sca`/`sast`/secrets) and `loadBaseRows(options)`.

## Current state of gas_devsecops (verified 23 Sep 2026 against main @ 938bd6a)

| Area | Where | State |
|---|---|---|
| Quadratic KM | `src/domain/remediation.ts:241` `kmCurve` | **Fixed in step 1** (sort and sweep, `test/kmCurveSweep.test.ts`). Was: same bug as gas/ had. Re-filters both arrays per distinct event time. Used by `kaplanMeier` (`remediation.ts:448`), i.e. the MTTR hero. `kmCurveEntry` (`:282`) is already O(n log n). |
| Bootstrap | `src/server/bootCore.ts` | **Cached core in step 2a** (`dsBootCore1`, durable, warmed first; live fields in `api.withLiveBootFields`). Was: not cached at all. Reads the `scans` tab, `loadSettings()`, `ledgerStore.loadBaseRows()` over the whole ledger, and `activeJob()` (`api.ts:378`, the whole `jobs` tab) on every call. |
| Inline bootstrap | `src/server/main.ts:8` | **`bootstrapIfWarm()` in step 2a** — peeks L1/L2, never computes. Was: doGet computed the full bootstrap on every load (6.4 s warm / 7.1 s cold, measured). |
| Settings | `src/server/settingsStore.ts` `loadSettings` | **CacheService in step 2b** (`dsSettings1:<dataVersion>`, 6 h, write-through in `saveSettings`, raw dict cached and cleaned on load). Was: read the `settings` tab every execution. |
| Repository tag map | `src/server/repoTags.ts` `getRepoTagMap` | **CacheService in step 2b** (`dsRepoTagMap1:<dataVersion>`, gzip + chunked, 6 h, write-through in `setRepoTagMap`; an unreadable tab is not cached). Was: `domain_map` tab (~9.8k rows, 1.5–1.7 s) every execution. |
| Cache key | `src/server/serverCache.ts` `KEY_PREFIX = wsk.e${CACHE_EPOCH}` | **Epoch in step 2d**: a deploy no longer cold-starts the cache; `settingsImpact` → `settingsImpact1`; the tag keys joined `configStamp`. Was: BUILD_ID in every L1 key and the L2 stamp. |
| Namespaces | `readModels.ts`: `dsMttr4`, `dsExecutive2`, `dsRegister2`, `dsSecrets2`, `dsProgram2`, `dsRepos2`, `dsHistory4`, `dsStorage1`; `api.ts`: `settingsImpact1` | All versioned, pinned by `test/cacheNamespaces.test.ts` (step 2d). |
| Base rows | `src/server/ledgerStore.ts:691` `loadBaseRows(options)` | Re-derived per call; options vary by `now` / `scope` / `trackingStartByScope`. 13 call sites. |
| Snapshot | `src/server/archiveStore.ts` `writeLedgerSnapshot`/`readLedgerSnapshot` | **v2 in step 2c** (shared codec, `gas_shared/domain/snapshotCodec.ts`, keyed by `finding_key`; v1 still read; `scans` no longer written). Was: v1, 1.96 MB gz, 2.4–2.8 s per cold read. |
| Warm | `src/server/readModels.ts:2598` `warmReadModels`, `WARM_BUDGET_MS` `:245` | Budgeted, logs a cut-out, **no continuation**. |
| `parseTs` | `src/domain/util.ts:107` | **Fast path added in step 1** (`test/parseTs.test.ts`). |
| Timing logs | sheetsDb, archiveStore, serverCache, readModelStore, ledgerStore, api (`bootstrap`, `getExecutivePage`) | **Added in step 1.** Awaiting the first production logs. |

Checks: `cd gas_devsecops && npm ci && npm run check` (typecheck, lint, vitest, check-dist-fresh).
Rebuild `dist/` with `npm run build` and commit it with each change (`check-dist-fresh` fails
otherwise). Read `gas_devsecops/README.md` and `DESIGN.md` before changing server behavior.

## Step 1 — instrument + the certain fixes (one PR)

1. **Timing lines**, same shapes as `gas/` so logs read the same across apps:
   - `sheetsDb.readAll`: `{"stage":"sheet",tab,rows,ms}`
   - `archiveStore` gz-JSON reads: `{"stage":"drive",label,name,bytes,fileMs,parseMs,ungzipMs,textMs,jsonMs}`, plus `driveTotal` around the snapshot/frame reads (include the folder lookup).
   - `serverCache.cached`: `{"stage":"cache",name,hit,getMs,computeMs,putMs,chars}` on hits and misses (`cachePutJson` returns the JSON length).
   - `readModelStore.durablyCached` L2 read: `{"stage":"l2",name,hit,why,ms}`.
   - `ledgerStore.loadBaseRows`: `{"stage":"baseRows",rows,ms}`.
   - Per-slice timing in the landing page's endpoint, `getExecutivePage` (`api_getExecutivePage` in `dist/entry.js`), pinned by a spec so a refactor can't drop a slice.
   - Also time `bootstrap` inside doGet (`inlineBootJson` already logs `{"api":"bootstrap","inline":true,"ms"}`).
   Reference: `gas/` PR #319.
2. **`kmCurve` → one sort and one sweep.** Copy `gas/src/domain/remediation.ts` `kmCurve` (sort-and-sweep, NaN dropped, `-0` reported as `+0`) and `gas/test/kmCurveSweep.test.ts` (the old implementation kept verbatim as the oracle, 200 seeded random registers + edge values + a <1 s perf check on 60k rows). Every existing vitest snapshot must stay unchanged. Reference: #320 (in gas/: 19,265 ms → 47 ms per curve at 58,679 rows).
3. **`parseTs` fast path** for 20-char `…T…Z` strings (`Date.parse` directly; fall through on NaN). Copy the parity spec `gas/test/parseTs.test.ts`. Reference: #318.

Then **stop and ask the user to deploy** and send: one cold load (after a settings save, which bumps DATA_VERSION) and one warm load of the landing page — the doGet log and the landing RPC's log.

## Step 1 numbers (production, 23 Sep 2026, ~28k base rows)

- **doGet** computing bootstrap inline: 7.1 s cold, **6.4 s warm** (never cached) — scans 0.8 s
  (mostly the spreadsheet open), settings 0.2 s, baseRows 2.2–2.8 s (ledger snapshot 1.9–2.5 s
  from Drive, 1.96 MB gz; derivation 0.13–0.17 s), repoTags 2.3–2.6 s (`domain_map` tab 1.5–1.7 s,
  9,776 rows), catalogues 0.4 s, live 0.3 s.
- **getExecutivePage** cold 7.8 s (re-reads settings, scans, snapshot and `domain_map`; the
  models' own CPU ~0.9 s + 0.4 s — KM is no longer visible); warm ~1.2 s, of which ~0.85 s is
  opening the spreadsheet to read settings.
- Not needed by these numbers: base rows once per execution (one derivation per execution),
  the active-job display cache (34 ms).

## Step 2 — decided by the step-1 numbers

Order by the numbers above: 2a = item 1 (bootstrap), 2b = item 2 plus a `domain_map` cache
(same shape: its only writer `repoTags.setRepoTagMap` bumps DATA_VERSION), 2c = item 7
(snapshot v2), 2d = item 4 (deploy invalidation). Items 3, 5 are not justified by the log;
item 6 only if a warm reports cut-outs.


Order by what the log shows. Expected, in rough order of impact:

1. **(2a, done)** **Cache the bootstrap core and inline it only when warm.** Split `bootstrap` into a cached core (everything derived from ledger/settings/scans — key on `dataVersion`, give it a versioned namespace like `dsBootCore1`, `durablyCached` if it should survive CacheService's 6 h) and live fields (`activeJob`, hub URL, credentials — never cached). Add `bootstrapIfWarm()` that peeks L1 then L2 and never computes (see `gas/src/server/api.ts` `bootstrapIfWarm`, `readModelStore.durablyPeek`, `serverCache.peekCached`/`primeCached`); point `main.ts` at it. Add the core to the warm, first. Reference: #317.
2. **(2b, done, with the `domain_map` cache)** **Settings cache** in CacheService, key `settings1:<dataVersion>`, TTL 21,600 s, write-through in `saveSettings`, skip dicts over 90k chars, any cache error falls back to the tab. Confirm `saveSettings` is the only writer of the tab and that it bumps the data version. Reference: #321 + #323, specs in `gas/test/requestMemos.test.ts`.
3. **Active job for display**, generation-keyed: `activeJob2:<generation>`, TTL 6 h, every writer of the `jobs` tab sets a fresh generation after its write; display only (guards keep `activeJob()`). Reference: `gas/src/server/jobsStore.ts` `activeJobForDisplay` / `forgetActiveJob` (#325), specs in `gas/test/jobsStore.test.ts` (including the late-stale-write race and the lost-generation case).
4. **(2d, done)** **Stop invalidating on deploy.** Replace BUILD_ID in `KEY_PREFIX` and in `currentStamp` with a `CACHE_EPOCH` constant; rename `settingsImpact` → `settingsImpact1` (or whatever suffix the next bump would be); add a spec like `gas/test/cacheNamespaces.test.ts` requiring a version on every namespace and keeping BUILD_ID out of the stamp; update the L2 "deploy moves the stamp" spec to "an epoch bump moves the stamp". Record the convention in root `CLAUDE.md` next to the gas/ line. Reference: #322.
5. **Base rows once per execution**, if the log shows repeated derivations: memoize per (state object, options) and hand out shallow copies — callers annotate rows in place. Bypass the memo for an explicit `now`. Reference: #318.
6. **Warm continuation** if the warm reports cut-outs: one-shot `trigger_continueWarm`-style handler with its own name, 6-hop cap per cache stamp, 60 s deferral while a job is in flight; add the handler to `dist/entry.js`, the entry-points spec and the build's NOT_RPCS guard. Put the landing page's models first in the warm order. Reference: #317.
7. **(2c, done — codec moved to `gas_shared/domain/`, gas/ imports it too)** **Snapshot v2** if the snapshot read is a visible cost: reuse `gas/src/domain/snapshotCodec.ts` (consider moving it to `gas_shared/domain/` and importing it from both apps rather than copying). Keep reading v1; name the v2 fields differently from v1 so a rollback reads the tabs instead of misreading. Reference: #324.

## Conventions carried over from the gas/ work

- One PR per step (or per logical change), each with before/after numbers from production logs in the description.
- Branch per session instructions; rebuild `dist/`; `npm run check` green before every push.
- Don't regenerate vitest snapshots to make a perf change pass — a perf change must leave them unchanged.
- Say plainly in the PR when something is estimated from node rather than measured in GAS.
