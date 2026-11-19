// Checks that a change weakens the lint setup in ways `ai-guard integrity` does not analyze: oxlint and eslint
// disable comments without a reason, and oxlint config files that lower a rule's severity, turn a rule off,
// add ignore patterns, or drop a JS plugin. Config files are read as text and never executed, so entries
// computed at runtime (spreads, function calls) are not seen.

// oxlint-disable effecttsgo/node-builtin-import -- a standalone CLI outside any Effect runtime, so Effect's platform services do not apply

import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { collectChanges, git, type FileChange } from "../diff-rules/git.ts";

export type IntegrityCheck = "suppression-without-reason" | "rule-weakened" | "ignore-pattern-added" | "js-plugin-removed";

export interface IntegrityFinding {
	readonly file: string;
	readonly line?: number;
	readonly check: IntegrityCheck;
	readonly message: string;
}

export interface IntegrityResult {
	readonly baseLabel: string;
	readonly baseCommit?: string;
	readonly findings: ReadonlyArray<IntegrityFinding>;
}

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
	".js",
	".mjs",
	".cjs",
	".jsx",
	".ts",
	".mts",
	".cts",
	".tsx",
	".vue",
	".svelte",
	".astro",
]);

const isOxlintConfig = (path: string): boolean =>
	/^\.oxlintrc(?:\.[\w-]+)?\.jsonc?$|^oxlint\.config\.[cm]?[jt]s$/.test(basename(path));

const DIRECTIVE = /(?:\/\/|\/\*)\s*((?:oxlint|eslint)-disable(?:-next-line|-line)?)(?=[\s*]|$)([^\n]*?)(?:\*\/|$)/g;

interface Directive {
	readonly key: string;
	readonly text: string;
	readonly line: number;
}

/** Whether `index` falls inside a string literal that opens earlier on the same line. */
function insideString(line: string, index: number): boolean {
	let quote: string | null = null;
	for (let position = 0; position < index; position += 1) {
		const char = line[position];
		if (quote !== null) {
			if (char === "\\") position += 1;
			else if (char === quote) quote = null;
		} else if (char === '"' || char === "'" || char === "`") {
			quote = char;
		}
	}
	return quote !== null;
}

/** Disable directives on one line that give no reason after ` -- `. */
function unexplainedDirectives(line: string, lineNumber: number): Directive[] {
	const found: Directive[] = [];
	for (const match of line.matchAll(DIRECTIVE)) {
		if (insideString(line, match.index)) continue;
		const [whole, kind = "", rest = ""] = match;
		if (/(?:^|\s)--\s*\S/.test(rest)) continue;
		const rules = rest
			.split(",")
			.map((rule) => rule.trim())
			.filter((rule) => rule.length > 0)
			.sort();
		found.push({ key: `${kind} ${rules.join(",")}`, text: whole.replace(/\s*\*\/$/, "").trim(), line: lineNumber });
	}
	return found;
}

/** Disable directives without a reason that the patch adds, net of the ones it removes or moves. */
export function addedUnexplainedDirectives(change: FileChange): IntegrityFinding[] {
	if (!SOURCE_EXTENSIONS.has(extname(change.path))) return [];
	const added: Directive[] = [];
	const removed = new Map<string, number>();
	let newLine = 0;
	for (const line of change.patch.split("\n")) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunk !== null) {
			newLine = Number(hunk[1]);
			continue;
		}
		if (newLine === 0 || line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) {
			added.push(...unexplainedDirectives(line.slice(1), newLine));
			newLine += 1;
		} else if (line.startsWith("-")) {
			for (const directive of unexplainedDirectives(line.slice(1), 0)) {
				removed.set(directive.key, (removed.get(directive.key) ?? 0) + 1);
			}
		} else if (line.startsWith(" ")) {
			newLine += 1;
		}
	}
	return added.flatMap((directive) => {
		const remaining = removed.get(directive.key) ?? 0;
		if (remaining > 0) {
			removed.set(directive.key, remaining - 1);
			return [];
		}
		return [
			{
				file: change.path,
				line: directive.line,
				check: "suppression-without-reason",
				message: `Added \`${directive.text}\` without a reason. Fix the finding, or say why the rule does not apply after \` -- \`.`,
			},
		];
	});
}

/** The text with comments blanked out, so offsets still match the original. Strings are kept. */
function blankComments(text: string): string {
	let out = "";
	let index = 0;
	while (index < text.length) {
		const char = text[index] ?? "";
		const next = text[index + 1];
		if (char === '"' || char === "'" || char === "`") {
			let end = index + 1;
			while (end < text.length && text[end] !== char) end += text[end] === "\\" ? 2 : 1;
			out += text.slice(index, end + 1);
			index = end + 1;
		} else if (char === "/" && next === "/") {
			const end = text.indexOf("\n", index);
			const stop = end === -1 ? text.length : end;
			out += " ".repeat(stop - index);
			index = stop;
		} else if (char === "/" && next === "*") {
			const end = text.indexOf("*/", index + 2);
			const stop = end === -1 ? text.length : end + 2;
			out += text.slice(index, stop).replace(/[^\n]/g, " ");
			index = stop;
		} else {
			out += char;
			index += 1;
		}
	}
	return out;
}

