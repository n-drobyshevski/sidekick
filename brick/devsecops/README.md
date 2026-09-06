# `brick/devsecops/` — code-register metrics on Databricks

The same Prioritization-to-Prediction machinery [`brick/`](../README.md) applies to host
workloads, applied to the code side of the estate: CVEs in the libraries a repository depends on
(`sca`), and weaknesses in first-party code (`sast`).

| Metric | Question it answers | Formula |
| --- | --- | --- |
| **MTTR / SLA** | How fast are we closing risk? | Kaplan–Meier median over `resolved_at − first_seen`, counting still-open findings as right-censored |
| **Coverage** | Of all high-risk findings, what share did we remediate? | `TP / (TP + FN)` |
| **Efficiency** | Of everything we remediated, what share was actually high-risk? | `TP / (TP + FP)` |
| **Capacity** | Can we close faster than risk arrives? | monthly `closed / open_at_start`, and `closed − opened` |
| **Assets at risk** | Which repositories carry the backlog, which offer a foothold, which are falling behind? | P2P v5: per-repo density percentiles, foothold rate, coverage, half-life and net flow |

---

## This is a fork, and that is the first thing to know

**Every runtime module here is a copy of the one in `brick/`, with the same name.** `config.py`,
`ledger.py`, `metrics.py`, `run_pipeline.py` — all of them. This directory depends on nothing
outside itself and can be deployed on its own, which is the point; the cost is that the
cross-scan reconciler and the P2P maths now exist twice.

### The rule that keeps a fork survivable

> **Exactly one of `brick/` and `brick/devsecops/` goes on `sys.path`. Never both.**

The module names are identical, so a path holding both resolves each import to whichever
directory came first — and you get `brick`'s `config` (whose `SCOPES` have no `sca`) with this
`metrics` (whose silver projection expects one). That imports cleanly and then measures the
wrong thing, which is the worst of the available failures.

Two guards make it loud instead:

- `PIPELINE_VERSION` here is `1.0-devsecops`, which cannot collide with brick's `2.x`, so
  `check_deployment()` catches a mixed set on the version alone.
- `run_pipeline._check_one_directory()` additionally requires every loaded module to have come
  from *this* directory, which catches two forks that happened to share a version.

Both run before Spark starts, so a bad folder costs a second rather than a cluster and an API
sweep.

### Keeping the two in step

`brick/` is upstream. Where a shared value disagrees between the two, brick is right and this
copy has drifted. The parts that are genuinely only here, and have no upstream to drift from:

| Only here | |
| --- | --- |
| `config.SastRiskRule`, `CWE_TOP_25_2024`, `CWE_ANCESTORS`, `AI_VERDICTS_HIGH` | no other surface measures a register with no CVE in it |
| `ingest.SAST_QUERY`, `metrics.SAST_NODE_SCHEMA`, `metrics.silver_sast` | the second source |
| the `sca` / `sast` scopes and `config.SCOPE_ASSET_MEMBERS` | |
| `panels.weakness_mix` | |

Everything else is brick's, and a change worth making to it is worth making in both.

**What was deliberately left behind:** `import_bundle.py`. The Apps Script app scans one Wiz
project for vulnerability findings on hosts, so there is no code-register history to seed from.
The notebook numbering keeps its gap at `07` rather than renumbering, so a reader who knows
brick's set can see at a glance which page is missing.

---

## The two registers are not symmetrical

### `sca` needs no new maths

`sca_request.py` queries the **same GraphQL connection** brick's `os` scope does —
`vulnerabilityFindings`, with the same `VulnerabilityFindingFilters` type — restricted to the
code stage of the default branch. Its findings carry a CVE and the same three exploit signals,
so every metric above applies unchanged and means what it means for a host register.

| | |
| --- | --- |
| `codeToCloudPipelineStage: ["CODE"]` | the library as it appears in the repository, not the copy baked into every container image built from it. Without it one dependency is counted once per repo *and* once per image |
| `isDefaultBranch: {equals: true}` | or every feature branch is its own asset, and the register grows and shrinks with the team's branching habits rather than with its code |

`sca` is also the reason this fork has **asset columns** where brick does not. A
`vulnerableAsset` union fails as a whole, so one member the tenant no longer has costs the
entire request — which is why `config.FETCH_ASSET_FIELDS` is off for a register that would have
to ask for all thirteen members. `sca` returns `REPOSITORY_BRANCH` and nothing else, and
`sca_response.json` is the evidence, so `config.SCOPE_ASSET_MEMBERS` narrows the selection to
the two that resolve. That is what makes the v5 asset family computable here at all.

### `sast` is a second source, and a rule of our own

