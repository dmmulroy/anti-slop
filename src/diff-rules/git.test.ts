// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env, effecttsgo/async-function -- tests a standalone CLI outside any Effect runtime against real git repositories
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_EXCLUDES } from "./config.ts";
import { DEFAULT_BRANCHES } from "../modes/changed.ts";
import { BASE_CANDIDATES, collectChanges, historySummary, type ChangeSet } from "./git.ts";

// Keep the developer's git configuration out of the scratch repositories.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void): void => {
  tests.push([name, run]);
};

function sh(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(root: string, path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function commit(root: string, message: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) write(root, path, content);
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", message);
  return sh(root, "rev-parse", "HEAD");
}

const scratch: string[] = [];
function repo(branch = "main"): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diff-rules-git-")));
  scratch.push(root);
  sh(root, "init", "-q", "-b", branch);
  return root;
}

const paths = (change: ChangeSet): string[] => change.files.map((file) => file.path);

test("diffs a feature branch against its merge-base with main and lists its commits", () => {
  const root = repo();
  commit(root, "initial", { "src/a.ts": "export const a = 1;\n" });
  const base = sh(root, "rev-parse", "HEAD");
  sh(root, "checkout", "-q", "-b", "feature");
  commit(root, "add b", { "src/b.ts": "export const b = 2;\n" });
  sh(root, "checkout", "-q", "main");
  commit(root, "main moves on", { "src/c.ts": "export const c = 3;\n" });
  sh(root, "checkout", "-q", "feature");

  const change = collectChanges({ cwd: root, mode: "full", exclude: [] });
  assert.equal(change.baseLabel, "main");
  assert.equal(change.baseCommit, base);
  assert.equal(change.branch, "feature");
  assert.deepEqual(paths(change), ["src/b.ts"]);
  assert.deepEqual(change.commits.map((item) => item.subject), ["add b"]);
  assert.equal(change.files[0]?.status, "added");
  assert.equal(change.files[0]?.added, 1);
});

test("uses the same default base as the oxlint rules' changed-lines mode", () => {
  assert.deepEqual(BASE_CANDIDATES, ["origin/HEAD", ...DEFAULT_BRANCHES]);
});

test("prefers origin/master over local main", () => {
  const root = repo();
  const first = commit(root, "initial", { "a.txt": "1\n" });
  commit(root, "second", { "a.txt": "2\n" });
  sh(root, "update-ref", "refs/remotes/origin/master", first);

  const change = collectChanges({ cwd: root, mode: "full", exclude: [] });
  assert.equal(change.baseLabel, "origin/master");
  assert.equal(change.baseCommit, first);
});