interface Span {
	readonly start: number;
	readonly end: number;
}

/** The index of the bracket that closes the one at `open`, skipping strings. */
function closingBracket(text: string, open: number): number {
	const pairs: Readonly<Record<string, string>> = { "{": "}", "[": "]", "(": ")" };
	const stack: string[] = [];
	for (let index = open; index < text.length; index += 1) {
		const char = text[index] ?? "";
		if (char === '"' || char === "'" || char === "`") {
			index += 1;
			while (index < text.length && text[index] !== char) index += text[index] === "\\" ? 2 : 1;
		} else if (pairs[char] !== undefined) {
			stack.push(pairs[char]);
		} else if (char === stack.at(-1)) {
			stack.pop();
			if (stack.length === 0) return index;
		}
	}
	return text.length;
}

/** The inside of every `key: { ... }` or `key: [ ... ]` value in the config text. */
function blocks(text: string, key: string, open: "{" | "["): Span[] {
	const pattern = new RegExp(`(?:["']${key}["']|\\b${key})\\s*:\\s*\\${open}`, "g");
	return [...text.matchAll(pattern)].map((match) => {
		const start = match.index + match[0].length - 1;
		return { start: start + 1, end: closingBracket(text, start) };
	});
}

/** Offsets in `span` that sit directly inside it, not inside a nested bracket or string. */
function topLevel(text: string, span: Span): (index: number) => boolean {
	const depths = new Int32Array(span.end - span.start + 1);
	let depth = 0;
	let quote: string | null = null;
	for (let index = span.start; index < span.end; index += 1) {
		const char = text[index] ?? "";
		depths[index - span.start] = quote === null ? depth : -1;
		if (quote !== null) {
			if (char === "\\") index += 1;
			else if (char === quote) quote = null;
		} else if (char === '"' || char === "'" || char === "`") {
			quote = char;
		} else if (char === "{" || char === "[" || char === "(") {
			depth += 1;
		} else if (char === "}" || char === "]" || char === ")") {
			depth -= 1;
		}
	}
	return (index) => depths[index - span.start] === 0;
}

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

const SEVERITY_NAMES = ["off", "warn", "error"] as const;

function severity(value: string): number | null {
	if (value === "off" || value === "allow" || value === "0") return 0;
	if (value === "warn" || value === "1") return 1;
	if (value === "error" || value === "deny" || value === "2") return 2;
	return null;
}

interface RuleEntry {
	readonly rule: string;
	readonly severity: number;
	readonly line: number;
}

const RULE_ENTRY = /(?:"([^"\n]+)"|'([^'\n]+)'|([A-Za-z_$][\w$-]*))\s*:\s*(?:\[\s*)?(?:"(\w+)"|'(\w+)'|(\d))/g;

function ruleEntries(text: string): RuleEntry[] {
	return blocks(text, "rules", "{").flatMap((span) => {
		const isTopLevel = topLevel(text, span);
		const body = text.slice(span.start, span.end);
		return [...body.matchAll(RULE_ENTRY)].flatMap((match) => {
			const offset = span.start + match.index;
			const level = severity(match[4] ?? match[5] ?? match[6] ?? "");
			const rule = match[1] ?? match[2] ?? match[3];
			if (!isTopLevel(offset) || level === null || rule === undefined) return [];
			return [{ rule, severity: level, line: lineAt(text, offset) }];
		});
	});
}

interface ListEntry {
	readonly value: string;
	readonly line: number;
}

const STRING = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`$]*)`/g;

function ignorePatterns(text: string): ListEntry[] {
	return blocks(text, "ignorePatterns", "[").flatMap((span) => {
		const isTopLevel = topLevel(text, span);
		return [...text.slice(span.start, span.end).matchAll(STRING)].flatMap((match) => {
			const offset = span.start + match.index;
			const value = match[1] ?? match[2] ?? match[3];
			return isTopLevel(offset) && value !== undefined ? [{ value, line: lineAt(text, offset) }] : [];
		});
	});
}

const stringProperty = (text: string, key: string): string | undefined => {
	const match = new RegExp(`(?:["']${key}["']|\\b${key})\\s*:\\s*(?:"([^"\\n]*)"|'([^'\\n]*)')`).exec(text);
	return match === null ? undefined : (match[1] ?? match[2]);
};

