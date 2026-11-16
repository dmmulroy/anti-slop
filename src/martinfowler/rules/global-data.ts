import { defineRule, type ESTree, type Variable } from "@oxlint/plugins";

import {
	isIgnoredTestFile,
	isWrapper,
	unwrap,
} from "../shared.ts";

const mutatingMethods = new Set([
	"add",
	"clear",
	"copyWithin",
	"delete",
	"fill",
	"pop",
	"push",
	"reverse",
	"set",
	"shift",
	"sort",
	"splice",
	"unshift",
]);

const containerConstructors = new Set(["Array", "Map", "Object", "Set", "WeakMap", "WeakSet"]);

function isMutableContainer(init: ESTree.Expression): boolean {
	const value = unwrap(init);
	if (value.type === "ObjectExpression" || value.type === "ArrayExpression") return true;
	return (
		value.type === "NewExpression" &&
		value.callee.type === "Identifier" &&
		containerConstructors.has(value.callee.name)
	);
}

function climbWrappers(node: ESTree.Node): ESTree.Node {
	let current = node;
	for (;;) {
		const parent = current.parent;
		if (!isWrapper(parent)) return current;
		current = parent;
	}
}

function isMemberName(node: ESTree.MemberExpression, names: ReadonlySet<string>): boolean {
	return !node.computed && node.property.type === "Identifier" && names.has(node.property.name);
}

/** Whether a reference writes into the referenced object or anything reachable through it. */
function mutatesThroughReference(identifier: ESTree.Node): boolean {
	let current = climbWrappers(identifier);
	const firstParent = current.parent;
	if (
		firstParent?.type === "CallExpression" &&
		firstParent.arguments[0] === current &&
		firstParent.callee.type === "MemberExpression" &&
		firstParent.callee.object.type === "Identifier" &&
		firstParent.callee.object.name === "Object" &&
		isMemberName(firstParent.callee, new Set(["assign"]))
	) {
		return true;
	}
	for (;;) {
		const member = current.parent;
		if (member?.type !== "MemberExpression" || member.object !== current) return false;
		const outer = climbWrappers(member);
		const parent = outer.parent;
		if (parent === null) return false;
		if (parent.type === "AssignmentExpression" && parent.left === outer) return true;
		if (parent.type === "UpdateExpression") return true;
		if (parent.type === "UnaryExpression" && parent.operator === "delete") return true;
		if (
			parent.type === "CallExpression" &&
			parent.callee === outer &&
			isMemberName(member, mutatingMethods)
		) {
			return true;
		}
		current = outer;
	}
}

function isReassigned(variable: Variable): boolean {
	return variable.references.some((reference) => reference.isWrite() && !reference.init);
}

/** Flag exported module-level state that is `let`/`var` or a container mutated in this file. */
export const globalDataRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Flag exported mutable module state: exported `let`/`var`, or exported objects, arrays, Maps, and Sets mutated in the file (Refactoring, Global Data).",
		},
		messages: {
			globalData:
				"Possibly Global Data: exported `{{name}}` is module-level state that {{how}}, so any importer can read it while code anywhere changes it. Consider Encapsulate Variable: keep the state private and expose functions that own every read and write (in Effect, a `Ref` created in a service's layer and reached only through its operations).",
		},
		schema: [
			{
				type: "object",
				properties: { ignoreTests: { type: "boolean" } },
				additionalProperties: false,
			},
		],
		defaultOptions: [{ ignoreTests: true }],
	},
	createOnce(context) {
		return {
			before() {
				return isIgnoredTestFile(context) ? false : undefined;
			},
			Program(program) {
				const declarators = new Map<string, ESTree.VariableDeclarator>();
				const exported = new Set<ESTree.VariableDeclarator>();
				const kinds = new Map<ESTree.VariableDeclarator, string>();
				const remember = (declaration: ESTree.VariableDeclaration, isExported: boolean) => {
					for (const declarator of declaration.declarations) {
						if (declarator.id.type !== "Identifier") continue;
						declarators.set(declarator.id.name, declarator);
						kinds.set(declarator, declaration.kind);
						if (isExported) exported.add(declarator);
					}
				};
				const exportedNames: Array<string> = [];
				for (const statement of program.body) {
					if (statement.type === "VariableDeclaration") remember(statement, false);
					if (statement.type === "ExportNamedDeclaration") {
						if (statement.declaration?.type === "VariableDeclaration") {
							remember(statement.declaration, true);
						}
						if (statement.source === null || statement.source === undefined) {
							for (const specifier of statement.specifiers) {
								if (specifier.local.type === "Identifier") exportedNames.push(specifier.local.name);
							}
						}
					}
					if (
						statement.type === "ExportDefaultDeclaration" &&
						statement.declaration.type === "Identifier"
					) {
						exportedNames.push(statement.declaration.name);
					}
				}
				for (const name of exportedNames) {
					const declarator = declarators.get(name);
					if (declarator !== undefined) exported.add(declarator);
				}

				for (const declarator of exported) {
					if (declarator.id.type !== "Identifier") continue;
					const kind = kinds.get(declarator);
					const variable = context.sourceCode.getDeclaredVariables(declarator)[0];
					if (variable === undefined) continue;
					let how: string | undefined;
					if (kind === "let" || kind === "var") {
						how = isReassigned(variable)
							? `is declared with \`${kind}\` and reassigned in this file`
							: `is declared with \`${kind}\`, so it can be reassigned`;
					} else if (
						declarator.init !== null &&
						declarator.init !== undefined &&
						isMutableContainer(declarator.init) &&
						variable.references.some(
							(reference) => !reference.init && mutatesThroughReference(reference.identifier),
						)
					) {
						how = "is mutated in this file";
					}
					if (how === undefined) continue;
					context.report({
						node: declarator.id,
						messageId: "globalData",
						data: { name: declarator.id.name, how },
					});
				}
			},
		};
	},
});
