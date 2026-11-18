// Ported from mpsuesser/enfect's `throw-in-effect-gen` (https://github.com/mpsuesser/enfect, MIT, @enfect/oxlint 0.10.0).
// The upstream rule reports any `throw` lexically inside an `Effect.gen`, `Effect.fn` or `Effect.fnUntraced` call
// unless it sits in an exactly shaped `Effect.try` callback, so it also reports throws in plain helpers, promise
// callbacks and object methods that only happen to be declared inside the generator. This version reports a throw
// only when the nearest enclosing function is the generator itself.
import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
	collectEffectModuleNames,
	isFunction,
	moduleCallName,
	unwrapNode,
	type EffectModuleNames,
	type FunctionNode,
} from "../shared/effect-modules.ts";

/** `Effect` constructors whose generator body runs as the Effect program. */
const generatorConstructors: ReadonlySet<string> = new Set(["fn", "fnUntraced", "gen"]);

/** Constructors that take the generator in a second call: `Effect.fn("name")(function* () {...})`. */
const curriedConstructors: ReadonlySet<string> = new Set(["fn", "fnUntraced"]);

/** The node that holds `node` in place of its wrappers: parentheses, type assertions and the like. */
function outermostWrapper(node: ESTree.Node): ESTree.Node {
	let current = node;
	while (current.parent !== null && unwrapNode(current.parent) !== current.parent) current = current.parent;
	return current;
}

/** Whether a synchronous function is called where it is written, so its throws reach the enclosing function. */
function isImmediatelyInvoked(fn: FunctionNode): boolean {
	if (fn.async || fn.generator || fn.type === "FunctionDeclaration") return false;
	const expression = outermostWrapper(fn);
	const call = expression.parent;
	return call?.type === "CallExpression" && unwrapNode(call.callee) === fn;
}

/** Whether `fn` is the generator passed to `Effect.gen`, `Effect.fn` or `Effect.fnUntraced`. */
function isEffectGenerator(fn: FunctionNode, names: EffectModuleNames): boolean {
	if (fn.type !== "FunctionExpression" || !fn.generator) return false;
	const argument = outermostWrapper(fn);
	const call = argument.parent;
	if (call?.type !== "CallExpression" || !call.arguments.some((candidate) => candidate === argument)) return false;
	const direct = moduleCallName(call, names, "Effect");
	if (direct !== null) return generatorConstructors.has(direct);
	const curried = moduleCallName(unwrapNode(call.callee), names, "Effect");
	return curried !== null && curriedConstructors.has(curried);
}

/**
 * Whether a throw escapes into an Effect generator. A throw belongs to the nearest enclosing function, looking
 * through synchronous functions invoked in place, and does not escape a `try` block that has a `catch` clause.
 * Callbacks that Effect runs later, such as the `try` callback of `Effect.try`, or synchronously, such as the
 * thunk of `Effect.sync`, are their own functions and are not reported.
 */
function throwsIntoEffectGenerator(node: ESTree.ThrowStatement, names: EffectModuleNames): boolean {
	let child: ESTree.Node = node;
	let current: ESTree.Node | null = node.parent;
	while (current !== null) {
		if (current.type === "TryStatement" && current.block === child && current.handler !== null) return false;
		if (isFunction(current)) {
			if (!isImmediatelyInvoked(current)) return isEffectGenerator(current, names);
		} else if (current.type === "StaticBlock" || current.type === "PropertyDefinition") {
			return false;
		}
		child = current;
		current = current.parent;
	}
	return false;
}

/** Reject `throw` in an Effect generator body, where it becomes a defect instead of a typed failure. */
export const throwInEffectGenRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `throw` in the generator body of `Effect.gen`, `Effect.fn` or `Effect.fnUntraced`, where it becomes a defect instead of a typed failure.",
		},
		messages: {
			throwInEffectGen:
				"This `throw` becomes a defect, not a typed failure. Use `return yield* Effect.fail(new MyError(...))` or `return yield* new MyTaggedError({...})` so `Effect.catchTag` can handle it.",
		},
	},
	create(context) {
		const names = collectEffectModuleNames(context.sourceCode.ast);
		if (!names.has("Effect")) return {};

		return {
			ThrowStatement(node) {
				if (throwsIntoEffectGenerator(node, names)) context.report({ node, messageId: "throwInEffectGen" });
			},
		};
	},
});
