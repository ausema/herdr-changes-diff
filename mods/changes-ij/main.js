import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, run, setShared } from "herdr";
import { resolveLocation } from "./location.js";
import { MAX_COMMITS, logArgs, parseLog, commitFilesArgs, parseCommitFiles, rowKey } from "./commits.js";
import { includedPaths, checkState, commitCommands, isCommitKey } from "./staging.js";
import { findReposArgs, repoRoots, repoName, parseStatus, isQuiet, groupKey, mapWithLimit } from "./repos.js";

const DIFF_MOD = "diff-ij";
const DIFF_TAB_NAME = "Diff";
const DIFF_TARGET_KEY = "diff-ij.target";
const MAX_FILES = 1000;
const REFRESH_EVERY_MS = 10000;
const ROW_HEIGHT = 28;
const LOCAL_GROUP = "local";
const COMMIT_FILES_INDENT = 14;
const REPO_INDENT = 14;
const REPOS_IN_PARALLEL = 4;
const FIND_TIMEOUT_MS = 2000;
const NO_COMMITS = { commits: [], limited: false };
const MESSAGE_ROWS = { min: 1, max: 6 };
const CHECK_GLYPH = { all: "✓", some: "–", none: "" };
const STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--branch", "--no-renames", "--untracked-files=all"];

