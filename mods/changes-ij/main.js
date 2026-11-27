import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, run, setShared } from "herdr";
import { resolveLocation } from "./location.js";
import { MAX_COMMITS, logArgs, parseLog, commitFilesArgs, parseCommitFiles, rowKey } from "./commits.js";

const DIFF_MOD = "diff-ij";
const DIFF_TAB_NAME = "Diff";
const DIFF_TARGET_KEY = "diff-ij.target";
const MAX_FILES = 1000;
const REFRESH_EVERY_MS = 10000;
const ROW_HEIGHT = 28;
const LOCAL_GROUP = "local";
const COMMIT_FILES_INDENT = 14;
const NO_COMMITS = { commits: [], limited: false };

function location(previous) {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return resolveLocation({ space, focused: f, pane, previous });
}
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

function openDiffTab() {
  const tab = spaces().find((s) => s.active)?.tabs.find((t) => t.name === DIFF_TAB_NAME);
  if (tab) {
    run("tab.select", { id: tab.id });
  } else {
    run("tab.new", { name: DIFF_TAB_NAME, mod: DIFF_MOD, focus: true });
  }
}

async function hasUpstream(git) {
  const result = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  return result.code === 0;
}

// A commit never changes, so its files are read once per sha and reused on every refresh.
async function loadUnpushed(git, cachedFilesBySha) {
  const log = await git(logArgs(await hasUpstream(git)));
  if (log.code !== 0) {
    return { ...NO_COMMITS, filesBySha: new Map() };
  }
  const { commits, limited } = parseLog(log.stdout);
  const filesBySha = new Map();
  for (const { sha } of commits) {
    if (cachedFilesBySha.has(sha)) {
      filesBySha.set(sha, cachedFilesBySha.get(sha));
      continue;
    }
    const show = await git(commitFilesArgs(sha));
    if (show.code !== 0) {
      throw new Error(show.stderr);
    }
    filesBySha.set(sha, parseCommitFiles(show.stdout));
  }
  return { commits, limited, filesBySha };
}

function sumChanges(files) {
  return { add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) };
}

