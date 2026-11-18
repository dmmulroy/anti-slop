import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
	collectEffectModuleNames,
	isFunction,
	moduleCallName,
	moduleMemberName,
	returnedExpressions,
	staticMembers,
	unwrapExpression,
	unwrapNode,
	type EffectModuleNames,
	type FunctionNode,
} from "../shared/effect-modules.ts";

/** Constructors whose subclasses are Effect services. */
const serviceFactories: ReadonlyMap<"Context" | "Effect", ReadonlySet<string>> = new Map([
	["Context", new Set(["Service", "Tag"])],
	["Effect", new Set(["Service"])],
]);

/** Whether a class extends `Context.Service<...>()(...)`, `Context.Tag(...)<...>()`, or `Effect.Service<...>()(...)`. */
function isServiceClass(node: ESTree.Class, names: EffectModuleNames): boolean {
	if (node.superClass === null) return false;
	let current: ESTree.Node = unwrapExpression(node.superClass);
	while (current.type === "CallExpression") {
		const callee = unwrapExpression(current.callee);
		for (const [module, factories] of serviceFactories) {
			const member = moduleMemberName(callee, names, module);
			if (member !== null && factories.has(member)) return true;
		}
		current = callee;
	}
	return false;
}

/** Whether `node` names the class: its name, or `this` where `this` is the class (outside nested non-arrow functions). */
function isServiceReference(node: ESTree.Node | null | undefined, className: string | null, thisIsClass = true): boolean {
	if (node === null || node === undefined) return false;
	const expression = unwrapNode(node);
	if (expression.type === "ThisExpression") return thisIsClass;
	return expression.type === "Identifier" && className !== null && expression.name === className;
}

/** Whether `node` is `yield* <ClassName>`. A generator has its own `this`, so `yield* this` is not the service. */
function isServiceYield(node: ESTree.Node | null | undefined, className: string | null): boolean {
	if (node === null || node === undefined) return false;
	const expression = unwrapNode(node);
	return expression.type === "YieldExpression" && expression.delegate && isServiceReference(expression.argument, className, false);
}

/** The names a function's parameters bind directly: `id`, `id = 1`, and `...ids`. */
function parameterNames(fn: FunctionNode | null): ReadonlySet<string> {
	const names = new Set<string>();
	for (const parameter of fn?.params ?? []) {
		const pattern = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
		if (pattern.type === "Identifier") names.add(pattern.name);
		else if (pattern.type === "AssignmentPattern" && pattern.left.type === "Identifier") names.add(pattern.left.name);
		else if (pattern.type === "RestElement" && pattern.argument.type === "Identifier") names.add(pattern.argument.name);
	}
	return names;
}

/** Whether every argument passes one of the static's own parameters through unchanged. */
function forwardsParameters(call: ESTree.CallExpression, parameters: ReadonlySet<string>): boolean {
	return call.arguments.every((argument) => {
		const value = argument.type === "SpreadElement" ? argument.argument : argument;
		const expression = unwrapExpression(value);
		return expression.type === "Identifier" && parameters.has(expression.name);
	});
}

/** The method name when `node` is `<receiver>.<method>(...parameters)` and `isReceiver` accepts the receiver. */
function forwardedMethod(
	node: ESTree.Node | null | undefined,
	parameters: ReadonlySet<string>,
	isReceiver: (receiver: ESTree.Node) => boolean,
): string | null {
	if (node === null || node === undefined) return null;
	let expression = unwrapNode(node);
	if (expression.type === "YieldExpression" && expression.delegate && expression.argument !== null) {
		expression = unwrapExpression(expression.argument);
	}
	if (expression.type !== "CallExpression" || !forwardsParameters(expression, parameters)) return null;
	const callee = unwrapExpression(expression.callee);
	if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return null;
	return isReceiver(callee.object) ? callee.property.name : null;
}

/** The single expression a statement returns or evaluates, or null. */
function statementValue(statement: ESTree.Statement): ESTree.Expression | null {
	if (statement.type === "ReturnStatement") return statement.argument;
	if (statement.type === "ExpressionStatement") return statement.expression;
	return null;
}

/**
 * The forwarded method when a generator body is only `const service = yield* Service; return yield* service.method(...)`
 * or `return yield* (yield* Service).method(...)`.
 */
function generatorForward(generator: ESTree.Function, className: string | null, parameters: ReadonlySet<string>): string | null {
	const statements = generator.body?.body ?? [];
	if (statements.length === 1) {
		const [only] = statements;
		if (only === undefined) return null;
		return forwardedMethod(statementValue(only), parameters, (receiver) => isServiceYield(receiver, className));
	}
	if (statements.length !== 2) return null;
	const [declaration, use] = statements;
	if (declaration?.type !== "VariableDeclaration" || declaration.declarations.length !== 1 || use === undefined) return null;
	const [declarator] = declaration.declarations;
	if (declarator?.id.type !== "Identifier" || !isServiceYield(declarator.init, className)) return null;
	const local = declarator.id.name;
	return forwardedMethod(
		statementValue(use),
		parameters,
		(receiver) => receiver.type === "Identifier" && receiver.name === local,
	);
}

