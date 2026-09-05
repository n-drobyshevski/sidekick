// One track split into labelled segments — an in/out proportion, or a severity mix.
//
// LOCAL, AND THE NEAREST SHARED THING IS NOT A NEAR MISS. `sevSegmentBar` draws a severity
// distribution and only that: its segments take `sev-fill-*` classes and its entries are
// `{sev, count}`. This one takes `{label, value, tone}` where `tone` is any class suffix, and
// its two most-used tones — `in` and `out`, an accent fill against a hatch — are what the
// scan-coverage and would-seal figures on Data and Program are drawn with. Folding the two
// would either put a hatch into the severity vocabulary or make an arbitrary tone look like
// a severity.
//
// THE `title` ATTRIBUTES ARE GONE, and that is a fix rather than a port. Each segment carried
// `title: "Label: 1,234"` — a native tooltip, which is unreachable by keyboard, absent on
// touch, and truncated by the OS. `el()` now refuses the attribute outright
// (gas_shared/ui/dom.js). The figures were never only in the tooltip — the caption below the
// bar has carried them in words from the start, because a bar alone fails the non-colour rule
// — so the segments become plain marks under one `role="img"` name, which is what they were
// already announcing as.

import { el } from "../../../../../gas_shared/ui/dom.js";

/**
 * A proportion bar: one track split into labelled segments, with the figures repeated in
 * text beneath it. `segments` is `[{ label, value, tone }]`, where `tone` is a class suffix
 * ("in" | "out" | a severity name). Never the only way to read the numbers — the caption
 * below carries them in words, because a bar alone fails the non-color rule and is
 * unreadable to a screen reader.
 */
export function splitBar({ segments, caption, ariaLabel }) {
  const total = segments.reduce((n, s) => n + (s.value || 0), 0);
  const track = el("div", {
    class: "splitbar", role: "img",
    "aria-label": ariaLabel
      || segments.map((s) => `${s.label} ${s.value}`).join(", "),
  });
  for (const s of segments) {
    if (!s.value) continue;
    const seg = el("span", { class: `splitbar__seg splitbar__seg--${s.tone || "in"}` });
    seg.style.width = `${(s.value / (total || 1)) * 100}%`;
    track.append(seg);
  }
  return el("div", { class: "splitbar-wrap" },
    track,
    caption ? el("p", { class: "splitbar__caption muted small" }, caption) : null);
}
