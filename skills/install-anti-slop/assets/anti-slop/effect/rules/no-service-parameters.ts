import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
	collectEffectModuleNames,
	isTestFile,
	moduleCallName,
	pipeReceiver,
	serviceClass,
	unwrapNode,
	walk,
	type EffectModule,
	type EffectModuleNames,
} from "../shared/effect-modules.ts";

/** Module type names that carry services: `Context.Context`, `ManagedRuntime.ManagedRuntime`, `Layer.Layer`. */
const serviceCarrierTypes: ReadonlyMap<EffectModule, string> = new Map<EffectModule, string>([
	["Context", "Context"],
	["ManagedRuntime", "ManagedRuntime"],
	["Layer", "Layer"],
]);

/** The carrier module of a `Module.Type<...>` reference, or null. */
function carrierModule(type: ESTree.TSType, names: EffectModuleNames): EffectModule | null {
	if (type.type !== "TSTypeReference" || type.typeName.type !== "TSQualifiedName") return null;
	const { left, right } = type.typeName;
	if (left.type !== "Identifier") return null;
	for (const [module, typeName] of serviceCarrierTypes) {
		if (right.name === typeName && (names.get(module)?.has(left.name) ?? false)) return module;
	}
	return null;
}

function serviceClassName(type: ESTree.TSType, services: ReadonlySet<string>): string | null {
	return type.type === "TSTypeReference" && type.typeName.type === "Identifier" && services.has(type.typeName.name)
		? type.typeName.name
		: null;
}

function parameterType(parameter: ESTree.ParamPattern): ESTree.TSType | null {
	const pattern = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
	const annotation = pattern.type === "AssignmentPattern" ? pattern.left.typeAnnotation : pattern.typeAnnotation;
	return annotation?.typeAnnotation ?? null;
}

/** Whether an expression is a Layer constructor call or a pipe of Layer combinators. */
function isLayerExpression(node: ESTree.Node, names: EffectModuleNames): boolean {
	const expression = unwrapNode(node);
	if (moduleCallName(expression, names, "Layer") !== null) return true;
	const receiver = pipeReceiver(expression);
	if (receiver === null || expression.type !== "CallExpression") return false;
	return isLayerExpression(receiver, names) || expression.arguments.some((step) => moduleCallName(unwrapNode(step), names, "Layer") !== null);
}

const effectApiModules: readonly EffectModule[] = ["Context", "Effect", "Layer", "ManagedRuntime"];

/** A callback passed to an Effect API, such as `Effect.contextWith((context: Context.Context<R>) => ...)`, whose parameter type the API dictates. */
function isEffectApiCallback(fn: ESTree.Node, names: EffectModuleNames): boolean {
	const parent = fn.parent;
	if (parent?.type !== "CallExpression" || !parent.arguments.some((argument) => argument === fn)) return false;
	return effectApiModules.some((module) => moduleCallName(parent, names, module) !== null);
}

type Signature = ESTree.ArrowFunctionExpression | ESTree.Function | ESTree.TSFunctionType | ESTree.TSMethodSignature;

/** Whether the function is a layer combinator: it declares or evidently returns a Layer. */
function returnsLayer(fn: Signature, names: EffectModuleNames): boolean {
	const returnType = fn.returnType?.typeAnnotation;
	if (returnType !== undefined && carrierModule(returnType, names) === "Layer") return true;
	if (fn.type === "ArrowFunctionExpression" && fn.body.type !== "BlockStatement") return isLayerExpression(fn.body, names);
	return false;
}

/** Reject passing Context, ManagedRuntime, Layer, or service instances into functions as ordinary arguments. */
export const noServiceParametersRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow function parameters typed as Context.Context, ManagedRuntime.ManagedRuntime, Layer.Layer, or a Context.Service declared in the same file.",
		},
		messages: {
			carrierParameter:
				"Do not pass a `{{type}}` as a parameter. `yield*` the services the operation needs inside it (`const store = yield* Store`) and let its requirements flow through R to the runtime that provides them; pass only plain values.",
			serviceParameter:
				"Do not pass the `{{type}}` service as a parameter. `yield* {{type}}` inside the operation and let the requirement flow through R to the layer that provides it; pass only plain values.",
		},
	},
	create(context) {
		if (isTestFile(context.filename)) return {};
		const names = collectEffectModuleNames(context.sourceCode.ast);
		const services = new Set<string>();
		walk(context.sourceCode.ast, (node) => {
			if ((node.type === "ClassDeclaration" || node.type === "ClassExpression") && node.id !== null && serviceClass(node, names) !== null) {
				services.add(node.id.name);
			}
			return true;
		});

		const check = (fn: Signature) => {
			if (isEffectApiCallback(fn, names)) return;
			for (const parameter of fn.params) {
				const type = parameterType(parameter);
				if (type === null) continue;
				const carrier = carrierModule(type, names);
				if (carrier !== null) {
					if (carrier === "Layer" && returnsLayer(fn, names)) continue;
					context.report({ node: parameter, messageId: "carrierParameter", data: { type: context.sourceCode.getText(type.type === "TSTypeReference" ? type.typeName : type) } });
					continue;
				}
				const service = serviceClassName(type, services);
				if (service !== null) context.report({ node: parameter, messageId: "serviceParameter", data: { type: service } });
			}
		};

		return {
			ArrowFunctionExpression: check,
			FunctionDeclaration: check,
			FunctionExpression: check,
			TSFunctionType: check,
			TSMethodSignature: check,
		};
	},
});

