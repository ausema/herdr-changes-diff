export const MAX_COMMITS = 50;

const FIELD_SEPARATOR = "\x1f";
const ENTRY_SEPARATOR = "\0";
const RAW_ENTRY_PREFIX = ":";
const NUMSTAT_BINARY = "-";
const KEPT_STATUSES = new Set(["A", "D"]);
const MODIFIED = "M";

export function logArgs(hasUpstream) {
  const range = hasUpstream ? ["@{upstream}..HEAD"] : ["HEAD", "--not", "--remotes"];
  return ["log", "--format=%H%x1f%h%x1f%s", "-z", "-n", String(MAX_COMMITS + 1), ...range];
}

export function parseLog(stdout) {
  const commits = stdout.split(ENTRY_SEPARATOR).filter(Boolean).map((entry) => {
    const [sha, short, subject] = entry.split(FIELD_SEPARATOR);
    return { sha, short, subject };
  });
  return { commits: commits.slice(0, MAX_COMMITS), limited: commits.length > MAX_COMMITS };
}

export function commitFilesArgs(sha) {
  return ["show", "--format=", "-z", "--no-renames", "--diff-merges=first-parent", "--raw", "--numstat", sha];
}

function statusOf(rawEntry) {
  const letter = rawEntry.split(" ").pop();
  return KEPT_STATUSES.has(letter) ? letter : MODIFIED;
}

export function parseCommitFiles(stdout) {
  const tokens = stdout.split(ENTRY_SEPARATOR);
  const files = [];
  const statByPath = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith(RAW_ENTRY_PREFIX)) {
      files.push({ path: tokens[i + 1], status: statusOf(token) });
      i++;
      continue;
    }
    const [add, del, ...parts] = token.split("\t");
    if (!parts.length) {
      continue;
    }
    const binary = add === NUMSTAT_BINARY;
    statByPath.set(parts.join("\t"), { add: Number(add) || 0, del: Number(del) || 0, binary });
  }
  return files.map((file) => ({ ...file, ...(statByPath.get(file.path) ?? { add: 0, del: 0, binary: false }) }));
}

export function rowKey(sha, path) {
  return `${sha ?? ""}:${path}`;
}
