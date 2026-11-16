import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
	classMemberName,
	collectEffectModuleNames,
	contains,
	enclosingClass,
	isFunction,
	isTestFile,
	moduleCallName,
	pipeReceiver,
	resolveIdentifier,
	returnedExpressions,
	serviceClass,
	serviceMakes,
	staticMembers,
	unwrapExpression,
	unwrapNode,
	type EffectModuleNames,
	type ServiceClass,
} from "../shared/effect-modules.ts";

const isLayerMemberName = (name: string): boolean => name === "layer" || /^layer[A-Z0-9_]/u.test(name);

/** `this.make`, `ClassName.make`, or a call of either. */
function isMakeReference(node: ESTree.Node | undefined, service: ServiceClass): boolean {
	if (node === undefined) return false;
	const expression = unwrapNode(node);
	const target = expression.type === "CallExpression" ? expression.callee : expression;
	return classMemberName(target, service) === "make";
}

/** Whether `node` is `Layer.effect(this, this.make)` or a form built only from it. */
function isMakeLayer(node: ESTree.Node, service: ServiceClass, names: EffectModuleNames): boolean {
	const expression = unwrapNode(node);
	if (isFunction(expression)) {
		const returned = returnedExpressions(expression);
		return returned.length > 0 && returned.every((value) => isMakeLayer(value, service, names));
	}
	const receiver = pipeReceiver(expression);
	if (receiver !== null) return isMakeLayer(receiver, service, names);
	if (expression.type === "CallExpression") {
		const sibling = classMemberName(expression.callee, service);
		if (sibling !== null && isLayerMemberName(sibling)) return true;
		if (moduleCallName(expression, names, "Layer") !== "effect") return false;
		const [target, make] = expression.arguments;
		return (
			target !== undefined &&
			isTarget(target, service) &&
			isMakeReference(make, service)
		);
	}
	const sibling = classMemberName(expression, service);
	return sibling !== null && sibling !== "layer" && isLayerMemberName(sibling);
}

function isTarget(node: ESTree.Node, service: ServiceClass): boolean {
	const expression = unwrapNode(node);
	return (
		expression.type === "ThisExpression" ||
		(expression.type === "Identifier" && service.name !== null && expression.name === service.name)
	);
}

const layerConstructors: ReadonlySet<string> = new Set(["effect", "scoped", "succeed", "sync"]);

/** Whether a static member builds this service with a Layer constructor, rather than a layer for another tag. */
const buildsService = (value: ESTree.Node, service: ServiceClass, names: EffectModuleNames): boolean =>
	contains(value, (node) => {
		const constructor = moduleCallName(node, names, "Layer");
		return (
			constructor !== null &&
			layerConstructors.has(constructor) &&
			node.type === "CallExpression" &&
			node.arguments[0] !== undefined &&
			isTarget(node.arguments[0], service)
		);
	});

/** Whether a variant layer refers to the service's make or one of its layers. */
const derivesFromService = (value: ESTree.Node, service: ServiceClass): boolean =>
	contains(value, (node) => {
		const member = classMemberName(node, service);
		return member !== null && (member === "make" || isLayerMemberName(member));
	});

/** `X.make` or `X.make(...)` where `X` has the same source text as the layer target. */
function isTargetMake(sourceText: (node: ESTree.Node) => string, target: ESTree.Node, make: ESTree.Node): boolean {
	const expression = unwrapNode(make);
	const reference = unwrapNode(expression.type === "CallExpression" ? expression.callee : expression);
	return (
		reference.type === "MemberExpression" &&
		!reference.computed &&
		reference.property.type === "Identifier" &&
		reference.property.name === "make" &&
		sourceText(reference.object) === sourceText(unwrapNode(target))
	);
}