/** Each `jsPlugins` entry, named by its `name`, else its specifier, so pointing a plugin at a new module is not a removal. */
function jsPlugins(text: string): ListEntry[] {
	return blocks(text, "jsPlugins", "[").flatMap((span) => {
		const isTopLevel = topLevel(text, span);
		const entries: ListEntry[] = [];
		for (let index = span.start; index < span.end; index += 1) {
			if (!isTopLevel(index)) continue;
			const char = text[index];
			if (char === "{") {
				const end = closingBracket(text, index);
				const element = text.slice(index, end + 1);
				const name = stringProperty(element, "name");
				const specifier = stringProperty(element, "specifier");
				const value = name ?? specifier;
				if (value !== undefined) entries.push({ value, line: lineAt(text, index) });
				index = end;
			} else if (char === '"' || char === "'") {
				const end = text.indexOf(char, index + 1);
				entries.push({ value: text.slice(index + 1, end), line: lineAt(text, index) });
				index = end;
			}
		}
		return entries;
	});
}

/** Multiset difference: the entries of `after` beyond those in `before`, compared by `key`. */
function addedEntries<T>(before: ReadonlyArray<T>, after: ReadonlyArray<T>, key: (entry: T) => string): T[] {
	const counts = new Map<string, number>();
	for (const entry of before) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
	return after.filter((entry) => {
		const remaining = counts.get(key(entry)) ?? 0;
		if (remaining > 0) counts.set(key(entry), remaining - 1);
		return remaining === 0;
	});
}

/** Rules, ignore patterns, and JS plugins that an oxlint config change weakens. */
export function configWeakenings(file: string, beforeText: string, afterText: string): IntegrityFinding[] {
	const before = blankComments(beforeText);
	const after = blankComments(afterText);
	const findings: IntegrityFinding[] = [];
	const beforeRules = ruleEntries(before);
	const afterRules = ruleEntries(after);
	const ruleKey = (entry: RuleEntry): string => `${entry.rule}\0${entry.severity}`;
	const added = addedEntries(beforeRules, afterRules, ruleKey);
	const removed = addedEntries(afterRules, beforeRules, ruleKey);
	const reported = new Set<string>();
	for (const entry of added) {
		const strongest = Math.max(-1, ...beforeRules.filter((old) => old.rule === entry.rule).map((old) => old.severity));
		if (reported.has(entry.rule) || (entry.severity > 0 && entry.severity >= strongest)) continue;
		reported.add(entry.rule);
		const to = SEVERITY_NAMES[entry.severity] ?? "off";
		const was = SEVERITY_NAMES[strongest] ?? "error";
		const message =
			entry.severity === 0
				? `Turned off \`${entry.rule}\`${strongest > 0 ? ` (was ${was})` : ""}.`
				: `Lowered \`${entry.rule}\` from ${was} to ${to}.`;
		findings.push({ file, line: entry.line, check: "rule-weakened", message });
	}
	for (const entry of removed) {
		if (reported.has(entry.rule) || entry.severity === 0) continue;
		if (added.some((replacement) => replacement.rule === entry.rule && replacement.severity >= entry.severity)) continue;
		reported.add(entry.rule);
		findings.push({
			file,
			check: "rule-weakened",
			message: `Removed \`${entry.rule}\` (${SEVERITY_NAMES[entry.severity] ?? "error"}), so it no longer runs where that entry applied.`,
		});
	}
	for (const pattern of addedEntries(ignorePatterns(before), ignorePatterns(after), (entry) => entry.value)) {
		findings.push({ file, line: pattern.line, check: "ignore-pattern-added", message: `Added ignore pattern \`${pattern.value}\`; oxlint no longer checks matching files.` });
	}
	for (const plugin of addedEntries(jsPlugins(after), jsPlugins(before), (entry) => entry.value)) {
		findings.push({ file, check: "js-plugin-removed", message: `Removed the jsPlugins entry \`${plugin.value}\`, so none of its rules run.` });
	}
	return findings;
}

function baseText(root: string, commit: string | undefined, path: string): string {
	if (commit === undefined) return "";
	const result = git(root, ["show", `${commit}:${path}`]);
	return result.status === 0 ? result.stdout : "";
}

export interface IntegrityOptions {
	readonly cwd: string;
	/** Branch or ref whose merge base with HEAD is the base; the default branch when absent. */
	readonly base?: string;
}

/** Compare the working tree, untracked files included, with the merge base of HEAD and the base branch. */
export function checkIntegrity(options: IntegrityOptions): IntegrityResult {
	const changes = collectChanges({ cwd: options.cwd, mode: "full", exclude: [], ...(options.base === undefined ? {} : { base: options.base }) });
	const findings: IntegrityFinding[] = [];
	for (const change of changes.files) {
		findings.push(...addedUnexplainedDirectives(change));
		if (!isOxlintConfig(change.path) && !(change.oldPath !== undefined && isOxlintConfig(change.oldPath))) continue;
		const before = change.status === "added" ? "" : baseText(changes.root, changes.baseCommit, change.oldPath ?? change.path);
		const after = change.status === "deleted" ? "" : readFileSync(join(changes.root, change.path), "utf8");
		findings.push(...configWeakenings(change.path, before, after));
	}
	return {
		baseLabel: changes.baseLabel,
		...(changes.baseCommit === undefined ? {} : { baseCommit: changes.baseCommit }),
		findings,
	};
}
