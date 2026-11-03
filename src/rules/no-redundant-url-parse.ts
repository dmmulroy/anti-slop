import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type FunctionScope = ESTree.Node;

function isGlobal(sourceCode: SourceCode, expression: ESTree.Expression, name: string): boolean {
  if (expression.type !== "Identifier" || expression.name !== name) return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

function isUrlConstruction(sourceCode: SourceCode, node: ESTree.Node): node is ESTree.NewExpression {
  return node.type === "NewExpression" && isGlobal(sourceCode, node.callee, "URL");
}

function isNeverReassigned(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): boolean {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || variable.defs.length === 0) return false;
  return variable.references.every((reference) => reference.init || !reference.isWrite());
}

function isKnownUrl(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length !== 1) return false;
  const declarator = variable.defs[0]?.node;
  return (
    declarator?.type === "VariableDeclarator" &&
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind === "const" &&
    declarator.init !== null &&
    isUrlConstruction(sourceCode, declarator.init)
  );
}

function isUrlSerialization(sourceCode: SourceCode, node: ESTree.Node): boolean {
  if (node.type === "MemberExpression") {
    return (
      !node.computed &&
      node.property.type === "Identifier" &&
      node.property.name === "href" &&
      isKnownUrl(sourceCode, node.object)
    );
  }
  return (
    node.type === "CallExpression" &&
    node.arguments.length === 0 &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "toString" &&
    isKnownUrl(sourceCode, node.callee.object)
  );
}

function isUrlCanParseCall(sourceCode: SourceCode, node: ESTree.Node): node is ESTree.CallExpression {
  if (node.type !== "CallExpression") return false;
  const { callee } = node;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "canParse" &&
    isGlobal(sourceCode, callee.object, "URL")
  );
}

function isStableInput(sourceCode: SourceCode, node: ESTree.Expression | ESTree.SpreadElement): boolean {
  if (node.type === "SpreadElement") return false;
  if (node.type === "Identifier") return isNeverReassigned(sourceCode, node);
  if (node.type === "MemberExpression" && !node.computed) return isStableInput(sourceCode, node.object);
  return false;
}

function enclosingFunction(node: ESTree.Node): FunctionScope {
  let current: ESTree.Node = node;
  while (current.parent) {
    current = current.parent;
    if (
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression" ||
      current.type === "ArrowFunctionExpression"
    ) {
      return current;
    }
  }
  return current;
}

export const noRedundantUrlParseRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow parsing the same URL twice or parsing a URL only to discard it.",
    },
    messages: {
      reparse:
        "This serializes a URL only to parse it again. Reuse the URL, or pass it to `new URL(url)` for a copy.",
      canParse: "Replace `URL.canParse(x) ? new URL(x) : …` with `URL.parse(x)`, which parses once.",
      fetchString: "`fetch` accepts a string. Pass it directly instead of wrapping it in `new URL`.",
      repeated: "This function already parses `{{source}}`. Parse it once into a local and reuse it.",
    },
  },
  createOnce(context) {
    const readsByFunction = new WeakMap<FunctionScope, Set<string>>();
    return {
      NewExpression(node) {
        const { sourceCode } = context;
        if (!isUrlConstruction(sourceCode, node) || node.arguments.length === 0) return;
        const [input] = node.arguments;
        const { parent } = node;

        if (node.arguments.length === 1 && isUrlSerialization(sourceCode, input)) {
          context.report({ node, messageId: "reparse" });
          return;
        }

        if (
          parent.type === "ConditionalExpression" &&
          parent.consequent === node &&
          isUrlCanParseCall(sourceCode, parent.test) &&
          parent.test.arguments.length === node.arguments.length &&
          parent.test.arguments.every(
            (argument, index) =>
              sourceCode.getText(argument) === sourceCode.getText(node.arguments[index]),
          )
        ) {
          context.report({ node: parent, messageId: "canParse" });
          return;
        }

        if (
          node.arguments.length === 1 &&
          parent.type === "CallExpression" &&
          parent.arguments[0] === node &&
          isGlobal(sourceCode, parent.callee, "fetch")
        ) {
          context.report({ node, messageId: "fetchString" });
          return;
        }

        if (parent.type !== "MemberExpression" || parent.object !== node) return;
        if (!node.arguments.every((argument) => isStableInput(sourceCode, argument))) return;
        const source = sourceCode.getText(node);
        const scope = enclosingFunction(node);
        const reads = readsByFunction.get(scope) ?? new Set<string>();
        readsByFunction.set(scope, reads);
        if (reads.has(source)) context.report({ node, messageId: "repeated", data: { source } });
        reads.add(source);
      },
    };
  },
});
