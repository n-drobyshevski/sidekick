// What the ISSUE LEDGER says about one row, separated from how the sheet draws it.
//
// DOM-free on purpose — the same split `pages/problemView.js`, `pages/dataModel.js` and
// `settingsModel.js` already make here, so `test/issueLifecycle.test.js` reads this file under
// plain Node without dragging the drawer in behind it. It imports two formatters from
// `./ui.js` and nothing else; that barrel was measured importing cleanly under bare Node
// (`node -e "import('./src/client/js/ui.js')"`), and taking `absentText`/`fmtDate` from it is
// what stops a second spelling of the absence mark appearing in this file.
//
// WHY THIS FILE EXISTS. `src/domain/issueLedger.ts`'s header states the rule in as many
// words: Wiz never tells this register that an issue was fixed — the query gate is
// `status: [OPEN, IN_PROGRESS]`, so the row is dropped before a `resolvedAt` could be read —
// and what the ledger observes is an ABSENCE. `disappearedAt` is therefore an UPPER BOUND
// whose error is the interval between two syncs: "gone by 4 Sep", never "resolved 4 Sep".
// A date printed without that word is a claim the register cannot support, and the two are
// the same pixel width. So the provenance travels in the WORD, exactly as
// `gas/src/client/js/pages/registerModel.js` and its devsecops original do for the other
// three registers, one register over.
//
// NO `OBSERVED`, AND THAT IS THE DIFFERENCE FROM THE SIBLINGS. gas's PROVENANCE has five
// members because the OS register really does receive API resolution dates
// (`resolution_src === "api"`). This ledger never can — see the paragraph above — so an
// `OBSERVED` member here would be a state nothing could ever produce, sitting in a lookup
// table beside four that can, inviting the next reader to write a branch for it. Three
// members, all reachable.
//
// THE ONE ROW AFTER THE TWO DATES, and why it is one rather than both. A row that left and
// came back and left again carries `resolutionSrc: "disappeared"` and `episode > 1` at the
// same time. It gets "Gone by", not "Returned": the question the sheet is answering is what
// this row's state IS, and it is gone. The episode count is not lost — `episode` is on the
// payload and the Data page's Returned column counts the transitions — but the sheet does
// not print two lifecycle verdicts about one row and leave the reader to rank them.

import { formatRegisterScope } from "./registerScopeText.js";
import { absentText, fmtDate } from "./ui.js";

/**
 * How a row's lifecycle date came to be, and therefore how much it can be trusted.
 *
 * `null` — no ledger row at all — is a fourth answer this deliberately does NOT name as a
 * member: it is not a provenance, it is the absence of one, and a `PROVENANCE.UNKNOWN`
 * would let a caller print a word where the register has nothing to say.
 */
export const PROVENANCE = {
  /** Still in the register. No departure date to qualify. */
  OPEN: "open",
  /** The issue stopped being returned. The date is a sync, and it is an upper bound. */
  BOUNDED: "bounded",
  /** Seen again after it had gone. Its episode count restarted on that sighting. */
  RETURNED: "returned",
};

/** The words each provenance gets. Short enough for a pill, honest enough to stand alone. */
export const PROVENANCE_LABEL = {
  [PROVENANCE.OPEN]: "Open",
  [PROVENANCE.BOUNDED]: "Gone by",
  [PROVENANCE.RETURNED]: "Returned",
};

/**
 * The pill tone each provenance takes.
 *
 * A bounded date is `warn`, never `ok`: a green tick over "it went at some unknown point in
 * the last sync interval" overstates what the ledger observed. The sibling registers make
 * the same call for the same reason.
 */
export const PROVENANCE_KIND = {
  [PROVENANCE.OPEN]: "neutral",
  [PROVENANCE.BOUNDED]: "warn",
  [PROVENANCE.RETURNED]: "warn",
};

export const PROVENANCE_HELP = {
  [PROVENANCE.OPEN]:
    "This issue was in the register at the last sync. The dates below are this register's "
    + "own sightings, not Wiz's created date.",
  [PROVENANCE.BOUNDED]:
    "This issue stopped being returned. The date is the sync that first missed it, so it "
    + "went at some point between the previous sync and that one — an upper bound, not a "
    + "measurement. Wiz never reports a resolution to this register.",
  [PROVENANCE.RETURNED]:
    "This issue had gone and was seen again. The episode count is what tells a genuine "
    + "re-detection apart from one long open row; the register does not record when each "
    + "episode began, so no clock here spans two of them.",
};

/**
 * The episode count, or null when the payload did not carry a real one.
 *
 * REFUSE BEFORE THE CAST. `Number(null)` is `0` and it is finite, and so are `Number("")`,
 * `Number([])` and `Number(false)` — the trap CLAUDE.md names three times. The `typeof`
 * gate is where the refusal actually bites, on the one input where the two readings differ:
 * a STRING `"2"`, which `Number("2") > 1` would happily accept as a reopen no sync ever
 * recorded. The wire writes `episode` as a number; a string there means something upstream
 * stringified the row, and inventing a second episode out of that is the failure of
 * presence this guard exists to stop.
 */
function episodeOf(ledger) {
  const e = ledger ? ledger.episode : null;
  if (typeof e !== "number" || !Number.isFinite(e) || e <= 1) return null;
  return e;
}

/**
 * A date cell, refusing an absent value before it reaches the formatter.
 *
 * `fmtDate` already answers the shared mark for a falsy input, but going through it for an
 * absent date would mean this file's "nothing was recorded" and its "the recorded value is
 * unparseable" print through two different paths. One refusal, at the top.
 */
