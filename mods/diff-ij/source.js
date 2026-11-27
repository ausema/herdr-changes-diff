const UNTRACKED = "??";
const GIT_STATE_FILES = [".git/HEAD", ".git/index"];

// "disk": the left side is empty and the file on disk is all new; "head": diff against HEAD.
export function diffSource(statusOutput, hasHead) {
  if (!hasHead || statusOutput.startsWith(UNTRACKED)) {
    return "disk";
  }
  return "head";
}

// A watch batch that names the root means "refresh everything".
export function touchesFile(changedPaths, root, path) {
  const relevant = new Set([root, `${root}/${path}`, ...GIT_STATE_FILES.map((file) => `${root}/${file}`)]);
  return changedPaths.some((changed) => relevant.has(changed));
}

const HUNK_START = "@@";
const BINARY_MARKER = "Binary files";
const LOCAL_LABELS = { disk: ["(new file)", "Current version"], head: ["HEAD", "Current version"] };

export function commitDiffArgs(sha, path, contextLines) {
  return ["show", "--format=", `-U${contextLines}`, "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--diff-merges=first-parent", sha, "--", path];
}

export function unifiedFrom(stdout) {
  const all = stdout.replace(/\n$/, "").split("\n");
  const first = all.findIndex((line) => line.startsWith(HUNK_START));
  if (first < 0) {
    return { notice: stdout.includes(BINARY_MARKER) ? "Binary file changed" : "No changes" };
  }
  return { lines: all.slice(first) };
}

export function sideLabels(source, commit) {
  if (source === "commit") {
    return [`${commit.short}^`, commit.short];
  }
  return LOCAL_LABELS[source] ?? LOCAL_LABELS.head;
}
