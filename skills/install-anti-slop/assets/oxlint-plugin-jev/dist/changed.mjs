import { realpathSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
//#region src/changed.ts
/**
* The oxlint `settings` key that carries per-rule modes and the base ref, so a rule reads its mode
* from `context.settings` instead of from its own options:
*
* `settings: { changedLines: { rules: { "<plugin>/<rule>": "changed" }, base: "origin/main" } }`
*/
const SETTINGS_KEY = "changedLines";
/** Tried in order after `refs/remotes/origin/HEAD` when resolving the default branch. */
const DEFAULT_BRANCHES = [
	"origin/main",
	"origin/master",
	"main",
	"master"
];
const BASE_ENV = "JEV_CHANGED_BASE";
const git = (cwd, args) => execFileSync("git", [
	"-c",
	"core.quotePath=false",
	...args
], {
	cwd,
	encoding: "utf8",
	maxBuffer: 268435456,
	stdio: [
		"ignore",
		"pipe",
		"pipe"
	]
});
const succeeds = (cwd, args) => {
	try {
		git(cwd, args);
		return true;
	} catch {
		return false;
	}
};
const messageOf = (error) => error instanceof Error ? error.message.trim() : String(error);
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function changedSettings(settings) {
	if (!isRecord(settings)) return void 0;
	const own = settings[SETTINGS_KEY];
	return isRecord(own) ? own : void 0;
}
/** The mode `settings.changedLines.rules` gives `ruleId`, or `fallback` when it names none. */
function ruleMode(settings, ruleId, fallback) {
	const rules = changedSettings(settings)?.rules;
	const mode = isRecord(rules) ? rules[ruleId] : void 0;
	return mode === "all" || mode === "changed" ? mode : fallback;
}
/** The base ref `settings.changedLines.base` names, if any. */
function settingsBase(settings) {
	const base = changedSettings(settings)?.base;
	return typeof base === "string" && base.trim() !== "" ? base.trim() : void 0;
}
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
/** Parses `git diff -U0` output into the new-side line numbers each file changed. */
function parseDiff(diff) {
	const files = /* @__PURE__ */ new Map();
	let current = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const target = line.slice(4);
			current = null;
			if (target.startsWith("b/")) {
				current = files.get(target.slice(2)) ?? /* @__PURE__ */ new Set();
				files.set(target.slice(2), current);
			}
			continue;
		}
		const hunk = current === null ? null : HUNK.exec(line);
		if (hunk === null || current === null) continue;
		const start = Number(hunk[1]);
		const count = hunk[2] === void 0 ? 1 : Number(hunk[2]);
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
function defaultBase(cwd) {
	try {
		const name = git(cwd, [
			"symbolic-ref",
			"-q",
			"refs/remotes/origin/HEAD"
		]).trim().replace(/^refs\/remotes\//, "");
		if (name !== "" && succeeds(cwd, [
			"rev-parse",
			"--verify",
			"-q",
			`${name}^{commit}`
		])) return name;
	} catch {}
	return DEFAULT_BRANCHES.find((branch) => succeeds(cwd, [
		"rev-parse",
		"--verify",
		"-q",
		`${branch}^{commit}`
	])) ?? null;
}
/** The explicit base when given, then `JEV_CHANGED_BASE`, then the default branch. */
function resolveBase(cwd, base) {
	return base?.trim() || process.env[BASE_ENV]?.trim() || defaultBase(cwd);
}
const MAX_AGE_MS = process.argv.includes("--lsp") ? 1e3 : Infinity;
const rootByDir = /* @__PURE__ */ new Map();
const changesByKey = /* @__PURE__ */ new Map();
function computeChanges(root, base) {
	const computedAt = Date.now();
	if (!succeeds(root, [
		"rev-parse",
		"--verify",
		"-q",
		"HEAD"
	])) return {
		root,
		files: null,
		computedAt
	};
	const ref = resolveBase(root, base);
	if (ref === null) throw new Error(`no default branch found (origin/HEAD, ${DEFAULT_BRANCHES.join(", ")}); set ${BASE_ENV} or the base setting`);
	const mergeBase = git(root, [
		"merge-base",
		ref,
		"HEAD"
	]).trim();
	const diff = git(root, [
		"diff",
		"-U0",
		"--no-color",
		"--no-ext-diff",
		"--no-renames",
		"--src-prefix=a/",
		"--dst-prefix=b/",
		mergeBase,
		"--"
	]);
	const files = new Map(parseDiff(diff));
	const untracked = git(root, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z"
	]);
	for (const file of untracked.split("\0").filter(Boolean)) files.set(file, "all");
	return {
		root,
		files,
		computedAt
	};
}
function repoChanges(dir, base, warn) {
	let root = rootByDir.get(dir);
	try {
		if (root === void 0) {
			root = realpathSync(git(dir, ["rev-parse", "--show-toplevel"]).trim());
			rootByDir.set(dir, root);
		}
		if (root === null) return null;
		const key = `${base ?? ""}\0${root}`;
		const cached = changesByKey.get(key);
		if (cached === null) return null;
		if (cached !== void 0 && Date.now() - cached.computedAt <= MAX_AGE_MS) return cached;
		try {
			const changes = computeChanges(root, base);
			changesByKey.set(key, changes);
			return changes;
		} catch (error) {
			changesByKey.set(key, null);
			throw error;
		}
	} catch (error) {
		if (root === void 0) rootByDir.set(dir, null);
		warn(`changed-lines mode could not diff ${dir}, checking every line: ${messageOf(error)}`);
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
function changedLines(filename, base, warn) {
	let file;
	try {
		file = realpathSync(filename);
	} catch {
		return "all";
	}
	const changes = repoChanges(path.dirname(file), base, warn);
	if (changes === null || changes.files === null) return "all";
	const relative = path.relative(changes.root, file).split(path.sep).join("/");
	return changes.files.get(relative) ?? /* @__PURE__ */ new Set();
}
function overlaps(lines, start, end) {
	if (lines === "all") return true;
	for (let line = start; line <= end; line++) if (lines.has(line)) return true;
	return false;
}
//#endregion
export { DEFAULT_BRANCHES, SETTINGS_KEY, changedLines, defaultBase, overlaps, parseDiff, resolveBase, ruleMode, settingsBase };
