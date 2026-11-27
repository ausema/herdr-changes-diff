import { test } from "node:test";
import assert from "node:assert/strict";
import { clampScroll, wheelScroll, revealScroll, longestLine, changeColumn, visibleSlice } from "../horizontal.js";

// 10 px per character and 20 columns on screen per side.
const VIEW = { charWidth: 10, visibleColumns: 20 };

test("clampScroll no baja de 0", () => {
  assert.equal(clampScroll(-3, { ...VIEW, columns: 50 }), 0);
});

test("clampScroll se para cuando el final de la línea más larga llega al borde", () => {
  assert.equal(clampScroll(90, { ...VIEW, columns: 50 }), 30);
});

test("clampScroll es 0 cuando todo cabe", () => {
  assert.equal(clampScroll(4, { ...VIEW, columns: 15 }), 0);
});

test("wheelScroll sigue el gesto lateral del trackpad, en columnas", () => {
  const event = { delta: { x: -40, y: 3 }, modifiers: { shift: false } };

  assert.equal(wheelScroll(10, event, { ...VIEW, columns: 50 }), 14);
});

test("wheelScroll acumula gestos de menos de una columna", () => {
  const event = { delta: { x: -5, y: 0 }, modifiers: { shift: false } };

  assert.equal(wheelScroll(10, event, { ...VIEW, columns: 50 }), 10.5);
});

test("wheelScroll convierte Shift + rueda vertical en horizontal", () => {
  const event = { delta: { x: 0, y: -40 }, modifiers: { shift: true } };

  assert.equal(wheelScroll(10, event, { ...VIEW, columns: 50 }), 14);
});

test("wheelScroll deja quieto el scroll horizontal con un gesto vertical", () => {
  const event = { delta: { x: 2, y: -40 }, modifiers: { shift: false } };

  assert.equal(wheelScroll(10, event, { ...VIEW, columns: 50 }), null);
});

test("revealScroll no se mueve si el cambio ya se ve", () => {
  assert.equal(revealScroll(0, 12, { ...VIEW, columns: 50 }), 0);
});

test("revealScroll deja un cambio lejano a 4 columnas del borde izquierdo", () => {
  assert.equal(revealScroll(0, 40, { ...VIEW, columns: 80 }), 36);
});

test("revealScroll vuelve al principio para un cambio que empieza a la izquierda de la vista", () => {
  assert.equal(revealScroll(36, 2, { ...VIEW, columns: 80 }), 0);
});

test("longestLine mide el texto más largo de cualquiera de los dos lados", () => {
  const rows = [
    { left: { text: "abc" }, right: { text: "abcdef" } },
    { left: null, right: { text: "ab" } },
    { left: null, right: null },
  ];

  assert.equal(longestLine(rows), 6);
});

test("changeColumn es donde empieza la parte cambiada de una línea modificada", () => {
  assert.equal(changeColumn({ kind: "changed", span: { left: [150, 160], right: [150, 170] } }), 150);
});

test("changeColumn es 0 para una línea añadida o borrada entera", () => {
  assert.equal(changeColumn({ kind: "added", span: null }), 0);
});

test("visibleSlice empieza la línea en la primera columna visible y mueve el resaltado con ella", () => {
  assert.deepEqual(visibleSlice("abcdefghij", [6, 8], 4.7), { text: "efghij", span: [2, 4] });
});

test("visibleSlice recorta un resaltado que empieza antes de la vista", () => {
  assert.deepEqual(visibleSlice("abcdefghij", [2, 6], 4), { text: "efghij", span: [0, 2] });
});

test("visibleSlice sin resaltado", () => {
  assert.deepEqual(visibleSlice("abc", null, 0), { text: "abc", span: null });
});
