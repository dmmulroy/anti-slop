import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type FunctionLike = ESTree.ArrowFunctionExpression | ESTree.Function;

type Assertion = {
	readonly subject: ESTree.Node | null;
	readonly expected: ESTree.Node | null;
};

type TestFrame = {
	readonly node: ESTree.CallExpression;
	assertions: number;
	mockOnly: boolean;
};

const TEST_CALLEES = new Set(["it", "test"]);
const MOCK_NAMESPACES = new Set(["jest", "mock", "sinon", "td", "vi"]);
const MOCK_FACTORIES = new Set(["fn", "mock", "spy", "spyOn", "stub"]);
const EQUALITY_ASSERTIONS = new Set([
	"deepEqual",
	"deepStrictEqual",
	"equal",
	"notDeepEqual",
	"notDeepStrictEqual",
	"notEqual",
	"notStrictEqual",
	"strictEqual",
]);
const COMPARISON_OPERATORS = new Set(["!=", "!==", "<", "<=", "==", "===", ">", ">="]);

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
		if (current.type === "AwaitExpression") {
			current = current.argument;
			continue;
		}
		return current;
	}
}

/** Walk member and call chains down to the identifier or call the chain is built on. */
function chainRoot(node: ESTree.Node): ESTree.Node {
	let current = unwrapExpression(node);
	for (;;) {
		if (current.type === "MemberExpression") {
			current = unwrapExpression(current.object);
			continue;
		}
		if (current.type === "CallExpression" && current.callee.type !== "Identifier") {
			current = unwrapExpression(current.callee);
			continue;
		}
		return current;
	}
}

function argumentAt(node: ESTree.CallExpression, index: number): ESTree.Node | null {
	const argument = node.arguments[index];
	return argument === undefined || argument.type === "SpreadElement" ? null : argument;
}

function assertion(node: ESTree.CallExpression): Assertion | null {
	if (node.callee.type === "Identifier") {
		if (node.callee.name === "assert") return { subject: argumentAt(node, 0), expected: null };
		if (!EQUALITY_ASSERTIONS.has(node.callee.name)) return null;
		return { subject: argumentAt(node, 0), expected: argumentAt(node, 1) };
	}
	if (node.callee.type !== "MemberExpression") return null;

	const root = chainRoot(node.callee);
	if (root.type === "Identifier") {
		return root.name === "assert"
			? { subject: argumentAt(node, 0), expected: argumentAt(node, 1) }
			: null;
	}
	if (root.type !== "CallExpression" || root.callee.type !== "Identifier") return null;
	return root.callee.name === "expect"
		? { subject: argumentAt(root, 0), expected: argumentAt(node, 0) }
		: null;
}

function isTestCall(node: ESTree.CallExpression): boolean {
	const root = chainRoot(node.callee);
	return root.type === "Identifier" && TEST_CALLEES.has(root.name);
}

function isMockFactoryCall(node: ESTree.Node): boolean {
	const call = unwrapExpression(node);
	if (call.type !== "CallExpression" || call.callee.type !== "MemberExpression") return false;
	const { object, property } = call.callee;
	if (property.type !== "Identifier" || !MOCK_FACTORIES.has(property.name)) return false;
	const namespace = chainRoot(object);
	return namespace.type === "Identifier" && MOCK_NAMESPACES.has(namespace.name);
}

function parameterNames(node: FunctionLike): readonly string[] | null {
	const names: string[] = [];
	for (const parameter of node.params) {
		if (parameter.type !== "Identifier") return null;
		names.push(parameter.name);
	}
	return names.length === 0 ? null : names;
}

function returnedExpression(node: FunctionLike): ESTree.Node | null {
	const body = node.body;
	if (body === null || body === undefined) return null;
	if (body.type !== "BlockStatement") return body;
	if (body.body.length !== 1) return null;
	const [statement] = body.body;
	return statement?.type === "ReturnStatement" ? statement.argument : null;
}

