import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { collectXStateImports, importedCallee } from "../shared.ts";

/** Hooks that create or subscribe to an actor. `useSelector` has its own rule. */
const actorHooks: ReadonlySet<string> = new Set(["useActor", "useActorRef", "useMachine"]);

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

/** The innermost function that contains `node`, or null at module level. */
function enclosingFunction(node: ESTree.Node): FunctionNode | null {
	let current = node.parent;
	while (current !== null) {
		if (current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression" || current.type === "FunctionDeclaration") {
			return current;
		}
		current = current.parent;
	}
	return null;
}

/** Reject components that call more than one XState actor hook. */
export const noMultipleXStateHooksRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow more than one `useMachine`, `useActor`, or `useActorRef` call in one component or hook.",
		},
		messages: {
			multipleHooks:
				"This component already calls `{{first}}`; a second actor hook (`{{second}}`) splits its state across actors. Compose the actors in one machine (invoke or spawn the child) or split the component so each one uses one actor hook.",
		},
	},
	create(context) {
		const imports = collectXStateImports(context.sourceCode.ast, "@xstate/react");
		const firstHook = new Map<FunctionNode, string>();
		return {
			CallExpression(node) {
				const hook = importedCallee(node.callee, imports);
				if (hook === null || !actorHooks.has(hook)) return;
				const owner = enclosingFunction(node);
				if (owner === null) return;
				const first = firstHook.get(owner);
				if (first === undefined) {
					firstHook.set(owner, hook);
					return;
				}
				context.report({ node, messageId: "multipleHooks", data: { first, second: hook } });
			},
		};
	},
});
