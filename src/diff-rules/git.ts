// oxlint-disable effecttsgo/node-builtin-import -- a standalone CLI outside any Effect runtime, so Effect's platform services do not apply

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export type ChangeMode = "full" | "committed" | "staged" | "working";

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: FileStatus;
  readonly added: number;
  readonly deleted: number;
  readonly patch: string;
}

export interface Commit {
  readonly hash: string;
  readonly subject: string;
}

export interface ChangeSet {
  readonly root: string;
  readonly mode: ChangeMode;
  /** The ref the change is measured against, as the user would recognise it. */
  readonly baseLabel: string;
  /** The commit diffed against; absent before the first commit. */
  readonly baseCommit?: string;
  readonly branch?: string;
  /** Commits between the base and HEAD, newest first. */
  readonly commits: ReadonlyArray<Commit>;
  readonly files: ReadonlyArray<FileChange>;
  /** Binary or oversized files left out of the diff. */
  readonly skipped: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

export interface CollectOptions {
  readonly cwd: string;
  readonly mode: ChangeMode;
  /** Branch or ref to diff against; its merge-base with HEAD is used. */
  readonly base?: string;
  readonly exclude: ReadonlyArray<string>;
}

/**
 * Remote default branch first, then fallbacks for clones without `origin/HEAD`: the same order as
 * the changed-lines mode of the oxlint rules (`modes/changed.ts`).
 */
export const BASE_CANDIDATES: ReadonlyArray<string> = [
  "origin/HEAD",
  "origin/main",
  "origin/master",
  "main",
  "master",
];

// Locale-independent, so the rendered input and its cache key are the same on every machine.
export const byCodePoint = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const MAX_UNTRACKED_BYTES = 1024 * 1024;
const MAX_LISTED_COMMITS = 50;

interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function git(cwd: string, args: ReadonlyArray<string>): GitResult {
  const result = spawnSync(
    "git",
    // Pin output-shaping settings so user config cannot change what is parsed.
    ["-c", "core.quotePath=false", "-c", "diff.noprefix=false", "-c", "color.ui=false", ...args],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function gitOk(cwd: string, args: ReadonlyArray<string>): string {
  const result = git(cwd, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function resolveCommit(cwd: string, ref: string): string | undefined {
  const result = git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function emptyTree(cwd: string): string {
  const result = spawnSync("git", ["hash-object", "-t", "tree", "--stdin"], {
    cwd,
    input: "",
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  return result.stdout.trim();
}

export function pathspecs(exclude: ReadonlyArray<string>): string[] {
  return ["--", ".", ...exclude.map((glob) => `:(glob,exclude)${glob}`)];
}

const unquote = (path: string): string =>
  path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;

// `+++ b/a b` gets a trailing tab when the path contains a space.
const headerPath = (line: string, prefix: string): string => unquote(line.slice(prefix.length).replace(/\t$/, ""));

function pathFromDiffHeader(header: string): string {
  // `diff --git a/<path> b/<path>` with identical halves when there is no rename.
  const pair = header.slice("diff --git ".length);
  const length = (pair.length - 5) / 2;
  return Number.isInteger(length) && length > 0 ? pair.slice(2, 2 + length) : pair;
}

interface ParsedPatch {
  readonly change: FileChange;
  readonly binary: boolean;
}

function parseFilePatch(patch: string): ParsedPatch {
  const lines = patch.split("\n");
  let path: string | undefined;
  let oldPath: string | undefined;
  let renamedFrom: string | undefined;
  let status: FileStatus = "modified";
  let binary = false;
  let inHunks = false;
  let added = 0;
  let deleted = 0;
  for (const line of lines.slice(1)) {
    if (inHunks) {
      if (line.startsWith("+")) added += 1;
      else if (line.startsWith("-")) deleted += 1;
      continue;
    }
    if (line.startsWith("@@")) inHunks = true;
    else if (line.startsWith("new file mode")) status = "added";
    else if (line.startsWith("deleted file mode")) status = "deleted";
    else if (line.startsWith("rename from ")) renamedFrom = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) path = line.slice("rename to ".length);
    else if (line.startsWith("--- a/")) oldPath = headerPath(line, "--- a/");
    else if (line.startsWith("+++ b/")) path = headerPath(line, "+++ b/");
    else if (line.startsWith("Binary files ") || line === "GIT binary patch") binary = true;
  }
  if (renamedFrom !== undefined) status = "renamed";
  const finalPath = path ?? oldPath ?? pathFromDiffHeader(lines[0] ?? "");
  return {
    binary,
    change: {
      path: finalPath,
      ...(renamedFrom === undefined ? {} : { oldPath: renamedFrom }),
      status,
      added,
      deleted,
      patch: patch.endsWith("\n") ? patch : `${patch}\n`,
    },
  };
}

export function splitPatch(patch: string): ParsedPatch[] {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((part) => part.startsWith("diff --git "))
    .map(parseFilePatch);
}

function readHead(path: string, bytes: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** A new-file patch for an untracked file, or undefined when it is binary or too large. */
function untrackedPatch(root: string, path: string): FileChange | undefined {
  const absolute = join(root, path);
  const stats = statSync(absolute, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile() || stats.size > MAX_UNTRACKED_BYTES) return undefined;
  const content = readHead(absolute, stats.size);
  if (content.includes(0)) return undefined;
  const text = content.toString("utf8");
  if (text.length === 0) {
    return { path, status: "added", added: 0, deleted: 0, patch: `diff --git a/${path} b/${path}\nnew file mode 100644\n` };
  }
  const endsWithNewline = text.endsWith("\n");
  const lines = (endsWithNewline ? text.slice(0, -1) : text).split("\n");
  const body = lines.map((line) => `+${line}`).join("\n");
  const patch = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
    ...(endsWithNewline ? [] : ["\\ No newline at end of file"]),
  ].join("\n");
  return { path, status: "added", added: lines.length, deleted: 0, patch: `${patch}\n` };
}

interface Base {
  readonly label: string;
  readonly commit?: string;
  readonly note?: string;
}

function findBase(cwd: string, hasHead: boolean, requested: string | undefined): Base {
  if (!hasHead) return { label: "(no commits)" };
  if (requested !== undefined) {
    const commit = resolveCommit(cwd, requested);
    if (commit === undefined) throw new Error(`base ref "${requested}" does not name a commit`);
    return { label: requested, commit: mergeBase(cwd, requested) };
  }
  for (const candidate of BASE_CANDIDATES) {
    if (resolveCommit(cwd, candidate) === undefined) continue;
    return { label: candidate, commit: mergeBase(cwd, candidate) };
  }
  return {
    label: "HEAD",
    commit: resolveCommit(cwd, "HEAD"),
    note: `no base branch (${BASE_CANDIDATES.join(", ")}) found; judging uncommitted changes only`,
  };
}

function mergeBase(cwd: string, ref: string): string {
  const result = git(cwd, ["merge-base", ref, "HEAD"]);
  if (result.status !== 0) throw new Error(`${ref} and HEAD have no common ancestor`);
  return result.stdout.trim();
}

function diffArgs(mode: ChangeMode, base: Base, tree: string): string[] {
  if (mode === "staged") return ["--cached"];
  const from = base.commit ?? tree;
  if (mode === "committed") return [from, "HEAD"];
  // `working` diffs against HEAD regardless of the base branch.
  return [from];
}

export function collectChanges(options: CollectOptions): ChangeSet {
  const { cwd, mode, exclude } = options;
  const inside = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (inside.status !== 0) throw new Error("not inside a git work tree");
  const root = inside.stdout.trim();
  const hasHead = resolveCommit(root, "HEAD") !== undefined;
  const notes: string[] = [];

  let base: Base;
  if (mode === "staged" || mode === "working") {
    base = hasHead ? { label: "HEAD", commit: resolveCommit(root, "HEAD") } : { label: "(no commits)" };
  } else {
    base = findBase(root, hasHead, options.base);
  }
  if (base.note !== undefined) notes.push(base.note);
  if (mode === "committed" && !hasHead) notes.push("no commits yet; nothing is committed");

  const files: FileChange[] = [];
  const skipped: string[] = [];
  if (!(mode === "committed" && !hasHead)) {
    const patch = gitOk(root, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      ...diffArgs(mode, base, emptyTree(root)),
      ...pathspecs(exclude),
    ]);
    for (const { change, binary } of splitPatch(patch)) {
      if (binary) skipped.push(change.path);
      else files.push(change);
    }
  }

  if (mode === "full" || mode === "working") {
    const untracked = gitOk(root, ["ls-files", "-z", "--others", "--exclude-standard", ...pathspecs(exclude)])
      .split("\0")
      .filter((path) => path.length > 0);
    for (const path of untracked) {
      const change = untrackedPatch(root, path);
      if (change === undefined) skipped.push(path);
      else files.push(change);
    }
  }

  files.sort((left, right) => byCodePoint(left.path, right.path));
  const branchResult = git(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : undefined;
  const commits =
    hasHead && base.commit !== undefined && mode !== "staged" && mode !== "working"
      ? listCommits(root, `${base.commit}..HEAD`)
      : [];
  return {
    root,
    mode,
    baseLabel: base.label,
    ...(base.commit === undefined ? {} : { baseCommit: base.commit }),
    ...(branch === undefined || branch.length === 0 ? {} : { branch }),
    commits,
    files,
    skipped: skipped.sort(byCodePoint),
    notes,
  };
}

function listCommits(root: string, range: string): Commit[] {
  return gitOk(root, ["log", "--no-merges", `-n${MAX_LISTED_COMMITS}`, "--format=%h%x09%s", range])
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf("\t");
      return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

export interface FileHistory {
  /** Subjects of the last commits touching the file before this change, newest first. */
  readonly subjects: ReadonlyArray<string>;
  /** How many of the scanned recent commits touched the file. */
  readonly recentCommits: number;
}

export interface CoChange {
  readonly left: string;
  readonly right: string;
  readonly commits: number;
}

export interface HistorySummary {
  readonly window: number;
  readonly files: Readonly<Record<string, FileHistory>>;
  /** Pairs of touched files that changed in the same commit, most frequent first. */
  readonly coChanges: ReadonlyArray<CoChange>;
}

export interface HistoryOptions {
  readonly commitsPerFile: number;
  readonly coChangeCommits: number;
  readonly maxFiles: number;
  readonly maxPairs: number;
}

// A commit touching this many files is a mass rename or reformat, which says nothing about
// coupling and would add a quadratic number of pairs.
const MAX_FILES_PER_COCHANGE_COMMIT = 50;

/** History before the change: the base commit's ancestry, so this branch's commits do not count. */
export function historySummary(
  root: string,
  head: string | undefined,
  paths: ReadonlyArray<string>,
  options: HistoryOptions,
): HistorySummary {
  const files: Record<string, FileHistory> = {};
  if (head === undefined || paths.length === 0) {
    return { window: options.coChangeCommits, files, coChanges: [] };
  }
  const touched = new Set(paths.slice(0, options.maxFiles));
  const recent = new Map<string, number>();
  const pairs = new Map<string, number>();
  const log = gitOk(root, [
    "log",
    "--no-merges",
    `-n${options.coChangeCommits}`,
    "--format=%x00",
    "--name-only",
    head,
  ]);
  for (const record of log.split("\0").slice(1)) {
    const inCommit = [...new Set(record.split("\n").filter((path) => touched.has(path)))].sort();
    for (const path of inCommit) recent.set(path, (recent.get(path) ?? 0) + 1);
    if (record.split("\n").filter((line) => line.length > 0).length > MAX_FILES_PER_COCHANGE_COMMIT) continue;
    for (let left = 0; left < inCommit.length; left += 1) {
      for (let right = left + 1; right < inCommit.length; right += 1) {
        const key = `${inCommit[left]}\0${inCommit[right]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  for (const path of touched) {
    const subjects = gitOk(root, ["log", "--no-merges", `-n${options.commitsPerFile}`, "--format=%s", head, "--", path])
      .split("\n")
      .filter((line) => line.length > 0);
    files[path] = { subjects, recentCommits: recent.get(path) ?? 0 };
  }
  const coChanges = [...pairs.entries()]
    .map(([key, commits]) => {
      const [left = "", right = ""] = key.split("\0");
      return { left, right, commits };
    })
    .sort((a, b) => b.commits - a.commits || byCodePoint(a.left, b.left) || byCodePoint(a.right, b.right))
    .slice(0, options.maxPairs);
  return { window: options.coChangeCommits, files, coChanges };
}
