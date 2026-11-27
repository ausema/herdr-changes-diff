import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLocation } from "../location.js";

const SPACE = { id: "sp1", folder: "/repo", machine: null };

test("resolveLocation usa la carpeta del terminal enfocado", () => {
  const location = resolveLocation({ space: SPACE, focused: { pane: "p1" }, pane: { pane: "p1", cwd: "/repo/sub" }, previousBySpace: new Map() });

  assert.deepEqual(location, { space: "sp1", cwd: "/repo/sub", on: null });
});

test("resolveLocation conserva la ubicación previa de la misma space si el foco está en un panel de mod", () => {
  const previous = { space: "sp1", cwd: "/repo/sub", on: null };

  const location = resolveLocation({ space: SPACE, focused: { pane: "p2" }, pane: { pane: "p2", mod: "diff", cwd: null }, previousBySpace: new Map([["sp1", previous]]) });

  assert.equal(location, previous);
});

test("resolveLocation ignora la ubicación previa de otra space y usa la carpeta de la space", () => {
  const previous = { space: "sp0", cwd: "/otro-repo", on: null };

  const location = resolveLocation({ space: SPACE, focused: { pane: "p2" }, pane: { pane: "p2", mod: "diff", cwd: null }, previousBySpace: new Map([["sp0", previous]]) });

  assert.deepEqual(location, { space: "sp1", cwd: "/repo", on: null });
});

test("resolveLocation toma la máquina del terminal de un bloque remoto", () => {
  const location = resolveLocation({ space: SPACE, focused: { pane: null, terminal: "vps/t7", cwd: "/srv" }, pane: null, previousBySpace: new Map() });

  assert.deepEqual(location, { space: "sp1", cwd: "/srv", on: "vps" });
});

test("resolveLocation recupera la ubicación de la space al volver a ella con el foco en un panel de mod", () => {
  const inApi = { space: "sp1", cwd: "/repo/api", on: null };
  const previousBySpace = new Map([["sp1", inApi], ["sp0", { space: "sp0", cwd: "/otro-repo", on: null }]]);

  const location = resolveLocation({ space: SPACE, focused: { pane: "p2" }, pane: { pane: "p2", mod: "diff", cwd: null }, previousBySpace });

  assert.equal(location, inApi);
});