/** The module an expression's root identifier is imported from, or null when it is not imported. */
function importSource(sourceCode: SourceCode, node: ESTree.Node): string | null {
	let root = unwrapNode(node);
	while (root.type === "MemberExpression") root = unwrapNode(root.object);
	if (root.type !== "Identifier") return null;
	const definition = resolveIdentifier(sourceCode, root)?.defs[0];
	if (definition?.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") return null;
	return definition.parent.source.value;
}

/** Tags from the Effect packages, whose classes a project cannot give a make. */
const isEffectPackage = (source: string | null): boolean =>
	source !== null && (source === "effect" || source.startsWith("effect/") || source.startsWith("@effect/"));

function readOptions(option: unknown): { readonly allowTagOnly: boolean } {
	if (typeof option !== "object" || option === null || !("allowTagOnly" in option)) return { allowTagOnly: true };
	return { allowTagOnly: option.allowTagOnly !== false };
}

/** Require each Context.Service to own its constructor as `make` and its layer as `Layer.effect(this, this.make)`. */
export const requireServiceMakeLayerRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require Context.Service classes to define `make` and `static layer = Layer.effect(this, this.make)`, with variant layers derived from them.",
		},
		messages: {
			missingMake:
				'Service "{{name}}" has no `make`. Add `make: Effect.gen(function* () { ...yield* dependencies...; return { ...operations } })` to its Context.Service options (or `static readonly make = (options: Options) => Effect.gen(...)` when construction needs plain options), then add `static readonly layer = Layer.effect(this, this.make)`.',
			missingLayer:
				'Service "{{name}}" has a `make` but no `static layer`. Add `static readonly layer = Layer.effect(this, this.make)`, or `static readonly layer = (options: Options) => Layer.effect(this, this.make(options))` when make takes options.',
			invalidLayer:
				'`{{name}}.layer` must be built from `{{name}}.make`. Write `static readonly layer = Layer.effect(this, this.make)` (add `.pipe(Layer.provide(...))` for local wiring), or `(options: Options) => Layer.effect(this, this.make(options))`; move any construction code into make.',
			invalidVariantLayer:
				'`{{name}}.{{member}}` does not derive from `{{name}}.layer` or `{{name}}.make`. Write it as `{{name}}.layer.pipe(Layer.provide(...))` or `Layer.effect(this, this.make(options))`. A separate implementation belongs in its own service, or in test/ when it is a fake.',
			inlineLayerEffect:
				"This Layer.effect builds `{{service}}` from an inline constructor. Move the constructor into the service class as `make: Effect.gen(...)`, add `static readonly layer = Layer.effect(this, this.make)`, and use `{{service}}.layer` here.",
		},
		schema: [
			{
				type: "object",
				properties: { allowTagOnly: { type: "boolean" } },
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allowTagOnly: true }],
	},
	create(context) {
		if (isTestFile(context.filename)) return {};
		const names = collectEffectModuleNames(context.sourceCode.ast);
		const { allowTagOnly } = readOptions(context.options?.[0]);
		const sourceText = (node: ESTree.Node) => context.sourceCode.getText(node);

		const checkClass = (node: ESTree.Class) => {
			const service = serviceClass(node, names);
			if (service === null) return;
			const name = service.name ?? "this service";
			const members = staticMembers(node);
			const layers = members.filter((member) => isLayerMemberName(member.name));
			if (serviceMakes(service).length === 0) {
				if (allowTagOnly && layers.length === 0) return;
				context.report({ node: node.id ?? node, messageId: "missingMake", data: { name } });
				return;
			}
			const layer = layers.find((member) => member.name === "layer");
			if (layer === undefined) {
				context.report({ node: node.id ?? node, messageId: "missingLayer", data: { name } });
			} else if (layer.value === null || !isMakeLayer(layer.value, service, names)) {
				context.report({ node: layer.node, messageId: "invalidLayer", data: { name } });
			}
			for (const member of layers) {
				if (member === layer) continue;
				if (member.value === null || !buildsService(member.value, service, names)) continue;
				if (derivesFromService(member.value, service)) continue;
				context.report({ node: member.node, messageId: "invalidVariantLayer", data: { name, member: member.name } });
			}
		};

		return {
			ClassDeclaration: checkClass,
			ClassExpression: checkClass,
			CallExpression(node) {
				if (moduleCallName(node, names, "Layer") !== "effect") return;
				const enclosing = enclosingClass(node);
				if (enclosing !== null && serviceClass(enclosing, names) !== null) return;
				const [target, make] = node.arguments;
				if (target === undefined || make === undefined || target.type === "SpreadElement" || make.type === "SpreadElement") return;
				if (isTargetMake(sourceText, target, make) || isEffectPackage(importSource(context.sourceCode, target))) return;
				context.report({ node, messageId: "inlineLayerEffect", data: { service: sourceText(unwrapExpression(target)) } });
			},
		};
	},
});