`sastFindings` is a different connection with a different filter type, and a static-analysis
finding has **no CVE, and therefore no KEV entry, no published exploit and no EPSS score**.
Under `RiskRule` every one of them classifies `unknown` and every rate is undefined — correctly,
and uselessly. So `config.SastRiskRule` is an any-of over three signals, in the same frozen,
inspectable shape, swept by the same `metrics_sensitivity` table.

| Signal | Question it answers | What it is |
| --- | --- | --- |
| `cwe` | is this a *kind* of weakness that gets exploited? | the CWE, or a documented ancestor of it, is in MITRE's CWE Top 25 |
| `ai_verdict` | does the scanner's own triage think this instance is real? | `aiAnalysis.verdict` is in `config.AI_VERDICTS_HIGH` |
| `critical` | did somebody already call this the worst tier? | severity is CRITICAL |

Four things about this register are different, and none is a detail:

- **The CWE hierarchy is the weakest joint.** Scanners report leaves and the Top 25 holds
  interior nodes: the captured response contains CWE-23 (Relative Path Traversal), a child of
  Top-25 member CWE-22. `config.CWE_ANCESTORS` lifts the children this tenant actually produces
  and is **deliberately incomplete**. An unmapped child classifies `low`, so the gap costs
  coverage's numerator silently — `signal_breakdown` publishes `cwe_unmapped` as its size, and
  that is the number to read before quoting a SAST coverage figure.
- **There is a birth date and no death date.** This bullet used to say there were no timestamps
  at all; a live probe (2026-08-27) falsified that. `SASTFinding.createdAt` is a non-null
  `DateTime!`, filterable and sortable, and `ingest.SAST_QUERY` now selects it —
  `metrics.silver_sast` reads it into `first_detected_at` and the ledger prefers it over the
  scan that first saw the finding. There is still no `resolvedAt`, so a death date arrives only
  when a later scan stops returning a finding. **SAST therefore has a genuine MTTR once two
  scans exist**: a measured start, a disappearance-dated end carrying an error bar of one scan
  interval, and `resolution_src = 'disappeared'` saying so. What remains under-measured is the
  *end*, not the beginning — findings that predate the first scan now carry their real age.
  **The column cannot be applied retroactively** — bronze holds only the fields the query asked
  for, so `--rebuild_ledger` over older scans still reads NULL and falls back to observation.
  The committed capture predates the column and exercises exactly that fallback.
- **Every closure is inferred, by choice, and the reason has changed.**
  `config.SAST_FETCH_RESOLVED` declines to ask for RESOLVED findings for two measured reasons:
  the type has no `resolvedAt`, and `status: RESOLVED` returns **zero rows** against this
  tenant. The old reason — "no timestamps at all" — is gone, but the arithmetic only moved. With
  `createdAt` selected and no `resolvedAt` to read, an already-resolved finding lands
  `first_seen = createdAt`, `resolved_at = now`, so **`mttr_days` is the finding's age at the
  moment we first looked**. That is worse than the flat 0 it replaces, because it is plausible:
  a weakness fixed within a day two years ago would report 730 days, and the Kaplan–Meier
  median would be set by the register's own start date. `tests/test_devsecops.py` measures that
  age. Turn the flag on if a `resolvedAt` appears, not before.
- **The same field name carries a different KIND across the two filter types, and the shape is
  now data.** `SASTFindingFilters` does accept `severity` — that bullet used to call it
  unverified — but as a `SASTSeverityFilter`, an object taking `{equals: [...]}`, where
  `VulnerabilityFindingFilters.severity` is a bare `[VulnerabilitySeverity!]`. Same for
  `status` (`SASTStatusFilter`), and inverted for the project restriction: SCA's `projectIdV2`
  is an object and SAST's `projectId` is a bare `[String!]`. A mismatch is refused with HTTP
  400 `VALIDATION_INVALID_TYPE_VARIABLE`, which fetches **zero rows and reads as an empty
  register**, not as an error — this fork sent the SCA convention to both scopes until the
  shapes were tabled. `config.OBJECT_FILTERS` holds the asymmetry per scope and
  `ingest._shape_base` routes **every** list-valued key of `config.SCOPES` through it, because
  a table covering only part of the filter is worse than none: an inline literal bypasses it
  and adding the key changes nothing. Copy new entries from `npm run probe -- --schema` in
  `gas_devsecops/`; never infer one filter type's shape from another's.
  `config.Source.severity_filter` answers a different question and stays — *whether the type
  has the key at all*, not what shape it wants — and when it is False,
  `ingest._severity_gate` applies `--severities` to the returned nodes instead.
- **What `aiAnalysis.verdict` spells is still unverified against the live tenant.** Every node
  in the captured response has `aiAnalysis: null`, so the AI clause will never fire until the
  enum is confirmed — quiet, which is why `ai_verdict_missing` is published beside it.

