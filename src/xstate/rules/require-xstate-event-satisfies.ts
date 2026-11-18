import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { importsXState } from "../shared.ts";

/** Whether a call is `send(...)` or `<actor>.send(...)`. */
function isSendCall(node: ESTree.CallExpression): boolean {
	const callee = node.callee;
	if (callee.type === "Identifier") return callee.name === "send";
	return callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "send";
}

/** Whether an object literal has a non-computed `type` property. */
const hasType = (object: ESTree.ObjectExpression): boolean =>
	object.properties.some(
		(property) =>
			property.type === "Property" &&
			!property.computed &&
			((property.key.type === "Identifier" && property.key.name === "type") ||
				(property.key.type === "Literal" && property.key.value === "type")),
	);

/** Require events sent to XState actors to be checked with `satisfies` against the machine's event type. */
export const requireXStateEventSatisfiesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Require `send({ type: ... })` event literals in XState files to use `satisfies <Event>`.",
		},
		messages: {
			missingSatisfies:
				"Write the event as `send({ type: ... } satisfies MachineEvent)`, using the machine's event type. `satisfies` checks the literal against that union where it is written, so a renamed event or a misspelled field fails here instead of being silently ignored by the machine.",
		},
	},
	create(context) {
		if (!importsXState(context.sourceCode.ast)) return {};
		return {
			CallExpression(node) {
				if (!isSendCall(node)) return;
				const [event] = node.arguments;
				if (event === undefined || event.type !== "ObjectExpression" || !hasType(event)) return;
				context.report({ node: event, messageId: "missingSatisfies" });
			},
		};
	},
});
