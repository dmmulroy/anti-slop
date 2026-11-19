// Ported from mpsuesser/enfect's `stream-large-files` pattern (https://github.com/mpsuesser/enfect, MIT,
// packages/patterns/stream-large-files.md), an ast-grep hint that @enfect/oxlint does not ship as a rule. The
// upstream pattern matches the path's source text against substrings such as `log`, so it also matches `catalog`
// and `dialog`; this version compares whole words of the path instead.
import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { unwrapNode } from "../shared/effect-modules.ts";

const wholeFileReads: ReadonlySet<string> = new Set(["readFile", "readFileString"]);

/** Words in a path that name data which grows without bound. */
const largeDataWords: ReadonlySet<string> = new Set([
	"archive",
	"backup",
	"csv",
	"dataset",
	"dump",
	"export",
	"huge",
	"jsonl",
	"large",
	"log",
	"logs",
	"ndjson",
]);

const pathBuilders: ReadonlySet<string> = new Set(["join", "resolve"]);

function words(text: string): readonly string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 0);
}

function propertyName(node: ESTree.MemberExpression): string | null {
	return !node.computed && node.property.type === "Identifier" ? node.property.name : null;
}

/** Whether the last part of a built path is computed, so the file it names is not known in the source. */
const isComputedPart = (node: ESTree.Node | undefined): boolean => {
	if (node === undefined) return false;
	const part = unwrapNode(node);
	return !(part.type === "Literal" || (part.type === "TemplateLiteral" && part.expressions.length === 0));
};

/**
 * Whether the path is unbounded: named like large data, taken from a listing (`files[i]`, `entry.path`), or
 * built from parts whose file name is computed. `path.join(dir, "package.json")` names a known file and is
 * left alone; the upstream pattern reports every `path.join`.
 */
function looksUnbounded(path: ESTree.Node, text: string): boolean {
	if (words(text).some((word) => largeDataWords.has(word))) return true;
	const node = unwrapNode(path);
	if (node.type === "BinaryExpression") return node.operator === "+" && isComputedPart(node.right);
	if (node.type === "MemberExpression") return node.computed || propertyName(node) === "path";
	if (node.type !== "CallExpression") return false;
	const callee = unwrapNode(node.callee);
	if (callee.type !== "MemberExpression") return false;
	const receiver = unwrapNode(callee.object);
	const method = propertyName(callee);
	if (receiver.type !== "Identifier" || receiver.name !== "path" || method === null || !pathBuilders.has(method)) return false;
	return isComputedPart(node.arguments.at(-1));
}

/** Reject reading a large or unbounded file into memory at once instead of streaming it. */
export const streamLargeFilesRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow `fs.readFile` and `fs.readFileString` on paths that name large data or are computed from parts, which load the whole file into memory. Stream them with `fs.stream`.",
		},
		messages: {
			streamLargeFile:
				"`fs.{{method}}` loads all of `{{path}}` into memory at once. Stream it instead: `fs.stream(path).pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach(handleLine))`.",
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const callee = unwrapNode(node.callee);
				if (callee.type !== "MemberExpression") return;
				const receiver = unwrapNode(callee.object);
				const method = propertyName(callee);
				if (receiver.type !== "Identifier" || receiver.name !== "fs" || method === null || !wholeFileReads.has(method)) return;
				const [path, encoding, ...rest] = node.arguments;
				if (path === undefined || path.type === "SpreadElement" || rest.length > 0) return;
				if (encoding !== undefined && !(encoding.type === "Literal" && typeof encoding.value === "string")) return;
				const text = context.sourceCode.getText(path);
				if (!looksUnbounded(path, text)) return;
				context.report({ node, messageId: "streamLargeFile", data: { method, path: text.length > 60 ? `${text.slice(0, 57)}...` : text } });
			},
		};
	},
});