### Two silver projections, one column contract

`metrics.silver_findings` dispatches on the scope's source and `metrics.silver_sast` handles the
second shape. **Both emit the same columns**, which is what keeps `ledger.py` unaware there are
two sources. Three of those columns mean something adjacent for SAST:

| Column | For `sast` |
| --- | --- |
| `cve` | the weakness *title* ("SQL Injection"), not an identifier. Reused rather than paralleled: it is the column every panel groups on to answer "what kind of thing is this". The identifier-shaped value is in `cwe` |
| `component` | the file path — the located artefact |
| `asset_*` | the repository branch, from `resource`. A plain object rather than a union, so none of the `FETCH_ASSET_FIELDS` trouble applies |

`ai_verdict` is **latest-observation-wins, not monotone**, unlike the exploit signals beside it.
Exploit knowledge does not decay, so letting `has_kev` fall back to false would be forgetting
something true; an AI triage verdict is an opinion about *this call site*, and a re-triage is a
correction. Freezing it would pin the high-risk population full of findings everyone has since
agreed are not real. The cost, stated rather than hidden: a SAST coverage figure **can** move
between scans for a reason that is not remediation.

---

## Reading coverage and efficiency

The formulas are P2P's. **The positive class is not** — and for `sast` it is one inferential
step further out than for any other register in this repo.

| | P2P research | `sca` | `sast` |
| --- | --- | --- | --- |
| Positive label | exploitation observed in the wild | `KEV ∨ public exploit ∨ EPSS ≥ 0.1` | `CWE in Top 25 ∨ AI verdict ∨ CRITICAL` |
| Nature | retrospective ground truth | our rule over a vendor prediction | our rule over a weakness *class* |
| Prevalence | ~2–5% of CVEs | rule-set — read `prevalence_pct` | rule-set — read `prevalence_pct` |
| Unit | CVE | finding-instance (`vuln_key`) | weakness instance (file × line) |

`sca` is one step from P2P's ground truth: the rule reads somebody else's prediction about
exploitation, made per CVE, by people whose job that is. `sast` is two: from *"this weakness is
of a kind that has historically been exploited across all software"* to *"this instance of it,
in this file, is worth fixing first"*. That second step is a genuine leap — a weakness class says
nothing about whether the call site is reachable, whether the input is attacker-controlled, or
whether the code ships.

P2P offers no help and says so: volumes 1, 2 and 3 each state, verbatim, *"We won't be discussing
CWEs in this study."*

**So: do not compare a SAST rate to the SCA register's, to brick's, or to any P2P baseline.**
Compare it to `prevalence_pct` on the same row, and read `metrics_sensitivity` beside it — which
matters more for that rule than for the other, not less.

---

## Assets at risk (P2P v5)

`…metrics_assets` is volume 5, whose unit of analysis is the asset rather than the vulnerability:
*"the fact that we manage vulnerabilities in assets rather than in a vacuum requires us to know
where risk isn't, where it is now, and where it will eventually be."* The asset is the repository
branch, and the language/ecosystem is v5's asset *category* — its analogue of Windows / Linux /
Mac / appliances, and for the same reason: a category is a group of assets that behave alike
because of the platform rather than because of the team looking after them.

| Column | v5 |
| --- | --- |
| `assets` | asset prevalence |
| `density_p25` / `density_p50` / `density_p75` | vulnerability density, open findings per asset (Fig. 10). Percentiles rather than a mean because the distribution is far too skewed for one |
| `assets_with_high_risk_pct` | the foothold rate (Fig. 11): *"just one opening is needed"* |
| `asset_coverage_p50` | coverage per asset rather than per finding, over the assets with anything to cover |
| `km_median_days` | the half-life (Fig. 15) — the same `metrics.kaplan_meier` the severity table uses |
| `mmcr_p50` | the median share of an asset's backlog closed per month (Fig. 20) |
| `falling_behind_pct` / `maintaining_pct` / `gaining_pct` | the capacity split (Fig. 21) |

- **Filter on `population`.** Every asset group appears twice — `all` and `high_risk` — and an
  unfiltered read doubles every count.
- **The capacity columns are NULL without a scan log.** They are rates per *watched* month, and
  a register that has not recorded when it started watching has none. `window_months` and
  `assets_flowing` ride along so a confident split over three repos and one month cannot pass
  for a trend.

---

## Deploying it

**Six** `.py` modules are needed at runtime. Put them in **one flat folder** that holds no other
brick deployment, created as **Files**, not Notebooks:

```
/Workspace/Users/<you>/wiz-devsecops/     ← this path goes on sys.path
├── config.py
├── dbx.py
├── ingest.py
├── ledger.py
├── metrics.py
└── run_pipeline.py
```

