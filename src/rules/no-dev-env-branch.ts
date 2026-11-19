// The polarity analysis, the canned-value test, and the constant-selector exception are ported from
// ai-guard-dev/eslint-plugin-ai-guard's `no-test-env-branch` (https://github.com/ai-guard-dev/eslint-plugin-ai-guard,
// MIT, eslint-plugin-ai-guard 1.4.7), which reports the same shortcut for test runners. Development branches
// are mostly legitimate tooling (devtools, extra logging, local URLs), so this rule reports only fake data,
// success responses, and skipped checks, not every literal a development branch returns.
import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

type Polarity = "dev" | "not-dev" | null;

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

/** Environment variables that name the running mode: `process.env.NODE_ENV === "development"`. */
const modeVariables: ReadonlySet<string> = new Set([
	"NODE_ENV",
	"APP_ENV",
	"ENV",
	"ENVIRONMENT",
	"MODE",
	"VITE_MODE",
	"VERCEL_ENV",
	"BABEL_ENV",
]);
const developmentModes: ReadonlySet<string> = new Set(["development", "dev", "local"]);
const productionModes: ReadonlySet<string> = new Set(["production", "prod"]);

/** Words in a binding or callee name that mark a value as made up. */
const fakeWords: ReadonlySet<string> = new Set([
	"canned",
	"dummy",
	"fake",
	"faker",
	"fakes",
	"fixture",
	"fixtures",
	"hardcoded",
	"mock",
	"mocked",
	"mocks",
	"placeholder",
	"stub",
	"stubbed",
	"stubs",
]);

/** Properties whose `true` value claims an operation succeeded or a check passed. */
const successKeys: ReadonlySet<string> = new Set([
	"allowed",
	"approved",
	"authenticated",
	"authorized",
	"isValid",
	"ok",
	"success",
	"valid",
	"verified",
]);

/** Words that name a verdict: `isAuthorized`, `verifyToken`, `hasPermission` answer whether a check passed. */
const verdictWords: ReadonlySet<string> = new Set([
	"allowed",
	"auth",
	"authenticate",
	"authenticated",
	"authorize",
	"authorized",
	"captcha",
	"check",
	"permission",
	"permissions",
	"permitted",
	"signature",
	"validate",
	"valid",
	"verify",
	"verified",
]);

/** Leading verbs of functions that throw when their check fails: `assertAdmin`, `requireAuth`, `verifySignature`. */
const throwingCheckVerbs: ReadonlySet<string> = new Set([
	"assert",
	"authenticate",
	"authorize",
	"ensure",
	"guard",
	"require",
	"validate",
	"verify",
]);

const nonProductionFile =
	/(?:^|\/)(?:__tests__|__specs__|tests?|specs?|e2e|cypress|playwright|__mocks__|__fixtures__|mocks?|fixtures?|stories|storybook|\.storybook|seeds?|seeders|examples?|demos?|playground|sandbox|msw|scripts?|dev|devtools?)\/|\.(?:test|spec|e2e|cy|stories|story|mock|mocks|fixture|fixtures|seed|config|dev)\.[cm]?[jt]sx?$|(?:^|\/)(?:seeds?|setup-?tests?|test-?setup|test-?utils?|test-?helpers?)\.[cm]?[jt]sx?$/;

/** Lowercase words of a camelCase, PascalCase, or SCREAMING_SNAKE name. */
function words(name: string): readonly string[] {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 0);
}

const hasWord = (name: string, set: ReadonlySet<string>): boolean => words(name).some((word) => set.has(word));

