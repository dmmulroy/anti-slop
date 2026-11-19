// Ported from ai-guard-dev/eslint-plugin-ai-guard's `no-tautological-assertion` (https://github.com/ai-guard-dev/eslint-plugin-ai-guard,
// MIT, eslint-plugin-ai-guard 1.4.7, Copyright (c) 2026 eslint-plugin-ai-guard contributors), with its `getExpectMatcher`
// helper. Upstream treats every `assert` as Node's `assert`, including a locally declared or imported invariant helper
// such as `function assert(condition, message)`, and any `{ assert }` or `{ strict }` import. This port resolves `assert`
// through scope: only a global `assert`, or one imported or required from an assertion module or test runner, counts.
import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

/**
 * Type-level test files (`types.test.ts`, `*.test-d.ts`) check types at compile time;
 * a runtime `expect(true).toBeTruthy()` there is a deliberate placeholder.
 */
const typeTestFile = /(?:^|[\\/.\-_])(?:types?|typings?)(?:[.\-_](?:test|spec))?\.(?:test|spec)\.[cm]?[jt]sx?$|\.test-d\.[cm]?tsx?$|[\\/]type-?tests?[\\/]/i;

/** Modules whose default export, namespace, and named exports are assertion functions. */
const assertModules: ReadonlySet<string> = new Set(["assert", "node:assert", "assert/strict", "node:assert/strict", "chai", "power-assert", "uvu/assert"]);

/** Test runners that export an `assert` namespace next to other helpers. */
const runnerModules: ReadonlySet<string> = new Set(["vitest", "@jest/globals", "bun:test", "@playwright/test", "node:test", "tap"]);

type Static = { readonly value: unknown } | null;

const maxStaticDepth = 8;

const isTruthy = (value: unknown): boolean => Boolean(value);

const isNumeric = (value: unknown): value is number | string | boolean | null =>
	typeof value === "number" || typeof value === "string" || typeof value === "boolean" || value === null;

/** `a - b` for two numbers or the order of two strings; null when JavaScript would coerce. */
function compare(a: unknown, b: unknown): number | null {
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
	return null;
}

function unaryValue(operator: string, value: unknown): Static {
	switch (operator) {
		case "!":
			return { value: !isTruthy(value) };
		case "-":
			return isNumeric(value) ? { value: -Number(value) } : null;
		case "+":
			return isNumeric(value) ? { value: Number(value) } : null;
		case "~":
			return typeof value === "number" ? { value: ~value } : null;
		case "typeof":
			return { value: typeof value };
		case "void":
			return { value: undefined };
		default:
			return null;
	}
}

function arithmetic(operator: string, a: number, b: number): Static {
	switch (operator) {
		case "+":
			return { value: a + b };
		case "-":
			return { value: a - b };
		case "*":
			return { value: a * b };
		case "/":
			return { value: a / b };
		case "%":
			return { value: a % b };
		case "**":
			return { value: a ** b };
		default:
			return null;
	}
}

function binaryValue(operator: string, a: unknown, b: unknown): Static {
	switch (operator) {
		case "===":
			return { value: a === b };
		case "!==":
			return { value: a !== b };
		// Loose comparisons mirror what the code under evaluation wrote.
		case "==":
			return { value: a == b };
		case "!=":
			return { value: a != b };
		case "<":
		case ">":
		case "<=":
		case ">=": {
			const order = compare(a, b);
			if (order === null || Number.isNaN(order)) return order === null ? null : { value: false };
			return { value: operator === "<" ? order < 0 : operator === ">" ? order > 0 : operator === "<=" ? order <= 0 : order >= 0 };
		}
		default:
			if (operator === "+" && (typeof a === "string" || typeof b === "string") && isNumeric(a) && isNumeric(b)) {
				return { value: `${a}${b}` };
			}
			return typeof a === "number" && typeof b === "number" ? arithmetic(operator, a, b) : null;
	}
}

function propertyKey(property: ESTree.Node): string | null {
	if (property.type !== "Property" || property.computed || property.kind !== "init") return null;
	if (property.key.type === "Identifier") return property.key.name;
	return property.key.type === "Literal" ? String(property.key.value) : null;
}

