import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { shared, exec, readTextFile, watchFolder, theme, settings, nextCommand } from "herdr";
import { sideBySideRows, changedSpan, untab, limitRows } from "./side-by-side.js";
import { diffSource, touchesFile, commitDiffArgs, unifiedFrom, sideLabels } from "./source.js";
import { changeBlocks, blockEnd, anchorRow, nextBlock, previousBlock } from "./navigation.js";

const TARGET_KEY = "diff-ij.target";
// Reads write nothing under .git, so the folder watch does not trigger itself.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const FULL_CONTEXT_LINES = 1000000;
const MAX_ROWS = 5000;
const MAX_LINE_COLUMNS = 4000;
const MAX_UNTRACKED_CHARS = 400000;
const HEADER_HEIGHT = 42;
const LABELS_HEIGHT = 26;
const MIN_GUTTER_DIGITS = 3;
const ADDED_ALPHA = { line: "2e", span: "66" };
const REMOVED_ALPHA = { line: "3d", span: "80" };
const DEFAULT_FONT = "JetBrains Mono";
const NEXT_CHANGE_KEY = "f7";
const PREVIOUS_CHANGE_KEY = "shift-f7";
const FOCUS_COMMAND = "focus";
const CURRENT_CHANGE_BAR_WIDTH = 3;

const rowHeight = (size) => Math.ceil(size * 1.8);
const charWidth = (size) => size * 0.64;

function fitLine(text) {
  const flat = untab(text);
  return flat.length > MAX_LINE_COLUMNS ? `${flat.slice(0, MAX_LINE_COLUMNS)}… (line truncated)` : flat;
}

function fitSide(side) {
  return side ? { number: side.number, text: fitLine(side.text) } : null;
}

function countChanges(rows) {
  return {
    add: rows.filter((row) => row.kind === "added" || row.kind === "changed").length,
    del: rows.filter((row) => row.kind === "removed" || row.kind === "changed").length,
  };
}

function viewRows(unifiedLines) {
  const all = sideBySideRows(unifiedLines);
  const { rows, truncated } = limitRows(all, MAX_ROWS);
  const shown = rows.map((row) => {
    const left = fitSide(row.left), right = fitSide(row.right);
    const span = row.kind === "changed" ? changedSpan(left.text, right.text) : null;
    return { kind: row.kind, left, right, span };
  });
  return { rows: shown, truncated, ...countChanges(all) };
}

function diskAsUnified(text) {
  const lines = text.slice(0, MAX_UNTRACKED_CHARS).replace(/\n$/, "").split("\n");
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)];
}

async function readFromDisk({ root, path, on }) {
  const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
  if (text === null) {
    return { notice: "Cannot preview this file (binary, too large, or unreadable)" };
  }
  if (text.includes("\0")) {
    return { notice: "Binary file · no text diff" };
  }
  if (!text) {
    return { notice: "Empty file" };
  }
  return { lines: diskAsUnified(text) };
}

async function readUnified(git, args) {
  const result = await git(args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim());
  }
  return unifiedFrom(result.stdout);
}

function readAgainstHead(git, path) {
  return readUnified(git, ["diff", "HEAD", `-U${FULL_CONTEXT_LINES}`, "--no-ext-diff", "--no-textconv", "--no-color", "--", path]);
}

// Asks git on every load: the file may have been committed or untracked since it was picked.
async function readDiff(target) {
  const git = (args) => exec("git", [...READ, ...args], { cwd: target.root, on: target.on });
  if (target.commit) {
    return { source: "commit", ...(await readUnified(git, commitDiffArgs(target.commit.sha, target.path, FULL_CONTEXT_LINES))) };
  }
  const head = await git(["rev-parse", "--verify", "HEAD"]);
  const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", target.path]);
  if (status.code !== 0) {
    throw new Error(status.stderr.trim());
  }
  const source = diffSource(status.stdout, head.code === 0);
  const read = source === "disk" ? readFromDisk(target) : readAgainstHead(git, target.path);
  return { source, ...(await read) };
}

export default class Diff extends View {
  init(_props, cx) {
    this.key = null;
    this.rows = [];
    this.notice = null;
    this.loading = false;
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.blocks = [];
    this.current = null;
    this.takeFocusOnCommand(cx);
  }

