// THE CAPACITY VERDICT'S OWN TRACK RECORD.
//
// "Gaining ground / keeping up / falling behind" is not a description a reader files away. It
// is read by the people whose behaviour it is about, and a verdict that changes what the
// register does next owes them an answer to the obvious question: how often has it been
// right? The server replays the verdict against every saved scan and pairs it with the month
// that followed (program.ts, `capacityHindcast`); this is the view over that payload.
//
// Pure and lifted out of the page for the reason overviewModel.js, mttrPaintPlan.js and
// capacity.js already are: every case worth pinning is a payload shape rather than a pixel —
// a verdict nobody could compute that day, a month with nothing open to close, an old cached
// payload carrying no hindcast block at all. Those are enumerable in node; the table is not.
//
// The leaf import rather than "../ui.js" is deliberate and is overviewModel.js's precedent:
// the barrel drags the DOM in behind it, and nothing here touches a node.
import { absentText, num, pct1 } from "../../../../../gas_shared/ui/figures.js";

/**
 * The three verdicts, in the words and the ornaments the page shows them with.
 *
 * ONE MAP, LIVING HERE, because `verdictPill` in program.js draws from it too. A second copy
 * would let the pill above the table and the words inside it disagree about what
 * "keeping-up" is called, which is exactly the drift a track record cannot survive.
 *
 * `glyph` is what keeps the pill from carrying its meaning in colour alone (PRODUCT.md's
 * accessibility bar); the table below uses `text` on its own, which needs no help.
 */
export const VERDICT = {
  gaining: { pill: "ok", glyph: "▲", text: "Gaining ground" },
  "keeping-up": { pill: "neutral", glyph: "=", text: "Keeping up" },
  "falling-behind": { pill: "bad", glyph: "▼", text: "Falling behind" },
};

/**
 * The hindcast payload as rows, a sentence and a scope note — or `{ empty }`.
 *
 * THE EMPTY BRANCH IS ABOUT `comparable`, NOT ABOUT `rows`. A register can have twenty
 * replayed scans and nothing to say about any of them: a verdict needs a complete month
 * behind it and an observed month in front of it, and early in a register's life neither
 * exists. Drawing four rows of em dashes under a sentence reading "Of 0 verdicts…" would
 * state a track record over a population nobody could check. The words are "no projection
 * old enough" — a refusal to measure, not a measurement of zero.
 *
 * `realisedText` goes through `pct1`, which answers the shared em dash for null and never
 * "0.0%": a month with nothing open to close has no net rate, and printing a zero there
 * would report a program holding steady where in fact none was observed.
 *
 * `agreedText` is three-valued for the same reason the domain's `agreed` is: "no" is a
 * verdict that was checked and missed, and an unobservable row has not earned that word.
 */
export function capacityHindcastView(hindcast) {
  const rows = Array.isArray(hindcast?.rows) ? hindcast.rows : [];
  // `num(v, 0)` rather than `Number(v)`: an absent field is not a zero, and Number(null),
  // Number("") and Number([]) are all 0 and all finite (CLAUDE.md). Here the fallback IS 0,
  // but only because "nothing comparable" and "no payload" take the same empty branch below.
  const comparable = num(hindcast?.comparable, 0);
  const counter = num(hindcast?.counterperformative, 0);
  if (!rows.length || comparable === 0) {
    return { empty: "No projection old enough to compare yet." };
  }
  // The scans actually replayed, not the cap that was offered. A register with three scans
  // has not been "checked over the last 24".
  const cap = num(hindcast?.scansConsidered, rows.length);
  return {
    rows: rows.map((r) => ({
      asOf: r.asOf,
      verdictText: VERDICT[r.verdict]?.text ?? absentText,
      realisedText: pct1(r.realisedNetPct),
      agreedText: r.agreed === true ? "yes" : r.agreed === false ? "no" : absentText,
    })),
    sentence:
      "Of " + comparable + " verdicts old enough to check, " + counter +
      " were followed by the opposite outcome.",
    cap,
    capNote: "Checked over the last " + cap + " scan" + (cap === 1 ? "" : "s") + ".",
  };
}