/** The value of an expression that does not depend on any code under test. */
function staticValue(node: ESTree.Node | null | undefined, depth = 0): Static {
	if (node === null || node === undefined || depth > maxStaticDepth) return null;
	switch (node.type) {
		case "Literal":
			if ("regex" in node && node.regex !== undefined && node.regex !== null) return null;
			return { value: node.value };
		case "TemplateLiteral":
			return node.expressions.length === 0 ? { value: node.quasis[0]?.value.cooked ?? "" } : null;
		case "Identifier":
			if (node.name === "undefined") return { value: undefined };
			if (node.name === "NaN") return { value: Number.NaN };
			if (node.name === "Infinity") return { value: Number.POSITIVE_INFINITY };
			return null;
		case "UnaryExpression": {
			if (node.operator === "delete") return null;
			const inner = staticValue(node.argument, depth + 1);
			return inner === null ? null : unaryValue(node.operator, inner.value);
		}
		case "BinaryExpression": {
			if (node.left.type === "PrivateIdentifier") return null;
			const left = staticValue(node.left, depth + 1);
			const right = staticValue(node.right, depth + 1);
			return left === null || right === null ? null : binaryValue(node.operator, left.value, right.value);
		}
		case "LogicalExpression": {
			const left = staticValue(node.left, depth + 1);
			if (left === null) return null;
			if (node.operator === "&&") return isTruthy(left.value) ? staticValue(node.right, depth + 1) : left;
			if (node.operator === "||") return isTruthy(left.value) ? left : staticValue(node.right, depth + 1);
			return left.value === null || left.value === undefined ? staticValue(node.right, depth + 1) : left;
		}
		case "ArrayExpression": {
			const items: unknown[] = [];
			for (const element of node.elements) {
				if (element === null || element.type === "SpreadElement") return null;
				const item = staticValue(element, depth + 1);
				if (item === null) return null;
				items.push(item.value);
			}
			return { value: items };
		}
		case "ObjectExpression": {
			const entries = new Map<string, unknown>();
			for (const property of node.properties) {
				const key = propertyKey(property);
				if (key === null || property.type !== "Property") return null;
				const value = staticValue(property.value, depth + 1);
				if (value === null) return null;
				entries.set(key, value.value);
			}
			return { value: Object.fromEntries(entries) };
		}
		case "ParenthesizedExpression":
		case "TSAsExpression":
		case "TSNonNullExpression":
		case "TSSatisfiesExpression":
			return staticValue(node.expression, depth + 1);
		default:
			return null;
	}
}

function definedEntries(value: object): ReadonlyMap<string, unknown> {
	return new Map(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
	}
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) || Array.isArray(b)) return false;
	const left = definedEntries(a);
	const right = definedEntries(b);
	return left.size === right.size && [...left].every(([key, value]) => right.has(key) && deepEqual(value, right.get(key)));
}

interface ExpectMatcher {
	/** Matcher name: `toBe`, or a chai word such as `true` or `equal`. */
	readonly name: string;
	readonly negated: boolean;
	/** Arguments of the matcher call; empty for chai property assertions. */
	readonly args: ReadonlyArray<ESTree.Argument>;
	/** Property names after `expect(...)`, such as `["not", "toBe"]`. */
	readonly chain: ReadonlyArray<string>;
}

/** The matcher at the end of the chain on an `expect(x)` call. */
function expectMatcher(expectCall: ESTree.CallExpression): ExpectMatcher | null {
	const chain: string[] = [];
	let node: ESTree.Node = expectCall;
	let parent = node.parent;
	while (parent?.type === "MemberExpression" && parent.object === node) {
		if (parent.computed || parent.property.type !== "Identifier") return null;
		chain.push(parent.property.name);
		node = parent;
		parent = node.parent;
	}
	const name = chain.at(-1);
	if (name === undefined) return null;
	const args = parent?.type === "CallExpression" && parent.callee === node ? parent.arguments : [];
	return { name, negated: chain.includes("not"), args, chain };
}

function includes(subject: unknown, expected: unknown): boolean {
	if (typeof subject === "string") return typeof expected === "string" && subject.includes(expected);
	return Array.isArray(subject) && subject.includes(expected);
}

function hasLength(subject: unknown, expected: unknown): boolean {
	return (typeof subject === "string" || Array.isArray(subject)) && subject.length === expected;
}

function ordered(subject: unknown, expected: unknown, accept: (order: number) => boolean): boolean | null {
	const order = compare(subject, expected);
	if (order === null) return null;
	return !Number.isNaN(order) && accept(order);
}

