import { defineRule, type ESTree, type SourceCode } from "@oxlint/plugins";

import {
	booleanOption,
	isFunctionNode,
	isIgnoredTestFile,
	resolveVariable,
	stringListOption,
	unwrap,
} from "../shared.ts";

const defaultVerbs = [
	"apply",
	"do",
	"doWork",
	"ensure",
	"execute",
	"handle",
	"init",
	"initialize",
	"manage",
	"perform",
	"prepare",
	"process",
	"resolve",
	"run",
	"sync",
	"update",
];

const defaultVagueNouns = [
	"All",
	"Data",
	"Info",
	"It",
	"Item",
	"Items",
	"Logic",
	"Stuff",
	"Thing",
	"Things",
	"Value",
	"Values",
	"Work",
];

const defaultAllowNames = ["fetch", "layer", "lookup", "make", "of"];

/** `Effect.fn("x")(function* () {})`, `Effect.fn(function* () {})`, or a plain function. */
function isFunctionValue(init: ESTree.Expression): boolean {
	const value = unwrap(init);
	if (isFunctionNode(value)) return true;
	if (value.type !== "CallExpression") return false;
	const hasFunctionArgument = value.arguments.some(
		(argument) => argument.type !== "SpreadElement" && isFunctionNode(unwrap(argument)),
	);
	if (!hasFunctionArgument) return false;
	const callee = unwrap(value.callee);
	const constructor = callee.type === "CallExpression" ? unwrap(callee.callee) : callee;
	return (
		constructor.type === "MemberExpression" &&
		!constructor.computed &&
		constructor.property.type === "Identifier" &&
		(constructor.property.name === "fn" || constructor.property.name === "fnUntraced")
	);
}

function aliasedFunctionName(
	sourceCode: SourceCode,
	init: ESTree.Expression,
): string | undefined {
	const value = unwrap(init);
	if (value.type !== "Identifier") return undefined;
	const variable = resolveVariable(sourceCode, value);
	const definition = variable?.defs[0];
	if (definition === undefined) return undefined;
	const declared = definition.node;
	// A parameter's definition node is its function, so check the definition kind first.
	if (definition.type === "FunctionName" && declared.type === "FunctionDeclaration") {
		return value.name;
	}
	if (
		definition.type === "Variable" &&
		declared.type === "VariableDeclarator" &&
		declared.init !== null &&
		declared.init !== undefined &&
		isFunctionValue(declared.init)
	) {
		return value.name;
	}
	return undefined;
}

/** Flag top-level functions named with a bare generic verb, and pure aliases of other functions. */
export const mysteriousNameRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Flag top-level functions whose name is a bare generic verb, or that only alias another function (Refactoring, Mysterious Name).",
		},
		messages: {
			genericName:
				"Possibly Mysterious Name: `{{name}}` is a generic verb with no object, so callers cannot tell which steps it performs or what it reads, writes, or calls. Consider Rename Function: name each caller-visible step it performs (for example `resolveConfiguration` → `loadAndReconcileConfigurationSources`).",
			alias:
				"Possibly Mysterious Name: `{{name}}` only aliases `{{target}}`, so one behavior has two names and readers must check whether they differ. Consider Rename Function: delete the alias and call `{{target}}` directly, or rename the one function so its name states what it does.",
		},
		schema: [
			{
				type: "object",
				properties: {
					ignoreTests: { type: "boolean" },
					verbs: { type: "array", items: { type: "string" } },
					vagueNouns: { type: "array", items: { type: "string" } },
					allowNames: { type: "array", items: { type: "string" } },
					checkAliases: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [
			{
				ignoreTests: true,
				verbs: defaultVerbs,
				vagueNouns: defaultVagueNouns,
				allowNames: defaultAllowNames,
				checkAliases: true,
			},
		],
	},
	createOnce(context) {
		let verbs: ReadonlySet<string> = new Set();
		let vagueNouns: ReadonlyArray<string> = [];
		let allowNames: ReadonlySet<string> = new Set();
		let checkAliases = true;

		const isGeneric = (name: string): boolean => {
			if (allowNames.has(name)) return false;
			if (verbs.has(name)) return true;
			return vagueNouns.some((noun) => {
				if (!name.endsWith(noun)) return false;
				return verbs.has(name.slice(0, name.length - noun.length));
			});
		};

		const checkFunctionName = (identifier: ESTree.BindingIdentifier) => {
			if (isGeneric(identifier.name)) {
				context.report({
					node: identifier,
					messageId: "genericName",
					data: { name: identifier.name },
				});
			}
		};

		const checkDeclaration = (declaration: ESTree.Node) => {
			if (declaration.type === "FunctionDeclaration") {
				if (declaration.id !== null && declaration.id !== undefined) checkFunctionName(declaration.id);
				return;
			}
			if (declaration.type !== "VariableDeclaration") return;
			for (const declarator of declaration.declarations) {
				if (declarator.id.type !== "Identifier") continue;
				if (declarator.init === null || declarator.init === undefined) continue;
				if (isFunctionValue(declarator.init)) checkFunctionName(declarator.id);
			}
		};

		return {
			before() {
				if (isIgnoredTestFile(context)) return false;
				verbs = new Set(stringListOption(context.options, "verbs", defaultVerbs));
				vagueNouns = stringListOption(context.options, "vagueNouns", defaultVagueNouns);
				allowNames = new Set(stringListOption(context.options, "allowNames", defaultAllowNames));
				checkAliases = booleanOption(context.options, "checkAliases", true);
				return undefined;
			},
			// Aliases are checked in every scope: a local `const executeMutation = refreshAuthentication`
			// hides behavior as much as a top-level one.
			VariableDeclarator(declarator) {
				if (!checkAliases) return;
				if (declarator.parent.type !== "VariableDeclaration" || declarator.parent.kind !== "const") return;
				if (declarator.id.type !== "Identifier") return;
				if (declarator.init === null || declarator.init === undefined) return;
				const target = aliasedFunctionName(context.sourceCode, declarator.init);
				if (target === undefined || target === declarator.id.name) return;
				context.report({
					node: declarator,
					messageId: "alias",
					data: { name: declarator.id.name, target },
				});
			},
			Program(program) {
				for (const statement of program.body) {
					if (statement.type === "ExportDefaultDeclaration") {
						checkDeclaration(statement.declaration);
					} else if (statement.type === "ExportNamedDeclaration") {
						if (statement.declaration !== null && statement.declaration !== undefined) {
							checkDeclaration(statement.declaration);
						}
					} else {
						checkDeclaration(statement);
					}
				}
			},
		};
	},
});
