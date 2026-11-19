import { defineRule, type ESTree, type SourceCode } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

const builtinChecks = new Map([
	["Array", "`Array.isArray(value)`"],
	["Error", "`Predicate.isError(value)`"],
	["Date", "`Predicate.isDate(value)`"],
	["Map", "`Predicate.isMap(value)`"],
	["Set", "`Predicate.isSet(value)`"],
	["RegExp", "`Predicate.isRegExp(value)`"],
	["Promise", "`Predicate.isPromise(value)`"],
	["Uint8Array", "`Predicate.isUint8Array(value)`"],
	["Function", "`Predicate.isFunction(value)`"],
]);

function builtinCheck(sourceCode: SourceCode, right: ESTree.Expression): string | undefined {
	if (right.type !== "Identifier") return undefined;
	const check = builtinChecks.get(right.name);
	if (check === undefined) return undefined;
	const variable = resolveVariable(sourceCode, right);
	return variable === null || variable.defs.length === 0 ? check : undefined;
}

/** Ban `instanceof`, which breaks across realms and duplicated packages and hides which check the code means. */
export const noInstanceofRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow instanceof; use Schema.is, tagged refinements, or a named predicate such as Predicate.isError or Array.isArray.",
		},
		messages: {
			instanceof:
				"Replace `instanceof` with a named check. Use `Schema.is(X)` for schemas and Schema.Class values, `Predicate.isTagged(value, tag)`, a `_tag` refinement, or `Schema.is` for tagged errors, `Predicate.isError` for unknown thrown values, and `Array.isArray`, `Predicate.isDate`, `Predicate.isMap`, and similar predicates for builtins.",
			builtin:
				"Replace `instanceof {{name}}` with {{check}}. `instanceof` fails for values from another realm or a duplicated package.",
		},
	},
	createOnce(context) {
		return {
			BinaryExpression(node) {
				if (node.operator !== "instanceof") return;
				const check = builtinCheck(context.sourceCode, node.right);
				if (check === undefined || node.right.type !== "Identifier") {
					context.report({ node, messageId: "instanceof" });
					return;
				}
				context.report({ node, messageId: "builtin", data: { name: node.right.name, check } });
			},
		};
	},
});