function matches(subject: unknown, arg: ESTree.Argument | undefined, expected: Static): boolean | null {
	if (arg?.type === "Literal" && "regex" in arg && arg.regex !== undefined && arg.regex !== null && typeof subject === "string") {
		return new RegExp(arg.regex.pattern, arg.regex.flags).test(subject);
	}
	if (expected === null) return null;
	return typeof subject === "string" && typeof expected.value === "string" && subject.includes(expected.value);
}

/** Outcome of a matcher on a constant subject: true (always passes), false (always fails), or null (unknown). */
function evaluateMatcher(subject: unknown, matcher: ExpectMatcher): boolean | null {
	const [arg] = matcher.args;
	const expected = arg === undefined ? null : staticValue(arg);
	const withExpected = (check: (value: unknown) => boolean | null): boolean | null => (expected === null ? null : check(expected.value));
	const result = ((): boolean | null => {
		switch (matcher.name) {
			case "toBe":
				return withExpected((value) => Object.is(subject, value));
			case "toEqual":
			case "toStrictEqual":
			case "eql":
				return withExpected((value) => deepEqual(subject, value));
			case "equal":
			case "equals":
				return withExpected((value) => (matcher.chain.includes("deep") ? deepEqual(subject, value) : subject === value));
			case "toBeTruthy":
			case "ok":
				return Boolean(subject);
			case "toBeFalsy":
				return !isTruthy(subject);
			case "toBeDefined":
				return subject !== undefined;
			case "toBeUndefined":
			case "undefined":
				return subject === undefined;
			case "toBeNull":
			case "null":
				return subject === null;
			case "toBeNaN":
			case "NaN":
				return Number.isNaN(subject);
			case "true":
				return subject === true;
			case "false":
				return subject === false;
			case "exist":
				return subject !== null && subject !== undefined;
			case "toBeGreaterThan":
			case "above":
				return withExpected((value) => ordered(subject, value, (order) => order > 0));
			case "toBeGreaterThanOrEqual":
			case "least":
				return withExpected((value) => ordered(subject, value, (order) => order >= 0));
			case "toBeLessThan":
			case "below":
				return withExpected((value) => ordered(subject, value, (order) => order < 0));
			case "toBeLessThanOrEqual":
			case "most":
				return withExpected((value) => ordered(subject, value, (order) => order <= 0));
			case "toContain":
			case "include":
			case "contain":
				return withExpected((value) => includes(subject, value));
			case "toHaveLength":
			case "lengthOf":
				return withExpected((value) => hasLength(subject, value));
			case "toBeTypeOf":
				return withExpected((value) => typeof subject === value);
			case "toMatch":
				return matches(subject, arg, expected);
			default:
				return null;
		}
	})();
	if (result === null) return null;
	return matcher.negated ? !result : result;
}

function isPureReference(node: ESTree.Node): boolean {
	if (node.type === "Identifier" || node.type === "ThisExpression") return true;
	if (node.type === "MemberExpression") {
		if (node.computed && node.property.type !== "Literal") return false;
		return isPureReference(node.object);
	}
	if (node.type === "TSNonNullExpression" || node.type === "TSAsExpression" || node.type === "ParenthesizedExpression") {
		return isPureReference(node.expression);
	}
	return false;
}

/** The outermost node of an `expect(x).not.toBe(y)` chain, for reporting. */
function chainEnd(expectCall: ESTree.CallExpression): ESTree.Node {
	let node: ESTree.Node = expectCall;
	let parent = node.parent;
	while (
		(parent?.type === "MemberExpression" && parent.object === node) ||
		(parent?.type === "CallExpression" && parent.callee === node)
	) {
		node = parent;
		parent = node.parent;
	}
	return node;
}

const equalityMatchers: ReadonlySet<string> = new Set(["toBe", "toEqual", "toStrictEqual", "toMatchObject", "equal", "equals", "eql"]);

type AssertCheck =
	| { readonly kind: "truthy" }
	| { readonly kind: "falsy" }
	| { readonly kind: "equal"; readonly strictness: "loose" | "strict" | "deep"; readonly negated: boolean }
	| { readonly kind: "is"; readonly expected: unknown };