function statusColor(status, t) {
  if (status === "A") {
    return t.ansi2;
  }
  if (status === "D" || status === "U") {
    return t.ansi1;
  }
  return t.foreground;
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.message = ""; this.handle = cx.focus_handle();
    this.resetCommits();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(REFRESH_EVERY_MS, (cx) => this.refresh(cx));
  }

  resetCommits() {
    this.commits = []; this.commitsLimited = false; this.commitFiles = new Map();
    this.collapsed = new Set(); this.seen = new Set();
  }

  // New commits arrive folded; a group the user opened or closed keeps that state across refreshes.
  foldNewCommits(commits) {
    for (const { sha } of commits) {
      if (!this.seen.has(sha)) {
        this.seen.add(sha);
        this.collapsed.add(sha);
      }
    }
  }

  toggle(group, cx) {
    if (this.collapsed.has(group)) {
      this.collapsed.delete(group);
    } else {
      this.collapsed.add(group);
    }
    cx.notify();
  }

  openKeys() {
    const keys = this.files.map((f) => rowKey(null, f.path));
    for (const { sha } of this.commits) {
      keys.push(...(this.commitFiles.get(sha) ?? []).map((f) => rowKey(sha, f.path)));
    }
    return new Set(keys);
  }

  where() {
    this.place = location(this.place);
    return this.place;
  }

  key() { return JSON.stringify(this.where()); }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  // One visit to a folder: results from an earlier visit to the same folder are stale too.
  current(context) {
    return this.context === context && this.key() === context.key;
  }

  refresh(cx) {
    const { cwd, on } = this.where(), next = this.key();
    if (next !== this.context?.key) {
      this.context = { key: next }; this.root = null; this.files = []; this.open = null;
      this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.limited = false;
      this.loading = false; this.resetCommits();
    }
    // A load left behind in another folder (a slow git, a read that never ends) must not hold this one.
    if (!cwd || this.loading || this.busy) return;
    const context = this.context;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (!this.current(context)) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.open = null; this.resetCommits(); this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, MAX_FILES)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        const unpushed = head.code === 0 ? await loadUnpushed(git, this.commitFiles) : { ...NO_COMMITS, filesBySha: new Map() };
        if (!this.current(context)) return;
        this.root = root; this.on = on; this.files = files; this.limited = entries.length > MAX_FILES; this.error = null;
        this.commits = unpushed.commits; this.commitsLimited = unpushed.limited; this.commitFiles = unpushed.filesBySha;
        this.foldNewCommits(unpushed.commits);
        this.watch(root, cx);
        if (this.open && !this.openKeys().has(this.open)) { this.open = null; }
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  pick(file, commit, cx) {
    this.open = rowKey(commit?.sha ?? null, file.path);
    const target = commit ? { sha: commit.sha, short: commit.short } : null;
    // requested makes a second pick of the same file a new target, so the Diff tab reloads it.
    setShared(DIFF_TARGET_KEY, { root: this.root, path: file.path, on: this.on ?? null, commit: target, requested: Date.now() });
    openDiffTab();
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context?.key !== this.key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (this.current(context)) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (this.current(context)) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  fileRow(f, t, commit) {
    const parts = f.path.split("/"), name = parts.pop(), key = rowKey(commit?.sha ?? null, f.path);
    return h_flex().id(`change-${key}`).h(ROW_HEIGHT).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(Boolean(commit), (e) => e.ml(COMMIT_FILES_INDENT)).when(this.open === key, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f, commit, cx))
      .child(div().w(14).flex_none().text_size(11).text_color(statusColor(f.status, t)).child(f.status))
      .child(h_flex().flex_1().min_w(0).gap(6)
        .child(div().flex_none().max_w(260).truncate().text_color(statusColor(f.status, t)).child(name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(parts.join("/"))))
      .when(f.add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
  }

  groupHeader(group, t, { short, title, add, del }) {
    const arrow = this.collapsed.has(group) ? "▸" : "▾";
    return h_flex().id(`group-${group}`).h(ROW_HEIGHT).flex_none().px(8).gap(6).items_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.toggle(group, cx))
      .child(div().w(14).flex_none().text_size(11).text_color(t.muted).child(arrow))
      .when(Boolean(short), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(short)))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(title))
      .when(add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${add}`)))
      .when(del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${del}`)));
  }

  localSection(t) {
    const header = this.groupHeader(LOCAL_GROUP, t, { title: `Local changes (${this.files.length})`, ...sumChanges(this.files) });
    if (this.collapsed.has(LOCAL_GROUP)) {
      return [header];
    }
    const empty = div().p(8).text_color(t.dim).child("No uncommitted changes");
    return [header, ...(this.files.length ? this.files.map((f) => this.fileRow(f, t)) : [empty])];
  }

  commitSection(commit, t) {
    const files = this.commitFiles.get(commit.sha) ?? [];
    const header = this.groupHeader(commit.sha, t, { short: commit.short, title: commit.subject, ...sumChanges(files) });
    if (this.collapsed.has(commit.sha)) {
      return [header];
    }
    return [header, ...files.map((f) => this.fileRow(f, t, commit))];
  }

  listRows(t) {
    if (!this.root) {
      return [div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : "No folder"))];
    }
    const rows = [...this.localSection(t), ...this.commits.flatMap((c) => this.commitSection(c, t))];
    if (this.error) {
      rows.unshift(div().p(8).text_color(t.ansi1).child(this.error));
    }
    if (this.commitsLimited) {
      rows.push(div().px(8).py(4).text_size(11).text_color(t.dim).child(`Showing the last ${MAX_COMMITS} unpushed commits`));
    }
    return rows;
  }

  render(cx) {
    if (this.key() !== this.context?.key) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).relative()
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.listRows(t)))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit")));
  }
}
