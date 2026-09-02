# design-sync notes — wiz sidekick design system

Repo-specific gotchas for future syncs. Measured, not assumed.

## Source shape: this repo is OUTSIDE the converter's default envelope

- **No React, no Storybook, no component-library `dist/`.** Verified: `rg "from ['\"]react"`
  over all js/ts/jsx/tsx/mjs returns nothing. The three registers (`gas/`, `gas_ai/`,
  `gas_devsecops/`) are vanilla Google Apps Script SPAs.
- The UI layer is **DOM factory functions** built on `el()` (`ui/dom.js`), returning
  `HTMLElement` via `document.createElement`, taking **positional args**
  (`kpiCard(label, value, sub, chip, help)`).
- Their `dist/` is HtmlService partials (`js_app.html`, `styles.html`, `index.html`,
  `server.js`) — not a component library.
- Therefore the sync goes through an **authored React adapter package**
  (`.design-sync/adapter/`) that imports the real UI modules and wraps them. The adapter is
  a mount shim, NOT a reimplementation: component bodies stay in the register's own source.

## What "shared core" actually is (measured 2026-09-02)

Diffed `gas_ai` vs `gas_devsecops` module-by-module and file-by-file.

**UI modules — 19 of 23 shared modules are BYTE-IDENTICAL.** The 4 that differ are cosmetic:

| Module | Divergence |
|---|---|
| `brandMark.js` | one comment word ("Wiz SIDEKICK AI" vs "Wiz Sidekick DevSecOps") |
| `sheet.js` | localStorage key namespace only (`sidekickai.` vs `sidekickdso.`) |
| `severity.js` | gas_ai adds `aarsChip` (AI-only). Shared exports identical. |
| `tableModel.js` | `pageOf` re-exported from `assetQuery.js` (ai) vs defined inline (dso). Identical arithmetic. |

9 further modules are gas_ai-only (`lattice*`, `posture`, `outcome`, `claimRail`,
`diagList`, `prunePanel`, `projectScope`) and are out of the shared core.

**CSS — the sole axis of variation is THE ACCENT.** `tokens.css` differs by 37 lines and
every one is the accent triplet. `base.css` differs by 50 lines and every one is
`var(--accent)` vs `var(--accent-text)` / an added `--accent-edge` shadow. This confirms
CLAUDE.md: the severity palette is byte-identical, the brand deliberately is not.

- `gas_devsecops` carries the **generalized** accent contract — `--accent` (fill only),
  `--accent-text` (ink), `--accent-edge` (mandatory edge under fills). `gas_ai` has only
  `--accent` / `--accent-hover` and uses the accent directly as ink.
- The devsecops form degrades to the gas_ai form by setting `--accent-text` to the rose and
  `--accent-edge: transparent`. **So devsecops CSS is the shared structural base**, and the
  brand is a swappable token block — not a fork.
- Do NOT collapse the split. `--accent: #ffcb13` is 1.52:1 on white; it is a FILL token.

## Preview-harness traps

- **`el()` throws on a `title` attribute** (deliberate, `ui/dom.js`). Any preview passing
  `title=` fails on first render. Use `tip()`.
- `tipLabel(content, help)` returns `content` unchanged when `help` is falsy — most previews
  need no tooltip machinery at all.
- `tip.js` builds its host lazily via `ensureHost()` and appends to `document.body`, so it
  works in a preview card without scaffolding.
- `portals.js` is pure counter state, no DOM. Safe.
- **NOT a blocker (measured, corrected):** `ui/tip.js` imports `navigate` from `../store.js`
  and `ui/sheet.js` imports `parseHash` from it; `store.js` in turn imports `./api.js`, the
  `google.script.run` bridge. This looked like it would need a bundler alias. It does not:
  `api.js` does all its work inside `call()` behind a `typeof google === "undefined"` guard,
  and `store.js` has exactly one top-level statement (`const rpcCache = new Map()`). Importing
  the real modules is side-effect-free, so the shared core bundles as-is with no shim.
- Modules escaping `ui/`: `../icons.js` (512 lines, leaf — needed, bundle it),
  `../helpContent.js` (107 lines, leaf), `../recordSections.js` (44 lines), `../store.js`
  (shim it).

## Not applicable here

- The **middlebox guard** in `esbuild.config.mjs` (no backticks, no bare `//`) exists because
  the GAS bundle ships inline through corporate SSL-inspection proxies. The design-system
  bundle takes a different delivery path — do not inherit that constraint into the adapter.

## Build steps this repo needs that the converter does not do by itself

- **`node .design-sync/adapter/gen.mjs`** regenerates the 45 React adapters and
  `dist/index.d.ts` from `spec.mjs`. `spec.mjs` is the single source of truth — never edit
  `src/components/*.jsx` or `dist/index.d.ts` by hand, `gen.mjs` wipes the directory.
- **`node .design-sync/adapter/build-css.mjs`** MUST run before the converter. `styles.css`
  @imports the register's stylesheets by relative path; the converter COPIES the css entry
  rather than resolving imports that leave the package, so pointing `cssEntry` at the raw
  entry shipped a 3.5 KB file of bare `@import` lines and every design would have rendered
  unstyled. `build-css.mjs` inlines the closure (3.5 KB -> 72 KB) into `dist/styles.css`,
  which is what `cssEntry` points at. It carries a marker guard, because that failure is
  otherwise silent: a stylesheet that lost every rule still "builds".
