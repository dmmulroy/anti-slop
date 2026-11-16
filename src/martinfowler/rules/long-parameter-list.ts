import { defineRule, type ESTree } from "@oxlint/plugins";

import {
	describeFunction,
	functionName,
	type FunctionNode,
	functionReportNode,
	isIgnoredTestFile,
	numberOption,
} from "../shared.ts";

const defaultMax = 4;

function isPositional(parameter: ESTree.Node): boolean {
	if (parameter.type === "RestElement") return false;
	if (parameter.type === "Identifier" && parameter.name === "this") return false;
	return true;
}

/** Flag function implementations with more positional parameters than the configured maximum. */
export const longParameterListRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Flag functions with more positional parameters than a threshold (Refactoring, Long Parameter List).",
		},
		messages: {
			long: "Possibly Long Parameter List: {{subject}} takes {{count}} positional parameters (limit {{max}}), so every call site depends on argument order and adding one more breaks them all. Consider Introduce Parameter Object: group related parameters into one named input (in Effect, a `Schema.Struct` input type), or Preserve Whole Object when several come from the same value.",
		},
		schema: [
			{
				type: "object",
				properties: { ignoreTests: { type: "boolean" }, max: { type: "integer", minimum: 0 } },
				additionalProperties: false,
			},
		],
		defaultOptions: [{ ignoreTests: true, max: defaultMax }],
	},
	createOnce(context) {
		const check = (node: FunctionNode) => {
			if (node.body === null || node.body === undefined) return;
			const max = numberOption(context.options, "max", defaultMax);
			const count = node.params.filter(isPositional).length;
			if (count <= max) return;
			context.report({
				node: functionReportNode(node),
				messageId: "long",
				data: {
					subject: describeFunction(functionName(node, context.sourceCode)),
					count,
					max,
				},
			});
		};
		return {
			before() {
				return isIgnoredTestFile(context) ? false : undefined;
			},
			FunctionDeclaration: check,
			FunctionExpression: check,
			ArrowFunctionExpression: check,
		};
	},
});
