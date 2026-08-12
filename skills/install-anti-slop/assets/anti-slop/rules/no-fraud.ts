import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type FunctionLike = ESTree.ArrowFunctionExpression | ESTree.Function;

type CatchFrame = {
	readonly node: ESTree.CatchClause;
	functionDepth: number;
	returns: number;
	fabricatedReturns: number;
	throws: number;
};

const PLACEHOLDER_VALUES = [
	"changeme",
	"example.com",
	"example.net",
	"example.org",
	"foo@bar",
	"jane doe",
	"john doe",
	"lorem ipsum",
	"test@test",
	"your-api-key",
];
const FAILURE_KEYS = new Set(["cause", "error", "errors", "failed", "failure"]);
const OUTCOME_KEYS = new Set(["ok", "success"]);
const UNFINISHED_COMMENT = /\b(?:todo|fixme|unimplemented|not implemented)\b/iu;
const TEST_FILE =
	/(?:^|[/\\])(?:__tests__|__mocks__|fixtures|mocks|tests?)[/\\]|\.(?:test|spec|stories|mock|fixture)\.[cm]?[jt]sx?$/iu;

function unwrapExpression(node: ESTree.Node): ESTree.Node {
	let current = node;
	for (;;) {
		if (
			current.type === "ParenthesizedExpression" ||
			current.type === "TSAsExpression" ||
			current.type === "TSSatisfiesExpression" ||
			current.type === "TSNonNullExpression"
		) {
			current = current.expression;
			continue;
		}
		return current;
	}
}

function isLiteralValue(node: ESTree.Node): boolean {
	const value = unwrapExpression(node);
	switch (value.type) {
		case "Literal":
			return true;
		case "TemplateLiteral":
			return value.expressions.length === 0;
		case "UnaryExpression":
			return (value.operator === "-" || value.operator === "!") && isLiteralValue(value.argument);
		case "ArrayExpression":
			return value.elements.every(
				(element) =>
					element !== null && element.type !== "SpreadElement" && isLiteralValue(element),
			);
		case "ObjectExpression":
			return value.properties.every(
				(property) =>
					property.type === "Property" && !property.computed && isLiteralValue(property.value),
			);
		default:
			return false;
	}
}

function propertyName(property: ESTree.ObjectProperty): string | null {
	if (property.computed) return null;
	if (property.key.type === "Identifier") return property.key.name;
	return property.key.type === "Literal" && typeof property.key.value === "string"
		? property.key.value
		: null;
}

/** An object literal is not a success claim when it names a failure or sets an outcome flag to false. */
function declaresFailure(value: ESTree.ObjectExpression): boolean {
	return value.properties.some((property) => {
		if (property.type !== "Property") return false;
		const name = propertyName(property);
		if (name === null) return false;
		if (FAILURE_KEYS.has(name)) return true;
		return (
			OUTCOME_KEYS.has(name) && property.value.type === "Literal" && property.value.value === false
		);
	});
}

/** A hardcoded value that reports success: `true`, or an object or array built only from literals. */
function isFabricatedSuccess(node: ESTree.Node): boolean {
	const value = unwrapExpression(node);
	if (value.type === "Literal") return value.value === true;
	if (value.type === "ArrayExpression") return isLiteralValue(value);
	return value.type === "ObjectExpression" && isLiteralValue(value) && !declaresFailure(value);
}

function finalReturnedExpression(node: FunctionLike): ESTree.Node | null {
	const body = node.body;
	if (body === null || body === undefined) return null;
	if (body.type !== "BlockStatement") return body;
	const last = body.body.at(-1);
	return last?.type === "ReturnStatement" ? last.argument : null;
}

