// Emits docs/<Name>.md — one per component.
//
// These do three jobs at once:
//   1. `category:` frontmatter, which is what puts a component in its group. Without a doc
//      file every component lands in `general`.
//   2. The usage example the design agent copies.
//   3. THE CLASS VOCABULARY. These components are class-named divs, so an agent that knows
//      the class structure can write native JSX that renders identically. The classes are
//      extracted from the register's own factory source, not invented here.
import { writeFileSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS } from "./spec.mjs";
import { EXAMPLES } from "./examples.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const docsDir = join(root, "docs");
const UI = join(root, "..", "..", "gas_devsecops", "src", "client", "js", "ui");
mkdirSync(docsDir, { recursive: true });
for (const f of readdirSync(docsDir)) rmSync(join(docsDir, f));

const srcCache = new Map();
function moduleSource(mod) {
  if (!srcCache.has(mod)) {
    const p = join(UI, mod + ".js");
    srcCache.set(mod, existsSync(p) ? readFileSync(p, "utf8") : "");
  }
  return srcCache.get(mod);
}

/**
 * The value expression starting at `i`, ending at the first `,` or `}` that is genuinely at
 * depth zero — outside every string, template interpolation, paren and bracket.
 */
function readExpr(src, i) {
  const start = i;
  let paren = 0;
  let quote = null; // '"' | "'" | '`'
  const tmpl = []; // interpolation depth per open template
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (quote === "`" && ch === "$" && src[i + 1] === "{") { tmpl.push(0); quote = null; i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
    if (ch === "(" || ch === "[") { paren++; i++; continue; }
    if (ch === ")" || ch === "]") { paren--; i++; continue; }
    if (ch === "{") { if (tmpl.length) tmpl[tmpl.length - 1]++; else paren++; i++; continue; }
    if (ch === "}") {
      if (tmpl.length && tmpl[tmpl.length - 1] === 0) { tmpl.pop(); quote = "`"; i++; continue; }
      if (tmpl.length) { tmpl[tmpl.length - 1]--; i++; continue; }
      if (paren === 0) break;
      paren--; i++; continue;
    }
    if (ch === "," && paren === 0 && !tmpl.length) break;
    if (ch === "\n" && paren === 0 && !tmpl.length) break;
    i++;
  }
  return src.slice(start, i);
}

/**
 * The classes a factory emits, in source order. Reads the factory's own body out of the
 * register module and pulls the string literals out of every `class:` expression — which
 * covers the three forms in use: a plain literal, a template with an interpolated variant,
 * and a concatenation with an optional modifier.
 */
function classesOf(factory, mod) {
  const src = moduleSource(mod);
  const start = src.indexOf(`export function ${factory}(`);
  if (start === -1) return [];
  // The body runs to the next top-level `export ` (or EOF).
  const nextExport = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, nextExport === -1 ? src.length : nextExport);
  const out = [];
  const seen = new Set();
  const add = (cls) => {
    if (!cls || cls.length > 40 || seen.has(cls) || cls === "<variant>") return;
    seen.add(cls);
    out.push(cls);
  };
  // Every quoted run inside a `class:` expression — plain strings AND template literals,
  // which the register uses for variants (`sev-badge sev-${s}`) and optional modifiers
  // (`segmented${className ? " " + className : ""}`). Both forms carry real class names, so
  // neither can be skipped.
  const HOLE = "\u0000";
  for (const m of body.matchAll(/class(?:Name)?:\s*/g)) {
    // Read the value expression with a real scanner rather than a regex: a template's
    // `${...}` contains a `}` that terminates any lazy pattern early, which silently ate
    // `sev-badge` out of `class: `sev-badge sev-${s}``.
    const expr = readExpr(body, m.index + m[0].length);
    for (const lit of expr.matchAll(/`((?:[^`\\]|\\.)*)`|"([^"\\]*)"|'([^'\\]*)'/g)) {
      const raw = lit[1] ?? lit[2] ?? lit[3] ?? "";
      // Interpolations become holes, so the static parts around them survive.
      for (const tok of raw.replace(/\$\{[^{}]*\}/g, HOLE).trim().split(/\s+/)) {
        if (!tok) continue;
        if (!tok.includes(HOLE)) { add(tok); continue; }
        const prefix = tok.slice(0, tok.indexOf(HOLE));
        if (!prefix) continue;
        // `sev-${s}` names a family; `segmented${maybe}` is just `segmented` plus an extra.
        add(prefix.endsWith("-") ? prefix + "<variant>" : prefix);
      }
    }
  }
  return out;
}

let written = 0;
for (const c of COMPONENTS) {
  const ex = EXAMPLES[c.name];
  const classes = classesOf(c.factory, c.mod);
  const lines = [];

  lines.push("---");
  lines.push(`category: ${c.group}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${c.name}`);
  lines.push("");
  lines.push(c.doc);
  lines.push("");

  if (c.props.length) {
    lines.push("## Props");
    lines.push("");
    lines.push("| Prop | Type | Required | Notes |");
    lines.push("| --- | --- | --- | --- |");
    for (const p of c.props) {
      lines.push(
        `| \`${p.n}\` | \`${p.t.replace(/\|/g, "\\|")}\` | ${p.req ? "yes" : "—"} | ${(p.d || "").replace(/\|/g, "\\|")} |`,
      );
    }
    lines.push("");
  }

  if (ex && ex.stories.length) {
    lines.push("## Usage");
    lines.push("");
    lines.push("```jsx");
    lines.push(ex.stories[0][1]);
    lines.push("```");
    lines.push("");
  }

  if (classes.length) {
    lines.push("## Class vocabulary");
    lines.push("");
    lines.push(
      "These are the classes this component emits, taken from its factory source. They are " +
      "part of the design system: styling around this component, or hand-writing the same " +
      "structure, uses these names rather than new ones.",
    );
    lines.push("");
    for (const cls of classes) lines.push(`- \`.${cls}\``);
    lines.push("");
  }

  lines.push(`> Source: \`gas_devsecops/src/client/js/ui/${c.mod}.js\` → \`${c.factory}()\`.`);
  lines.push("");

  writeFileSync(join(docsDir, c.name + ".md"), lines.join("\n"));
  written++;
}

console.log(`wrote ${written} component docs to docs/`);
const noClasses = COMPONENTS.filter((c) => classesOf(c.factory, c.mod).length === 0).map((c) => c.name);
if (noClasses.length) console.log(`  (no classes extracted for: ${noClasses.join(", ")})`);
