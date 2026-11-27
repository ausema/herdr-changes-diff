import { test } from "node:test";
import assert from "node:assert/strict";
import { sideBySideRows, changedSpan, limitRows } from "../side-by-side.js";

test("limitRows corta y avisa cuando hay más filas que el máximo", () => {
  assert.deepEqual(limitRows([1, 2, 3], 2), { rows: [1, 2], truncated: true });
});

test("limitRows no avisa si caben todas", () => {
  assert.deepEqual(limitRows([1, 2], 2), { rows: [1, 2], truncated: false });
});

test("sideBySideRows empareja contexto en ambos lados", () => {
  const rows = sideBySideRows(["@@ -1,2 +1,2 @@", " a", " b"]);

  assert.deepEqual(rows, [
    { kind: "same", left: { number: 1, text: "a" }, right: { number: 1, text: "a" } },
    { kind: "same", left: { number: 2, text: "b" }, right: { number: 2, text: "b" } },
  ]);
});

test("sideBySideRows empareja un bloque - seguido de + fila a fila", () => {
  const rows = sideBySideRows(["@@ -1,3 +1,3 @@", " x", "-old1", "-old2", "+new1", " y"]);

  assert.deepEqual(rows, [
    { kind: "same", left: { number: 1, text: "x" }, right: { number: 1, text: "x" } },
    { kind: "changed", left: { number: 2, text: "old1" }, right: { number: 2, text: "new1" } },
    { kind: "removed", left: { number: 3, text: "old2" }, right: null },
    { kind: "same", left: { number: 4, text: "y" }, right: { number: 3, text: "y" } },
  ]);
});

test("sideBySideRows trata + sin - previo como added", () => {
  const rows = sideBySideRows(["@@ -0,0 +1,2 @@", "+a", "+b"]);

  assert.deepEqual(rows, [
    { kind: "added", left: null, right: { number: 1, text: "a" } },
    { kind: "added", left: null, right: { number: 2, text: "b" } },
  ]);
});

test("sideBySideRows ignora la marca de fin de fichero sin salto de línea", () => {
  const rows = sideBySideRows(["@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file"]);

  assert.deepEqual(rows, [
    { kind: "changed", left: { number: 1, text: "a" }, right: { number: 1, text: "b" } },
  ]);
});

test("sideBySideRows separa con una fila hunk los bloques no contiguos", () => {
  const rows = sideBySideRows(["@@ -1 +1 @@", " a", "@@ -9 +9 @@", " z"]);

  assert.deepEqual(rows, [
    { kind: "same", left: { number: 1, text: "a" }, right: { number: 1, text: "a" } },
    { kind: "hunk", left: null, right: null },
    { kind: "same", left: { number: 9, text: "z" }, right: { number: 9, text: "z" } },
  ]);
});

test("changedSpan marca solo el valor cambiado", () => {
  assert.deepEqual(changedSpan("  failureThreshold: 30", "  failureThreshold: 49"), { left: [20, 22], right: [20, 22] });
});

test("changedSpan con textos iguales devuelve tramos vacíos", () => {
  assert.deepEqual(changedSpan("a", "a"), { left: [1, 1], right: [1, 1] });
});

test("changedSpan no solapa prefijo y sufijo comunes", () => {
  assert.deepEqual(changedSpan("aa", "aaa"), { left: [2, 2], right: [2, 3] });
});
