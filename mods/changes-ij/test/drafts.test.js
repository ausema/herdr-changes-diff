import { test } from "node:test";
import assert from "node:assert/strict";
import { CommitDrafts } from "../drafts.js";

test("CommitDrafts devuelve el mensaje guardado para un repo", () => {
  const drafts = new CommitDrafts();

  drafts.keep(null, "/w/api", "feat: x\n\n- body");

  assert.equal(drafts.get(null, "/w/api"), "feat: x\n\n- body");
});

test("CommitDrafts devuelve vacío para un repo sin borrador", () => {
  assert.equal(new CommitDrafts().get(null, "/w/api"), "");
});

test("CommitDrafts separa los borradores de cada repo", () => {
  const drafts = new CommitDrafts();

  drafts.keep(null, "/w/api", "feat: api");
  drafts.keep(null, "/w/web", "feat: web");

  assert.equal(drafts.get(null, "/w/api"), "feat: api");
  assert.equal(drafts.get(null, "/w/web"), "feat: web");
});

test("CommitDrafts distingue la misma ruta en otra máquina", () => {
  const drafts = new CommitDrafts();

  drafts.keep("vps", "/w/api", "feat: remote");

  assert.equal(drafts.get(null, "/w/api"), "");
  assert.equal(drafts.get("vps", "/w/api"), "feat: remote");
});

test("CommitDrafts olvida un borrador vaciado", () => {
  const drafts = new CommitDrafts();
  drafts.keep(null, "/w/api", "feat: x");

  drafts.keep(null, "/w/api", "");

  assert.equal(drafts.get(null, "/w/api"), "");
  assert.equal(drafts.size, 0);
});

test("CommitDrafts drop borra el borrador tras commitear", () => {
  const drafts = new CommitDrafts();
  drafts.keep(null, "/w/api", "feat: x");

  drafts.drop(null, "/w/api");

  assert.equal(drafts.get(null, "/w/api"), "");
});