/** The forwarded method when a callback is `(service) => service.method(...)` or `({ method }) => method(...)`. */
function callbackForward(callback: ESTree.Node | undefined, parameters: ReadonlySet<string>): string | null {
	if (callback === undefined || !isFunction(callback) || callback.params.length !== 1) return null;
	const [returned, ...others] = returnedExpressions(callback);
	if (returned === undefined || others.length > 0) return null;
	const [parameter] = callback.params;
	if (parameter?.type === "Identifier") {
		return forwardedMethod(returned, parameters, (receiver) => receiver.type === "Identifier" && receiver.name === parameter.name);
	}
	if (parameter?.type !== "ObjectPattern" || parameter.properties.length !== 1) return null;
	const [property] = parameter.properties;
	if (property?.type !== "Property" || property.computed || property.value.type !== "Identifier" || property.key.type !== "Identifier") {
		return null;
	}
	const local = property.value.name;
	const call = unwrapExpression(returned);
	if (call.type !== "CallExpression" || !forwardsParameters(call, parameters)) return null;
	const callee = unwrapExpression(call.callee);
	return callee.type === "Identifier" && callee.name === local ? property.key.name : null;
}

const chainingOperators: ReadonlySet<string> = new Set(["andThen", "flatMap"]);

/** The generator of `Effect.gen(function* () {...})`, or of `Effect.fn(...)(function* () {...})` with no pipeline steps. */
function effectGenerator(node: ESTree.Expression, names: EffectModuleNames): ESTree.Function | null {
	if (node.type !== "CallExpression") return null;
	const body = node.arguments.at(-1);
	if (body?.type !== "FunctionExpression" || !body.generator) return null;
	if (moduleCallName(node, names, "Effect") === "gen") return body;
	if (node.arguments.length !== 1) return null;
	const callee = unwrapExpression(node.callee);
	const fn = callee.type === "CallExpression" ? unwrapExpression(callee.callee) : callee;
	const member = moduleMemberName(fn, names, "Effect");
	return member === "fn" || member === "fnUntraced" ? body : null;
}

/** The method an Effect expression forwards to, or null when it does any other work. */
function effectForward(
	expression: ESTree.Expression,
	names: EffectModuleNames,
	className: string | null,
	outerParameters: ReadonlySet<string>,
): string | null {
	const node = unwrapExpression(expression);
	const generator = effectGenerator(node, names);
	if (generator !== null) {
		const parameters = new Set([...outerParameters, ...parameterNames(generator)]);
		return generatorForward(generator, className, parameters);
	}
	if (node.type !== "CallExpression") return null;
	const operator = moduleCallName(node, names, "Effect");
	if (operator !== null && chainingOperators.has(operator) && node.arguments.length === 2) {
		const [service, callback] = node.arguments;
		return isServiceReference(service, className) ? callbackForward(callback, outerParameters) : null;
	}
	const callee = unwrapExpression(node.callee);
	if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return null;
	if (!isServiceReference(callee.object, className) || node.arguments.length !== 1) return null;
	const [argument] = node.arguments;
	if (callee.property.name === "use") return callbackForward(argument, outerParameters);
	if (callee.property.name !== "pipe" || argument === undefined || argument.type === "SpreadElement") return null;
	const step = unwrapExpression(argument);
	const stepOperator = moduleCallName(step, names, "Effect");
	if (step.type !== "CallExpression" || stepOperator === null || !chainingOperators.has(stepOperator) || step.arguments.length !== 1) {
		return null;
	}
	return callbackForward(step.arguments[0], outerParameters);
}

/** The method a static member forwards to: its value is such an Effect or a function that returns one. */
function staticForward(value: ESTree.Expression, names: EffectModuleNames, className: string | null): string | null {
	const node = unwrapExpression(value);
	if (!isFunction(node)) return effectForward(node, names, className, new Set());
	if (node.generator || node.async) return null;
	const [returned, ...others] = returnedExpressions(node);
	if (returned === undefined || others.length > 0) return null;
	if (node.body?.type === "BlockStatement" && node.body.body.length !== 1) return null;
	return effectForward(returned, names, className, parameterNames(node));
}

/** Reject static members of an Effect service that only fetch the service and call one of its methods. */
export const noStaticEffectServiceForwardersRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow static members of an Effect service class that only yield the service and call one of its methods.",
		},
		messages: {
			staticForwarder:
				"`{{service}}.{{name}}` only fetches `{{service}}` and calls its `{{method}}` method. Delete the static and have callers `yield* {{service}}` and call `{{method}}` on it, so the dependency stays visible where it is used.",
		},
	},
	create(context) {
		const names = collectEffectModuleNames(context.sourceCode.ast);

		const check = (node: ESTree.Class) => {
			if (!isServiceClass(node, names)) return;
			const className = node.id?.name ?? null;
			for (const member of staticMembers(node)) {
				if (member.value === null) continue;
				const method = staticForward(member.value, names, className);
				if (method === null) continue;
				context.report({
					node: member.node,
					messageId: "staticForwarder",
					data: { service: className ?? "the service", name: member.name, method },
				});
			}
		};

		return { ClassDeclaration: check, ClassExpression: check };
	},
});
