import { defineRule } from "@oxlint/plugins";

import { collectXStateImports, importedCallee } from "../shared.ts";

/** Reject `useSelector` from `@xstate/react`, which subscribes a component to an actor it does not own. */
export const noDirectXStateUseSelectorRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow `useSelector` from `@xstate/react`.",
		},
		messages: {
			directUseSelector:
				"Do not call `useSelector` from `@xstate/react`. Read state from the snapshot that the component's one actor hook (`useMachine` or `useActor`) returns, and pass what children need as props, so each component has one visible subscription to one actor.",
		},
	},
	create(context) {
		const imports = collectXStateImports(context.sourceCode.ast, "@xstate/react");
		return {
			CallExpression(node) {
				if (importedCallee(node.callee, imports) === "useSelector") context.report({ node, messageId: "directUseSelector" });
			},
		};
	},
});
