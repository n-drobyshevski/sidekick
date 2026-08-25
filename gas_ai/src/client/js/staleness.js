// The staleness notices a register carries, as pure logic.
//
// ITS OWN MODULE, not a function on the inventory page, for a mechanical reason worth stating:
// pages/inventory.js transitively imports charts.js, which reads `window` at module scope, so
// anything exported from the page can only be tested inside a DOM environment. This is pure
// data in and data out, and it earns a unit test without one — the same split assetQuery.js
// makes against the page that uses it.

/**
 * Where each kind of staleness sends an operator. Keyed by the `remedy` the SERVER names, so
 * the sentence and the button cannot drift from the condition that raised them — api.ts says
 * exactly that where it sets `derivation.remedy`.
 */
const STALE_REMEDIES = {
  sync: { href: "#/scans", link: "Open Wiz Scans" },
  recompute: { href: "#/aars", link: "Open AARS Rules" },
};

/**
 * The staleness notices this register should be carrying, worst first.
 *
 * TWO KINDS, AND THEY HAVE DIFFERENT REMEDIES — which is the whole reason this is a list
 * rather than a flag. `aarsRule.stale` means the model moved since these scores were computed
 * and Recompute repairs it with no Wiz call. `derivation.stale` means the STORED FACTS came
 * from an older normalizer, and Recompute cannot repair it at all: the original reading was
 * destroyed at ingest, so a cell reading "false" no longer remembers that Wiz never answered.
 * Only a full sync does. Pointing an operator at a button that cannot help is worse than not
 * warning at all, so the derivation notice goes FIRST — someone who reads one line reads the
 * one that Recompute will not fix.
 *
 * Pure, and exported for the same reason actionView's filters are: the page's logic is tested
 * here, the page's pixels are checked in the dev harness.
 */
export function staleNotices(boot) {
  const out = [];
  if (boot && boot.derivation && boot.derivation.stale) {
    out.push({
      id: "derivation",
      text: "These scores were computed from facts an older sync collected. Recompute cannot "
        + "repair them — the original readings were lost at ingest — only a full sync can.",
      ...(STALE_REMEDIES[boot.derivation.remedy] || STALE_REMEDIES.sync),
    });
  }
  if (boot && boot.aarsRule && boot.aarsRule.stale) {
    out.push({
      id: "aarsRule",
      text: "The AARS rule has changed since these scores were computed. "
        + "Recompute them on the AARS Rules page.",
      ...STALE_REMEDIES.recompute,
    });
  }
  return out;
}