function unwrap(node: ESTree.Node): ESTree.Node {
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

function staticPropertyName(node: ESTree.MemberExpression): string | null {
	if (!node.computed && node.property.type === "Identifier") return node.property.name;
	if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") return node.property.value;
	return null;
}

function isImportMeta(node: ESTree.Node): boolean {
	return node.type === "MetaProperty" && node.meta.name === "import" && node.property.name === "meta";
}

/** The variable read by `process.env.X`, `process.env["X"]`, or `import.meta.env.X`. */
function envVariable(node: ESTree.Node): string | null {
	const member = unwrap(node);
	if (member.type !== "MemberExpression") return null;
	const name = staticPropertyName(member);
	const object = unwrap(member.object);
	if (name === null || object.type !== "MemberExpression" || staticPropertyName(object) !== "env") return null;
	const root = unwrap(object.object);
	if (root.type === "Identifier" && root.name === "process") return name;
	return isImportMeta(root) ? name : null;
}

function stringValue(node: ESTree.Node): string | null {
	const value = unwrap(node);
	if (value.type === "Literal" && typeof value.value === "string") return value.value;
	if (value.type === "TemplateLiteral" && value.expressions.length === 0) return value.quasis[0]?.value.cooked ?? null;
	return null;
}

const flip = (polarity: Polarity): Polarity => (polarity === "dev" ? "not-dev" : polarity === "not-dev" ? "dev" : null);

function onlyReturnedExpression(fn: FunctionNode): ESTree.Node | null {
	if (fn.body === null || fn.body === undefined) return null;
	if (fn.body.type !== "BlockStatement") return fn.body;
	const [only] = fn.body.body;
	return fn.body.body.length === 1 && only?.type === "ReturnStatement" && only.argument !== null ? only.argument : null;
}

function constInitializer(sourceCode: SourceCode, identifier: ESTree.Node & { readonly name: string }): ESTree.Node | null {
	const variable = resolveVariable(sourceCode, identifier);
	const definition = variable?.defs[0];
	if (variable === null || definition?.type !== "Variable" || definition.node.type !== "VariableDeclarator") return null;
	if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
	return definition.node.init;
}

/** Whether the code guarded by `expression` runs only in development, only outside it, or either. */
function polarityOf(expression: ESTree.Node, sourceCode: SourceCode, depth = 0): Polarity {
	if (depth > 3) return null;
	const node = unwrap(expression);
	if (node.type === "MemberExpression") {
		const name = envVariable(node);
		const object = unwrap(node.object);
		const fromImportMeta = object.type === "MemberExpression" && isImportMeta(unwrap(object.object));
		if (fromImportMeta && name === "DEV") return "dev";
		if (fromImportMeta && name === "PROD") return "not-dev";
		return null;
	}
	switch (node.type) {
		case "Identifier": {
			if (node.name === "__DEV__") return resolveVariable(sourceCode, node) === null ? "dev" : null;
			const init = constInitializer(sourceCode, node);
			return init === null ? null : polarityOf(init, sourceCode, depth + 1);
		}
		case "UnaryExpression":
			return node.operator === "!" ? flip(polarityOf(node.argument, sourceCode, depth + 1)) : null;
		case "BinaryExpression": {
			if (!["===", "==", "!==", "!="].includes(node.operator)) return null;
			const equal = node.operator === "===" || node.operator === "==";
			for (const [left, right] of [
				[node.left, node.right],
				[node.right, node.left],
			] as const) {
				const variable = envVariable(left);
				const mode = stringValue(right);
				if (variable === null || mode === null || !modeVariables.has(variable)) continue;
				if (developmentModes.has(mode)) return equal ? "dev" : "not-dev";
				if (productionModes.has(mode)) return equal ? "not-dev" : "dev";
			}
			return null;
		}
		case "LogicalExpression": {
			const left = polarityOf(node.left, sourceCode, depth + 1);
			const right = polarityOf(node.right, sourceCode, depth + 1);
			if (node.operator === "&&") return left === "dev" || right === "dev" ? "dev" : null;
			if (node.operator === "||") return left === null ? right : right === null || right === left ? left : null;
			return null;
		}
		case "CallExpression": {
			if (node.arguments.length > 0 || node.callee.type !== "Identifier") return null;
			const variable = resolveVariable(sourceCode, node.callee);
			const definition = variable?.defs[0];
			let fn: FunctionNode | null = null;
			if (definition?.type === "FunctionName" && definition.node.type === "FunctionDeclaration") fn = definition.node;
			if (definition?.type === "Variable" && definition.node.type === "VariableDeclarator") {
				const init = definition.node.init;
				if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") fn = init;
			}
			const returned = fn === null ? null : onlyReturnedExpression(fn);
			return returned === null ? null : polarityOf(returned, sourceCode, depth + 1);
		}
		default:
			return null;
	}
}

/** A hard-coded value: a literal, or an object or array built only from literals. */
function isCanned(expression: ESTree.Node | null | undefined, sourceCode: SourceCode, depth = 0): boolean {
	if (expression === null || expression === undefined || depth > 6) return false;
	const node = unwrap(expression);
	switch (node.type) {
		case "Literal":
			return !("regex" in node && node.regex !== undefined && node.regex !== null);
		case "TemplateLiteral":
			return node.expressions.length === 0;
		case "Identifier": {
			if (node.name === "undefined") return true;
			const variable = resolveVariable(sourceCode, node);
			const definition = variable?.defs[0];
			if (definition?.type !== "Variable" || definition.node.type !== "VariableDeclarator") return false;
			const declaration = definition.node.parent;
			return declaration?.type === "VariableDeclaration" && declaration.kind === "const" && isCanned(definition.node.init, sourceCode, depth + 1);
		}
		case "UnaryExpression":
			return isCanned(node.argument, sourceCode, depth + 1);
		case "ArrayExpression":
			return node.elements.every((element) => element !== null && element.type !== "SpreadElement" && isCanned(element, sourceCode, depth + 1));
		case "ObjectExpression":
			return node.properties.every((property) => property.type === "Property" && !property.computed && isCanned(property.value, sourceCode, depth + 1));
		default:
			return false;
	}
}

/** The name a value is read or built through: `mockUser`, `fixtures.user`, `createFakeOrder()`, `new StubClient()`. */
function valueName(node: ESTree.Node): string | null {
	if (node.type === "Identifier") return node.name;
	if (node.type === "MemberExpression") {
		const names = [staticPropertyName(node), valueName(unwrap(node.object))].filter((name) => name !== null);
		return names.length === 0 ? null : names.join("_");
	}
	if (node.type === "CallExpression" || node.type === "NewExpression") return valueName(unwrap(node.callee));
	return null;
}

function keyName(key: ESTree.Node): string | null {
	if (key.type === "Identifier") return key.name;
	return key.type === "Literal" && typeof key.value === "string" ? key.value : null;
}

function isSuccessObject(node: ESTree.ObjectExpression): boolean {
	return node.properties.some((property) => {
		if (property.type !== "Property" || property.computed) return false;
		const key = keyName(property.key);
		const value = unwrap(property.value);
		return key !== null && successKeys.has(key) && value.type === "Literal" && value.value === true;
	});
}

/** What a development-only value fabricates, or null when it is not fake data. */
function fabricated(expression: ESTree.Node, sourceCode: SourceCode, depth = 0): string | null {
	if (depth > 4) return null;
	const node = unwrap(expression);
	if (node.type === "AwaitExpression") return fabricated(node.argument, sourceCode, depth + 1);
	if (node.type === "ObjectExpression" && isSuccessObject(node)) return "a success result";
	if (node.type === "CallExpression" || node.type === "NewExpression") {
		const callee = unwrap(node.callee);
		const method = callee.type === "MemberExpression" ? staticPropertyName(callee) : callee.type === "Identifier" ? callee.name : null;
		const [first] = node.arguments;
		const wraps = method === "json" || method === "resolve" || (node.type === "NewExpression" && method === "Response");
		if (wraps && first !== undefined && first.type !== "SpreadElement") {
			const inner = fabricated(first, sourceCode, depth + 1);
			if (inner !== null) return inner;
		}
	}
	const name = valueName(node);
	if (name !== null && hasWord(name, fakeWords)) return `fake data (\`${name}\`)`;
	if ((node.type === "ObjectExpression" && node.properties.length > 0) || (node.type === "ArrayExpression" && node.elements.length > 0)) {
		return isCanned(node, sourceCode) ? "hard-coded data" : null;
	}
	return null;
}

function enclosingFunction(node: ESTree.Node): FunctionNode | null {
	let current = node.parent;
	while (current !== null && current !== undefined) {
		if (isFunctionNode(current)) return current;
		current = current.parent;
	}
	return null;
}

function functionName(fn: FunctionNode): string | null {
	if (fn.type !== "ArrowFunctionExpression" && fn.id !== null && fn.id !== undefined) return fn.id.name;
	const parent = fn.parent;
	if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
	if ((parent?.type === "MethodDefinition" || parent?.type === "Property" || parent?.type === "PropertyDefinition") && !parent.computed) {
		return keyName(parent.key);
	}
	return null;
}

const skippedKeys: ReadonlySet<string> = new Set(["parent", "loc", "range", "start", "end"]);

const isNode = (value: unknown): value is ESTree.Node =>
	typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const isFunctionNode = (node: ESTree.Node): node is FunctionNode =>
	node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration";

/** Return statements of a function body, not counting nested functions. */
function ownReturns(node: ESTree.Node, out: ESTree.ReturnStatement[] = []): ESTree.ReturnStatement[] {
	if (node.type === "ReturnStatement") {
		out.push(node);
		return out;
	}
	for (const [key, value] of Object.entries(node)) {
		if (skippedKeys.has(key)) continue;
		for (const child of Array.isArray(value) ? value : [value]) {
			if (isNode(child) && !isFunctionNode(child)) ownReturns(child, out);
		}
	}
	return out;
}

/** Statements that run in a branch: through blocks, nested ifs, and try blocks, not into functions or loops. */
function branchStatements(node: ESTree.Node | null | undefined, out: ESTree.Node[] = []): ESTree.Node[] {
	if (node === null || node === undefined) return out;
	switch (node.type) {
		case "BlockStatement":
			for (const statement of node.body) branchStatements(statement, out);
			return out;
		case "IfStatement":
			branchStatements(node.consequent, out);
			branchStatements(node.alternate, out);
			return out;
		case "TryStatement":
			branchStatements(node.block, out);
			return out;
		default:
			out.push(node);
			return out;
	}
}

/** `if (isDev) return "silent"; return "info";` picks between constants: configuration, not a shortcut. */
function isConstantSelector(fn: FunctionNode, branchReturns: ReadonlySet<ESTree.ReturnStatement>, sourceCode: SourceCode): boolean {
	if (fn.body === null || fn.body === undefined || fn.body.type !== "BlockStatement") return false;
	const others = ownReturns(fn.body).filter((statement) => !branchReturns.has(statement));
	return others.length > 0 && others.every((statement) => statement.argument !== null && isCanned(statement.argument, sourceCode));
}

function isNullish(node: ESTree.Node | null): boolean {
	if (node === null) return true;
	const value = unwrap(node);
	return (value.type === "Identifier" && value.name === "undefined") || (value.type === "Literal" && value.value === null);
}

function isTrue(node: ESTree.Node | null): boolean {
	if (node === null) return false;
	const value = unwrap(node);
	return value.type === "Literal" && value.value === true;
}

/** Whether returning `argument` from `name` passes its check without running it. */
function skipsCheck(name: string | null, argument: ESTree.Node | null): boolean {
	if (name === null) return false;
	if (isTrue(argument)) return hasWord(name, verdictWords);
	const [verb] = words(name);
	return isNullish(argument) && verb !== undefined && throwingCheckVerbs.has(verb);
}

function conditionText(sourceCode: SourceCode, condition: ESTree.Node): string {
	const text = sourceCode.getText(condition).replace(/\s+/g, " ");
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Reject production code that serves fake data or skips a check when it detects development mode. */
export const noDevEnvBranchRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow production code that returns fake data or a success result, or skips a check, when it detects development mode (`if (process.env.NODE_ENV === \"development\") return mockUser`, `import.meta.env.DEV ? fakeData : realData`). Development-only tooling, logging, and configuration are allowed.",
		},
		messages: {
			fakeResult:
				"{{name}} returns {{what}} in development (`{{condition}}`), so local runs never exercise the real code path. Remove the branch and make the real path work locally: run the dependency locally, or seed real data.",
			fakeValue:
				"This uses {{what}} in development (`{{condition}}`) instead of the real value, so local runs never exercise the real code path. Remove the branch and make the real path work locally: run the dependency locally, or seed real data.",
			skippedCheck:
				"{{name}} skips its check in development (`{{condition}}`), so the check never runs where the code is written and tested. Remove the branch and give development the credentials or local service the check needs.",
		},
	},
	create(context) {
		const filename = (context.physicalFilename || context.filename).replaceAll("\\", "/").toLowerCase();
		if (nonProductionFile.test(filename)) return {};
		const { sourceCode } = context;

		function inspectBranch(branch: ESTree.Node | null | undefined, condition: ESTree.Node, ifStatement: ESTree.IfStatement): void {
			const fn = enclosingFunction(ifStatement);
			const name = fn === null ? null : functionName(fn);
			const label = name === null ? "This function" : `\`${name}\``;
			const findings: Array<{ readonly node: ESTree.Node; readonly messageId: "fakeResult" | "fakeValue" | "skippedCheck"; readonly what: string }> = [];
			const returns = new Set<ESTree.ReturnStatement>();
			for (const statement of branchStatements(branch)) {
				if (statement.type === "ReturnStatement" && fn !== null) {
					returns.add(statement);
					const what = statement.argument === null ? null : fabricated(statement.argument, sourceCode);
					if (what !== null) findings.push({ node: statement, messageId: "fakeResult", what });
					else if (skipsCheck(name, statement.argument)) findings.push({ node: statement, messageId: "skippedCheck", what: "" });
				} else if (statement.type === "ExpressionStatement" && statement.expression.type === "AssignmentExpression") {
					const what = fabricated(statement.expression.right, sourceCode);
					if (what !== null) findings.push({ node: statement, messageId: "fakeValue", what });
				}
			}
			if (findings.length === 0) return;
			if (fn !== null && returns.size > 0 && isConstantSelector(fn, returns, sourceCode)) return;
			const text = conditionText(sourceCode, condition);
			for (const finding of findings) {
				context.report({ node: finding.node, messageId: finding.messageId, data: { name: label, what: finding.what, condition: text } });
			}
		}

		return {
			IfStatement(node) {
				const polarity = polarityOf(node.test, sourceCode);
				if (polarity === null) return;
				inspectBranch(polarity === "dev" ? node.consequent : node.alternate, node.test, node);
			},
			ConditionalExpression(node) {
				const polarity = polarityOf(node.test, sourceCode);
				if (polarity === null) return;
				const devValue = polarity === "dev" ? node.consequent : node.alternate;
				const realValue = polarity === "dev" ? node.alternate : node.consequent;
				const what = fabricated(devValue, sourceCode);
				if (what === null || isCanned(realValue, sourceCode) || fabricated(realValue, sourceCode) !== null) return;
				context.report({ node: devValue, messageId: "fakeValue", data: { what, condition: conditionText(sourceCode, node.test) } });
			},
		};
	},
});