  takeFocusOnCommand(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === FOCUS_COMMAND) {
          this.handle.focus();
          cx.notify();
        }
      }
    });
  }

  show(target, key, cx) {
    this.key = key;
    this.target = target;
    this.rows = [];
    this.changes = { add: 0, del: 0 };
    this.truncated = false;
    this.source = null;
    this.blocks = [];
    this.current = null;
    this.jumpToFirstPending = true;
    this.notice = target ? null : "Select a file in Changes";
    this.watch?.cancel();
    this.watch = null;
    if (!target) {
      return;
    }
    this.reload(cx);
    if (!target.commit) {
      this.watchLocal(target, key, cx);
    }
  }

  reload(cx) {
    const key = this.key, target = this.target;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const { source, lines, notice } = await readDiff(target);
        if (this.key !== key) {
          return;
        }
        const view = lines ? viewRows(lines) : { rows: [], truncated: false, add: 0, del: 0 };
        this.rows = view.rows;
        this.truncated = view.truncated;
        this.changes = { add: view.add, del: view.del };
        this.source = source;
        this.notice = notice ?? null;
        this.locateChanges();
      } catch (e) {
        if (this.key === key) {
          this.rows = [];
          this.blocks = [];
          this.current = null;
          this.notice = `Cannot show this diff: ${e.message ?? e}`;
        }
      } finally {
        if (this.key === key) {
          this.loading = false;
        }
        cx.notify();
      }
    });
  }

  locateChanges() {
    this.blocks = changeBlocks(this.rows);
    if (this.current !== null && this.current >= this.blocks.length) {
      this.current = null;
    }
    if (!this.jumpToFirstPending) {
      return;
    }
    this.jumpToFirstPending = false;
    if (this.blocks.length) {
      this.jumpTo(0);
    } else if (this.rows.length) {
      this.scroll.scroll_to_item(0);
    }
  }

  jumpTo(index) {
    this.current = index;
    this.scroll.scroll_to_item(this.blocks[index], "center");
  }

  visibleRows() {
    const height = rowHeight(settings().font_size), top = this.scroll.offset().y, viewport = this.scroll.viewport_size().height;
    return {
      first: Math.floor(top / height),
      center: Math.floor((top + viewport / 2) / height),
      last: Math.floor((top + viewport) / height),
    };
  }

  goToNextChange(cx) {
    this.goToChange(nextBlock, cx);
  }

  goToPreviousChange(cx) {
    this.goToChange(previousBlock, cx);
  }

  goToChange(pickBlock, cx) {
    const index = pickBlock(this.blocks, anchorRow(this.blocks, this.current, this.visibleRows()));
    if (index === null) {
      return;
    }
    this.jumpTo(index);
    cx.notify();
  }

  // Remote folders cannot be watched; picking the file again reloads it.
  watchLocal(target, key, cx) {
    if (target.on) {
      return;
    }
    cx.spawn(async (cx) => {
      while (this.key === key) {
        this.watch = watchFolder(target.root);
        let changed;
        try {
          changed = await this.watch;
        } catch {
          return;
        }
        if (this.key === key && touchesFile(changed, target.root, target.path)) {
          this.reload(cx);
        }
      }
    });
  }

  gutter(size) {
    const digits = Math.max(MIN_GUTTER_DIGITS, String(Math.max(0, ...this.rows.map((row) => row.right?.number ?? row.left?.number ?? 0))).length);
    return Math.ceil(digits * charWidth(size)) + 12;
  }

  half(side, span, tint) {
    const el = h_flex().flex_1().min_w(0).h_full().px(10).overflow_hidden().whitespace_nowrap().when(Boolean(tint), (e) => e.bg(tint.color + tint.alpha.line));
    if (!side) {
      return el;
    }
    if (!span || span[0] === span[1]) {
      return el.child(div().flex_none().child(side.text || " "));
    }
    const [start, end] = span;
    return el
      .child(div().flex_none().child(side.text.slice(0, start)))
      .child(div().flex_none().rounded(2).bg(tint.color + tint.alpha.span).child(side.text.slice(start, end)))
      .child(div().flex_none().child(side.text.slice(end)));
  }

  number(side, width, color) {
    return div().w(width).flex_none().px(6).text_right().text_color(color).child(side ? String(side.number) : "");
  }

  currentBlockRows() {
    if (this.current === null) {
      return { start: 0, end: 0 };
    }
    const start = this.blocks[this.current];
    return { start, end: blockEnd(this.rows, start) };
  }

  row({ kind, left, right, span }, t, size, gutter, highlight) {
    const height = rowHeight(size);
    if (kind === "hunk") {
      return div().w_full().h(height).flex_none().px(12).bg(t.raised).text_color(t.dim).child("⋯");
    }
    const leftTint = kind === "removed" || kind === "changed" ? { color: t.ansi1, alpha: REMOVED_ALPHA } : null;
    const rightTint = kind === "added" || kind === "changed" ? { color: t.ansi2, alpha: ADDED_ALPHA } : null;
    const numbers = highlight ? { bg: t.accent, text: t.accent_foreground } : { bg: t.raised, text: t.dim };
    return h_flex().w_full().h(height).flex_none().items_center()
      .when(highlight, (e) => e.border_l(CURRENT_CHANGE_BAR_WIDTH).border_color(t.accent))
      .child(this.half(left, span?.left, leftTint))
      .child(h_flex().flex_none().h_full().items_center().bg(numbers.bg)
        .child(this.number(left, gutter, numbers.text))
        .child(this.number(right, gutter, numbers.text)))
      .child(this.half(right, span?.right, rightTint));
  }

  header(t) {
    const parts = (this.target?.path ?? "").split("/"), name = parts.pop() ?? "";
    const { add, del } = this.changes ?? { add: 0, del: 0 };
    return h_flex().h(HEADER_HEIGHT).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child(name || "Diff"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(parts.join("/")))
      .when(Boolean(this.target?.commit), (e) => e.child(div().flex_none().text_size(11).text_color(t.muted).child(this.target.commit.short)))
      .when(this.truncated, (e) => e.child(div().text_size(11).text_color(t.blocked).child(`Showing the first ${MAX_ROWS.toLocaleString("en")} lines`)))
      .when(add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)))
      .when(del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .children(this.navigation(t));
  }

  navigation(t) {
    const total = this.blocks.length, enabled = total > 0;
    const button = (id, label, go) => div().id(id).px(6).rounded(4).text_color(enabled ? t.foreground : t.dim)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.raised)).on_click((_e, cx) => go(cx)))
      .child(label);
    const counter = div().text_size(11).text_color(t.muted).child(`${this.current === null ? "–" : this.current + 1}/${total}`);
    return [
      ...(enabled ? [counter] : []),
      button("diff-previous-change", "↑", (cx) => this.goToPreviousChange(cx)),
      button("diff-next-change", "↓", (cx) => this.goToNextChange(cx)),
    ];
  }

  labels(t, gutter) {
    const label = (text) => div().flex_1().px(10).text_size(11).text_color(t.muted).child(text);
    const commit = this.target?.commit;
    const [left, right] = sideLabels(commit ? "commit" : this.source, commit);
    return h_flex().h(LABELS_HEIGHT).flex_none().items_center().border_b(1).border_color(t.border)
      .child(label(left))
      .child(div().w(gutter * 2).flex_none())
      .child(label(right));
  }

  render(cx) {
    const target = shared(TARGET_KEY) ?? null, key = JSON.stringify(target);
    if (key !== this.key) {
      this.show(target, key, cx);
    }
    const t = theme(), size = settings().font_size, gutter = this.gutter(size), current = this.currentBlockRows();
    const isInCurrentBlock = (index) => index >= current.start && index < current.end;
    const message = this.notice ?? (this.loading && !this.rows.length ? "Loading diff…" : null);
    return v_flex().id("diff").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => {
        if (e.keystroke === NEXT_CHANGE_KEY) {
          this.goToNextChange(cx);
          cx.stop_propagation();
        } else if (e.keystroke === PREVIOUS_CHANGE_KEY) {
          this.goToPreviousChange(cx);
          cx.stop_propagation();
        }
      })
      .child(this.header(t))
      .child(this.labels(t, gutter))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? DEFAULT_FONT).text_size(size)
        .child(v_virtual_list("diff-rows", this.rows.length, rowHeight(size), (i) => String(i),
          (range) => this.rows.slice(range.start, range.end).map((row, offset) => this.row(row, t, size, gutter, isInCurrentBlock(range.start + offset)))).track_scroll(this.scroll).size_full())
        .child(Scrollbar.vertical("diff-rows").viewport_from_layout().absolute().inset_0())
        .when(Boolean(message), (e) => e.child(div().absolute().top(8).px(14).text_size(12).text_color(t.dim).child(message))));
  }
}
