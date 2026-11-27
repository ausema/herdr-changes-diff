import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSource, touchesFile, commitDiffArgs, unifiedFrom, sideLabels } from "../source.js";

test("diffSource lee el disco para un fichero sin seguimiento", () => {
  assert.equal(diffSource("?? nuevo.txt\0", true), "disk");
});

test("diffSource lee el disco en un repo sin commits", () => {
  assert.equal(diffSource("A  f.txt\0", false), "disk");
});

test("diffSource compara contra HEAD un fichero con seguimiento", () => {
  assert.equal(diffSource(" M f.txt\0", true), "head");
});

test("diffSource compara contra HEAD un fichero ya commiteado sin cambios", () => {
  assert.equal(diffSource("", true), "head");
});

test("touchesFile reacciona al propio fichero", () => {
  assert.equal(touchesFile(["/repo/a/b.yml"], "/repo", "a/b.yml"), true);
});

test("touchesFile reacciona a un cambio de HEAD o del índice", () => {
  assert.equal(touchesFile(["/repo/.git/HEAD"], "/repo", "a/b.yml"), true);
  assert.equal(touchesFile(["/repo/.git/index"], "/repo", "a/b.yml"), true);
});

test("touchesFile reacciona cuando el watch pide refrescar todo el root", () => {
  assert.equal(touchesFile(["/repo"], "/repo", "a/b.yml"), true);
});

test("touchesFile ignora cambios en otros ficheros", () => {
  assert.equal(touchesFile(["/repo/target/classes/X.class", "/repo/a/c.yml"], "/repo", "a/b.yml"), false);
});

test("commitDiffArgs separa la ruta con --", () => {
  const args = commitDiffArgs("aaa", "dir/a b.js", 1000000);
  assert.deepEqual(args.slice(-3), ["aaa", "--", "dir/a b.js"]);
  assert.ok(args.includes("-U1000000"));
  assert.ok(args.includes("--diff-merges=first-parent"));
});

test("unifiedFrom se salta la cabecera de git", () => {
  const stdout = "diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
  assert.deepEqual(unifiedFrom(stdout), { lines: ["@@ -1 +1 @@", "-a", "+b"] });
});

test("unifiedFrom avisa de binarios", () => {
  assert.deepEqual(unifiedFrom("diff --git a/i b/i\nBinary files a/i and b/i differ\n"), { notice: "Binary file changed" });
});

test("unifiedFrom sin hunks dice que no hay cambios", () => {
  assert.deepEqual(unifiedFrom(""), { notice: "No changes" });
});

test("sideLabels de un commit", () => {
  assert.deepEqual(sideLabels("commit", { short: "86bd3d0" }), ["86bd3d0^", "86bd3d0"]);
});

test("sideLabels de cambios locales", () => {
  assert.deepEqual(sideLabels("head"), ["HEAD", "Current version"]);
  assert.deepEqual(sideLabels("disk"), ["(new file)", "Current version"]);
});
