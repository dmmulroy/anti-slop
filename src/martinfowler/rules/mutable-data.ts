import { defineRule, type ESTree } from "@oxlint/plugins";

import {
	isFunctionNode,
	isIgnoredTestFile,
} from "../shared.ts";

function enclosingFunction(node: ESTree.Node): ESTree.Node | undefined {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isFunctionNode(current)) return current;
		current = current.parent;
	}
	return undefined;
}

/** Flag non-exported module-level `let`/`var` bindings that functions reassign. */
export const mutableDataRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Flag module-level `let`/`var` bindings reassigned inside functions (Refactoring, Mutable Data). Exported bindings are reported by global-data instead.",
		},
		messages: {
			mutableData:
				"Possibly Mutable Data: module-level `{{name}}` is reassigned inside {{functions}}, so its value depends on which functions ran before and in what order. Consider Encapsulate Variable so one owner controls every update, or Replace Derived Variable with Query if it can be computed from other data (in Effect, a `Ref` owned by a service, or a value derived where it is needed).",
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
				for (const statement of program.body) {
					if (statement.type !== "VariableDeclaration") continue;
					if (statement.kind !== "let" && statement.kind !== "var") continue;
					for (const declarator of statement.declarations) {
						for (const variable of context.sourceCode.getDeclaredVariables(declarator)) {
							const writers = new Set<ESTree.Node>();
							for (const reference of variable.references) {
								if (!reference.isWrite() || reference.init) continue;
								const writer = enclosingFunction(reference.identifier);
								if (writer !== undefined) writers.add(writer);
							}
							if (writers.size === 0) continue;
							const identifier = variable.identifiers[0];
							if (identifier === undefined) continue;
							context.report({
								node: identifier,
								messageId: "mutableData",
								data: {
									name: variable.name,
									functions: writers.size === 1 ? "1 function" : `${writers.size} functions`,
								},
							});
						}
					}
				}
			},
		};
	},
});
