// The stamp's load-bearing property is not what it hashes but what it DOESN'T.
//
// __BUILD_COMMIT__ was removed because dist/ is tracked here: a SHA baked into a committed
// artifact can only ever name its own parent, so `npm run check` after any commit left
// dist/ dirty by one line with no sequence of commits that could settle it. The fix was to
// stamp only a hash of src/, because src/ does not contain dist/ — the input does not
// depend on the output.
//
// That is a property, not an implementation detail, so it is pinned here rather than left
// to a comment. These tests build synthetic trees under the OS temp dir and touch nothing
// in the repo.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStamp, sourceStamp } from "../buildStamp.mjs";

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stamp-test-"));
  mkdirSync(join(root, "src/client"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "src/client/b.js"), "export const b = 2;\n");
  writeFileSync(join(root, "dist/server.js"), "// generated\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("sourceStamp", () => {
  it("is deterministic for an unchanged tree", () => {
    expect(sourceStamp(root)).toBe(sourceStamp(root));
  });

  it("ignores dist/ entirely — the property that stops the churn", () => {
    const before = sourceStamp(root);
    writeFileSync(join(root, "dist/server.js"), "// a completely different build\n");
    writeFileSync(join(root, "dist/js_app.html"), "<script>1</script>\n");
    expect(sourceStamp(root)).toBe(before);
  });

  it("ignores anything outside src/, so committing cannot move it", () => {
    const before = sourceStamp(root);
    // The two things that change on every commit but must not restamp the build.
    writeFileSync(join(root, "README.md"), "# docs\n");
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(join(root, "test/x.test.ts"), "it('x', () => {});\n");
    expect(sourceStamp(root)).toBe(before);
  });

  it("still moves for any real source change", () => {
    const before = sourceStamp(root);
    writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
    expect(sourceStamp(root)).not.toBe(before);
  });

  it("notices a new source file, not just edited bytes", () => {
    const before = sourceStamp(root);
    writeFileSync(join(root, "src/c.ts"), "export const c = 3;\n");
    expect(sourceStamp(root)).not.toBe(before);
  });

  it("hashes only bundled file types", () => {
    const before = sourceStamp(root);
    writeFileSync(join(root, "src/notes.md"), "not bundled\n");
    expect(sourceStamp(root)).toBe(before);
  });
});

describe("buildStamp", () => {
  it("defines exactly one identifier", () => {
    // A second define would have to name a commit, which is the fixpoint that did not
    // exist. Pinning the key set makes reintroducing one a test failure, not a surprise.
    const { id, define } = buildStamp(root);
    expect(Object.keys(define)).toEqual(["__BUILD_ID__"]);
    expect(define.__BUILD_ID__).toBe(JSON.stringify(id));
  });

  it("agrees with sourceStamp", () => {
    expect(buildStamp(root).id).toBe(sourceStamp(root));
  });
});
