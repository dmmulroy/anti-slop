import { defineRule, type ESTree } from "@oxlint/plugins";

import {
	booleanOption,
	childNodes,
	contains,
	isFunctionNode,
	isIgnoredTestFile,
	isWrapper,
	resolveVariable,
	unwrap,
} from "../shared.ts";

type LoopNode =
	| ESTree.ForStatement
	| ESTree.ForInStatement
	| ESTree.ForOfStatement
	| ESTree.WhileStatement
	| ESTree.DoWhileStatement;

const collectingMethods = new Set(["push", "unshift", "set", "add"]);
const indexedWrite = "assigning computed keys";

function isLoop(node: ESTree.Node): node is LoopNode {
	return (
		node.type === "ForStatement" ||
		node.type === "ForInStatement" ||
		node.type === "ForOfStatement" ||
		node.type === "WhileStatement" ||
		node.type === "DoWhileStatement"
	);
}

function isConditionLoop(node: ESTree.Node): boolean {
	return node.type === "WhileStatement" || node.type === "DoWhileStatement";
}

/** `return`, or a `break` that leaves this loop, means the loop is a search, not a transform. */
function hasEarlyExit(loop: LoopNode): boolean {
	const label = loop.parent.type === "LabeledStatement" ? loop.parent.label.name : undefined;
	const visit = (node: ESTree.Node, breakable: boolean): boolean => {
		if (isFunctionNode(node)) return false;
		if (node.type === "ReturnStatement") return true;
		if (node.type === "BreakStatement") {
			if (node.label === null || node.label === undefined) return !breakable;
			return node.label.name === label || !breakable;
		}
		const nestedBreakable = breakable || isLoop(node) || node.type === "SwitchStatement";
		return childNodes(node).some((child) => visit(child, nestedBreakable));
	};
	return visit(loop.body, false);
}

interface Accumulation {
	readonly node: ESTree.Node;
	readonly target: ESTree.IdentifierReference;
	readonly how: string;
}

function referencesName(node: ESTree.Node, name: string): boolean {
	if (node.type === "Identifier") return node.name === name;
	return childNodes(node).some((child) => referencesName(child, name));
}

function accumulation(node: ESTree.Node): Accumulation | undefined {
	if (node.type === "CallExpression") {
		const callee = unwrap(node.callee);
		if (
			callee.type === "MemberExpression" &&
			!callee.computed &&
			callee.property.type === "Identifier" &&
			collectingMethods.has(callee.property.name)
		) {
			const object = unwrap(callee.object);
			if (object.type === "Identifier") {
				return { node, target: object, how: `calling \`.${callee.property.name}\`` };
			}
		}
		return undefined;
	}
	if (node.type !== "AssignmentExpression") return undefined;
	const left = node.left;
	if (left.type === "MemberExpression" && left.computed) {
		const object = unwrap(left.object);
		if (object.type === "Identifier") return { node, target: object, how: indexedWrite };
		return undefined;
	}
	if (left.type !== "Identifier" || node.operator !== "=") return undefined;
	const right = unwrap(node.right);
	const isSelf = (argument: ESTree.Expression) => {
		const value = unwrap(argument);
		return value.type === "Identifier" && value.name === left.name;
	};
	const spreadsItself =
		right.type === "ArrayExpression"
			? right.elements.some((element) => element?.type === "SpreadElement" && isSelf(element.argument))
			: right.type === "ObjectExpression" &&
				right.properties.some(
					(property) => property.type === "SpreadElement" && isSelf(property.argument),
				);
	if (spreadsItself) return { node, target: left, how: "copying it with a spread" };
	if (
		right.type === "CallExpression" &&
		right.callee.type === "MemberExpression" &&
		!right.callee.computed &&
		right.callee.property.type === "Identifier" &&
		right.callee.property.name === "concat" &&
		isSelf(right.callee.object)
	) {
		return { node, target: left, how: "calling `.concat`" };
	}
	return undefined;
}

function accumulations(root: ESTree.Node): ReadonlyArray<Accumulation> {
	const found: Array<Accumulation> = [];
	const pending: Array<ESTree.Node> = [root];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) break;
		const site = accumulation(node);
		if (site !== undefined) found.push(site);
		pending.push(...childNodes(node));
	}
	return found;
}

function rootIdentifier(node: ESTree.Node): (ESTree.Node & { readonly name: string }) | undefined {
	let current: ESTree.Node = node;
	for (;;) {
		if (current.type === "Identifier") return current;
		if (current.type === "MemberExpression") {
			current = current.object;
			continue;
		}
		if (isWrapper(current)) {
			current = current.expression;
			continue;
		}
		return undefined;
	}
}