const assertMethods: ReadonlyMap<string, AssertCheck> = new Map<string, AssertCheck>([
	["ok", { kind: "truthy" }],
	["isOk", { kind: "truthy" }],
	["isTrue", { kind: "is", expected: true }],
	["isFalse", { kind: "is", expected: false }],
	["isNull", { kind: "is", expected: null }],
	["isUndefined", { kind: "is", expected: undefined }],
	["isNotOk", { kind: "falsy" }],
	["equal", { kind: "equal", strictness: "loose", negated: false }],
	["strictEqual", { kind: "equal", strictness: "strict", negated: false }],
	["deepEqual", { kind: "equal", strictness: "deep", negated: false }],
	["deepStrictEqual", { kind: "equal", strictness: "deep", negated: false }],
	["notEqual", { kind: "equal", strictness: "loose", negated: true }],
	["notStrictEqual", { kind: "equal", strictness: "strict", negated: true }],
	["notDeepEqual", { kind: "equal", strictness: "deep", negated: true }],
	["notDeepStrictEqual", { kind: "equal", strictness: "deep", negated: true }],
]);

/** What an identifier is bound to: `expect`, an `assert` namespace, or one assert method such as `strictEqual`. */
type Binding = { readonly kind: "expect" } | { readonly kind: "assert" } | { readonly kind: "method"; readonly method: string } | null;

const expectBinding: Binding = { kind: "expect" };
const assertBinding: Binding = { kind: "assert" };

function exportedBinding(exported: string, source: string): Binding {
	if (exported === "expect") return expectBinding;
	if (exported === "assert" || exported === "strict") return assertModules.has(source) || runnerModules.has(source) ? assertBinding : null;
	return assertModules.has(source) ? { kind: "method", method: exported } : null;
}

function importBinding(specifier: ESTree.Node): Binding {
	const declaration = specifier.parent;
	if (declaration?.type !== "ImportDeclaration") return null;
	const source = declaration.source.value;
	if (specifier.type === "ImportSpecifier") {
		const { imported } = specifier;
		return exportedBinding(imported.type === "Literal" ? imported.value : imported.name, source);
	}
	return assertModules.has(source) ? assertBinding : null;
}

/** `const assert = require("node:assert")` or `const { strictEqual: equal } = require("assert")`. */
function requireBinding(declarator: ESTree.VariableDeclarator, localName: string): Binding {
	const { init } = declarator;
	if (init?.type !== "CallExpression" || init.callee.type !== "Identifier" || init.callee.name !== "require") return null;
	const [source] = init.arguments;
	if (source?.type !== "Literal" || typeof source.value !== "string" || !assertModules.has(source.value)) return null;
	if (declarator.id.type === "Identifier") return assertBinding;
	if (declarator.id.type !== "ObjectPattern") return null;
	for (const property of declarator.id.properties) {
		if (property.type !== "Property" || property.key.type !== "Identifier" || property.value.type !== "Identifier") continue;
		if (property.value.name === localName) return exportedBinding(property.key.name, source.value);
	}
	return null;
}

function bindingOf(sourceCode: SourceCode, identifier: ESTree.Node & { readonly name: string }): Binding {
	// Any `expect`, including the test context's `({ expect }) =>`, is an expectation, as upstream treats it.
	if (identifier.name === "expect") return expectBinding;
	const variable = resolveVariable(sourceCode, identifier);
	const definition = variable?.defs[0];
	// No definition means a global, including one declared in the lint configuration.
	if (definition === undefined) return identifier.name === "assert" ? assertBinding : null;
	if (definition?.type === "ImportBinding") return importBinding(definition.node);
	if (definition?.type === "Variable" && definition.node.type === "VariableDeclarator") return requireBinding(definition.node, identifier.name);
	return null;
}

function describeStatic(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value).slice(0, 40);
	if (typeof value === "number" && Number.isNaN(value)) return "NaN";
	if (value === undefined) return "undefined";
	const text = JSON.stringify(value, (_key, entry: unknown) => (typeof entry === "bigint" ? `${entry}n` : entry));
	return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

