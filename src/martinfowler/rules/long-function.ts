import { defineRule, type ESTree } from "@oxlint/plugins";

import {
	childNodes,
	describeFunction,
	functionName,
	type FunctionNode,
	functionReportNode,
	isFunctionNode,
	isIgnoredTestFile,
	lineSpan,
	numberOption,
} from "../shared.ts";

const defaultMaxStatements = 30;
const defaultMaxLines = 80;

function isCountedStatement(node: ESTree.Node): boolean {
	if (node.type === "BlockStatement" || node.type === "EmptyStatement") return false;
	return (
		node.type.endsWith("Statement") ||
		node.type === "VariableDeclaration" ||
		node.type === "FunctionDeclaration" ||
		node.type === "ClassDeclaration"
	);
}

interface OwnSize {
	readonly statements: number;
	readonly nestedLines: number;
}

/** Statements and nested-function lines inside `root`, stopping at nested function boundaries. */
function measure(root: ESTree.Node): OwnSize {
	let statements = 0;
	let nestedLines = 0;
	const pending: Array<ESTree.Node> = [...childNodes(root)];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) break;
		if (isCountedStatement(node)) statements += 1;
		if (isFunctionNode(node)) {
			nestedLines += lineSpan(node) - 1;
			continue;
		}
		pending.push(...childNodes(node));
	}
	return { statements, nestedLines };
}

/** Flag functions whose own body, excluding nested functions, has too many statements or lines. */
export const longFunctionRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Flag functions whose own statements or lines exceed a threshold (Refactoring, Long Function).",
		},
		messages: {
			long: "Possibly Long Function: {{subject}} has {{statements}} statements over {{lines}} lines of its own (limits {{maxStatements}} statements, {{maxLines}} lines), so a reader must hold every step in mind at once. Consider Extract Function: move each step into a function named for what it does (in Effect, a named `Effect.fn(\"domain.operation\")` step that this function yields).",
		},
		schema: [
			{
				type: "object",
				properties: {
					ignoreTests: { type: "boolean" },
					maxStatements: { type: "integer", minimum: 1 },
					maxLines: { type: "integer", minimum: 1 },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [
			{ ignoreTests: true, maxStatements: defaultMaxStatements, maxLines: defaultMaxLines },
		],
	},
	createOnce(context) {
		const check = (node: FunctionNode) => {
			if (node.body === null || node.body === undefined) return;
			if (node.body.type !== "BlockStatement") return;
			const maxStatements = numberOption(context.options, "maxStatements", defaultMaxStatements);
			const maxLines = numberOption(context.options, "maxLines", defaultMaxLines);
			const { statements, nestedLines } = measure(node.body);
			const lines = lineSpan(node) - nestedLines;
			if (statements <= maxStatements && lines <= maxLines) return;
			context.report({
				node: functionReportNode(node),
				messageId: "long",
				data: {
					subject: describeFunction(functionName(node, context.sourceCode)),
					statements,
					lines,
					maxStatements,
					maxLines,
				},
			});
		};
		return {
			before() {
				return isIgnoredTestFile(context) ? false : undefined;
			},
			FunctionDeclaration: check,
			FunctionExpression: check,
			ArrowFunctionExpression: check,
		};
	},
});
