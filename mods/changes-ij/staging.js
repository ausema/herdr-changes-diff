// What the Commit button commits: the local changes left checked, and nothing else.

// A path is a literal name, never a pathspec pattern ("src/[id].js" is that file).
const LITERAL = "--literal-pathspecs";

export function includedPaths(files, excluded) {
  return files.map((f) => f.path).filter((path) => !excluded.has(path));
}

export function checkState(files, excluded) {
  const included = includedPaths(files, excluded).length;
  if (included === 0) {
    return "none";
  }
  return included === files.length ? "all" : "some";
}

// Paths after `commit --` commit only those files, whatever else is staged.
export function commitCommands(message, paths) {
  return [
    [LITERAL, "add", "-A", "--", ...paths],
    [LITERAL, "commit", "-m", message, "--", ...paths],
  ];
}

// Enter adds a line to the message; Cmd+Enter (Ctrl+Enter off macOS) commits.
export function isCommitKey(event) {
  return Boolean(event?.secondary);
}
