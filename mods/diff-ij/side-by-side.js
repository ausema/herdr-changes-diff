const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)/;
const NO_NEWLINE_MARKER = "\\";
const TAB_STOP = 4;

export function untab(text) {
  return text.replace(/[^\t]*\t/g, (chunk) => {
    const width = chunk.length - 1;
    return chunk.slice(0, -1).padEnd(width - (width % TAB_STOP) + TAB_STOP);
  });
}

// Pairs each run of "-" lines with the "+" run after it, row by row, as a side-by-side view shows them.
export function sideBySideRows(unifiedLines) {
  const rows = [];
  let removed = [], added = [], oldNumber = 0, newNumber = 0;

  const flush = () => {
    const paired = Math.min(removed.length, added.length);
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const left = removed[i] ?? null, right = added[i] ?? null;
      const kind = i < paired ? "changed" : left ? "removed" : "added";
      rows.push({ kind, left, right });
    }
    removed = [];
    added = [];
  };

  for (const line of unifiedLines) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      flush();
      if (rows.length) {
        rows.push({ kind: "hunk", left: null, right: null });
      }
      oldNumber = Number(header[1]);
      newNumber = Number(header[2]);
      continue;
    }
    if (line.startsWith(NO_NEWLINE_MARKER)) {
      continue;
    }
    const marker = line[0], text = line.slice(1);
    if (marker === "-") {
      removed.push({ number: oldNumber++, text });
    } else if (marker === "+") {
      added.push({ number: newNumber++, text });
    } else if (marker === " ") {
      flush();
      rows.push({ kind: "same", left: { number: oldNumber++, text }, right: { number: newNumber++, text } });
    }
  }
  flush();
  return rows;
}

export function limitRows(rows, max) {
  return { rows: rows.slice(0, max), truncated: rows.length > max };
}

// [start, end) of the part that differs once the common prefix and suffix are removed.
export function changedSpan(oldText, newText) {
  const shorter = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < shorter && oldText[prefix] === newText[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < shorter - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) {
    suffix++;
  }
  return { left: [prefix, oldText.length - suffix], right: [prefix, newText.length - suffix] };
}
