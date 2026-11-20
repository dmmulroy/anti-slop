import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

import { createTypeAliasEnvironment, hasVisibleTypeBinding } from "./type-alias-resolution.ts";

/** Unwrap syntax-only wrappers when inspecting array methods and accumulator references. */
export function unwrapArrayExpression(node: ESTree.Node): ESTree.Node {
  while (
    node.type === "ParenthesizedExpression" ||
    node.type === "ChainExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSSatisfiesExpression"
  ) {
    node = node.expression;
  }
  return node;
}

/** Resolve a local binding by scope, not by identifier spelling. */
export function resolveArrayBinding(sourceCode: SourceCode, node: ESTree.Node): Variable | null {
  node = unwrapArrayExpression(node);
  if (node.type !== "Identifier") return null;
  let scope: Scope | null = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

/** Read static method names, including computed string literals, without evaluating expressions. */
export function arrayMethodTarget(
  node: ESTree.Node,
): { readonly name: string; readonly object: ESTree.Node } | null {
  node = unwrapArrayExpression(node);
  if (node.type !== "MemberExpression") return null;
  const property = node.property;
  if (!node.computed && property.type === "Identifier") {
    return { name: property.name, object: node.object };
  }
  if (node.computed && property.type === "Literal" && typeof property.value === "string") {
    return { name: property.value, object: node.object };
  }
  return null;
}

function isArrayAnnotation(sourceCode: SourceCode, type: ESTree.TSType): boolean {
  if (type.type === "TSArrayType" || type.type === "TSTupleType") return true;
  if (type.type === "TSParenthesizedType") return isArrayAnnotation(sourceCode, type.typeAnnotation);
  if (type.type === "TSTypeOperator" && type.operator === "readonly") {
    return isArrayAnnotation(sourceCode, type.typeAnnotation);
  }
  return (
    type.type === "TSTypeReference" && type.typeName.type === "Identifier" &&
    (type.typeName.name === "Array" || type.typeName.name === "ReadonlyArray") &&
    !hasVisibleTypeBinding(type.typeName.name, type, createTypeAliasEnvironment(sourceCode.ast, sourceCode.visitorKeys))
  );
}

function staticPropertyName(key: ESTree.Node, computed: boolean): string | null {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

function isArrayPropertyAnnotation(sourceCode: SourceCode, type: ESTree.TSType, path: readonly string[]): boolean {
  if (path.length === 0) return isArrayAnnotation(sourceCode, type);
  if (type.type === "TSParenthesizedType") return isArrayPropertyAnnotation(sourceCode, type.typeAnnotation, path);
  if (type.type !== "TSTypeLiteral") return false;
  const properties = type.members.filter(member =>
    member.type === "TSPropertySignature" && staticPropertyName(member.key, member.computed) === path[0],
  );
  const property = properties[0];
  return properties.length === 1 && property?.type === "TSPropertySignature" &&
    property.typeAnnotation !== null && isArrayPropertyAnnotation(sourceCode, property.typeAnnotation.typeAnnotation, path.slice(1));
}

/** Reject explicit property writes through the receiver or its local aliases. */
function hasPropertyWrite(sourceCode: SourceCode, variable: Variable, visited = new Set<Variable>()): boolean {
  if (visited.has(variable)) return false;
  if (visited.size >= 32) return true;
  visited.add(variable);
  for (const reference of variable.references) {
    let node: ESTree.Node = reference.identifier;
    while (node.parent !== null) {
      const parent: ESTree.Node = node.parent;
      if (
        (parent.type === "MemberExpression" && parent.object === node) ||
        (parent.type === "Property" && parent.value === node && parent.parent.type === "ObjectPattern") ||
        parent.type === "ObjectPattern" || parent.type === "ArrayPattern" ||
        (parent.type === "RestElement" && parent.argument === node) ||
        (parent.type === "AssignmentPattern" && parent.left === node) ||
        unwrapArrayExpression(parent) === node
      ) node = parent;
      else break;
    }
    const parent = node.parent;
    if (parent === null) continue;
    if (
      (parent.type === "AssignmentExpression" && parent.left === node) ||
      ((parent.type === "ForOfStatement" || parent.type === "ForInStatement") && parent.left === node) ||
      parent.type === "UpdateExpression" ||
      (parent.type === "UnaryExpression" && parent.operator === "delete")
    ) return true;
    if (parent.type === "VariableDeclarator" && parent.init === node) {
      // Destructured aliases can expose nested objects that subsequently receive writes.
      if (parent.id.type !== "Identifier") return true;
      const alias = resolveArrayBinding(sourceCode, parent.id);
      if (alias !== null && hasPropertyWrite(sourceCode, alias, visited)) return true;
    }
  }
  return false;
}

function isKnownArrayProperty(
  sourceCode: SourceCode,
  node: ESTree.Node,
  path: readonly string[],
  visited: Set<Variable>,
  depth = 0,
): boolean {
  if (depth >= 32) return false;
  if (path.length === 0) return isKnownArrayExpression(sourceCode, node, visited);
  node = unwrapArrayExpression(node);
  const member = arrayMethodTarget(node);
  if (member !== null) {
    return isKnownArrayProperty(sourceCode, member.object, [member.name, ...path], visited, depth + 1);
  }
  if (node.type === "ObjectExpression") {
    // Spreads and dynamic keys may replace the property, even when a literal array is present.
    if (node.properties.some(property =>
      property.type === "SpreadElement" || staticPropertyName(property.key, property.computed) === null,
    )) return false;
    const properties = node.properties.filter(property =>
      property.type === "Property" && staticPropertyName(property.key, property.computed) === path[0],
    );
    const property = properties[0];
    return properties.length === 1 && property?.type === "Property" && property.kind === "init" &&
      !property.method && isKnownArrayProperty(sourceCode, property.value, path.slice(1), visited, depth + 1);
  }
  const variable = resolveArrayBinding(sourceCode, node);
  if (variable === null || visited.has(variable) || hasPropertyWrite(sourceCode, variable)) return false;
  visited.add(variable);
  if (variable.references.some(reference => reference.isWrite() && !reference.init)) return false;
  for (const identifier of variable.identifiers) {
    const annotation = identifier.typeAnnotation?.typeAnnotation;
    if (annotation !== undefined) return isArrayPropertyAnnotation(sourceCode, annotation, path);
  }
  for (const definition of variable.defs) {
    if (
      definition.type === "Variable" && definition.node.type === "VariableDeclarator" &&
      definition.node.id.type === "Identifier" && definition.node.init !== null &&
      definition.node.parent.type === "VariableDeclaration" && definition.node.parent.kind === "const"
    ) return isKnownArrayProperty(sourceCode, definition.node.init, path, visited, depth + 1);
  }
  return false;
}

/** Recognize local array evidence; unknown receivers and iterator pipelines are deliberately excluded. */
export function isKnownArrayExpression(
  sourceCode: SourceCode,
  node: ESTree.Node,
  visited = new Set<Variable>(),
): boolean {
  node = unwrapArrayExpression(node);
  if (node.type === "ArrayExpression") return true;
  const member = arrayMethodTarget(node);
  if (member !== null) return isKnownArrayProperty(sourceCode, member.object, [member.name], visited);
  if (node.type === "CallExpression") {
    const method = arrayMethodTarget(node.callee);
    return (
      method !== null &&
      ["map", "filter", "flatMap", "slice", "concat", "toSorted", "toReversed", "toSpliced"].includes(method.name) &&
      isKnownArrayExpression(sourceCode, method.object, visited)
    );
  }
  if (node.type !== "Identifier") return false;
  const variable = resolveArrayBinding(sourceCode, node);
  if (variable === null || visited.has(variable)) return false;
  visited.add(variable);
  if (variable.references.some(reference => reference.isWrite() && !reference.init)) return false;
  for (const identifier of variable.identifiers) {
    const annotation = identifier.typeAnnotation?.typeAnnotation;
    if (annotation !== undefined) return isArrayAnnotation(sourceCode, annotation);
  }
  for (const definition of variable.defs) {
    if (
      definition.type === "Variable" && definition.node.type === "VariableDeclarator" &&
      definition.node.id.type === "Identifier" && definition.node.init !== null &&
      definition.node.parent.type === "VariableDeclaration" && definition.node.parent.kind === "const"
    ) {
      return isKnownArrayExpression(sourceCode, definition.node.init, visited);
    }
  }
  return false;
}
