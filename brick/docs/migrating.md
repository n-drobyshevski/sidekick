# Migrating into the register

## Migrating an existing register

Everything above applies to tables created from now on. A register that already exists keeps its
unclustered layout — a clustering spec cannot be added by an append, and this pipeline will not
silently rewrite the physical layout of a production ledger on the next scheduled run.

Migrating is a handful of statements against the two clustered tables — `metrics` declares no
layout, so there is nothing to `ALTER` on it. Run them once, from a notebook or the SQL editor,
with the pipeline stopped:

```sql
ALTER TABLE <catalog>.<schema>.wiz_vuln_ledger CLUSTER BY (scope, vuln_key);
ALTER TABLE <catalog>.<schema>.wiz_vuln_ledger
  SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true');

ALTER TABLE <catalog>.<schema>.wiz_findings_raw CLUSTER BY (scope, scan_id);

OPTIMIZE <catalog>.<schema>.wiz_vuln_ledger;
OPTIMIZE <catalog>.<schema>.wiz_findings_raw;
```

One statement each now, not one per scope — the register is one shared table set, so there is
one `wiz_vuln_ledger` and one `wiz_findings_raw` to migrate, not three.
`run_pipeline.CLUSTERING`'s two-column tuples are exactly these `CLUSTER BY` lists.
**This recipe is documented, not measured**: no register ever ran the earlier per-scope table
layout (`wiz_os_vuln_ledger`, `wiz_sca_vuln_ledger`, …) against live data, so there is nothing
to migrate *from* in practice and this ALTER has never been run against a populated table.

Three things to know before you do:

- **Existing data is not reclustered until `OPTIMIZE` runs.** `ALTER TABLE` changes the spec,
  nothing else. Until then the layout is unchanged.
