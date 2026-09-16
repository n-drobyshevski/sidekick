// One track split into labelled segments — an in/out proportion, or a severity mix.
//
// PROMOTED FROM gas/src/client/js/ui/splitBar.js (P2). Its own header called out that it was
// "local, and the nearest shared thing is not a near miss" against `sevSegmentBar` — that
// argument was about the two components never merging, not about this one staying gas-only.
// Two call sites reached it before this move (both in gas's settingsReadouts.js) and neither
// crossed an app boundary, so the promotion is not justified by cross-app reuse; it follows
// gas_shared/README.md's placement rule instead — "anything exported from gas_shared/ui/ with
// a domain-free API gets its CSS in components.css" — because the new settingsReadouts.js
// primitives (impactSplit, severitySplitModel) build directly on this shape and belong beside
// it rather than importing a still-local gas file.
//
// `sevSegmentBar` draws a severity distribution and only that: its segments take `sev-fill-*`
// classes and its entries are `{sev, count}`. This one takes `{label, value, tone}` where
// `tone` is any class suffix, and its two most-used tones — `in` and `out`, an accent fill
// against a hatch — are what the scan-coverage and would-seal figures on Data and Program are
// drawn with. Folding the two would either put a hatch into the severity vocabulary or make an
// arbitrary tone look like a severity.
//
// THE `title` ATTRIBUTES ARE GONE, and that is a fix rather than a port. Each segment carried
// `title: "Label: 1,234"` — a native tooltip, which is unreachable by keyboard, absent on
// touch, and truncated by the OS. `el()` now refuses the attribute outright
// (gas_shared/ui/dom.js). The figures were never only in the tooltip — the caption below the
// bar has carried them in words from the start, because a bar alone fails the non-colour rule
// — so the segments become plain marks under one `role="img"` name, which is what they were
// already announcing as.
//
// THE HATCH ON `.splitbar__seg--out` IS THE LITERAL SHIPPED GRADIENT, CARRIED ACROSS UNCHANGED.
// gas_shared/README.md's own rule: `--hatch` is for NEW work; `axisBar`'s hatch and
// `.sevbar-seg--empty`'s keep their own rules, because repointing them changes shipped pictures
// and belongs in its own measured round, not in the commit that moves the file that draws them.
// This segment's hatch is the identical case — it predates the token and repointing it here
// would move a pixel this package promised not to move. See
// gas_shared/styles/components.css's own copy of this rule for where the gradient itself lives
// now.

import { el } from "./dom.js";

/**
 * A proportion bar: one track split into labelled segments, with the figures repeated in
 * text beneath it. `segments` is `[{ label, value, tone }]`, where `tone` is a class suffix
 * ("in" | "out" | a severity name). Never the only way to read the numbers — the caption
 * below carries them in words, because a bar alone fails the non-color rule and is
 * unreadable to a screen reader.
 */
export function splitBar({ segments, caption, keys, summary, ariaLabel }) {
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
  // KEYS OVER A CAPTION, where the model offers them. A key row is the same figures as a row
  // of facts — swatch, word, figure per segment — and a reader scans it; the joined caption
  // was a sentence they parsed, and at five severities it ran to 45 words. Both forms repeat
  // every number in text, which is the non-colour rule; only one of them is prose. A caller
  // that passes only `caption` (the two-way impact split, a dozen words) is drawn exactly as
  // before.
  const keyRow = keys && keys.length
    ? el("div", { class: "splitbar__keys" },
      ...keys.map((k) => el("span", { class: `splitbar__key${k.out ? " splitbar__key--out" : ""}` },
        el("span", {
          class: `splitbar__swatch splitbar__seg--${k.out ? "out" : k.tone}`,
          "aria-hidden": "true",
        }),
        el("span", { class: "splitbar__key-label" }, k.label),
        el("span", { class: "splitbar__key-num num" }, k.text),
        k.out ? el("span", { class: "splitbar__key-out" }, String(k.outLabel || "").toLowerCase()) : null)))
    : null;
  return el("div", { class: "splitbar-wrap" },
    track,
    keyRow,
    keyRow && summary ? el("p", { class: "splitbar__sum muted small" }, summary) : null,
    !keyRow && caption ? el("p", { class: "splitbar__caption muted small" }, caption) : null);
}
