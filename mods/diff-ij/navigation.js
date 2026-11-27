const CHANGE_KINDS = new Set(["added", "removed", "changed"]);

const isChange = (row) => CHANGE_KINDS.has(row.kind);

export function changeBlocks(rows) {
  return rows.flatMap((row, index) => (isChange(row) && (index === 0 || !isChange(rows[index - 1])) ? [index] : []));
}

export function blockEnd(rows, start) {
  const end = rows.findIndex((row, index) => index > start && !isChange(row));
  return end === -1 ? rows.length : end;
}

// A jumped-to block that is still on screen anchors the next jump: blocks near the top cannot be centered.
export function anchorRow(blocks, current, visible) {
  if (current === null) {
    return visible.center;
  }
  const start = blocks[current];
  return start >= visible.first && start <= visible.last ? start : visible.center;
}

export function nextBlock(blocks, anchor) {
  if (!blocks.length) {
    return null;
  }
  const index = blocks.findIndex((start) => start > anchor);
  return index === -1 ? 0 : index;
}

export function previousBlock(blocks, anchor) {
  if (!blocks.length) {
    return null;
  }
  const index = blocks.findLastIndex((start) => start < anchor);
  return index === -1 ? blocks.length - 1 : index;
}
