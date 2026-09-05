// THE ISSUE LIFECYCLE LEDGER — the one tab in this app that is never overwritten.
//
// WHAT IT EXISTS TO STOP. Every other tab here is a SNAPSHOT: `persistSync` calls
// `overwrite(TABS.issues, …)` on each sync, and the issue query is filtered to
// `status: [OPEN, IN_PROGRESS]`. So a remediated issue does not move to a closed state in
// this ledger — it VANISHES from `ai_issues` on the next sync, and nothing anywhere records
// that it was ever there or when it went. A register that cannot say when a row left cannot
// answer a single question about remediation; it can only ever describe today.
//
// FORWARD-ONLY, AND THE LABELS COST TWO SYNCS. The first sync writes every issue as `new`
// and can date nothing: there is no prior population to have disappeared from. A row only
// acquires a `disappearedAt` on the sync that first fails to see it, so the earliest a
// lifecycle figure exists is the SECOND sync under a stable scope. Nothing here backfills,
// and nothing may: the ledger's dates are its own observations, and inventing one for a row
// that predates the tab would be a measurement nobody took.
//
// "DISAPPEARED" IS A SOFTER CLAIM THAN A RESOLUTION, and the row says which it is holding.
// Wiz's `Issue` carries a `resolvedAt`, but this register never sees it: the query gate drops
// the row before the field can be read (`isUnresolvedIssue` / the OPEN+IN_PROGRESS filter),
// so what the ledger observes is an ABSENCE. `disappearedAt` is therefore an upper bound whose
// error is the sync interval — "gone by 4 Sep", never "resolved 4 Sep" — and `resolutionSrc`
// is what lets a reader tell the two apart rather than reading the date at face value. The
// same distinction the code register makes in as many words; it applies here for the same
// reason, one register over.
//
// THE DISAPPEARANCE GUARD IS THE DANGEROUS PART, and it is PORTED, not imported, from
// `gas/src/domain/reconcile.ts` (the OS-vulnerability register's severity-scope check) —
// two registers, two schemas, and a shared module would make one's population change break
// the other's build. There the gate is the severity set a scan applied; here it is the
// CATEGORY SCOPE (`registerScopeSignature`), because that is what decides which issues a
// sync could see at all. Widening `issue_categories` from one category to six does not make
// yesterday's rows disappear — but NARROWING it makes 6,000 rows absent by construction, and
// resolving them by absence would publish a remediation programme that never happened.
// `gas/src/domain/purge.ts` records the same trap from the other side.
//
// The guard refuses on ANY scope difference rather than trying to decide the direction.
// A widened scope provably cannot un-see a row, so in principle a widening could still
// resolve by absence — but proving "this scope is a superset of that one" from two
// signatures is a CLAIM, and the only thing the eval needs from this branch is that the
// rows were not resolved and that the skip was counted. A skipped sync costs one interval
// of resolution latency; a wrong resolution costs the figure its meaning.
//
// NO CLOCK. `syncTs` is a parameter, `syncId` is a parameter, and nothing in this file reads
// `Date.now()` — the same discipline every other pure module here keeps, and what makes a
// two-sync lifecycle testable without a fake clock.

import type { AiAdjacency, ExploitationTier, IssueRow } from "./graphTypes";

/**
 * One issue's lifecycle, across every sync that has ever seen it.
 *
 * The frozen fields (`ruleId` … `registerScope`) are the rank inputs as of the LAST SIGHTING,
 * copied rather than recomputed: the ledger's job is to make a score REPLAYABLE from stored
 * facts, and a rank computed here would be a second answer to a question `rank.ts` already
 * owns (`api.effectiveRankRule` builds the rule; this file freezes the inputs it reads).
 *
 * ABSENT IS NEVER ZERO, and the three optional fields are where that bites. They are copied
 * only when the sighting carried them, and DROPPED when it did not — never carried forward
 * from an older sighting. Carrying them would date an exploitation reading to a scan that
 * never ran the fold, which is precisely what `persistSync` refuses to do one tab over. An
 * absent `exploitationTier` means "no evidence pass reached this row on the sync that last
 * saw it"; `"none"` means "it was looked at and nothing fired".
 */
