import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
	collectEffectModuleNames,
	contains,
	isFunction,
	isTestFile,
	makeGenerator,
	moduleCallName,
	moduleMemberName,
	ownReturns,
	pipeReceiver,
	resolveInitializer,
	returnedExpressions,
	serviceClass,
	serviceMakes,
	unwrapExpression,
	unwrapNode,
	type EffectModuleNames,
	type FunctionNode,
} from "../shared/effect-modules.ts";

/** `Effect.fn("name")`, with a literal span name. */
function isNamedEffectFn(node: ESTree.Node, names: EffectModuleNames): boolean {
	if (moduleCallName(node, names, "Effect") !== "fn" || node.type !== "CallExpression") return false;
	const [name] = node.arguments;
	return (name?.type === "Literal" && typeof name.value === "string") || name?.type === "TemplateLiteral";
}

const isSpanCall = (node: ESTree.Node, names: EffectModuleNames): boolean =>
	isNamedEffectFn(node, names) || moduleCallName(node, names, "Effect") === "withSpan";

/** Whether `node` names a span itself, or calls a local function that does. */
function hasSpan(node: ESTree.Node, names: EffectModuleNames, sourceCode: SourceCode): boolean {
	return contains(node, (current) => {
		if (isSpanCall(current, names)) return true;
		if (current.type !== "CallExpression") return false;
		const callee = unwrapNode(current.callee);
		if (callee.type !== "Identifier") return false;
		const initializer = resolveInitializer(sourceCode, callee);
		return initializer !== null && contains(initializer, (inner) => isSpanCall(inner, names));
	});
}

/** Whether an expression evaluates to an Effect: an `Effect.*` call, or a pipe with an `Effect.*` step. */
function isEffectCall(node: ESTree.Node, names: EffectModuleNames): boolean {
	let expression = unwrapNode(node);
	let receiver = pipeReceiver(expression);
	while (receiver !== null) {
		if (
			expression.type === "CallExpression" &&
			expression.arguments.some((step) => moduleCallName(unwrapNode(step), names, "Effect") !== null || moduleMemberName(unwrapNode(step), names, "Effect") !== null)
		) {
			return true;
		}
		expression = receiver;
		receiver = pipeReceiver(expression);
	}
	if (expression.type !== "CallExpression") return false;
	const callee = unwrapNode(expression.callee);
	if (moduleCallName(expression, names, "Effect") !== null) return true;
	// `Effect.fn("name")(function* () {})` is a call of a call.
	return callee.type === "CallExpression" && moduleCallName(callee, names, "Effect") !== null;
}

/** Whether a function evidently returns an Effect; plain helpers a service exposes are not operations. */
const returnsEffect = (fn: FunctionNode, names: EffectModuleNames): boolean =>
	returnedExpressions(fn).some((returned) => isEffectCall(returned, names));

const isOperation = (node: ESTree.Node, names: EffectModuleNames): boolean =>
	isFunction(node) ? returnsEffect(node, names) : isEffectCall(node, names);

/** The operation an object property holds, resolving a same-file identifier one level, or null. */
function operationOf(
	value: ESTree.Node,
	names: EffectModuleNames,
	sourceCode: SourceCode,
): ESTree.Node | null {
	const expression = unwrapNode(value);
	if (isOperation(expression, names)) return expression;
	if (expression.type !== "Identifier") return null;
	const initializer = resolveInitializer(sourceCode, expression);
	if (initializer === null) return null;
	const resolved = unwrapNode(initializer);
	return isOperation(resolved, names) ? resolved : null;
}

/** The object literal returned at the top level of a make generator, directly or through `X.of({...})`. */
function returnedObjects(generator: ESTree.Function, sourceCode: SourceCode): readonly ESTree.ObjectExpression[] {
	if (generator.body === null) return [];
	const objects: ESTree.ObjectExpression[] = [];
	for (const statement of ownReturns(generator.body)) {
		if (statement.argument === null) continue;
		let expression = unwrapExpression(statement.argument);
		if (expression.type === "CallExpression") {
			const callee = unwrapNode(expression.callee);
			const [argument] = expression.arguments;
			if (
				callee.type === "MemberExpression" &&
				!callee.computed &&
				callee.property.type === "Identifier" &&
				callee.property.name === "of" &&
				argument !== undefined &&
				argument.type !== "SpreadElement"
			) {
				expression = unwrapExpression(argument);
			}
		}
		if (expression.type === "Identifier") {
			const initializer = resolveInitializer(sourceCode, expression);
			if (initializer !== null && initializer.type !== "FunctionDeclaration") expression = unwrapExpression(initializer);
		}
		if (expression.type === "ObjectExpression") objects.push(expression);
	}
	return objects;
}

/** Require every operation a service's make returns to be named with a span. */
export const requireOperationSpanRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require each operation returned by a Context.Service make to be traced with Effect.fn(\"name\") or Effect.withSpan.",
		},
		messages: {
			missingSpan:
				'Operation "{{operation}}" of service "{{service}}" has no span. Define it with `Effect.fn("{{service}}.{{operation}}")(function* (input) { ... })`, or end its pipe with `Effect.withSpan("{{service}}.{{operation}}", { attributes: { ... } })`.',
		},
	},
	create(context) {
		if (isTestFile(context.filename)) return {};
		const names = collectEffectModuleNames(context.sourceCode.ast);
		const { sourceCode } = context;

		const checkClass = (node: ESTree.Class) => {
			const service = serviceClass(node, names);
			if (service === null) return;
			for (const make of serviceMakes(service)) {
				const generator = makeGenerator(make, names);
				if (generator === null) continue;
				for (const object of returnedObjects(generator, sourceCode)) {
					for (const property of object.properties) {
						if (property.type !== "Property" || property.computed) continue;
						const operation = operationOf(property.value, names, sourceCode);
						if (operation === null || hasSpan(operation, names, sourceCode)) continue;
						context.report({
							node: property,
							messageId: "missingSpan",
							data: { operation: sourceCode.getText(property.key), service: service.name ?? "Service" },
						});
					}
				}
			}
		};

		return { ClassDeclaration: checkClass, ClassExpression: checkClass };
	},
});