test("prefers origin/HEAD over local main", () => {
  const root = repo();
  const first = commit(root, "initial", { "a.txt": "1\n" });
  commit(root, "second", { "a.txt": "2\n" });
  sh(root, "update-ref", "refs/remotes/origin/main", first);
  sh(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

  const change = collectChanges({ cwd: root, mode: "full", exclude: [] });
  assert.equal(change.baseLabel, "origin/HEAD");
  assert.equal(change.baseCommit, first);
  assert.deepEqual(paths(change), ["a.txt"]);
});

test("an explicit --base wins over the defaults and must name a commit", () => {
  const root = repo();
  const first = commit(root, "initial", { "a.txt": "1\n" });
  commit(root, "second", { "b.txt": "2\n" });
  sh(root, "tag", "v1", first);
  const change = collectChanges({ cwd: root, mode: "full", base: "v1", exclude: [] });
  assert.equal(change.baseLabel, "v1");
  assert.deepEqual(paths(change), ["b.txt"]);
  assert.throws(() => collectChanges({ cwd: root, mode: "full", base: "nope", exclude: [] }), /does not name a commit/);
});

test("full and working include staged, unstaged, and untracked changes; staged and committed do not mix them", () => {
  const root = repo();
  commit(root, "initial", { "staged.txt": "1\n", "unstaged.txt": "1\n" });
  sh(root, "checkout", "-q", "-b", "feature");
  commit(root, "committed", { "committed.txt": "1\n" });
  write(root, "staged.txt", "2\n");
  sh(root, "add", "staged.txt");
  write(root, "unstaged.txt", "2\n");
  write(root, "untracked.txt", "new\n");

  assert.deepEqual(paths(collectChanges({ cwd: root, mode: "full", exclude: [] })), [
    "committed.txt",
    "staged.txt",
    "unstaged.txt",
    "untracked.txt",
  ]);
  assert.deepEqual(paths(collectChanges({ cwd: root, mode: "working", exclude: [] })), [
    "staged.txt",
    "unstaged.txt",
    "untracked.txt",
  ]);
  assert.deepEqual(paths(collectChanges({ cwd: root, mode: "staged", exclude: [] })), ["staged.txt"]);
  assert.deepEqual(paths(collectChanges({ cwd: root, mode: "committed", exclude: [] })), ["committed.txt"]);

  const untracked = collectChanges({ cwd: root, mode: "working", exclude: [] }).files.find((file) => file.path === "untracked.txt");
  assert.match(untracked?.patch ?? "", /^\+\+\+ b\/untracked\.txt\n@@ -0,0 \+1,1 @@\n\+new\n$/m);
});

test("leaves out default excludes, configured globs, and binary files", () => {
  const root = repo();
  commit(root, "initial", { "README.md": "hi\n" });
  write(root, "pnpm-lock.yaml", "lock: 1\n");
  write(root, "packages/x/package-lock.json", "{}\n");
  write(root, "dist/bundle.js", "x\n");
  write(root, "src/gen/schema.ts", "x\n");
  write(root, "src/keep.ts", "x\n");
  write(root, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  write(root, "tracked.bin", Buffer.from([1, 0, 2]));
  sh(root, "add", "tracked.bin");

  const change = collectChanges({ cwd: root, mode: "full", exclude: [...DEFAULT_EXCLUDES, "src/gen/**"] });
  assert.deepEqual(paths(change), ["src/keep.ts"]);
  assert.deepEqual(change.skipped, ["logo.png", "tracked.bin"]);
});

test("reports deletions and renames", () => {
  const root = repo();
  const body = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  commit(root, "initial", { "old.ts": `${body}\n`, "gone.ts": "bye\n" });
  sh(root, "mv", "old.ts", "new.ts");
  sh(root, "rm", "-q", "gone.ts");
  const change = collectChanges({ cwd: root, mode: "working", exclude: [] });
  assert.deepEqual(
    change.files.map((file) => [file.path, file.status, file.oldPath]),
    [
      ["gone.ts", "deleted", undefined],
      ["new.ts", "renamed", "old.ts"],
    ],
  );
});

test("an unchanged branch yields an empty change set", () => {
  const root = repo();
  commit(root, "initial", { "a.txt": "1\n" });
  const change = collectChanges({ cwd: root, mode: "full", exclude: [] });
  assert.deepEqual(change.files, []);
  assert.deepEqual(change.commits, []);
});

test("works before the first commit", () => {
  const root = repo();
  write(root, "staged.txt", "1\n");
  sh(root, "add", "staged.txt");
  write(root, "untracked.txt", "2\n");
  const change = collectChanges({ cwd: root, mode: "full", exclude: [] });
  assert.equal(change.baseLabel, "(no commits)");
  assert.equal(change.baseCommit, undefined);
  assert.deepEqual(paths(change), ["staged.txt", "untracked.txt"]);
  assert.deepEqual(paths(collectChanges({ cwd: root, mode: "staged", exclude: [] })), ["staged.txt"]);
  assert.deepEqual(paths(collectChanges({ cwd: root, mode: "committed", exclude: [] })), []);
});

test("without any base branch it judges uncommitted changes and says so", () => {
  const root = repo("trunk");
  commit(root, "initial", { "a.txt": "1\n" });
  write(root, "a.txt", "2\n");
  const change = collectChanges({ cwd: root, mode: "full", exclude: [] });
  assert.equal(change.baseLabel, "HEAD");
  assert.deepEqual(paths(change), ["a.txt"]);
  assert.match(change.notes.join("\n"), /no base branch/);
});

test("fails outside a git work tree", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "diff-rules-nogit-")));
  scratch.push(dir);
  assert.throws(() => collectChanges({ cwd: dir, mode: "full", exclude: [] }), /not inside a git work tree/);
});

test("history summarises per-file subjects and co-change counts before the base", () => {
  const root = repo();
  commit(root, "a and b one", { "a.ts": "1\n", "b.ts": "1\n" });
  commit(root, "a and b two", { "a.ts": "2\n", "b.ts": "2\n" });
  commit(root, "a and c", { "a.ts": "3\n", "c.ts": "1\n" });
  commit(root, "unrelated", { "d.ts": "1\n" });
  const base = sh(root, "rev-parse", "HEAD");
  sh(root, "checkout", "-q", "-b", "feature");
  // Branch commits are part of the change, not its history.
  commit(root, "branch touches a and c", { "a.ts": "4\n", "c.ts": "2\n" });

  const history = historySummary(root, base, ["a.ts", "b.ts", "c.ts"], {
    commitsPerFile: 2,
    coChangeCommits: 100,
    maxFiles: 10,
    maxPairs: 10,
  });
  assert.deepEqual(history.coChanges, [
    { left: "a.ts", right: "b.ts", commits: 2 },
    { left: "a.ts", right: "c.ts", commits: 1 },
  ]);
  assert.deepEqual(history.files["a.ts"], { subjects: ["a and c", "a and b two"], recentCommits: 3 });
  assert.deepEqual(history.files["c.ts"], { subjects: ["a and c"], recentCommits: 1 });
});

test("co-change ignores mass-change commits", () => {
  const root = repo();
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`f${index}.ts`, "1\n"]));
  commit(root, "reformat everything", { ...many, "a.ts": "1\n", "b.ts": "1\n" });
  const history = historySummary(root, sh(root, "rev-parse", "HEAD"), ["a.ts", "b.ts"], {
    commitsPerFile: 1,
    coChangeCommits: 10,
    maxFiles: 10,
    maxPairs: 10,
  });
  assert.deepEqual(history.coChanges, []);
  assert.equal(history.files["a.ts"]?.recentCommits, 1);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}
for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
if (failed > 0) process.exit(1);
