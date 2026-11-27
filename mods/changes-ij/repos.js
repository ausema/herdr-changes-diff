// A folder that isn't a repo but holds several (~/work/repo-a, ~/work/repo-b): helpers to
// find them and to tell from one `git status --branch` whether a repo has anything to show.

const GIT_DIR_NAME = ".git";
const ENTRY_SEPARATOR = "\0";
const BRANCH_HEADER_PREFIX = "## ";
// "main...origin/main [ahead 1, behind 2]", "No commits yet on main", "HEAD (no branch)".
const BRANCH_HEADER = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/;
const AHEAD = /ahead (\d+)/;
const UPSTREAM_GONE = "gone";

export function findReposArgs(folder) {
  return [folder, "-mindepth", "2", "-maxdepth", "2", "-name", GIT_DIR_NAME];
}

export function repoRoots(findOutput) {
  return findOutput.split("\n").filter(Boolean).map((gitPath) => gitPath.slice(0, -(GIT_DIR_NAME.length + 1))).sort();
}

export function repoName(root) {
  return root.split("/").pop();
}

function parseBranch(header) {
  const [, name, upstream = null, tracking = ""] = BRANCH_HEADER.exec(header.slice(BRANCH_HEADER_PREFIX.length));
  return { name, upstream, ahead: Number(AHEAD.exec(tracking)?.[1] ?? 0), gone: tracking === UPSTREAM_GONE };
}

// Output of `git status --porcelain=v1 -z --branch`: the branch header, then one entry per file.
export function parseStatus(stdout) {
  const [header, ...entries] = stdout.split(ENTRY_SEPARATOR).filter(Boolean);
  return { branch: parseBranch(header), entries };
}

// Clean and nothing to push: the rest of the repo's git calls can be skipped.
export function isQuiet({ branch, entries }) {
  return entries.length === 0 && branch.upstream !== null && !branch.gone && branch.ahead === 0;
}

export function groupKey(root, group) {
  return `${root}:${group}`;
}

export async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