/** A function passed straight to a call is call-site syntax, not an indirection in the API surface. */
function isInlineCallback(node: FunctionLike): boolean {
	const parent = node.parent;
	if (parent.type !== "CallExpression" && parent.type !== "NewExpression") return false;
	return parent.callee !== node;
}

function isPassThrough(node: FunctionLike): boolean {
	if (isInlineCallback(node)) return false;
	const names = parameterNames(node);
	const returned = returnedExpression(node);
	if (names === null || returned === null) return false;

	if (returned.type === "Identifier") return names.includes(returned.name);
	if (returned.type !== "CallExpression" || returned.arguments.length !== names.length) {
		return false;
	}
	return returned.arguments.every(
		(argument, index) => argument.type === "Identifier" && argument.name === names[index],
	);
}

/** Reject constructs that only prove themselves: self-comparing assertions, mock-only tests, and pass-through functions. */
export const noSelfLickingRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow self-licking constructs: assertions that compare a value to itself, tests that only assert on their own doubles, and functions that forward their parameters unchanged.",
		},
		messages: {
			tautologicalAssertion:
				"This assertion compares a value to itself, so it passes no matter what the code under test does. Assert the value the implementation is expected to produce.",
			mockOnlyAssertion:
				"This test only asserts on doubles it created, so it proves the mock rather than the system. Assert an observable result of the code under test.",
			passThroughWrapper:
				"This function forwards its parameters unchanged and adds no behavior, so it hides the real call site without adding evidence. Call the underlying operation directly or give this function real work.",
		},
	},
	create(context) {
		const mockNames = new Set<string>();
		const frames: TestFrame[] = [];

		const normalizedText = (node: ESTree.Node): string =>
			context.sourceCode.getText(node).replaceAll(/\s+/gu, "");

		const isSelfComparison = ({ subject, expected }: Assertion): boolean => {
			if (subject === null) return false;
			if (expected !== null && normalizedText(subject) === normalizedText(expected)) return true;

			const inner = unwrapExpression(subject);
			return (
				inner.type === "BinaryExpression" &&
				COMPARISON_OPERATORS.has(inner.operator) &&
				inner.left.type !== "PrivateIdentifier" &&
				normalizedText(inner.left) === normalizedText(inner.right)
			);
		};

		const recordAssertion = (node: ESTree.CallExpression, { subject }: Assertion) => {
			const frame = frames.at(-1);
			if (frame === undefined || frame.node === node) return;
			frame.assertions += 1;
			if (subject === null) {
				frame.mockOnly = false;
				return;
			}
			const root = chainRoot(subject);
			if (root.type !== "Identifier" || !mockNames.has(root.name)) frame.mockOnly = false;
		};

		const checkFunction = (node: FunctionLike) => {
			if (!isPassThrough(node)) return;
			context.report({ node, messageId: "passThroughWrapper" });
		};

		return {
			VariableDeclarator(node) {
				if (node.id.type !== "Identifier" || node.init === null) return;
				if (isMockFactoryCall(node.init)) mockNames.add(node.id.name);
			},
			CallExpression(node) {
				if (isTestCall(node)) frames.push({ node, assertions: 0, mockOnly: true });

				const found = assertion(node);
				if (found === null) return;
				if (isSelfComparison(found)) {
					context.report({ node, messageId: "tautologicalAssertion" });
				}
				recordAssertion(node, found);
			},
			"CallExpression:exit"(node) {
				const frame = frames.at(-1);
				if (frame === undefined || frame.node !== node) return;
				frames.pop();
				if (frame.assertions > 0 && frame.mockOnly) {
					context.report({ node: node.callee, messageId: "mockOnlyAssertion" });
				}
			},
			ArrowFunctionExpression: checkFunction,
			FunctionDeclaration: checkFunction,
			FunctionExpression: checkFunction,
		};
	},
});