/** Names of bindings declared outside `loop` that its body reassigns or writes properties on. */
function outerWrites(
	loop: LoopNode,
	isOuter: (identifier: ESTree.Node & { readonly name: string }) => boolean,
): ReadonlySet<string> {
	const names = new Set<string>();
	const pending: Array<ESTree.Node> = [loop.body];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) break;
		const target =
			node.type === "AssignmentExpression"
				? node.left
				: node.type === "UpdateExpression"
					? node.argument
					: undefined;
		if (target !== undefined) {
			const root = rootIdentifier(target);
			if (root !== undefined && isOuter(root)) names.add(root.name);
		}
		pending.push(...childNodes(node));
	}
	return names;
}
function insideCountedLoop(node: ESTree.Node, loop: LoopNode): boolean {
	let current: ESTree.Node | null = node;
	while (current !== null) {
		if (current.type === "ForStatement") return true;
		if (current === loop) return false;
		current = current.parent;
	}
	return false;
}

function iteratedExpression(loop: LoopNode): ESTree.Node | undefined {
	if (loop.type === "ForOfStatement" || loop.type === "ForInStatement") return loop.right;
	if (loop.type === "ForStatement") return loop.test ?? undefined;
	return loop.test;
}

/** Flag loops that build a collection declared outside the loop by pushing, setting, or spreading. */
export const loopsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Flag loops that build an array, object, Map, or Set declared outside the loop (Refactoring, Loops).",
		},
		messages: {
			loop: "Possibly Loops: this loop builds `{{target}}` by {{how}} on each iteration, so the transformation is hidden inside control flow and mutation. Consider Replace Loop with Pipeline: express it as `map`/`filter`/`flatMap`/`groupBy` over the source (Effect's `Arr` and `Record` modules, or `Object.fromEntries`), or `Effect.forEach`/`Stream` when each iteration runs an effect.",
		},
		schema: [
			{
				type: "object",
				properties: { ignoreTests: { type: "boolean" }, includeWhile: { type: "boolean" } },
				additionalProperties: false,
			},
		],
		defaultOptions: [{ ignoreTests: true, includeWhile: false }],
	},
	createOnce(context) {
		const qualifies = (loop: LoopNode, includeWhile: boolean) =>
			(includeWhile || !isConditionLoop(loop)) && !hasEarlyExit(loop);

		const check = (loop: LoopNode) => {
			const includeWhile = booleanOption(context.options, "includeWhile", false);
			if (!qualifies(loop, includeWhile)) return;
			const iterated = iteratedExpression(loop);
			const isOuter = (identifier: ESTree.Node & { readonly name: string }) => {
				const declaration = resolveVariable(context.sourceCode, identifier)?.identifiers[0];
				return declaration === undefined || !contains(loop, declaration);
			};
			// Writes to other outer state make the loop a state machine, not a transform.
			const written = outerWrites(loop, isOuter);
			for (const site of accumulations(loop.body)) {
				if ([...written].some((name) => name !== site.target.name)) return;
				// Index writes inside counted `for` loops are in-place buffer or matrix updates.
				if (site.how === indexedWrite && insideCountedLoop(site.node, loop)) continue;
				const variable = resolveVariable(context.sourceCode, site.target);
				const declaration = variable?.identifiers[0];
				if (declaration === undefined || contains(loop, declaration)) continue;
				// A worklist loop that grows the collection it iterates is not a pipeline.
				if (iterated !== undefined && referencesName(iterated, site.target.name)) continue;
				let ancestor: ESTree.Node | null = loop.parent;
				let reportedByOuterLoop = false;
				while (ancestor !== null && !contains(ancestor, declaration)) {
					if (isLoop(ancestor) && qualifies(ancestor, includeWhile)) {
						reportedByOuterLoop = true;
						break;
					}
					ancestor = ancestor.parent;
				}
				if (reportedByOuterLoop) continue;
				context.report({
					node: loop,
					messageId: "loop",
					data: { target: site.target.name, how: site.how },
				});
				return;
			}
		};
		return {
			before() {
				return isIgnoredTestFile(context) ? false : undefined;
			},
			ForStatement: check,
			ForInStatement: check,
			ForOfStatement: check,
			WhileStatement: check,
			DoWhileStatement: check,
		};
	},
});