/** Reject implementations that claim work they never do: fake success, swallowed failures, and placeholder data. */
export const noFraudRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow fraudulent implementations: functions that ignore their inputs and return hardcoded success, catch clauses that discard the error and report success, and placeholder data in production source.",
		},
		messages: {
			fakeSuccess:
				"This function accepts inputs it never reads and returns a hardcoded success, so callers cannot tell the work never happened. Implement the operation, or make the unfinished path fail loudly.",
			errorSwallowedSuccess:
				"This catch clause discards the error and reports success, hiding the failure from callers. Return a failure result, or rethrow with the original error as `cause`.",
			placeholderData:
				'Placeholder value "{{value}}" ships in production source and misrepresents real data. Read the value from configuration, or take it from the caller.',
		},
	},
	create(context) {
		if (TEST_FILE.test(context.filename)) return {};

		const frames: CatchFrame[] = [];

		const ignoresParameters = (node: FunctionLike): boolean => {
			const parameters = context.sourceCode
				.getDeclaredVariables(node)
				.filter((variable) => variable.defs.some((definition) => definition.type === "Parameter"))
				.filter((variable) => !variable.name.startsWith("_"));
			return (
				parameters.length > 0 && parameters.every((variable) => variable.references.length === 0)
			);
		};

		const hasUnfinishedComment = (node: FunctionLike): boolean =>
			context.sourceCode
				.getCommentsInside(node)
				.some((comment) => UNFINISHED_COMMENT.test(comment.value));

		const checkFunction = (node: FunctionLike) => {
			const frame = frames.at(-1);
			if (frame !== undefined) frame.functionDepth += 1;

			if (node.params.length === 0) return;
			const returned = finalReturnedExpression(node);
			if (returned === null || !isFabricatedSuccess(returned)) return;
			if (!ignoresParameters(node) && !hasUnfinishedComment(node)) return;
			context.report({ node: returned, messageId: "fakeSuccess" });
		};

		const exitFunction = () => {
			const frame = frames.at(-1);
			if (frame !== undefined) frame.functionDepth -= 1;
		};

		const checkPlaceholder = (node: ESTree.Node, text: string) => {
			const lowercased = text.toLowerCase();
			const value = PLACEHOLDER_VALUES.find((candidate) => lowercased.includes(candidate));
			if (value === undefined) return;
			context.report({ node, messageId: "placeholderData", data: { value } });
		};

		return {
			ArrowFunctionExpression: checkFunction,
			FunctionDeclaration: checkFunction,
			FunctionExpression: checkFunction,
			"ArrowFunctionExpression:exit": exitFunction,
			"FunctionDeclaration:exit": exitFunction,
			"FunctionExpression:exit": exitFunction,
			CatchClause(node) {
				frames.push({ node, functionDepth: 0, returns: 0, fabricatedReturns: 0, throws: 0 });
			},
			ReturnStatement(node) {
				const frame = frames.at(-1);
				if (frame === undefined || frame.functionDepth > 0) return;
				frame.returns += 1;
				if (node.argument !== null && isFabricatedSuccess(node.argument)) {
					frame.fabricatedReturns += 1;
				}
			},
			ThrowStatement() {
				const frame = frames.at(-1);
				if (frame === undefined || frame.functionDepth > 0) return;
				frame.throws += 1;
			},
			"CatchClause:exit"(node) {
				const frame = frames.at(-1);
				if (frame === undefined || frame.node !== node) return;
				frames.pop();

				const usesError =
					node.param !== null &&
					context.sourceCode
						.getDeclaredVariables(node)
						.some((variable) => variable.references.length > 0);
				if (
					usesError ||
					frame.throws > 0 ||
					frame.returns === 0 ||
					frame.returns !== frame.fabricatedReturns
				) {
					return;
				}
				context.report({ node, messageId: "errorSwallowedSuccess" });
			},
			Literal(node) {
				if (typeof node.value !== "string") return;
				checkPlaceholder(node, node.value);
			},
			TemplateElement(node) {
				checkPlaceholder(node, node.value.cooked ?? node.value.raw);
			},
		};
	},
});