- **`ALTER TABLE` needs ownership or `MANAGE`**, which is more than the `MODIFY` the pipeline
  itself runs on — see the grant list in [Store the credentials](deploy.md#1-store-the-credentials). This
  is an operator action, not something the service principal should be able to do.
- **The reader-version bump on the ledger is one-way** (see
  [Table layout](register.md#table-layout)). Check what else reads that table first.

The alternative to all of it: `--rebuild_ledger` against a freshly created register replays
bronze into new, correctly-clustered tables — see below.

## Backfilling from existing bronze

If a register has been running against an older flat-snapshot version of this pipeline, bronze
already holds months of scans. `--rebuild_ledger` rebuilds **one scope** — the one named by
`--scope` — and leaves the other two untouched: it deletes that scope's rows of `metrics` (the
commit record and every gold family, not only the replayed `scan_id`s) along with that scope's
ledger rows, then replays that scope's bronze scans oldest-first through the same reconciler the
live path uses. Every statement it issues names `scope` for exactly the reason `reconcile_scan`'s
prior does — the ledger, bronze and `metrics` are shared by every register now, and an unscoped
`--rebuild_ledger` would be the single most destructive statement in this file, emptying two
registers that have nothing to do with the recovery being attempted:

```bash
python brick/run_pipeline.py --catalog=<catalog> --scope=os --rebuild_ledger=true \
  --severities=CRITICAL,HIGH --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

Without it the ledger starts today: every finding's `first_seen` collapses to now and MTTR reads
as roughly zero until enough history accumulates.

**One caveat, and it matters.** The oldest scans never recorded which severities a scan asked
for, so replayed scans are assumed to have used the `--severities` you pass. If your history was
collected under a different scope, pass *that* scope — otherwise the replay will resolve-by-
disappearance severities the original scans never covered, and invent remediation that never
happened. Scans that already carry their own scope and severities are unaffected.

**It regenerates gold too, not only the ledger.** Each replayed scan reconciles, commits its
record, and then publishes its own gold from the ledger as it stood at that point in the replay
— the same three steps in the same order a live scan takes, because it is the same two
functions. That makes `metrics` a pure function of bronze plus the replay's `--severities`, and
it is the only way to put back a scan's gold once a later scan has moved the ledger past it (see
[The scan record is load-bearing](register.md#the-scan-record-is-load-bearing)). It also means the cost is
per replayed scan rather than a single pass: a rebuild over a long history is a genuinely long
job, and is not something to run on a schedule.

The rebuild is idempotent, and `tests/test_ledger_pipeline.py` pins the invariant that matters:
replaying bronze lands exactly where running those scans live landed.

## Migrating from the Apps Script app

`--rebuild_ledger` only helps a deployment that already has bronze. A **new** deployment beside
a `gas/` app that has been scanning for months has none — and starting its ledger today is not
merely incomplete, it is wrong in the same four ways: `first_seen` collapses to now,
Kaplan–Meier reads near zero, capacity marks every earlier month `reconstructed`, and the
confusion matrix is computed over a population one scan deep. None of it looks like an error.

`import_bundle.py` seeds the ledger and the scan log from a **migration bundle** — the
`wiz-sidekick-migration` JSON that `wiz_dashboard/data/migrate.py` defines, the GAS app already
imports, and now exports too. This is **`os`-only in practice**: `gas/` has been reconciling a
daily OS-patching scan, so it is the only one of the three registers here with a matching
history to seed from. Nothing in `import_bundle.py` refuses a different `--scope` — `scope` is
stamped from the run the same way every other write is, and there is no bundle format for
`sca` or `sast` to check against yet — but there is no `gas_devsecops/` export today that would
give one a history to import.

```
GAS  Data → Migration bundle (Drive)        →  migration-<ts>.json.gz
     upload to a Unity Catalog volume       →  /Volumes/<cat>/<schema>/<vol>/migration-….json.gz
brick 07_import_gas  (or the CLI below)     →  wiz_vuln_ledger + the family='scan' rows of wiz_metrics
     06_run_and_verify, one scan            →  the gold families, from real lifetimes
```

```bash
python brick/import_bundle.py --catalog=<catalog> --schema=<schema> --scope=os \
  --bundle_path=/Volumes/<catalog>/<schema>/<volume>/migration-20260811T000000Z.json.gz
```

**A bundle is one scope's register**, and the import is scoped to it. `wiz_vuln_ledger`,
`wiz_findings_raw` and `wiz_metrics` are shared by every scope now, so the importer reads and
writes only the rows carrying `--scope`'s value: it seeds an **empty** register (this scope
holding nothing — the ledger, or any row of `metrics`, commit record or gold alike) and refuses
otherwise. Merging a seed into a register that has already scanned would re-open lifecycles it
has since resolved, and appending an older scan log beside this pipeline's own would hand the
disappearance guard the wrong previous scan — and with three scopes in one table set, an
unscoped refusal check or an unscoped delete would answer for, or empty, registers that have
nothing to do with the import being run.

`--force_import=true` **replaces this scope's register**, not merely its ledger, and never
touches the other two scopes' rows. Gold is why: it is appended per scan and computed from the
ledger *as it stood at that scan*, so gold rows written before a seed were derived from a ledger
that started empty. Left in place they sit in `04_scan_history` as a run whose MTTR reads near
zero, beside seeded runs where it does not — a contradiction with nothing on the page to explain
it. So a forced import empties this scope's bronze and this scope's share of the *whole*
`metrics` table — the scan log and every gold family together, since they now share one table —
and this scope's register genuinely restarts from the imported history. Re-scan to repopulate
them.

They are emptied rather than dropped: `DELETE` needs only `MODIFY` and keeps each table's
grants, where `DROP` needs ownership and would take the grants with it.

**If the import stops with "No write access"**, that is Unity Catalog, not the bundle. A
`DELETE … WHERE 1=0` probe runs before the expensive work precisely so the refusal names the
grant instead of surfacing as a `Py4JJavaError` at `saveAsTable` some jobs later. Note that
overwriting is not a way around it — UC gives a table's owner `MODIFY` implicitly, so being
refused it means this principal does not own the table, and replacing or dropping needs
ownership or `MANAGE`, a strictly higher bar. Grant at the schema, because the first scan after
the import creates the one remaining table, bronze:

```sql
GRANT USE CATALOG ON CATALOG <catalog> TO `<principal>`;
GRANT USE SCHEMA, SELECT, MODIFY, CREATE TABLE ON SCHEMA <catalog>.<schema> TO `<principal>`;
```

**The two parameters that must match GAS**, because getting either wrong invents remediation
that never happened:

| | |
| --- | --- |
| `--severities` | the scope GAS was scanning. Absence of a severity nobody looked for is not a fix — the same caveat the bronze rebuild carries |
| `--project_id` | GAS's `WIZ_PROJECT_ID_V2`. GAS scans one Wiz project; `--scope=os` pins none unless asked. A wider or narrower population resolves-by-disappearance everything outside the overlap on the first run |

Read `resolved_count` in that first run's summary before anything else. A plausible day's
remediation means the handoff worked; a number close to the whole register means the populations
disagree, and the fix is to re-import with corrected parameters rather than accept it — after a
second run the mistake is indistinguishable from a real mass closure.

### What comes across, and what does not

`config.LEDGER_COLUMNS` was written to mirror `gas/src/domain/reconcile.ts`'s list, so 23 of
GAS's 24 ledger columns map 1:1 — including the vendor-fix clock and the exploit signals, which
cannot be recovered afterwards because a finding resolved by disappearance is gone from the API
entirely. Sealed `resolved_episodes` are folded in as ordinary RESOLVED rows, mirroring
`ledgerCore.baseRows`, which unions them at read time: that union is the population GAS's own
coverage and MTTR are computed over, so importing only the live ledger would shrink both.

| Not carried | |
| --- | --- |
| `tags_json` | ingest selects no asset tags, so nothing downstream would read it — and domain triage is unavailable here either way |
| a back-dated actionable clock | `fix_date` / `fix_observed_at` arrive and are read (see [The actionable clock](reading-the-numbers.md#the-actionable-clock)), but the bundle carries no fix history beyond what each lifecycle's last observation held |
| bronze, and therefore a back-dated gold trend | the bundle holds reconciled lifecycles, not raw findings. The `family='scan'` rows of `wiz_metrics`, filtered to this scope, show the imported runs; the gold families begin accumulating from the first live run |
| `mttr_history` | GAS's precomputed daily KPI series. It rides in the bundle and this pipeline has no table for it |
| several episodes for one `vuln_key` | this ledger is one row per key, so the most recently resolved wins; the import counts the rest |

Two things survive the import but not a **re-scan**, and both are worth knowing before reading a
severity breakdown. GAS heals a blank severity from `vendorSeverity` / `nvdSeverity`
(`gas/src/domain/severity.ts::effectiveSeverity`), and this pipeline's `ingest` queries neither
field, so such a row will read `UNKNOWN` after its next scan — and `UNKNOWN` has no
`SLA_TARGETS` entry. GAS likewise falls back `firstDetectedAt → firstSeenAt → createdAt` where
this pipeline reads only the first.

**The `h:` caveat.** `vuln_key` is `id:<wiz finding id>` when the API gave one and a hash
otherwise, and the hash basis includes `component`, which GAS never persisted. An imported `h:`
row is therefore re-keyed by the next scan and starts a second lifecycle. Only findings with no
Wiz id are affected, which is why the import prints the `h:` count — that number is the blast
radius, and it is usually zero.
