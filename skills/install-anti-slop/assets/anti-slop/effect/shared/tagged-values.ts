import type { ESTree } from "@oxlint/plugins";

const equalityOperators = new Set(["==", "===", "!=", "!=="]);
const broadEffectCatchMethods = new Set(["catch", "catchAll", "catchIf"]);

export const isStringLiteral = (
	node: ESTree.Node | null | undefined,
): node is ESTree.StringLiteral =>
	node?.type === "Literal" && typeof node.value === "string";

export const isTagMember = (
	node: ESTree.Node | null | undefined,
): node is ESTree.MemberExpression =>
	node?.type === "MemberExpression" &&
	((!node.computed &&
		node.property.type === "Identifier" &&
		node.property.name === "_tag") ||
		(node.computed &&
			isStringLiteral(node.property) &&
			node.property.value === "_tag"));

export const tagMemberFromComparison = (
	node: ESTree.BinaryExpression,
): ESTree.MemberExpression | undefined => {
	if (!equalityOperators.has(node.operator)) return undefined;
	if (isTagMember(node.left) && isStringLiteral(node.right)) return node.left;
	if (isTagMember(node.right) && isStringLiteral(node.left)) return node.right;
	return undefined;
};

const isBroadEffectCatchCall = (
	node: ESTree.Node | null | undefined,
): node is ESTree.CallExpression =>
	node?.type === "CallExpression" &&
	node.callee.type === "MemberExpression" &&
	node.callee.object.type === "Identifier" &&
	node.callee.object.name === "Effect" &&
	!node.callee.computed &&
	node.callee.property.type === "Identifier" &&
	broadEffectCatchMethods.has(node.callee.property.name);

export const isInsideBroadEffectHandler = (node: ESTree.Node): boolean => {
	let current: ESTree.Node | null | undefined = node.parent;
	while (current !== null && current !== undefined) {
		if (
			current.type === "ArrowFunctionExpression" ||
			current.type === "FunctionExpression"
		) {
			return (
				isBroadEffectCatchCall(current.parent) &&
				current.parent.arguments.includes(current)
			);
		}
		current = current.parent;
	}
	return false;
};

export const isReasonTagMember = (node: ESTree.MemberExpression): boolean =>
	node.object.type === "MemberExpression" &&
	((!node.object.computed &&
		node.object.property.type === "Identifier" &&
		node.object.property.name === "reason") ||
		(node.object.computed &&
			isStringLiteral(node.object.property) &&
			node.object.property.value === "reason"));

export const propertyName = (
	property: ESTree.ObjectProperty,
): string | undefined => {
	if (!property.computed && property.key.type === "Identifier") {
		return property.key.name;
	}
	if (
		property.key.type === "Literal" &&
		typeof property.key.value === "string"
	) {
		return property.key.value;
	}
	return undefined;
};

const matchPatternMethods = new Set(["when", "not", "whenAnd", "whenOr"]);

const isMatchCall = (
	node: ESTree.Node | null | undefined,
): node is ESTree.CallExpression => {
	if (node?.type !== "CallExpression") return false;
	const callee = node.callee;
	if (callee.type !== "MemberExpression") return false;
	const isMatchNamespace =
		(callee.object.type === "Identifier" && callee.object.name === "Match") ||
		(callee.object.type === "MemberExpression" &&
			!callee.object.computed &&
			callee.object.object.type === "Identifier" &&
			callee.object.object.name === "Effect" &&
			callee.object.property.type === "Identifier" &&
			callee.object.property.name === "Match");
	if (!isMatchNamespace) return false;
	const methodName =
		!callee.computed && callee.property.type === "Identifier"
			? callee.property.name
			: callee.computed && isStringLiteral(callee.property)
				? callee.property.value
				: undefined;
	return methodName !== undefined && matchPatternMethods.has(methodName);
};

export const isMatchPatternObject = (node: ESTree.ObjectExpression): boolean => {
	let current: ESTree.Node = node;
	while (current.parent !== null && current.parent !== undefined) {
		const parentNode: ESTree.Node = current.parent;
		if (
			parentNode.type === "Property" &&
			parentNode.value === current &&
			parentNode.parent?.type === "ObjectExpression"
		) {
			current = parentNode.parent;
			continue;
		}
		if (parentNode.type === "ArrayExpression") {
			current = parentNode;
			continue;
		}
		if (
			parentNode.type === "ParenthesizedExpression" &&
			"expression" in parentNode &&
			parentNode.expression === current
		) {
			current = parentNode;
			continue;
		}
		break;
	}
	const call = current.parent;
	if (!isMatchCall(call)) return false;

	const argIndex = call.arguments.indexOf(current as ESTree.Expression);
	if (argIndex === -1) return false;

	return call.arguments.length === 1
		? argIndex === 0
		: argIndex >= 0 && argIndex < call.arguments.length - 1;
};
