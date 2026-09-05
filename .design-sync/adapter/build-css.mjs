// Resolves styles.css into ONE self-contained stylesheet at dist/styles.css.
//
// WHY THIS STEP EXISTS. styles.css @imports the register's stylesheets by relative path
// (../../gas_devsecops/...). Those paths are meaningful in this repo and meaningless in an
// uploaded design project: the converter copies the entry rather than resolving imports that
// leave the package, so the first build shipped a 3.5 KB stylesheet of @import lines and
// every rendered design would have come up unstyled. Inlining here is what makes the CSS the
// design agent receives the same CSS the register renders.
//
// Not minified on purpose: the conventions header tells the design agent to read this file
// for the real class vocabulary, and a minified sheet cannot be read.
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(root, "dist"), { recursive: true });

const res = await build({
  entryPoints: [join(root, "styles.css")],
  bundle: true,
  minify: false,
  write: false,
  logLevel: "info",
});

const css = res.outputFiles[0].text;
const out = join(root, "dist", "styles.css");
writeFileSync(out, css);

// A guard, because the failure this step fixes was silent: a stylesheet that lost the
// register's rules still "builds", it just renders nothing.
const marks = ["kpi-card", "sev-badge", "stat-row", "data", "sheet-row"];
const missing = marks.filter((m) => !css.includes(m));
if (missing.length) {
  throw new Error(
    "styles bundle is missing register rules (" + missing.join(", ") + ") — " +
    "the @import closure did not resolve",
  );
}
console.log(`css bundled: ${(css.length / 1024).toFixed(1)} KB, all ${marks.length} markers present`);