- `.design-sync/adapter/node_modules` is a symlink to `../../.ds-sync/node_modules`; without
  it the converter reports `[DTS_REACT] @types/react not found` and React types degrade to
  `any`. Recreated per clone, never committed.

## Config decisions and why

- **`runtimeFontPrefixes: ["Inter"]`** — validate raises `[FONT_MISSING]` for Inter, but the
  register never loads it: `--font` in `tokens.css:277` is a native stack
  (`-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, …`) and Inter is one
  opportunistic entry in it, not a brand face. There is no `@font-face` and no font link in
  `index.html` to port. Rendering with system fonts is the intended behaviour, not a
  substitution — so the warning is suppressed rather than answered with `extraFonts`.

## A SECOND asymmetry the module/stylesheet diff did not show

The register diff concluded that the only axis of variation between `gas_ai` and
`gas_devsecops` is the brand accent. That is true **of the files that exist in both** — and it
is not the whole story:

**Six shared-core modules are byte-identical in both registers while their CSS exists only in
gas_ai.** `ui/axisBar.js`, `ui/rail.js`, `ui/tokenList.js`, `ui/rowReorder.js` and the
filter-chip / select-field parts of `ui/controls.js` were forked into `gas_devsecops` without
the rules that dress them, because no devsecops page draws them. Their styles live in
`gas_ai/styles/aars.css` and `graph.css` — the files excluded as register-specific.

Shipped from the devsecops stylesheets alone, `AxisBar`, `PointRail`, `FilterChipRow`,
`TokenList`, `SelectField` and `RuleGrip` render as **unstyled text**. `extract-extras.mjs`
lifts those rules by selector into `shared-extras.css` (41 of 46 missing classes recovered)
and converts `var(--accent)` -> `var(--accent-text)` on the way, because gas_ai's crimson can
carry ink at 6.29:1 and the shared core's yellow cannot at 1.52:1 — the same conversion
`gas_devsecops/base.css` already performs when it forks those constructs.

**How this was caught matters.** The `FilterChipRow` screenshot read as "fine" to the eye; it
was a scripted check — every class the docs extract, tested against the shipped CSS — that
found it. Re-run that check after any CSS change:

```
node -e 'const fs=require("fs");const css=fs.readFileSync(".design-sync/adapter/dist/styles.css","utf8");
for(const f of fs.readdirSync(".design-sync/adapter/docs")){const t=fs.readFileSync(".design-sync/adapter/docs/"+f,"utf8");
const bad=(t.match(/^- `\.(.+)`$/gm)||[]).map(x=>x.slice(4,-1)).filter(c=>!c.includes("<variant>")&&!css.includes("."+c));
if(bad.length)console.log(f,bad.join(" "));}'
```

Five classes stay unmatched and that is correct: `brand-mark--compact`,
`settings-panel__head`, `sheet-row--static`, `tabstrip__label` are emitted by the factories
and defined by **no stylesheet in either register**; `th-groups` is styled only inside
gas_ai's `.gq-table` page container, which is not part of the shared core.

## Two factories need a post-build call, and are silent without it

`Mounted` supports an `after` step in `spec.mjs` for these. Both were found by reading renders,
not by reading signatures:

- **`saveBar`** returns `{node, setBusy, update}` and its node is built `hidden: true`. It is
  invisible until `update(countText, summary)` gets a non-empty summary. The adapter exposes
  `changes` / `countText` and calls it.
- **`axisBar({values})`** takes the axis VALUE NAMES, not magnitudes; the data arrives via
  `.paint(axisSegments(reading, values))`. Without it the bar reads "not measured yet". The
  adapter exposes `reading` and calls it. The first spec had `values: number[]` — wrong.

`filterChipRow` and `tokenList` follow the same pattern via `.sync(...)`.

## Known render warns (triaged — a warn NOT in this list is new, go look)

- `[RENDER_THIN] BrandMark: mounts have no text and paint nothing` — **benign**. BrandMark is
  a text-free SVG logo; the check is text-based. The screenshot shows both variants (compact
  and the full dot-map mark) rendering correctly at 16 KB PNG. Do not "fix" this by adding a
  caption — the preview should be the component.

## Re-sync risks — what can go stale

- **The adapter tracks the register by import, not by copy.** `src/components/*.jsx` import
  `../../../../gas_devsecops/src/client/js/ui/*.js` directly, so a change to a factory's
  signature silently changes the component while `spec.mjs` keeps describing the old one.
  After any edit under `gas_devsecops/src/client/js/ui/`, re-read the changed factory against
  its `spec.mjs` entry — nothing checks this automatically.
- **`shared-extras.css` is generated from gas_ai and pinned to nothing.** If gas_ai's
  `aars.css` / `graph.css` are edited, re-run `extract-extras.mjs` and re-run the class-coverage
  check above.
- **The class vocabulary in each doc is extracted statically** from the factory body by a
  scanner in `docs-gen.mjs`. It handles plain strings, templates (`sev-badge sev-${s}`) and
  concatenations, but a factory that computes a class name at runtime would slip past it.
- **Only the devsecops brand was rendered.** Every screenshot in this sync is the default
  yellow; `[data-brand="ai"]` (crimson) ships and is contrast-checked by arithmetic (6.29:1 on
  white) but was never visually verified in a preview.
- **Toolchain:** node v24.8.0, esbuild + ts-morph + playwright installed into `.ds-sync/`
  (chromium-headless-shell 151.0.7922.34). `.design-sync/adapter/node_modules` is a symlink
  that must be recreated per clone.