function dateCell(iso) {
  return iso ? fmtDate(iso) : absentText;
}

/**
 * The register-scope signature, read the way a person reads it rather than the pipe-joined
 * token `registerScopeSignature` writes for comparison. Refuses before the format, same rule
 * as every other cell here: an absent scope prints the shared mark, not an empty string.
 *
 * The formatting itself is `registerScopeText.js`, because the token carries TWO facts — the
 * categories and, as a `#tenant` suffix on the last of them, whether the sync applied any
 * project filter at all. Splitting on `|` here (which this cell used to do) printed a
 * category called `wct-id-3#tenant`.
 */
function scopeCell(scope) {
  return scope ? formatRegisterScope(scope) : absentText;
}

/**
 * How this row's lifecycle date came to be. `null` when there is no ledger row to read.
 *
 * A row is not BOUNDED merely because it is absent from today's register — it is bounded
 * because a sync recorded the absence and stamped `resolutionSrc`. The two are different
 * claims and only the second is in the ledger.
 */
export function provenance(ledger) {
  const l = ledger && typeof ledger === "object" ? ledger : null;
  if (!l) return null;
  if (l.resolutionSrc === "disappeared") return PROVENANCE.BOUNDED;
  if (episodeOf(l) !== null) return PROVENANCE.RETURNED;
  return PROVENANCE.OPEN;
}

/**
 * The Lifecycle section, the header chip, and the one decision about Wiz's own `resolvedAt`.
 *
 * `wizResolved` IS THE POINT OF THE THIRD FIELD. The Facts pane prints Wiz's `resolvedAt`
 * under the heading "Resolved", and a row this register dated BY DISAPPEARANCE must never
 * be relabelled that way — "Gone by 4 Sep" and "Resolved 4 Sep" are the same width and
 * opposite claims. So the decision is made once, here, and the pane consults it instead of
 * reading `issue.resolvedAt` for itself. It stays a row (rather than a boolean the pane
 * turns into one) so that a test can perturb the gate and read what the pane would print.
 *
 * The only two fields read off `issue` are `resolvedAt` — for that row — and nothing else:
 * every date this section prints is the LEDGER's own observation. Wiz's `createdAt` can
 * predate the ledger's first sighting by a year (`sampleData.ts` seeds exactly that case on
 * purpose), so a model that reached for it would print a lifetime nobody measured.
 *
 * A DATE IS AUDITABLE ONLY WITH THE SYNC THAT RECORDED IT. `getIssueDetail` ships an
 * eight-field ledger projection; the two sightings above drew five of them and left
 * `firstSeenSync`, `lastSeenSync` and `registerScope` on the wire with no call site — pinned
 * as a FINDING in `test/issueLifecycle.test.js` until now. So each sighting row carries its
 * own `syncId` beside the date (rendered by `detailSheets.js`'s `lifecycleSection`, never
 * built here — this file stays DOM-free), and one more row states the category scope that
 * sync applied: widen or narrow Settings' Register tab and a date recorded under the OLD
 * scope is not a date this reader should take at face value against the new one.
 * `disappearedAt` gets no `syncId` — the projection carries none for it — so the "Gone by"
 * help entry says "the sync that first missed it" in words instead.
 */
export function issueLifecycleModel(issue, ledger) {
  const iss = issue && typeof issue === "object" ? issue : null;
  const l = ledger && typeof ledger === "object" ? ledger : null;
  const p = provenance(l);

  // Absent ledger row: no chip, no rows, and Wiz's own date is the only thing there is —
  // so it is printed. A sheet opened before the lifecycle tab existed lands here.
  if (!l || !p) {
    return { chip: null, rows: [], wizResolved: wizResolvedRow(iss) };
  }

  const rows = [
    {
      label: "First seen by this register",
      value: dateCell(l.firstSeenAt),
      syncId: l.firstSeenSync || null,
      help: { term: "first-seen" },
    },
    {
      label: "Last seen",
      value: dateCell(l.lastSeenAt),
      syncId: l.lastSeenSync || null,
    },
  ];

  if (p === PROVENANCE.BOUNDED) {
    rows.push({
      label: PROVENANCE_LABEL[PROVENANCE.BOUNDED],
      value: dateCell(l.disappearedAt),
      help: { term: "disappearance" },
    });
  } else {
    const episode = episodeOf(l);
    if (episode !== null) {
      rows.push({
        label: PROVENANCE_LABEL[PROVENANCE.RETURNED],
        value: "Episode " + episode,
        help: { term: "episode" },
      });
    }
  }

  // Last, and unconditional: whichever provenance the row above named, the two dates it
  // stands on were both read under this scope.
  rows.push({
    label: "Register scope",
    value: scopeCell(l.registerScope),
    help: { term: "register-scope" },
  });

  const chipText = p === PROVENANCE.BOUNDED
    ? PROVENANCE_LABEL[p] + " " + dateCell(l.disappearedAt)
    : PROVENANCE_LABEL[p];

  return {
    chip: { kind: PROVENANCE_KIND[p], text: chipText, help: PROVENANCE_HELP[p] },
    rows,
    // The gate. A disappearance is dated by this register, not reported by Wiz, so the
    // Facts pane's "Resolved" row is withheld on exactly those rows and on no others.
    wizResolved: p === PROVENANCE.BOUNDED ? null : wizResolvedRow(iss),
  };
}

/** Wiz's own resolution date, when the payload carried one. */
function wizResolvedRow(issue) {
  const at = issue ? issue.resolvedAt : null;
  return at ? { label: "Resolved", value: fmtDate(at) } : null;
}
