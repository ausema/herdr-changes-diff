import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLocation } from "../location.js";

const SPACE = { id: "sp1", folder: "/repo", machine: null };

test("resolveLocation usa la carpeta del terminal enfocado", () => {
  const location = resolveLocation({ space: SPACE, focused: { pane: "p1" }, pane: { pane: "p1", cwd: "/repo/sub" }, previous: null });

  assert.deepEqual(location, { space: "sp1", cwd: "/repo/sub", on: null });
});

test("resolveLocation conserva la ubicación previa de la misma space si el foco está en un panel de mod", () => {
  const previous = { space: "sp1", cwd: "/repo/sub", on: null };

  const location = resolveLocation({ space: SPACE, focused: { pane: "p2" }, pane: { pane: "p2", mod: "diff", cwd: null }, previous });

  assert.equal(location, previous);
});

test("resolveLocation ignora la ubicación previa de otra space y usa la carpeta de la space", () => {
  const previous = { space: "sp0", cwd: "/otro-repo", on: null };

  const location = resolveLocation({ space: SPACE, focused: { pane: "p2" }, pane: { pane: "p2", mod: "diff", cwd: null }, previous });

  assert.deepEqual(location, { space: "sp1", cwd: "/repo", on: null });
});

test("resolveLocation toma la máquina del terminal de un bloque remoto", () => {
  const location = resolveLocation({ space: SPACE, focused: { pane: null, terminal: "vps/t7", cwd: "/srv" }, pane: null, previous: null });

  assert.deepEqual(location, { space: "sp1", cwd: "/srv", on: "vps" });
});
