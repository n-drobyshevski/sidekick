// What the Settings page needs in order to state, beside each control, what that control is
// currently doing to the register — the devsecops twin of `gas/src/domain/settingsImpact.ts`.
// Read that file's header first; the thesis is the same one: "a figure that appears only after
// you save is not decision support, it is a receipt."
//
// THIS PACKAGE (P6a) PORTS THREE THINGS FROM gas/, NOT THE WHOLE FILE. gas/'s module also
// carries `buildRiskCube` / `breakdownFromCube` / `toggleImpact` for its EPSS-threshold and
// no-fix/EOL display toggles — this register has neither control today, so neither is ported.
// What IS ported is `severityCensus`, `scanAges` and `wouldSeal`, plus one function gas/ does
// not have at all: `strandedOpenCount` — see its own header for why this register needs a
// figure gas/ never had to compute.
//
// THREE SCOPES, ONE SEVERITY VOCABULARY EACH. `sca`, `sast` and `secrets` (config.ts's
// `SCOPES`) each carry their own requested-severity set (`Settings.fetchSeverities`), so every
// function below that touches severity is run PER SCOPE rather than once over the whole
// register — a census pooling all three scopes together could not answer "what would widening
// just `sast` back to MEDIUM show me", because the other two scopes' counts would be mixed in.
//
// THE ONE THING THIS FILE MUST NOT GET WRONG: `[]` in `Settings.fetchSeverities[scope]` means
// EVERY SEVERITY, never none — config.ts's `DEFAULT_FETCH_SEVERITIES` docstring walks the two
// wrong answers that preceded this one, and `secrets` ships `[]` on purpose. Every function
// here that reads a requested-severity list treats an empty list as "unfiltered", exactly like
// `compaction.ts`'s `serializeSeverities` / `parseSeverities` already do for the same list on
// its way to and from a scan row.

import { MIN_UNSEALED_FLAT_SCANS, SCOPES, SEVERITY_ORDER, type Scope } from "./config";

/**
 * Per-severity counts over the UNFILTERED base, for one scope's scan-scope preview — ported
 * verbatim from gas/'s function of the same name. The bootstrap's counts are already narrowed
 * by whatever severity gate is currently saved, so they cannot answer "what would adding MEDIUM
 * back show me?" — previewing a change to a filter needs the population from before that filter
 * ran, and that is what the census is built over.
 */
export interface SeverityCensus {
  /** Every row the register holds for this scope, per severity. */
  all: Record<string, number>;
  /** The open subset, per severity. */
  open: Record<string, number>;
}

export function severityCensus<T>(
  rows: readonly T[],
  severityOf: (r: T) => string,
  isOpen: (r: T) => boolean,
): SeverityCensus {
  const out: SeverityCensus = { all: {}, open: {} };
  for (const r of rows) {
    const s = severityOf(r);
    out.all[s] = (out.all[s] ?? 0) + 1;
    if (isOpen(r)) out.open[s] = (out.open[s] ?? 0) + 1;
  }
  return out;
}

/** One scope's census, with the totals `severityCensus` alone does not carry — this is the
 *  shape `census.byScope[scope]` ships in the settings-impact payload. */
export interface ScopeCensus {
  /** Every row this scope holds, whatever its severity. */
  total: number;
  /** The open subset of `total`. */
  openTotal: number;
  bySeverity: SeverityCensus;
}

// --------------------------------------------------------------------- stranded open findings

/**
 * How many currently-OPEN findings a draft scope/severity selection would STRAND — the number
 * behind the confirm-dialog prose `src/client/js/settingsModel.js`'s `draftWarnings` already
 * ships (two paragraphs, no number): dropping a register or narrowing a severity gate does not
 * merely collect less going forward, it FREEZES whatever is already in the ledger outside the
 * new gate. The register's own rule is why: a scan records the gate it APPLIED
 * (`compaction.ts`'s `serializeSeverities` on the scan row), and resolve-by-disappearance only
 * ever closes a finding whose severity was actually requested — the same guard that stops an
 * unrequested severity from mass-resolving also stops it from ever closing. A row outside the
 * gate cannot resolve by absence and cannot resolve by API either (nothing is looking at it),
 * so it sits open and ageing until the gate is widened again.
 *
 * PURE AND SINGLE-SELECTION, deliberately: this does not diff a "saved" selection against a
 * "draft" one (that is `draftWarnings`' job, client-side, for the confirm copy). It answers one
 * question — "under THIS scope set and THESE per-scope severities, how many open rows are
 * outside the gate right now" — for whichever selection the caller hands it. That is what lets
 * a page call it twice with the same census (once with the saved settings, once with a live
 * draft) exactly the way the risk cube in gas/ is re-aggregated client-side for a draft
 * threshold: one shipped population, recomputed locally as many times as the control moves.
 *
 * `[]` MEANS EVERY SEVERITY. A scope whose `fetchSeverities` entry is empty strands nothing by
 * severity — see the module header — so this checks `.length` before ever comparing to
 * `severityOrder`, the same guard `draftWarnings`' `isAll` makes.
 */
export interface StrandedImpact {
  /** Open findings stranded across every scope. */
  total: number;
  /** Open findings stranded per scope — present for every scope in `config.SCOPES`, 0 where
   *  the census has no rows or the selection strands nothing there. */
  byScope: Record<Scope, number>;
}

