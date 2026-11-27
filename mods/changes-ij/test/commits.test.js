import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_COMMITS, logArgs, parseLog, commitFilesArgs, parseCommitFiles, rowKey } from "../commits.js";

const logEntry = (sha, short, subject) => `${sha}\x1f${short}\x1f${subject}\0`;

test("logArgs usa el upstream cuando existe", () => {
  assert.deepEqual(logArgs(true).slice(-3), ["-n", "51", "@{upstream}..HEAD"]);
});

test("logArgs sin upstream excluye lo que está en remotas", () => {
  assert.deepEqual(logArgs(false).slice(-3), ["HEAD", "--not", "--remotes"]);
});

test("parseLog separa hash, hash corto y asunto", () => {
  const stdout = logEntry("aaa", "a1", "feat: x") + logEntry("bbb", "b2", "fix: y");
  assert.deepEqual(parseLog(stdout), {
    commits: [
      { sha: "aaa", short: "a1", subject: "feat: x" },
      { sha: "bbb", short: "b2", subject: "fix: y" },
    ],
    limited: false,
  });
});

test("parseLog con salida vacía no da commits", () => {
  assert.deepEqual(parseLog(""), { commits: [], limited: false });
});

test("parseLog marca limited al pasar de MAX_COMMITS", () => {
  const stdout = Array.from({ length: MAX_COMMITS + 1 }, (_, i) => logEntry(`sha${i}`, `s${i}`, `c${i}`)).join("");
  const { commits, limited } = parseLog(stdout);
  assert.equal(commits.length, MAX_COMMITS);
  assert.equal(limited, true);
});

test("commitFilesArgs pide raw y numstat contra el primer padre", () => {
  assert.deepEqual(commitFilesArgs("aaa"), ["show", "--format=", "-z", "--no-renames", "--diff-merges=first-parent", "--raw", "--numstat", "aaa"]);
});

test("parseCommitFiles cruza raw y numstat", () => {
  const raw = ":100644 100644 a b M\0src/a.js\0:000000 100644 0 c A\0new file.txt\0:100644 000000 d 0 D\0old.md\0";
  const numstat = "3\t1\tsrc/a.js\0" + "2\t0\tnew file.txt\0" + "0\t5\told.md\0";
  assert.deepEqual(parseCommitFiles(raw + numstat), [
    { path: "src/a.js", status: "M", add: 3, del: 1, binary: false },
    { path: "new file.txt", status: "A", add: 2, del: 0, binary: false },
    { path: "old.md", status: "D", add: 0, del: 5, binary: false },
  ]);
});

test("parseCommitFiles marca binarios", () => {
  const stdout = ":100644 100644 a b M\0img.png\0" + "-\t-\timg.png\0";
  assert.deepEqual(parseCommitFiles(stdout), [{ path: "img.png", status: "M", add: 0, del: 0, binary: true }]);
});

test("parseCommitFiles trata T como M", () => {
  const stdout = ":120000 100644 a b T\0link\0" + "1\t0\tlink\0";
  assert.equal(parseCommitFiles(stdout)[0].status, "M");
});

test("parseCommitFiles tolera el separador vacío entre raw y numstat", () => {
  const stdout = ":100644 100644 a b M\0a.js\0\0" + "1\t1\ta.js\0";
  assert.deepEqual(parseCommitFiles(stdout), [{ path: "a.js", status: "M", add: 1, del: 1, binary: false }]);
});

test("rowKey distingue el mismo fichero en local y en un commit", () => {
  assert.notEqual(rowKey(null, "a.js"), rowKey("aaa", "a.js"));
});
