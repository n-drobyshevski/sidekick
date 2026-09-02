import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { pageHeader } from "../../../../gas_devsecops/src/client/js/ui/controls.js";

/**
 * The shared page header: a borderless grid closed by a hairline, reading in three levels
 * rather than as a row of equal tiles. hero is the subject, aside is the one thing that
 * qualifies it, stats are the supporting facts. Every slot is optional.
 *
 * @param hero The subject - normally a HeroStat.
 * @param aside The one thing that qualifies the hero.
 * @param stats Supporting facts - a strip of StatRow.
 */
export function PageHeader(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    hero: useSlot(p.hero !== undefined && p.hero !== null),
    aside: useSlot(p.aside !== undefined && p.aside !== null),
    stats: useSlot(p.stats !== undefined && p.stats !== null),
  };
  const sig = sigOf(p, ["hero","aside","stats"]);
  return (
    <>
      <Mounted sig={sig} build={() => pageHeader({ hero: S.hero, aside: S.aside, stats: S.stats ? [S.stats] : null })} />
      <Slots pairs={[[S.hero, p.hero], [S.aside, p.aside], [S.stats, p.stats]]} />
    </>
  );
}
