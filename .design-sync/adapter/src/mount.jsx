// The bridge between the register's DOM factories and React.
//
// The components in gas_devsecops/src/client/js/ui are factory functions returning a real
// HTMLElement (see ui/dom.js `el`). Nothing here reimplements them — this file mounts what
// they build, so the bundle ships the register's own component code.
import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

// useLayoutEffect so the node is in the DOM before a preview screenshot is taken; falls back
// where there is no layout pass.
const useIsoLayout = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * A rebuild signature over the props that actually change what the factory draws.
 * Functions are excluded (they are made stable by useStableProps below) and so are React
 * nodes (they arrive through portalled slots whose host element is stable).
 */
export function sigOf(props, skip) {
  const out = [];
  for (const k of Object.keys(props).sort()) {
    if (skip && skip.indexOf(k) !== -1) continue;
    const v = props[k];
    if (typeof v === "function" || (v && typeof v === "object" && v.$$typeof)) continue;
    try {
      out.push(k + "=" + JSON.stringify(v, (_k, x) => (x instanceof Set ? [...x] : x)));
    } catch {
      out.push(k + "=?");
    }
  }
  return out.join("|");
}

/**
 * Replaces each named function prop with a stable wrapper delegating to the latest one, so a
 * handler identity that changes every render does not tear down and rebuild the DOM node —
 * which in an interactive control is a dropped keystroke and focus on <body>.
 *
 * Absence is preserved: a prop that is not a function stays undefined, because several
 * factories branch on `p.onEdit || null` to decide whether to draw an affordance at all.
 */
export function useStableProps(props, fnKeys) {
  const latest = useRef(props);
  latest.current = props;
  const presence = fnKeys.map((k) => (typeof props[k] === "function" ? "1" : "0")).join("");
  const stable = useMemo(() => {
    const out = {};
    fnKeys.forEach((k, i) => {
      if (presence[i] !== "1") return;
      out[k] = (...args) => {
        const fn = latest.current[k];
        return typeof fn === "function" ? fn(...args) : undefined;
      };
    });
    return out;
  }, [presence]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...props, ...stable };
}

/**
 * Mount whatever `build()` returns, rebuilding when `sig` changes.
 *
 * THE HOST'S `display` IS CONDITIONAL, AND THAT CONDITION IS LOAD-BEARING.
 *
 * `display: contents` is what lets a `.stat-row` stay a grid item of its parent `.stat-list`
 * rather than being wrapped in a box the register's CSS knows nothing about — so it is
 * required wherever this adapter nests one component inside another's slot.
 *
 * But an element with `display: contents` generates NO BOX, and the preview harness measures
 * the element it mounted. Applying it unconditionally made every card measure 0px tall while
 * painting perfectly (KpiCard: maxHeight 0, pngBytes 20848, all three stories' text intact) —
 * 20 components flagged RENDER_THIN for a defect none of them had.
 *
 * So: contents only when the parent is one of this adapter's own slots, block otherwise.
 */
export function Mounted({ build, sig }) {
  const host = useRef(null);
  const latest = useRef(build);
  latest.current = build;
  useIsoLayout(() => {
    const node = host.current;
    if (!node) return undefined;
    const nested = !!(node.parentElement && node.parentElement.hasAttribute("data-ds-slot"));
    node.style.display = nested ? "contents" : "block";
    let built;
    try {
      built = latest.current();
    } catch (err) {
      const pre = document.createElement("pre");
      pre.className = "ds-adapter-error";
      pre.textContent = String((err && err.message) || err);
      node.replaceChildren(pre);
      return undefined;
    }
    // field() returns { node, setError, setChanged } rather than an element.
    const element = built && built.nodeType ? built : built && built.node;
    node.replaceChildren(element || document.createComment("empty"));
    return () => node.replaceChildren();
  }, [sig]);
  return <div ref={host} />;
}

/**
 * A stable detached <div style="display:contents"> that React portals children into and the
 * factory receives as a plain DOM Node. This is how a React child reaches a factory whose
 * signature takes a Node (PageHeader's hero, SettingRow's control, Disclosure's body).
 */
export function useSlot(active) {
  const ref = useRef(null);
  if (active && !ref.current) {
    const div = document.createElement("div");
    div.style.display = "contents";
    // The marker Mounted reads to decide its own display — see the note there.
    div.setAttribute("data-ds-slot", "");
    ref.current = div;
  }
  return active ? ref.current : null;
}

/** Portal each [hostNode, children] pair, so the factory's DOM subtree stays React-driven. */
export function Slots({ pairs }) {
  return (
    <>
      {pairs.map(([node, children], i) =>
        node ? <React.Fragment key={i}>{createPortal(children, node)}</React.Fragment> : null,
      )}
    </>
  );
}
