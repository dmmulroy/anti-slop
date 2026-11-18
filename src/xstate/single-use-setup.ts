import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { collectXStateImports, importedCallee, unwrap } from "./shared.ts";

/** Which `setup` implementations a single-use rule checks. */
export type SetupSection = "actions" | "guards";

const keyName = (key: ESTree.Node): string | null => {
	if (key.type === "Identifier") return key.name;
	if (key.type === "Literal" && typeof key.value === "string") return key.value;
	return null;
};

const skippedKeys: ReadonlySet<string> = new Set(["parent", "loc", "range", "start", "end"]);

const isNode = (value: unknown): value is ESTree.Node =>
	typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

/** Count string literals in `root` that are not object keys, by value. */
function countStringReferences(root: ESTree.Node, counts: Map<string, number>): void {
	const visit = (node: ESTree.Node, isKey: boolean) => {
		// Event and context types name strings that are not references to implementations.
		if (node.type.startsWith("TS")) {
			if ("expression" in node && isNode(node.expression)) visit(node.expression, false);
			return;
		}
		if (node.type === "Literal" && typeof node.value === "string" && !isKey) {
			counts.set(node.value, (counts.get(node.value) ?? 0) + 1);
		}
		for (const [key, value] of Object.entries(node)) {
			if (skippedKeys.has(key)) continue;
			const childIsKey = node.type === "Property" && key === "key" && !node.computed;
			if (Array.isArray(value)) {
				for (const item of value) if (isNode(item)) visit(item, false);
			} else if (isNode(value)) {
				visit(value, childIsKey);
			}
		}
	};
	visit(root, false);
}

/** The `setup({ ... })` call whose result `.createMachine(...)` is called on, with both calls. */
interface SetupMachine {
	readonly setup: ESTree.CallExpression;
	readonly options: ESTree.ObjectExpression;
	readonly createMachine: ESTree.CallExpression;
}

function setupMachine(node: ESTree.CallExpression, setupNames: (callee: ESTree.Node) => boolean): SetupMachine | null {
	const callee = unwrap(node.callee);
	if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier" || callee.property.name !== "createMachine") {
		return null;
	}
	const setup = unwrap(callee.object);
	if (setup.type !== "CallExpression" || !setupNames(setup.callee)) return null;
	const [options] = setup.arguments;
	if (options === undefined || options.type === "SpreadElement") return null;
	const object = unwrap(options);
	return object.type === "ObjectExpression" ? { setup, options: object, createMachine: node } : null;
}

/** The named implementations of one `setup` section: `setup({ actions: { save: ... } })`. */
function sectionEntries(options: ESTree.ObjectExpression, section: SetupSection): readonly ESTree.ObjectProperty[] {
	for (const property of options.properties) {
		if (property.type !== "Property" || property.computed || keyName(property.key) !== section) continue;
		const value = unwrap(property.value);
		if (value.type !== "ObjectExpression") return [];
		return value.properties.filter((entry): entry is ESTree.ObjectProperty => entry.type === "Property" && !entry.computed);
	}
	return [];
}

/** Build a rule that reports `setup` actions or guards the machine names exactly once. */
export function singleUseSetupRule(section: SetupSection, singular: string) {
	return defineRule({
		meta: {
			type: "suggestion",
			docs: {
				description: `Disallow \`setup({ ${section} })\` entries that the machine references only once.`,
			},
			messages: {
				singleUse: `The ${singular} \`{{name}}\` is referenced once. Write it inline where it is used, and keep named ${section} in \`setup\` for the ones the machine reuses.`,
			},
		},
		create(context) {
			const imports = collectXStateImports(context.sourceCode.ast, "xstate");
			const isSetup = (callee: ESTree.Node) => importedCallee(callee, imports) === "setup";
			return {
				CallExpression(node) {
					const machine = setupMachine(node, isSetup);
					if (machine === null) return;
					const entries = sectionEntries(machine.options, section);
					if (entries.length === 0) return;
					const counts = new Map<string, number>();
					countStringReferences(machine.options, counts);
					for (const argument of machine.createMachine.arguments) countStringReferences(argument, counts);
					for (const entry of entries) {
						const name = keyName(entry.key);
						if (name !== null && counts.get(name) === 1) context.report({ node: entry.key, messageId: "singleUse", data: { name } });
					}
				},
			};
		},
	});
}
