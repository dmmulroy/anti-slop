import { defineRule, type ESTree } from "@oxlint/plugins";

import {
	booleanOption,
	isIgnoredTestFile,
	isWrapper,
	numberOption,
	stringListOption,
	truncate,
	unwrap,
} from "../shared.ts";

const defaultMaxDepth = 3;
const defaultIgnoreRoots = [
	"console",
	"document",
	"globalThis",
	"location",
	"navigator",
	"process",
	"self",
	"window",
];

function propertyName(member: ESTree.MemberExpression): string | undefined {
	if (member.computed) return undefined;
	return member.property.type === "Identifier" || member.property.type === "PrivateIdentifier"
		? member.property.name
		: undefined;
}

function isGetterCall(call: ESTree.CallExpression, member: ESTree.MemberExpression): boolean {
	const name = propertyName(member);
	return call.arguments.length === 0 && name !== undefined && /^get[A-Z]/.test(name);
}

interface Chain {
	readonly depth: number;
	readonly root: ESTree.Node;
	readonly hasPipe: boolean;
}

/**
 * The longest run of property reads and zero-argument `getX()` calls in a chain. A call with
 * arguments, or any method other than a getter, ends the run: it is a command or a builder step,
 * not navigation through another object's structure.
 */
function measureChain(top: ESTree.Expression): Chain {
	let current = unwrap(top);
	let run = 0;
	let depth = 0;
	let hasPipe = false;
	for (;;) {
		if (current.type === "MemberExpression") {
			if (current.computed) {
				const isIndex = current.property.type === "Literal";
				if (!isIndex) {
					depth = Math.max(depth, run);
					run = 0;
				}
			} else {
				run += 1;
			}
			current = unwrap(current.object);
			continue;
		}
		if (current.type === "CallExpression") {
			const callee = unwrap(current.callee);
			if (callee.type !== "MemberExpression") break;
			if (propertyName(callee) === "pipe") hasPipe = true;
			if (isGetterCall(current, callee)) {
				current = callee;
				continue;
			}
			depth = Math.max(depth, run);
			run = 0;
			current = unwrap(callee.object);
			continue;
		}
		break;
	}
	return { depth: Math.max(depth, run), root: current, hasPipe };
}

/** Climb from a member expression to the outermost expression of its chain, or undefined if inner. */
function chainTop(node: ESTree.MemberExpression): ESTree.Expression | undefined {
	let top: ESTree.Expression = node;
	for (;;) {
		const parent: ESTree.Node | null = top.parent;
		if (parent === null) return top;
		if (isWrapper(parent) && parent.expression === top) {
			top = parent;
			continue;
		}
		if (parent.type === "MemberExpression" && parent.object === top) return undefined;
		if (parent.type === "CallExpression" && parent.callee === top) {
			top = parent;
			continue;
		}
		return top;
	}
}

/** Flag long navigation chains through other objects' properties and getters. */
export const messageChainsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Flag property and getter chains that navigate through more objects than a threshold (Refactoring, Message Chains).",
		},
		messages: {
			chain: "Possibly Message Chains: `{{chain}}` navigates through {{depth}} objects (limit {{maxDepth}}), so this code depends on the structure of every object along the path. Consider Hide Delegate: ask the first object for what you need through one method (in Effect, a service operation that returns the value), or Extract Function on the chain and Move Function it next to the data it walks.",
		},
		schema: [
			{
				type: "object",
				properties: {
					ignoreTests: { type: "boolean" },
					maxDepth: { type: "integer", minimum: 1 },
					ignoreRoots: { type: "array", items: { type: "string" } },
					ignorePascalCaseRoots: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [
			{
				ignoreTests: true,
				maxDepth: defaultMaxDepth,
				ignoreRoots: defaultIgnoreRoots,
				ignorePascalCaseRoots: true,
			},
		],
	},
	createOnce(context) {
		return {
			before() {
				return isIgnoredTestFile(context) ? false : undefined;
			},
			MemberExpression(node) {
				const top = chainTop(node);
				if (top === undefined) return;
				const maxDepth = numberOption(context.options, "maxDepth", defaultMaxDepth);
				const chain = measureChain(top);
				if (chain.depth <= maxDepth || chain.hasPipe) return;
				const root = chain.root;
				if (root.type === "MetaProperty" || root.type === "Super") return;
				if (root.type === "Identifier") {
					const ignoreRoots = stringListOption(context.options, "ignoreRoots", defaultIgnoreRoots);
					if (ignoreRoots.includes(root.name)) return;
					// Namespaces and classes (`Schema.Struct`, `Effect.Service`) are module paths, not objects.
					const ignorePascalCase = booleanOption(context.options, "ignorePascalCaseRoots", true);
					if (ignorePascalCase && /^[A-Z]/.test(root.name)) return;
				}
				context.report({
					node: top,
					messageId: "chain",
					data: {
						chain: truncate(context.sourceCode.getText(top), 60),
						depth: chain.depth,
						maxDepth,
					},
				});
			},
		};
	},
});