export interface IssueLedgerRow {
  issueId: string;
  /** The sync id that FIRST saw this issue, and the timestamp of that sync. */
  firstSeenSync: string;
  /**
   * When this ledger first saw the row — NOT Wiz's `createdAt`, which is frozen separately
   * below and can predate the tab by a year.
   *
   * A reopen does NOT re-derive it. The sibling code register records the opposite defect
   * (a reopened episode re-reading `firstDetectedAt` from the API and inflating its whole
   * MTTR by the first episode); it cannot happen here because this date is the ledger's own
   * observation and no API field is ever written into it.
   */
  firstSeenAt: string;
  /** The most recent sync that saw the issue, and its timestamp. */
  lastSeenSync: string;
  lastSeenAt: string;
  /**
   * The timestamp of the sync that first FAILED to see the row, or null while it is present.
   *
   * An upper bound, not a resolution date — see this file's header. Cleared on a reopen.
   */
  disappearedAt: string | null;
  /**
   * What the last lifecycle event was: `disappeared` (the row left the register),
   * `reopened` (it came back), or null (it has only ever been present).
   *
   * The PROVENANCE of `disappearedAt`, in the same row, so a surface cannot render the date
   * without the word that qualifies it.
   */
  resolutionSrc: "disappeared" | "reopened" | null;
  /** `IssueRow.status` at the last sighting — OPEN / IN_PROGRESS, whatever the gate allowed. */
  lastStatus: string;
  /**
   * The UNION of every category this row has ever been fetched under, in the order the
   * categories were first seen.
   *
   * A union rather than the last sighting's list, because the question it answers is "which
   * question has ever returned this row" — and a narrowed scope must not be able to erase the
   * fact that a wider one once matched it.
   */
  categories: string[];
  ruleId: string;
  /** Wiz's own dates. `null` is "the sighting reported none", which is a measurement. */
  createdAt: string | null;
  dueAt: string | null;
  /** Rank inputs, frozen from the last sighting. Absent means the fold did not reach the row. */
  aiAdjacency?: AiAdjacency;
  exploitationTier?: ExploitationTier;
  /** `null` is "tier decided, no probability captured"; absent is "no fold ran". Both survive. */
  epssPeak?: number | null;
  /**
   * The category scope APPLIED by the sync that last saw the row — never the scope settings
   * hold now. The row's own `categories` above say which questions matched it; this says
   * which questions were ASKED, and only the second can explain an absence.
   */
  registerScope: string;
  /**
   * How many times this row has been present: 1 for a row that has never left, 2 after its
   * first reopen. The clock a later MTTR would have to be measured per-episode against.
   */
  episode: number;
}

/**
 * What one reconcile CHANGED. Transition counts, not a partition of `rows`.
 *
 * A row that was present and is still present is counted by none of them: it moved through no
 * transition. So a replay of the same sync reports five zeroes, which is the honest reading of
 * "this reconcile changed nothing" — the ROWS are what is idempotent, and the deltas say so by
 * going quiet rather than by repeating themselves.
 */
export interface IssueLedgerDeltas {
  /** Issues this sync saw for the first time. */
  new: number;
  /** Rows resolved BY DISAPPEARANCE this sync — never an API-declared resolution. */
  resolved: number;
  /** Rows that had disappeared and were seen again. */
  reopened: number;
  /** Rows already disappeared and still absent, carried forward untouched. */
  carried: number;
  /**
   * Rows absent this sync that were NOT resolved, because the scope changed and absence is
   * therefore expected rather than remediation.
   *
   * The count is the point. A run of these says the register was re-scoped, and any lifecycle
   * figure spanning that sync is measuring two different populations.
   */
  skippedNarrowedScope: number;
}

export interface IssueLedgerReconcile {
  rows: IssueLedgerRow[];
  deltas: IssueLedgerDeltas;
}

/** Byte-stable order, and deliberately not `localeCompare`: a persisted grid must not sort by locale. */
function byIssueId(a: IssueLedgerRow, b: IssueLedgerRow): number {
  return a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0;
}

/** Prior categories first, then any the sighting adds — order-stable across replays. */
function unionCategories(prev: readonly string[], next: readonly string[]): string[] {
  const out = prev.slice();
  for (const c of next) if (c && out.indexOf(c) < 0) out.push(c);
  return out;
}

/**
 * Copy the rank inputs a sighting carried, DROPPING the ones it did not.
 *
 * Assigning `undefined` would leave the key present, which a `toEqual` will not notice and a
 * `Object.keys` round trip will; deleting is what makes "absent" mean absent all the way to
 * the sheet.
 */
function freezeInputs(row: IssueLedgerRow, issue: IssueRow): void {
  if (issue.aiAdjacency === undefined) delete row.aiAdjacency;
  else row.aiAdjacency = issue.aiAdjacency;
  // The TIER is what says the fold ran, so the peak is read and written INSIDE its guard —
  // the same pairing `ai_issues` already keeps (`rowToIssue`). A peak without a tier could
  // not survive the sheet, where an empty cell has to mean "no fold" rather than "no
  // probability"; with the tier present, `null` says the fold ran and captured no EPSS.
  if (issue.exploitationTier === undefined) {
    delete row.exploitationTier;
    delete row.epssPeak;
  } else {
    row.exploitationTier = issue.exploitationTier;
    row.epssPeak = issue.epssPeak ?? null;
  }
  row.ruleId = issue.ruleId;
  row.createdAt = issue.createdAt ?? null;
  row.dueAt = issue.dueAt ?? null;
  row.lastStatus = issue.status;
}

