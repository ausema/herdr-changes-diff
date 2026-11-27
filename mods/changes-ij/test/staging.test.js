import { test } from "node:test";
import assert from "node:assert/strict";
import { includedPaths, checkState, commitCommands, isCommitKey } from "../staging.js";

const FILES = [{ path: "src/a.js" }, { path: "notes.txt" }, { path: "b.js" }];

test("includedPaths deja fuera los ficheros desmarcados", () => {
  assert.deepEqual(includedPaths(FILES, new Set(["notes.txt"])), ["src/a.js", "b.js"]);
});

test("includedPaths ignora desmarcados que ya no están en la lista", () => {
  assert.deepEqual(includedPaths(FILES, new Set(["gone.txt"])), ["src/a.js", "notes.txt", "b.js"]);
});

test("checkState es all cuando no hay ninguno desmarcado", () => {
  assert.equal(checkState(FILES, new Set()), "all");
});

test("checkState es none cuando están todos desmarcados", () => {
  assert.equal(checkState(FILES, new Set(["src/a.js", "notes.txt", "b.js"])), "none");
});

test("checkState es some con una parte desmarcada", () => {
  assert.equal(checkState(FILES, new Set(["b.js"])), "some");
});

test("checkState sin ficheros es none", () => {
  assert.equal(checkState([], new Set()), "none");
});

test("commitCommands añade y commitea solo las rutas marcadas, tomadas literalmente", () => {
  assert.deepEqual(commitCommands("feat: x", ["src/[id].js", "b.js"]), [
    ["--literal-pathspecs", "add", "-A", "--", "src/[id].js", "b.js"],
    ["--literal-pathspecs", "commit", "-m", "feat: x", "--", "src/[id].js", "b.js"],
  ]);
});

test("commitCommands conserva el cuerpo del mensaje", () => {
  const [, commit] = commitCommands("feat: x\n\n- detail", ["b.js"]);

  assert.equal(commit[3], "feat: x\n\n- detail");
});

test("isCommitKey solo con Cmd/Ctrl+Enter", () => {
  assert.equal(isCommitKey({ secondary: true }), true);
  assert.equal(isCommitKey({ secondary: false }), false);
  assert.equal(isCommitKey({ shift: true }), false);
  assert.equal(isCommitKey(undefined), false);
});
