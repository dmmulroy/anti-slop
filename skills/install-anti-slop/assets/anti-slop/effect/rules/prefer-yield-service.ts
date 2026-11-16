import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
	collectEffectModuleNames,
	moduleCallName,
	unwrapExpression,
	unwrapNode,
	type EffectModuleNames,
} from "../shared/effect-modules.ts";

const effectProvides: ReadonlySet<string> = new Set(["provide", "provideContext"]);

const layerProvides: ReadonlySet<string> = new Set(["provide", "succeedContext"]);

/** The `Effect.provide`, `Effect.provideContext`, `Layer.provide`, or `Layer.succeedContext` call `identifier` is an argument of. */
function providingCall(identifier: ESTree.Node, names: EffectModuleNames): ESTree.CallExpression | null {
	let child: ESTree.Node = identifier;
	let parent = identifier.parent;
	while (parent !== null && unwrapNode(parent) !== parent) {
		child = parent;
		parent = parent.parent;
	}
	if (parent?.type !== "CallExpression" || !parent.arguments.some((argument) => argument === child)) return null;
	const effectMember = moduleCallName(parent, names, "Effect");
	const layerMember = moduleCallName(parent, names, "Layer");
	const provides =
		(effectMember !== null && effectProvides.has(effectMember)) || (layerMember !== null && layerProvides.has(layerMember));
	return provides ? parent : null;
}

/** Reject capturing the whole Effect context only to provide it back to a nested effect. */
export const preferYieldServiceRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `yield* Effect.context()` results that are passed back to Effect.provide, Effect.provideContext, Layer.provide, or Layer.succeedContext.",
		},
		messages: {
			reprovidedContext:
				"Do not capture the context with `Effect.context` and provide it back with {{provide}}. `yield*` each service the operation uses (`const store = yield* Store`) and let the nested effect's requirements flow through its R channel to the layer or runtime that provides them.",
		},
	},
	create(context) {
		const names = collectEffectModuleNames(context.sourceCode.ast);

		return {
			VariableDeclarator(node) {
				if (node.id.type !== "Identifier" || node.init === null) return;
				const init = unwrapExpression(node.init);
				if (init.type !== "YieldExpression" || !init.delegate || init.argument === null) return;
				if (moduleCallName(unwrapExpression(init.argument), names, "Effect") !== "context") return;
				const [variable] = context.sourceCode.getDeclaredVariables(node);
				for (const reference of variable?.references ?? []) {
					const call = providingCall(reference.identifier, names);
					if (call === null) continue;
					const provide = context.sourceCode.getText(unwrapExpression(call.callee));
					context.report({ node, messageId: "reprovidedContext", data: { provide } });
					return;
				}
			},
		};
	},
});
