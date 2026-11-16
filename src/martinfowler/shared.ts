import type { Context, ESTree, Options, Scope, SourceCode, Variable } from "@oxlint/plugins";

type JsonValue = Options[number];
type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

type WrapperNode =
	| ESTree.ParenthesizedExpression
	| ESTree.TSAsExpression
	| ESTree.TSSatisfiesExpression
	| ESTree.TSTypeAssertion
	| ESTree.TSNonNullExpression
	| ESTree.ChainExpression;

export type { FunctionNode };

function optionValue(options: Readonly<Options> | undefined, key: string): JsonValue | undefined {
	const first = options?.[0];
	if (typeof first !== "object" || first === null || Array.isArray(first)) return undefined;
	return first[key];
}

export function numberOption(
	options: Readonly<Options> | undefined,
	key: string,
	fallback: number,
): number {
	const value = optionValue(options, key);
	return typeof value === "number" ? value : fallback;
}

export function booleanOption(
	options: Readonly<Options> | undefined,
	key: string,
	fallback: boolean,
): boolean {
	const value = optionValue(options, key);
	return typeof value === "boolean" ? value : fallback;
}

export function stringListOption(
	options: Readonly<Options> | undefined,
	key: string,
	fallback: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const value = optionValue(options, key);
	if (!Array.isArray(value)) return fallback;
	return value.filter((item): item is string => typeof item === "string");
}

const testFilePattern =
	/(?:^|[\\/])(?:__tests__|__mocks__|test|tests)[\\/]|\.(?:test|spec)\.[cm]?[jt]sx?$/;

export function isTestFile(filename: string): boolean {
	return testFilePattern.test(filename);
}

/** Test files follow different size and setup conventions, so rules skip them unless `ignoreTests: false`. */
export function isIgnoredTestFile(context: Context): boolean {
	return booleanOption(context.options, "ignoreTests", true) && isTestFile(context.filename);
}

export function isFunctionNode(node: ESTree.Node): node is FunctionNode {
	return (
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression" ||
		node.type === "ArrowFunctionExpression"
	);
}

/** Strip parentheses, TypeScript-only wrappers, and optional-chain wrappers. */
export function unwrap(node: ESTree.Expression): ESTree.Expression {
	let current = node;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSSatisfiesExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression" ||
		current.type === "ChainExpression"
	) {
		current = current.expression;
	}
	return current;
}

export function isWrapper(node: ESTree.Node | null): node is WrapperNode {
	return (
		node !== null &&
		(node.type === "ParenthesizedExpression" ||
			node.type === "TSAsExpression" ||
			node.type === "TSSatisfiesExpression" ||
			node.type === "TSTypeAssertion" ||
			node.type === "TSNonNullExpression" ||
			node.type === "ChainExpression")
	);
}

function isNode(value: unknown): value is ESTree.Node {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

/** Direct AST children, excluding the `parent` back-reference. */
export function childNodes(node: ESTree.Node): ReadonlyArray<ESTree.Node> {
	const children: Array<ESTree.Node> = [];
	for (const [key, value] of Object.entries(node)) {
		if (key === "parent") continue;
		if (Array.isArray(value)) {
			for (const item of value) if (isNode(item)) children.push(item);
		} else if (isNode(value)) {
			children.push(value);
		}
	}
	return children;
}

export function contains(outer: ESTree.Node, inner: ESTree.Node): boolean {
	return outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1];
}

export function lineSpan(node: ESTree.Node): number {
	return node.loc.end.line - node.loc.start.line + 1;
}

/** Resolve an identifier to its binding by walking lexical scopes upward. */
export function resolveVariable(
	sourceCode: SourceCode,
	identifier: ESTree.Node & { readonly name: string },
): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier);
	while (scope !== null) {
		const variable = scope.set.get(identifier.name);
		if (variable !== undefined) return variable;
		scope = scope.upper;
	}
	return null;
}

function staticKeyName(
	key: ESTree.Node,
	computed: boolean,
): string | undefined {
	if (computed) return undefined;
	if (key.type === "Identifier") return key.name;
	if (key.type === "PrivateIdentifier") return `#${key.name}`;
	if (key.type === "Literal" && typeof key.value === "string") return key.value;
	return undefined;
}

function stringArgument(call: ESTree.CallExpression): string | undefined {
	const first = call.arguments[0];
	if (first === undefined) return undefined;
	if (first.type === "Literal" && typeof first.value === "string") return first.value;
	if (first.type === "TemplateLiteral" && first.expressions.length === 0) {
		return first.quasis[0]?.value.cooked ?? undefined;
	}
	return undefined;
}

/** Name a function from its own id or the binding, key, or `Effect.fn("name")` that holds it. */
export function functionName(node: FunctionNode, sourceCode: SourceCode): string | undefined {
	if (node.type !== "ArrowFunctionExpression" && node.id !== null && node.id !== undefined) {
		return node.id.name;
	}
	let holder: ESTree.Node = node;
	let parent = node.parent;
	while (isWrapper(parent)) {
		holder = parent;
		parent = parent.parent;
	}
	if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
		return parent.id.name;
	}
	if (parent.type === "MethodDefinition" || parent.type === "Property") {
		return staticKeyName(parent.key, parent.computed);
	}
	if (parent.type === "PropertyDefinition") return staticKeyName(parent.key, parent.computed);
	if (parent.type === "AssignmentExpression" && parent.right === holder) {
		return sourceCode.getText(parent.left);
	}
	if (parent.type === "CallExpression" && parent.callee !== holder) {
		const callee = unwrap(parent.callee);
		if (callee.type === "CallExpression") {
			const label = stringArgument(callee);
			if (label !== undefined) return label;
		}
		const traced = callee.type === "CallExpression" ? unwrap(callee.callee) : callee;
		const isEffectConstructor =
			traced.type === "MemberExpression" &&
			!traced.computed &&
			traced.property.type === "Identifier" &&
			["fn", "fnUntraced", "gen"].includes(traced.property.name);
		if (!isEffectConstructor) return undefined;
		let declarator: ESTree.Node | null = parent.parent;
		while (declarator?.type === "CallExpression" || isWrapper(declarator)) {
			declarator = declarator.parent;
		}
		if (declarator?.type === "VariableDeclarator" && declarator.id.type === "Identifier") {
			return declarator.id.name;
		}
	}
	return undefined;
}

/** The node to underline for a function: its name when it has one, otherwise the function. */
export function functionReportNode(node: FunctionNode): ESTree.Node {
	if (node.type !== "ArrowFunctionExpression" && node.id !== null && node.id !== undefined) {
		return node.id;
	}
	let parent = node.parent;
	while (isWrapper(parent)) parent = parent.parent;
	if (parent.type === "VariableDeclarator") return parent.id;
	if (
		parent.type === "MethodDefinition" ||
		parent.type === "Property" ||
		parent.type === "PropertyDefinition"
	) {
		return parent.key;
	}
	return node;
}

export function describeFunction(name: string | undefined): string {
	return name === undefined ? "This function" : `\`${name}\``;
}

export function truncate(text: string, max = 80): string {
	const compact = text.replace(/\s+/g, " ");
	return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}
