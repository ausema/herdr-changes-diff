import { test } from "node:test";
import assert from "node:assert/strict";
import { findReposArgs, repoRoots, repoName, parseStatus, isQuiet, groupKey, mapWithLimit } from "../repos.js";

const status = (...entries) => entries.map((e) => `${e}\0`).join("");

test("findReposArgs busca .git solo un nivel por debajo de la carpeta", () => {
  assert.deepEqual(findReposArgs("/w"), ["/w", "-mindepth", "2", "-maxdepth", "2", "-name", ".git"]);
});

test("repoRoots devuelve la carpeta de cada .git, ordenadas", () => {
  assert.deepEqual(repoRoots("/w/repo-b/.git\n/w/repo-a/.git\n"), ["/w/repo-a", "/w/repo-b"]);
});

test("repoRoots sin resultados devuelve una lista vacía", () => {
  assert.deepEqual(repoRoots(""), []);
});

test("repoName es el último tramo de la ruta", () => {
  assert.equal(repoName("/w/repo-a"), "repo-a");
});

test("parseStatus separa la cabecera de rama de los ficheros", () => {
  const parsed = parseStatus(status("## main...origin/main", " M src/a.js", "?? b.txt"));

  assert.deepEqual(parsed, {
    branch: { name: "main", upstream: "origin/main", ahead: 0, gone: false },
    entries: [" M src/a.js", "?? b.txt"],
  });
});

test("parseStatus lee los commits por delante del upstream", () => {
  assert.equal(parseStatus(status("## main...origin/main [ahead 2, behind 1]")).branch.ahead, 2);
});

test("parseStatus marca el upstream borrado", () => {
  assert.equal(parseStatus(status("## feat...origin/feat [gone]")).branch.gone, true);
});

test("parseStatus en una rama sin upstream", () => {
  assert.deepEqual(parseStatus(status("## main")).branch, { name: "main", upstream: null, ahead: 0, gone: false });
});

test("parseStatus en un repo sin commits", () => {
  assert.equal(parseStatus(status("## No commits yet on main")).branch.name, "main");
});

test("parseStatus con HEAD suelto", () => {
  assert.deepEqual(parseStatus(status("## HEAD (no branch)")).branch, { name: "HEAD (no branch)", upstream: null, ahead: 0, gone: false });
});

test("isQuiet en un repo limpio y al día con su upstream", () => {
  assert.equal(isQuiet(parseStatus(status("## main...origin/main [behind 3]"))), true);
});

test("isQuiet es falso con ficheros cambiados", () => {
  assert.equal(isQuiet(parseStatus(status("## main...origin/main", "?? b.txt"))), false);
});

test("isQuiet es falso con commits sin subir", () => {
  assert.equal(isQuiet(parseStatus(status("## main...origin/main [ahead 1]"))), false);
});

test("isQuiet es falso sin upstream o con el upstream borrado", () => {
  assert.equal(isQuiet(parseStatus(status("## main"))), false);
  assert.equal(isQuiet(parseStatus(status("## feat...origin/feat [gone]"))), false);
});

test("groupKey distingue el mismo grupo en dos repos", () => {
  assert.notEqual(groupKey("/w/a", "local"), groupKey("/w/b", "local"));
});

test("mapWithLimit conserva el orden y no pasa del límite a la vez", async () => {
  let running = 0, peak = 0;
  const slow = async (n) => {
    running++; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5 - n));
    running--;
    return n * 10;
  };

  const results = await mapWithLimit([1, 2, 3, 4], 2, slow);

  assert.deepEqual(results, [10, 20, 30, 40]);
  assert.equal(peak, 2);
});
