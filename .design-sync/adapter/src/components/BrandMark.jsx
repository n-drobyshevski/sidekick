import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { brandMark } from "../../../../gas_shared/ui/brandMark.js";

/**
 * The Sidekick mark. Decorative by default - it sits next to the wordmark almost everywhere,
 * and announcing the picture as well as the name would say it twice. Pass label only where the
 * mark is the only identity on screen.
 *
 * @param size Default 96.
 * @param compact The narrow variant for a collapsed rail.
 * @param label Give it an accessible name. Only where the wordmark is hidden.
 */
export function BrandMark(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => brandMark(p.size === undefined ? 96 : p.size, { compact: !!p.compact, label: p.label || null })} />;
}
