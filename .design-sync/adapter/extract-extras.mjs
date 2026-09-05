// Recovers the style rules for shared-core components whose CSS lives only in gas_ai.
//
// THE ASYMMETRY THIS CLOSES. The two registers were diffed module-by-module and file-by-file,
// and the conclusion was that the only axis of variation is the brand accent. That holds for
// the files that exist in BOTH — but six modules are byte-identical in both registers while
// their stylesheets exist only in gas_ai: the devsecops fork copied ui/axisBar.js,
// ui/rail.js, ui/tokenList.js, ui/rowReorder.js and the filter-chip / select-field parts of
// controls.js without the rules that dress them, because no devsecops page uses them.
//
// Shipped as-is that is six components rendering as unstyled text — which the class-coverage
// check at the bottom of this file is what caught, after a screenshot read as "fine" to the
// eye. So the rules are lifted here, by selector, from gas_ai's own stylesheets. Nothing is
// rewritten: a rule either comes across verbatim or does not come across at all.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const AI = join(root, "..", "..", "gas_ai", "src", "client", "styles");
const bundled = readFileSync(join(root, "dist", "styles.css"), "utf8");

// ---- 1. which classes the shipped components claim but the shipped CSS lacks -------------
const docsDir = join(root, "docs");
const wanted = new Set();
for (const f of readdirSync(docsDir)) {
  const text = readFileSync(join(docsDir, f), "utf8");
  for (const m of text.matchAll(/^- `\.(.+)`$/gm)) {
    const cls = m[1];
    if (cls.includes("<variant>")) continue;
    if (!bundled.includes("." + cls)) wanted.add(cls);
  }
}

// ---- 2. split a stylesheet into top-level blocks, keeping @media wrappers intact ---------
function blocks(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "/" && css[i + 1] === "*") { const e = css.indexOf("*/", i + 2); i = e === -1 ? css.length : e + 1; continue; }
    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1; }
    }
  }
  return out.filter(Boolean);
}

// A block is wanted when its SELECTOR (not its body) names one of the missing classes —
// matching the body would drag in every rule that merely mentions one in a comment.
const hits = (selector) =>
  [...wanted].some((c) =>
    new RegExp("\\." + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])").test(selector) ||
    selector.includes("." + c + "--") ||
    selector.includes("." + c + "__"),
  );

function keep(block) {
  const brace = block.indexOf("{");
  const head = block.slice(0, brace);
  if (/^\s*@(media|supports)/.test(head)) {
    const inner = block.slice(brace + 1, block.lastIndexOf("}"));
    const kept = blocks(inner).filter(keep);
    return kept.length ? head.trim() + " {\n" + kept.join("\n") + "\n}" : null;
  }
  if (/^\s*@/.test(head)) return null; // keyframes etc. come across only if referenced
  return hits(head) ? block : null;
}

// ---- 3. lift them, in the source files' own order ----------------------------------------
const sources = ["components.css", "aars.css", "graph.css", "inventory.css", "base.css"];
const parts = [];
const found = new Set();
for (const file of sources) {
  let css;
  try { css = readFileSync(join(AI, file), "utf8"); } catch { continue; }
  const kept = [];
  for (const b of blocks(css)) {
    const k = typeof keep(b) === "string" ? keep(b) : keep(b);
    if (!k) continue;
    kept.push(k);
    for (const c of wanted) if (k.slice(0, k.indexOf("{")).includes("." + c)) found.add(c);
  }
  if (kept.length) {
    parts.push(`/* ------------------------------------------ from gas_ai/${file} */\n` + kept.join("\n"));
  }
}

// ---- 4. carry the accent split across with them ------------------------------------------
// gas_ai's accent is crimson (6.29:1 on white) so it can carry ink directly, and its rules
// use var(--accent) for focus rings and for a hatch. The shared core defaults to the
// DevSecOps yellow, where --accent is a FILL token measuring 1.52:1 — a focus ring drawn in
// it is invisible.
//
// This is not a redesign: gas_devsecops/base.css already performs exactly this conversion on
// exactly these constructs when it forks the same rules — `outline: 2px solid var(--accent)`
// becomes var(--accent-text), and the 45° hatch drops color-mix(--accent 55%, white) for
// var(--accent-text). The lifted rules get the same treatment so they obey the split they are
// landing in.
let css = parts.join("\n\n");
const accentInk = (css.match(/var\(--accent\)/g) || []).length;
css = css.replace(/var\(--accent\)/g, "var(--accent-text)");

writeFileSync(
  join(root, "shared-extras.css"),
  "/* GENERATED by extract-extras.mjs — do not edit by hand.\n" +
  " * Rules for shared-core components whose stylesheets live only in gas_ai.\n" +
  " * See the header of extract-extras.mjs for why this file exists. */\n\n" +
  css + "\n",
);
if (accentInk) console.log(`  ${accentInk} var(--accent) -> var(--accent-text) (fill token cannot carry ink)`);

const still = [...wanted].filter((c) => !found.has(c));
console.log(`extras: ${wanted.size} classes missing, ${found.size} recovered from gas_ai`);
if (still.length) console.log(`  not found anywhere: ${still.join(", ")}`);