function location(previousBySpace) {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return resolveLocation({ space, focused: f, pane, previousBySpace });
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

async function loadStats(git, hasHead) {
  const stats = {};
  const results = hasHead ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
  for (const result of results) {
    if (result.code !== 0) throw new Error(result.stderr);
    for (const entry of result.stdout.split("\0")) {
      const [a, d, ...parts] = entry.split("\t");
      if (!parts.length) continue;
      const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
      stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
    }
  }
  return stats;
}

function fileOf(entry, stats) {
  const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
  const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
  const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
  const stat = stats[path] ?? { add: 0, del: 0 };
  return { path, status: s, fresh, ...stat };
}

// With skipQuiet, a clean repo level with its upstream costs one git call and loads as null.
async function loadRepo(root, on, cachedFilesBySha, { skipQuiet = false } = {}) {
  const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
  const status = await git(STATUS_ARGS);
  if (status.code !== 0) throw new Error(status.stderr);
  const parsed = parseStatus(status.stdout);
  if (skipQuiet && isQuiet(parsed)) return null;
  const head = await git(["rev-parse", "--verify", "HEAD"]);
  const stats = await loadStats(git, head.code === 0);
  const files = parsed.entries.slice(0, MAX_FILES).map((entry) => fileOf(entry, stats));
  const unpushed = head.code === 0 ? await loadUnpushed(git, cachedFilesBySha) : { ...NO_COMMITS, filesBySha: new Map() };
  return {
    root, name: repoName(root), branch: parsed.branch.name, files, limited: parsed.entries.length > MAX_FILES,
    commits: unpushed.commits, commitsLimited: unpushed.limited, commitFiles: unpushed.filesBySha, error: null,
  };
}

function failedRepo(root, error) {
  return { root, name: repoName(root), branch: null, files: [], limited: false, commits: [], commitsLimited: false, commitFiles: new Map(), error: String(error) };
}

function hasSomethingToShow(repo) {
  return Boolean(repo && (repo.files.length || repo.commits.length || repo.error));
}

function fileKey(repo, commit, file) {
  return groupKey(repo.root, rowKey(commit?.sha ?? null, file.path));
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
    this.message = ""; this.handle = cx.focus_handle(); this.placeBySpace = new Map();
    this.clearRepos(); this.resetFolds();
    // Unchecked files by repo root: a local-only file stays out of every commit while the panel lives.
    this.excludedByRoot = new Map();
    this.input = TextareaState.new({ placeholder: "Commit message (⌘Enter to commit)" });
    this.input.set_auto_grow(MESSAGE_ROWS.min, MESSAGE_ROWS.max);
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (e, cx) => {
      if (isCommitKey(e)) {
        this.commit(cx);
      }
    });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(REFRESH_EVERY_MS, (cx) => this.refresh(cx));
  }

  clearRepos() {
    this.repos = []; this.repoCount = 0; this.multi = false;
  }

  excludedOf(root) {
    if (!this.excludedByRoot.has(root)) {
      this.excludedByRoot.set(root, new Set());
    }
    return this.excludedByRoot.get(root);
  }

  toggleFile(repo, path, cx) {
    const excluded = this.excludedOf(repo.root);
    if (excluded.has(path)) {
      excluded.delete(path);
    } else {
      excluded.add(path);
    }
    cx.notify();
  }

  toggleAllFiles(repo, cx) {
    const excluded = this.excludedOf(repo.root);
    const checkAll = checkState(repo.files, excluded) !== "all";
    for (const { path } of repo.files) {
      if (checkAll) {
        excluded.delete(path);
      } else {
        excluded.add(path);
      }
    }
    cx.notify();
  }

  checkedPaths() {
    const repo = this.committable();
    return repo ? includedPaths(repo.files, this.excludedOf(repo.root)) : [];
  }

  resetFolds() {
    this.collapsed = new Set(); this.seen = new Set();
  }

  // New commits arrive folded; a group the user opened or closed keeps that state across refreshes.
  foldNewCommits(repos) {
    for (const repo of repos) {
      for (const { sha } of repo.commits) {
        const key = groupKey(repo.root, sha);
        if (!this.seen.has(key)) {
          this.seen.add(key);
          this.collapsed.add(key);
        }
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
    const keys = [];
    for (const repo of this.repos) {
      keys.push(...repo.files.map((f) => fileKey(repo, null, f)));
      for (const commit of repo.commits) {
        keys.push(...(repo.commitFiles.get(commit.sha) ?? []).map((f) => fileKey(repo, commit, f)));
      }
    }
    return new Set(keys);
  }

  // The one repo the commit box commits to; none in a folder of several repos.
  committable() {
    return this.multi ? null : this.repos[0] ?? null;
  }

  cachedCommitFiles(root) {
    return this.repos.find((r) => r.root === root)?.commitFiles ?? new Map();
  }

  show(repos, { multi, repoCount, on }) {
    this.repos = repos; this.multi = multi; this.repoCount = repoCount; this.on = on; this.error = null;
    this.foldNewCommits(repos);
  }

  where() {
    const place = location(this.placeBySpace);
    this.placeBySpace.set(place.space, place);
    return place;
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
      this.context = { key: next }; this.clearRepos(); this.open = null;
      this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null;
      this.loading = false; this.resetFolds();
    }
    // A load left behind in another folder (a slow git, a read that never ends) must not hold this one.
    if (!cwd || this.loading || this.busy) return;
    const context = this.context;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (!this.current(context)) return;
        if (top.code === 0) {
          const root = top.stdout.trim(), repo = await loadRepo(root, on, this.cachedCommitFiles(root));
          if (!this.current(context)) return;
          this.show([repo], { multi: false, repoCount: 1, on });
          this.watch(root, cx);
        } else {
          await this.loadRepos(cwd, on, context);
        }
        if (this.open && !this.openKeys().has(this.open)) { this.open = null; }
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  // No folder watch here: watching every repo would cost more than the 10 s poll.
  async loadRepos(cwd, on, context) {
    const found = await exec("find", findReposArgs(cwd), { on, timeout: FIND_TIMEOUT_MS });
    if (!this.current(context)) return;
    const roots = repoRoots(found.stdout);
    if (!roots.length) { this.clearRepos(); this.resetFolds(); this.error = "Not a git repository"; return; }
    const load = (root) => loadRepo(root, on, this.cachedCommitFiles(root), { skipQuiet: true }).catch((e) => failedRepo(root, e));
    const repos = await mapWithLimit(roots, REPOS_IN_PARALLEL, load);
    if (!this.current(context)) return;
    this.show(repos.filter(hasSomethingToShow), { multi: true, repoCount: roots.length, on });
  }

  pick(repo, file, commit, cx) {
    this.open = fileKey(repo, commit, file);
    const target = commit ? { sha: commit.sha, short: commit.short } : null;
    // requested makes a second pick of the same file a new target, so the Diff tab reloads it.
    setShared(DIFF_TARGET_KEY, { root: repo.root, path: file.path, on: this.on ?? null, commit: target, requested: Date.now() });
    openDiffTab();
    cx.notify();
  }

  commit(cx) {
    const repo = this.committable(), paths = this.checkedPaths();
    if (!this.message.trim() || !repo || !paths.length || this.busy || this.loading || this.context?.key !== this.key()) return;
    const root = repo.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of commitCommands(message, paths)) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (this.current(context)) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (this.current(context)) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  checkbox(id, state, t, toggle) {
    const on = state !== "none";
    return div().id(id).size(14).flex_none().flex().items_center().justify_center().rounded(3).border_1().border_color(on ? t.accent : t.border).when(on, (e) => e.bg(t.accent)).text_size(10).text_color(t.accent_foreground).cursor_pointer()
      .on_click((_e, cx) => { cx.stop_propagation(); toggle(cx); })
      .child(CHECK_GLYPH[state]);
  }

  fileRow(repo, f, t, commit, indent) {
    const parts = f.path.split("/"), name = parts.pop(), key = fileKey(repo, commit, f);
    return h_flex().id(`change-${key}`).h(ROW_HEIGHT).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().ml(indent + (commit ? COMMIT_FILES_INDENT : 0)).when(this.open === key, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(repo, f, commit, cx))
      .when(!commit && !this.multi, (e) => e.child(this.checkbox(`check-${key}`, this.excludedOf(repo.root).has(f.path) ? "none" : "all", t, (cx) => this.toggleFile(repo, f.path, cx))))
      .child(div().w(14).flex_none().text_size(11).text_color(statusColor(f.status, t)).child(f.status))
      .child(h_flex().flex_1().min_w(0).gap(6)
        .child(div().flex_none().max_w(260).truncate().text_color(statusColor(f.status, t)).child(name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(parts.join("/"))))
      .when(f.add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
  }

  groupHeader(group, t, { short, title, add, del, check }, indent) {
    const arrow = this.collapsed.has(group) ? "▸" : "▾";
    return h_flex().id(`group-${group}`).h(ROW_HEIGHT).flex_none().px(8).gap(6).items_center().rounded(7).cursor_pointer().ml(indent).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.toggle(group, cx))
      .child(div().w(14).flex_none().text_size(11).text_color(t.muted).child(arrow))
      .when(Boolean(check), (e) => e.child(this.checkbox(`check-${group}`, check.state, t, check.toggle)))
      .when(Boolean(short), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(short)))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(title))
      .when(add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${add}`)))
      .when(del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${del}`)));
  }

  localSection(repo, t, indent) {
    const group = groupKey(repo.root, LOCAL_GROUP);
    const check = this.multi || !repo.files.length ? null : { state: checkState(repo.files, this.excludedOf(repo.root)), toggle: (cx) => this.toggleAllFiles(repo, cx) };
    const header = this.groupHeader(group, t, { title: `Local changes (${repo.files.length})`, ...sumChanges(repo.files), check }, indent);
    if (this.collapsed.has(group)) {
      return [header];
    }
    const empty = div().ml(indent).p(8).text_color(t.dim).child("No uncommitted changes");
    return [header, ...(repo.files.length ? repo.files.map((f) => this.fileRow(repo, f, t, null, indent)) : [empty])];
  }

  commitSection(repo, commit, t, indent) {
    const group = groupKey(repo.root, commit.sha), files = repo.commitFiles.get(commit.sha) ?? [];
    const header = this.groupHeader(group, t, { short: commit.short, title: commit.subject, ...sumChanges(files) }, indent);
    if (this.collapsed.has(group)) {
      return [header];
    }
    return [header, ...files.map((f) => this.fileRow(repo, f, t, commit, indent))];
  }

  repoRows(repo, t, indent) {
    const rows = [...this.localSection(repo, t, indent), ...repo.commits.flatMap((c) => this.commitSection(repo, c, t, indent))];
    if (repo.commitsLimited) {
      rows.push(div().ml(indent).px(8).py(4).text_size(11).text_color(t.dim).child(`Showing the last ${MAX_COMMITS} unpushed commits`));
    }
    return rows;
  }

  repoSection(repo, t) {
    const title = repo.branch ? `${repo.name} · ${repo.branch}` : repo.name;
    const header = this.groupHeader(repo.root, t, { title, ...sumChanges(repo.files) }, 0);
    if (this.collapsed.has(repo.root)) {
      return [header];
    }
    if (repo.error) {
      return [header, div().ml(REPO_INDENT).p(8).text_color(t.ansi1).child(repo.error)];
    }
    return [header, ...this.repoRows(repo, t, REPO_INDENT)];
  }

  listRows(t) {
    if (!this.multi && !this.repos.length) {
      return [div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : "No folder"))];
    }
    const rows = this.multi ? this.repos.flatMap((r) => this.repoSection(r, t)) : this.repoRows(this.repos[0], t, 0);
    if (this.multi && !this.repos.length) {
      rows.push(div().p(8).text_color(t.dim).child(`No changes in ${this.repoCount} repositories`));
    }
    if (this.error) {
      rows.unshift(div().p(8).text_color(t.ansi1).child(this.error));
    }
    return rows;
  }

  render(cx) {
    if (this.key() !== this.context?.key) this.refresh(cx);
    const t = theme(), files = this.repos.flatMap((r) => r.files), { add, del } = sumChanges(files);
    const badge = this.multi ? `${files.length} files · ${this.repos.length}/${this.repoCount} repos` : `${files.length} files`;
    const enabled = Boolean(this.message.trim() && this.checkedPaths().length && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(badge))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).relative()
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.listRows(t)))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.repos.some((r) => r.limited), el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .when(!this.multi, (e) => e.child(h_flex().flex_none().p(10).gap(8).items_end().border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).min_h(32).px(10).py(7).rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(this.input).w_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit"))));
  }
}