To read the notebooks as well, four more files go on the same `sys.path`:

```
/Workspace/Users/<you>/wiz-devsecops/     ← these files go on sys.path too
├── panels.py
├── figures.py
├── tiles.py
├── csvstore.py
└── notebooks/
    ├── 00_security_posture.ipynb
    ├── 01_mttr_sla.ipynb
    ├── 02_program_performance.ipynb
    ├── 03_code_vulnerabilities.ipynb
    ├── 04_scan_history.ipynb
    ├── 05_estate.ipynb
    ├── 06_run_and_verify.ipynb
    └── 08_code_assets.ipynb
```

**Catalog mode is the supported deployment.** Pass `--catalog` and `--schema` and the register
is Delta tables in the lake; `brick/databricks.yml` deploys one Job per scope that way. The two
CSV paragraphs below are the fallback for a principal with no schema it may create tables in —
see [`brick/README.md`](../README.md), *Fallback storage* and *The CSV register (legacy)*.

**`--csv_path` makes a workspace directory the register.** Delta is still involved — the ledger
is `MERGE`d on every scan and read back to compute the gold tables, and a CSV cannot be merged
into — but only as scratch for the length of one run: the CSV is restored into Delta before the
scan and exported back after, and with `--csv_path` set no catalog is consulted at all. Without
it, and without `--data_path`, the run creates and writes tables in `catalog`.`schema`, i.e. in
the lake. Set the `csv_path` widget (or the flag) to stay out of it — cell 1 of
`06_run_and_verify` and its run cell both read that widget, so they cannot disagree about where
the register is.

The two scopes write separate tables and must never be blended, and `ledger.reconcile` does not
merely rely on that: a prior row or an observation stating a scope other than the one it was
asked for is refused. Absence is remediation here, so a `sast` prior meeting a `sca` scan is not
a mislabelled input — every one of its rows is missing from that scan *by construction*, and all
of them would close as remediated, with real resolution dates.

Then run one scope at a time — in the lake:

```bash
python run_pipeline.py --scope=sca --severities=CRITICAL,HIGH \
  --catalog=<your-catalog> --schema=<your-schema> \
  --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

or, on the fallback, with `--csv_path=/Workspace/Users/<you>/wiz/devsecops_csv` in place of the
catalog pair.

To run either scope on a laptop against a local lake, with no tenant and no cluster:

```bash
python -m devlake.run --fork=devsecops --scope=sca  --scans=2 --lake=/tmp/lakecheck
python -m devlake.run --fork=devsecops --scope=sast --scans=2 --lake=/tmp/lakecheck
```

The fake Wiz in front of it **validates the filter shape per scope**, so the asymmetry below
(SAST wraps `severity`, bares `projectId`; SCA does the opposite) fails loudly rather than
fetching zero rows. See [`devlake/README.md`](../../devlake/README.md).

The first run has nothing to restore and says so; after it the directory is the register, and
each later run reconciles against it. The scratch Delta side defaults to
`dbfs:/tmp/wiz_scratch_<scope>` and is safe to lose. Because bronze is excluded from the export
by default, `--rebuild_ledger` has nothing to replay in this mode unless
`--csv_include_bronze=true` was set on the runs before it.

Read `resolved_count` in the first run's summary before anything else. A plausible day's
remediation means the scope is right; a number close to the whole register means it is not.

Everything else — parameters, retries, the ledger's lifecycle rules, the actionable clock, the
CSV register, table layout, `--rebuild_ledger` — works exactly as
[`brick/README.md`](../README.md) describes, because it is the same code. One difference is
load-bearing and lives there too: `awaiting_vendor_fix` is scope-guarded, because a weakness in
your own code has no vendor, so `sast` is not in `config.HAS_VENDOR_FIX` and never awaits one. Read that file for the detail; this one covers only what differs.

## Tests

```bash
pip install -r brick/devsecops/requirements.txt
pytest brick/devsecops/tests -n 3 --dist loadgroup -q
```

`tests/test_devsecops.py` is the module that carries this fork's own oracles: that both silver
projections emit the same columns, that the CWE ancestor hop works, that one missing signal
makes a whole row unknown, and that asking for resolved SAST findings would report zero-day
MTTR. The rest are brick's suites, retargeted at these scopes.

**The live register is built from `sca_findings_example.json`, which is synthetic.** The captured
`sca_response.json` is the *grouped* query — one row per repository with severity counts — so it
has no per-finding rows and cannot drive a pipeline. The synthetic file uses the repository
branches and cloud platforms the real capture does contain, with a spread of CVEs chosen so the
confusion matrix has all four quadrants and an unclassified row.
