// Rows have one fixed height, so a long line can't wrap: both sides scroll sideways together instead.
// The offset is in columns, not pixels: each line is cut at the first visible column, so where it
// starts on screen doesn't depend on how wide the font really draws a character. Fractions
// accumulate small trackpad moves; the cut uses the whole part.

// Columns kept to the left of a change brought into view, so it doesn't sit on the edge.
const REVEAL_MARGIN_COLUMNS = 4;

export function longestLine(rows) {
  return Math.max(0, ...rows.flatMap((row) => [row.left?.text.length ?? 0, row.right?.text.length ?? 0]));
}

// Where a row's change starts: the differing part of a changed line, or the whole line.
export function changeColumn(row) {
  return row.span ? Math.min(row.span.left[0], row.span.right[0]) : 0;
}

export function clampScroll(offset, { columns, visibleColumns }) {
  return Math.min(Math.max(0, offset), Math.max(0, columns - visibleColumns));
}

// A sideways trackpad swipe, or Shift with a mouse wheel; null for a vertical gesture, which the list scrolls.
export function wheelScroll(offset, { delta, modifiers }, view) {
  const sideways = modifiers?.shift ? delta.x || delta.y : Math.abs(delta.x) > Math.abs(delta.y) ? delta.x : 0;
  if (!sideways) {
    return null;
  }
  return clampScroll(offset - sideways / view.charWidth, view);
}

export function revealScroll(offset, column, view) {
  if (column >= offset && column < offset + view.visibleColumns - REVEAL_MARGIN_COLUMNS) {
    return offset;
  }
  return clampScroll(column - REVEAL_MARGIN_COLUMNS, view);
}

export function visibleSlice(text, span, offset) {
  const first = Math.floor(offset);
  const shifted = span ? [Math.max(0, span[0] - first), Math.max(0, span[1] - first)] : null;
  return { text: text.slice(first), span: shifted };
}
