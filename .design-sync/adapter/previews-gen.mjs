// Seeds .design-sync/previews/<Name>.tsx from examples.mjs for the scoped component set.
//
// WRITE-IF-ABSENT, deliberately. These files are authored artifacts: they get graded, and a
// grade that says "this story is thin" is answered by editing the .tsx. Regenerating over a
// hand-tuned preview would silently undo that, so an existing file is never touched — delete
// it if you want it reseeded.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS } from "./spec.mjs";
import { EXAMPLES } from "./examples.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "..", "previews");
mkdirSync(outDir, { recursive: true });

// The scoped set: the components a design agent reaches for constantly. The rest ship
// functional with the honest floor card and can be authored on any later re-sync.
// Every component with an example is authored. The scope started at the ~22 a design agent
// reaches for constantly, then widened twice: first to clear components the render check
// flagged, then to the whole set once it was clear the examples already existed for all of
// them — a floor card is honest, but a real card is better and these cost a rebuild.
export const SCOPED = Object.keys(EXAMPLES);

const byName = new Map(COMPONENTS.map((c) => [c.name, c]));
const PKG = "@wiz-sidekick/design-system";

// Which component names a JSX snippet actually mentions, so the import list is exact.
function usedIn(src) {
  const names = new Set();
  for (const m of src.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) if (byName.has(m[1])) names.add(m[1]);
  return names;
}

let wrote = 0;
let kept = 0;
const missing = [];

for (const name of SCOPED) {
  const ex = EXAMPLES[name];
  if (!ex) { missing.push(name); continue; }
  const file = join(outDir, name + ".tsx");
  if (existsSync(file)) { kept++; continue; }

  const imports = new Set([name]);
  for (const [, jsx] of ex.stories) for (const n of usedIn(jsx)) imports.add(n);

  const body = ex.stories
    .map(([exportName, jsx]) => {
      const indented = jsx.split("\n").map((l) => (l ? "  " + l : l)).join("\n");
      return `export const ${exportName} = () => (\n${indented}\n);`;
    })
    .join("\n\n");

  writeFileSync(
    file,
    `import { ${[...imports].sort().join(", ")} } from "${PKG}";\n\n${body}\n`,
  );
  wrote++;
}

console.log(`previews: ${wrote} written, ${kept} kept (already authored)`);
if (missing.length) console.log(`  ! no example for: ${missing.join(", ")}`);