/** Reject assertions that pass no matter what the code under test does. */
export const noTautologicalAssertionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow assertions that pass no matter what the code does: `expect(true).toBe(true)`, `expect(1 + 1).toBe(2)`, `expect(x).toEqual(x)`, `assert.ok(1)`. Assertions that always fail (used as \"should have thrown\" sentinels) are not reported, and a locally declared or imported `assert` helper is not Node's `assert`.",
		},
		messages: {
			alwaysPasses:
				"This assertion always passes: it checks {{subject}}, a constant, instead of anything your code produced. Assert on the result of the code under test.",
			comparesWithItself:
				"This assertion compares `{{subject}}` with itself, so it always passes. Compare the result of the code under test with an independent expected value.",
			constantSubject: "This assertion checks a constant ({{subject}}), so it never tests your code. Pass the value produced by the code under test to expect().",
		},
	},
	create(context) {
		if (typeTestFile.test(context.physicalFilename || context.filename)) return {};
		const { sourceCode } = context;
		const normalized = (node: ESTree.Node): string => sourceCode.getText(node).replace(/\s+/g, "");

		function checkExpect(expectCall: ESTree.CallExpression): void {
			const [subjectNode] = expectCall.arguments;
			if (subjectNode === undefined || subjectNode.type === "SpreadElement") return;
			const matcher = expectMatcher(expectCall);
			if (matcher === null) return;
			const reportNode = chainEnd(expectCall);

			const subject = staticValue(subjectNode);
			if (subject !== null) {
				// expect(200).toBe(res.status): the constant is on the wrong side, but the
				// assertion still checks a value the code produced.
				if (matcher.args.some((arg) => arg.type === "SpreadElement" || staticValue(arg) === null)) return;
				const outcome = evaluateMatcher(subject.value, matcher);
				// An assertion that always fails is an intentional "should not reach" sentinel.
				if (outcome === false) return;
				context.report({
					node: reportNode,
					messageId: outcome === true ? "alwaysPasses" : "constantSubject",
					data: { subject: describeStatic(subject.value) },
				});
				return;
			}

			const [expected] = matcher.args;
			if (
				!matcher.negated &&
				equalityMatchers.has(matcher.name) &&
				expected !== undefined &&
				expected.type !== "SpreadElement" &&
				isPureReference(subjectNode) &&
				normalized(subjectNode) === normalized(expected)
			) {
				context.report({ node: reportNode, messageId: "comparesWithItself", data: { subject: normalized(subjectNode).slice(0, 40) } });
			}
		}

		function checkAssert(call: ESTree.CallExpression, check: AssertCheck): void {
			const [first, second] = call.arguments;
			if (first === undefined || first.type === "SpreadElement") return;

			if (check.kind === "equal") {
				if (second === undefined || second.type === "SpreadElement") return;
				if (!check.negated && isPureReference(first) && normalized(first) === normalized(second)) {
					context.report({ node: call, messageId: "comparesWithItself", data: { subject: normalized(first).slice(0, 40) } });
					return;
				}
				const a = staticValue(first);
				const b = staticValue(second);
				if (a === null || b === null) return;
				// assert.equal compares loosely, like ==.
				const equal = check.strictness === "deep" ? deepEqual(a.value, b.value) : check.strictness === "strict" ? Object.is(a.value, b.value) : a.value == b.value;
				if (equal !== check.negated) context.report({ node: call, messageId: "alwaysPasses", data: { subject: describeStatic(a.value) } });
				return;
			}

			const value = staticValue(first);
			if (value === null) return;
			const passes = check.kind === "truthy" ? Boolean(value.value) : check.kind === "falsy" ? !isTruthy(value.value) : Object.is(value.value, check.expected);
			if (passes) context.report({ node: call, messageId: "alwaysPasses", data: { subject: describeStatic(value.value) } });
		}

		return {
			CallExpression(node) {
				const { callee } = node;
				if (callee.type === "Identifier") {
					const binding = bindingOf(sourceCode, callee);
					if (binding === null) return;
					if (binding.kind === "expect") return checkExpect(node);
					// assert(value) is assert.ok(value).
					if (binding.kind === "assert") return checkAssert(node, { kind: "truthy" });
					const check = assertMethods.get(binding.method);
					if (check !== undefined) checkAssert(node, check);
					return;
				}
				if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return;

				// chai.expect(x)
				if (callee.object.type === "Identifier" && callee.object.name === "chai" && callee.property.name === "expect") return checkExpect(node);
				// assert.equal(a, b), chai.assert.isTrue(x), assert.strict.equal(a, b)
				let objectNode: ESTree.Node = callee.object;
				if (
					objectNode.type === "MemberExpression" &&
					!objectNode.computed &&
					objectNode.property.type === "Identifier" &&
					(objectNode.property.name === "strict" || objectNode.property.name === "assert")
				) {
					objectNode = objectNode.object;
				}
				if (objectNode.type !== "Identifier") return;
				if (objectNode.name !== "chai" && bindingOf(sourceCode, objectNode)?.kind !== "assert") return;
				const check = assertMethods.get(callee.property.name);
				if (check !== undefined) checkAssert(node, check);
			},
		};
	},
});
