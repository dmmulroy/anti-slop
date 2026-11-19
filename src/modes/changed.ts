// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/process-env, effecttsgo/global-date -- runs inside oxlint's plugin host, outside any Effect runtime

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, relative, sep } from "node:path";

import { errorMessage } from "../shared/error-message.ts";

/**
 * How a rule picks what to check, set in its own options. `"all"` (the default) checks every line;
 * `"changed"` checks only lines that differ from the merge base of `HEAD` and the default branch,
 * so findings on untouched lines are dropped.
 */
export type Mode = "all" | "changed";

/** Changed line numbers of one file, or `"all"` when every line counts as changed. */
export type ChangedLines = ReadonlySet<number> | "all";

/** Tried in order after `refs/remotes/origin/HEAD` when resolving the default branch. */
export const DEFAULT_BRANCHES: ReadonlyArray<string> = ["origin/main", "origin/master", "main", "master"];

const BASE_ENV = "ANTI_SLOP_BASE";

interface RepoChanges {
	readonly root: string;
	/** `null` before the first commit, when every line of every file is new. */
	readonly files: ReadonlyMap<string, ChangedLines> | null;
	readonly computedAt: number;
}

const git = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync("git", ["-c", "core.quotePath=false", ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});

const succeeds = (cwd: string, args: ReadonlyArray<string>): boolean => {
	try {
		git(cwd, args);
		return true;
	} catch {
		return false;
	}
};

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Parses `git diff -U0` output into the new-side line numbers each file changed. */
export function parseDiff(diff: string): Map<string, Set<number>> {
	const files = new Map<string, Set<number>>();
	let current: Set<number> | null = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const target = line.slice(4);
			current = null;
			if (target.startsWith("b/")) {
				current = files.get(target.slice(2)) ?? new Set();
				files.set(target.slice(2), current);
			}
			continue;
		}
		const hunk = current === null ? null : HUNK.exec(line);
		if (hunk === null || current === null) continue;
		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		// A pure deletion has no new lines, so the lines on either side of the gap count as changed.
		if (count === 0) {
			current.add(start);
			current.add(start + 1);
		}
		for (let offset = 0; offset < count; offset++) current.add(start + offset);
	}
	return files;
}

/**
 * The default branch: what `refs/remotes/origin/HEAD` points at (`origin/main` or
 * `origin/master`), else the first of `DEFAULT_BRANCHES` that names a commit, else `null`.
 */
export function defaultBase(cwd: string): string | null {
	try {
		const ref = git(cwd, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]).trim();
		const name = ref.replace(/^refs\/remotes\//, "");
		if (name !== "" && succeeds(cwd, ["rev-parse", "--verify", "-q", `${name}^{commit}`])) return name;
	} catch {
		// No origin/HEAD; fall through to the fixed list.
	}
	return DEFAULT_BRANCHES.find((branch) => succeeds(cwd, ["rev-parse", "--verify", "-q", `${branch}^{commit}`])) ?? null;
}

/** The rule's `base` option when given, then `ANTI_SLOP_BASE`, then the default branch. */
export function resolveBase(cwd: string, base: string | undefined): string | null {
	return base?.trim() || process.env[BASE_ENV]?.trim() || defaultBase(cwd);
}

// The language server lints edits for as long as it runs, so its diffs go stale; a CLI run sees
// one working tree and computes each diff once.
const MAX_AGE_MS = process.argv.includes("--lsp") ? 1000 : Infinity;

const rootByDir = new Map<string, string | null>();
const changesByKey = new Map<string, RepoChanges | null>();

function computeChanges(root: string, base: string | undefined): RepoChanges {
	const computedAt = Date.now();
	if (!succeeds(root, ["rev-parse", "--verify", "-q", "HEAD"])) return { root, files: null, computedAt };
	const ref = resolveBase(root, base);
	if (ref === null) {
		throw new Error(`no default branch found (origin/HEAD, ${DEFAULT_BRANCHES.join(", ")}); set ${BASE_ENV} or the rule's base option`);
	}
	const mergeBase = git(root, ["merge-base", ref, "HEAD"]).trim();
	// The working tree against the merge base covers commits on this branch, staged, and unstaged
	// edits together.
	const diff = git(root, ["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", mergeBase, "--"]);
	const files = new Map<string, ChangedLines>(parseDiff(diff));
	const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
	for (const file of untracked.split("\0").filter(Boolean)) files.set(file, "all");
	return { root, files, computedAt };
}

function repoChanges(dir: string, base: string | undefined, warn: (message: string) => void): RepoChanges | null {
	let root = rootByDir.get(dir);
	try {
		if (root === undefined) {
			root = realpathSync(git(dir, ["rev-parse", "--show-toplevel"]).trim());
			rootByDir.set(dir, root);
		}
		if (root === null) return null;
		const key = `${base ?? ""}\0${root}`;
		const cached = changesByKey.get(key);
		if (cached === null) return null;
		if (cached !== undefined && Date.now() - cached.computedAt <= MAX_AGE_MS) return cached;
		try {
			const changes = computeChanges(root, base);
			changesByKey.set(key, changes);
			return changes;
		} catch (error) {
			changesByKey.set(key, null);
			throw error;
		}
	} catch (error) {
		if (root === undefined) rootByDir.set(dir, null);
		warn(`changed-lines mode could not diff ${dir}, checking every line: ${errorMessage(error).trim()}`);
		return null;
	}
}

/**
 * The lines of a file changed against the merge base of `HEAD` and `base` (default: see
 * `resolveBase`), computed once per repository per run. An empty set means the file is unchanged.
 * Untracked files, and every file before the first commit, count as entirely changed. When git
 * cannot answer, every line counts as changed and `warn` is told why, so a broken diff never
 * silently turns checks off.
 */
export function changedLines(filename: string, base: string | undefined, warn: (message: string) => void): ChangedLines {
	let file: string;
	try {
		file = realpathSync(filename);
	} catch {
		return "all";
	}
	const changes = repoChanges(dirname(file), base, warn);
	if (changes === null || changes.files === null) return "all";
	const path = relative(changes.root, file).split(sep).join("/");
	return changes.files.get(path) ?? new Set();
}

export function overlaps(lines: ChangedLines, start: number, end: number): boolean {
	if (lines === "all") return true;
	for (let line = start; line <= end; line++) if (lines.has(line)) return true;
	return false;
}