export function strandedOpenCount(
  census: Readonly<Partial<Record<Scope, ScopeCensus>>>,
  scopes: readonly Scope[],
  fetchSeverities: Readonly<Partial<Record<Scope, readonly string[]>>>,
  severityOrder: readonly string[] = SEVERITY_ORDER,
): StrandedImpact {
  const kept = new Set(scopes);
  const byScope = {} as Record<Scope, number>;
  let total = 0;
  for (const scope of SCOPES) {
    const c = census[scope];
    if (!c) {
      byScope[scope] = 0;
      continue;
    }
    if (!kept.has(scope)) {
      // The whole register is dropped: nothing will ever scan it again, so every open finding
      // it holds today is stranded — draftWarnings' "FREEZES" case, counted rather than only
      // described.
      byScope[scope] = c.openTotal;
      total += c.openTotal;
      continue;
    }
    const requested = fetchSeverities[scope] ?? [];
    if (!requested.length) {
      // Unfiltered (or widened back to unfiltered): nothing strands.
      byScope[scope] = 0;
      continue;
    }
    let strandedInScope = 0;
    for (const sev of severityOrder) {
      if (requested.includes(sev)) continue; // still requested — a future scan can still close it
      strandedInScope += c.bySeverity.open[sev] ?? 0;
    }
    byScope[scope] = strandedInScope;
    total += strandedInScope;
  }
  return { total, byScope };
}

// --------------------------------------------------------------------- scan ages and retention

/**
 * The scans a retention window would seal, as ages in days — ported from gas/'s `scanAges`,
 * with two divergences forced by this register's shape rather than copied blindly:
 *
 *   1. `keepRecent` DEFAULTS OFF `config.ts`'s `MIN_UNSEALED_FLAT_SCANS`, not gas/'s literal
 *      `2`. They carry the same value today, but this register's floor is declared once, in
 *      one place (`compaction.ts`'s `selectSealCandidates` reads the same constant), and a
 *      caller here inherits that declaration instead of a second copy that could drift from it.
 *
 *   2. EACH `ScanRow` CARRIES ITS OWN `scope`, and this register writes ONE ROW PER SCOPE PER
 *      SYNC RUN (`ledgerStore`'s `scanIdFor` — a run shares one `scan_id` and steps through
 *      `sca`/`sast`/`secrets`), where gas/ writes one row per run, full stop. `scanAges` here
 *      takes every scope's rows in ONE call and returns ONE array in time order — NOT three
 *      per-scope arrays — because the retention window and the seal floor are ONE decision,
 *      shared across all three registers (`maintenance.ts`'s `compactLedgerCore`: "the floor is
 *      computed over the whole scan log, across all three scopes... one ledger, one baseline,
 *      one floor"). Three independent lanes would draw three retention decisions where the
 *      product only ever makes one; a caller draws this as ONE LANE and reads `scope` off each
 *      tick to label it, which is exactly what the register's own retention mechanics do.
 *
 * `pinned` is computed PER ROW here (the first `keepRecent` rows in descending ts order),
 * exactly as gas/'s does — NOT per RUN the way `selectSealCandidates`'s `scan_id`-keyed
 * protection effectively ends up behaving once a run fans out to multiple rows. That is a
 * narrower guarantee than the real seal floor (see that function's own note on why its
 * `protectedIds` set typically ends up covering a whole run rather than exactly `keepRecent`
 * rows), but it never changes `wouldSeal`'s answer: `RETENTION_MIN_DAYS` floors every real
 * retention window at 30 days, and the rows this simpler `pinned` might under-protect are the
 * most recent ones in the log — days old, not weeks — so they are already excluded by `ageDays
 * > retentionDays` before `pinned` is ever consulted. It can only disagree with the exact seal
 * floor on a display badge, never on the count.
 */
export interface ScanAge {
  scope: Scope;
  ageDays: number;
  sealed: boolean;
  /** Held back from sealing regardless of the window. */
  pinned: boolean;
}

export function scanAges<S extends { scope: Scope; ts: string; sealed: 0 | 1 }>(
  scans: readonly S[],
  now: number,
  keepRecent: number = MIN_UNSEALED_FLAT_SCANS,
): ScanAge[] {
  // loadScanRows() hands scans over oldest-first, across all three scopes; the page reads
  // newest-first, and "the most recent N rows" has to mean the most recent N, not the oldest.
  const desc = [...scans].reverse();
  return desc.map((s, i) => {
    const t = Date.parse(s.ts);
    return {
      scope: s.scope,
      ageDays: Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0,
      sealed: !!s.sealed,
      pinned: i < keepRecent,
    };
  });
}

/** How many unsealed, unpinned scans the given window would seal on the next compaction pass.
 *  Ported verbatim from gas/ — no internal floor at `RETENTION_MIN_DAYS`, because a caller
 *  previewing a draft below that floor is meant to see what the RAW number would be; the floor
 *  itself is `compactLedgerCore`'s to enforce when the setting is actually saved. */
export function wouldSeal(ages: readonly ScanAge[], retentionDays: number | null): number {
  if (retentionDays === null) return 0;
  return ages.filter((a) => !a.sealed && !a.pinned && a.ageDays > retentionDays).length;
}