/**
 * Fold one sync's issue register into the ledger.
 *
 * `prevScopeSignature` is the scope the PREVIOUS COMMITTED sync applied, read off
 * `sync_history.register_scope` — `null` when nothing has been committed yet, or when the
 * stored row predates that column. Null is UNKNOWN and never "the same scope": a ledger that
 * cannot prove the last scan looked for a row must not resolve that row by its absence.
 *
 * Pure and idempotent in the rows: reconciling the same `current` twice with the same
 * `syncId` / `syncTs` returns the same grid.
 */
export function reconcileIssueLedger(
  prev: readonly IssueLedgerRow[],
  current: readonly IssueRow[],
  syncId: string,
  syncTs: string,
  scopeSignature: string,
  prevScopeSignature: string | null,
): IssueLedgerReconcile {
  const deltas: IssueLedgerDeltas = {
    new: 0, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0,
  };

  const byId: Record<string, IssueLedgerRow> = {};
  const order: string[] = [];
  for (const row of prev) {
    if (!row.issueId || byId[row.issueId]) continue;
    // Copied, never mutated in place: the caller's array is its own read of the sheet, and a
    // reconcile that edited it would make a dry run indistinguishable from a commit.
    byId[row.issueId] = { ...row, categories: row.categories.slice() };
    order.push(row.issueId);
  }

  const seen: Record<string, true> = {};
  for (const issue of current) {
    if (!issue.id) continue;
    const first = !seen[issue.id];
    seen[issue.id] = true;
    const existing = byId[issue.id];
    if (!existing) {
      const row: IssueLedgerRow = {
        issueId: issue.id,
        firstSeenSync: syncId,
        firstSeenAt: syncTs,
        lastSeenSync: syncId,
        lastSeenAt: syncTs,
        disappearedAt: null,
        resolutionSrc: null,
        lastStatus: issue.status,
        categories: unionCategories([], issue.categories ?? []),
        ruleId: issue.ruleId,
        createdAt: issue.createdAt ?? null,
        dueAt: issue.dueAt ?? null,
        registerScope: scopeSignature,
        episode: 1,
      };
      freezeInputs(row, issue);
      byId[issue.id] = row;
      order.push(issue.id);
      if (first) deltas.new += 1;
      continue;
    }
    // A REOPEN: this row had left the register and is back. `episode` is what a later
    // per-episode clock has to key on — a single MTTR over first-seen to last-disappeared
    // would silently price the gap between episodes as time-to-remediate.
    if (existing.disappearedAt !== null) {
      existing.episode += 1;
      existing.disappearedAt = null;
      existing.resolutionSrc = "reopened";
      if (first) deltas.reopened += 1;
    }
    existing.lastSeenSync = syncId;
    existing.lastSeenAt = syncTs;
    existing.categories = unionCategories(existing.categories, issue.categories ?? []);
    existing.registerScope = scopeSignature;
    freezeInputs(existing, issue);
  }

  // Disappearance, gated on the scope the previous sync APPLIED. `scopeCovers` false is not a
  // failure — it is the ledger declining to read an expected absence as a remediation.
  const scopeCovers = prevScopeSignature !== null && prevScopeSignature === scopeSignature;
  for (const id of order) {
    if (seen[id]) continue;
    const row = byId[id]!;
    if (row.disappearedAt !== null) {
      deltas.carried += 1;
      continue;
    }
    if (!scopeCovers) {
      deltas.skippedNarrowedScope += 1;
      continue;
    }
    row.disappearedAt = syncTs;
    row.resolutionSrc = "disappeared";
    deltas.resolved += 1;
  }

  return { rows: order.map((id) => byId[id]!).sort(byIssueId), deltas };
}

/** A ledger's standing population, for a reader that needs the figures rather than the rows. */
export interface IssueLedgerCensus {
  /** Rows present as of their last sighting. */
  open: number;
  /** Rows whose absence has been dated. An upper bound on remediation, never a resolution count. */
  disappeared: number;
  /** Rows that have left and come back at least once (`episode > 1`). */
  reopenedEver: number;
  /**
   * The `resolutionSrc` distribution. `none` is "no lifecycle event yet" — a row that has been
   * present on every sync since it arrived — and NOT "not measured".
   */
  byResolutionSrc: { disappeared: number; reopened: number; none: number };
}

export function ledgerCensus(rows: readonly IssueLedgerRow[]): IssueLedgerCensus {
  const census: IssueLedgerCensus = {
    open: 0,
    disappeared: 0,
    reopenedEver: 0,
    byResolutionSrc: { disappeared: 0, reopened: 0, none: 0 },
  };
  for (const row of rows) {
    if (row.disappearedAt === null) census.open += 1;
    else census.disappeared += 1;
    if (row.episode > 1) census.reopenedEver += 1;
    if (row.resolutionSrc === "disappeared") census.byResolutionSrc.disappeared += 1;
    else if (row.resolutionSrc === "reopened") census.byResolutionSrc.reopened += 1;
    else census.byResolutionSrc.none += 1;
  }
  return census;
}
