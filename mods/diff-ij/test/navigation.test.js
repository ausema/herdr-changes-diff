import { test } from "node:test";
import assert from "node:assert/strict";
import { changeBlocks, blockEnd, anchorRow, nextBlock, previousBlock } from "../navigation.js";

const row = (kind) => ({ kind });

test("changeBlocks agrupa filas cambiadas seguidas en un bloque", () => {
  const rows = [row("same"), row("added"), row("changed"), row("same"), row("removed")];

  assert.deepEqual(changeBlocks(rows), [1, 4]);
});

test("changeBlocks separa bloques por una fila hunk", () => {
  assert.deepEqual(changeBlocks([row("added"), row("hunk"), row("removed")]), [0, 2]);
});

test("changeBlocks sin cambios devuelve lista vacía", () => {
  assert.deepEqual(changeBlocks([row("same"), row("hunk")]), []);
});

test("nextBlock va al primer bloque por debajo del ancla", () => {
  assert.equal(nextBlock([2, 10, 30], 10), 2);
});

test("nextBlock vuelve al primero tras el último", () => {
  assert.equal(nextBlock([2, 10, 30], 30), 0);
});

test("previousBlock va al último bloque por encima del ancla", () => {
  assert.equal(previousBlock([2, 10, 30], 10), 0);
});

test("previousBlock vuelve al último antes del primero", () => {
  assert.equal(previousBlock([2, 10, 30], 2), 2);
});

test("nextBlock y previousBlock sin bloques devuelven null", () => {
  assert.equal(nextBlock([], 0), null);
  assert.equal(previousBlock([], 0), null);
});

test("anchorRow ancla en el bloque actual si sigue en pantalla", () => {
  assert.equal(anchorRow([2, 10, 30], 0, { first: 0, center: 20, last: 40 }), 2);
});

test("anchorRow usa el centro si el bloque actual ya no se ve", () => {
  assert.equal(anchorRow([2, 10, 30], 0, { first: 50, center: 70, last: 90 }), 70);
});

test("anchorRow usa el centro si no se ha saltado aún", () => {
  assert.equal(anchorRow([2, 10, 30], null, { first: 0, center: 20, last: 40 }), 20);
});

test("blockEnd devuelve la fila siguiente a la última del bloque", () => {
  const rows = [row("same"), row("changed"), row("added"), row("same"), row("removed")];

  assert.equal(blockEnd(rows, 1), 3);
});

test("blockEnd llega al final si el bloque cierra el fichero", () => {
  assert.equal(blockEnd([row("same"), row("removed"), row("removed")], 1), 3);
});
