import { defineRule } from "@oxlint/plugins";

import { collectXStateImports, importedCallee } from "../shared.ts";

/** Require machines to be built from `setup()` so actions, guards, actors, and events are declared and typed once. */
export const noDirectXStateCreateMachineRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow `createMachine` from xstate; build machines with `setup({ ... }).createMachine(...)`.",
		},
		messages: {
			directCreateMachine:
				"Build the machine with `setup({ types, actions, guards, actors }).createMachine(...)` instead of `createMachine(...)`. `setup` declares the machine's events, context, and named implementations in one typed place, and references to them are checked.",
		},
	},
	create(context) {
		const imports = collectXStateImports(context.sourceCode.ast, "xstate");
		return {
			CallExpression(node) {
				if (importedCallee(node.callee, imports) === "createMachine") context.report({ node, messageId: "directCreateMachine" });
			},
		};
	},
});
