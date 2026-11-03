import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

const REPEATED_SCOPES = new Set([
  "ArrowFunctionExpression",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "StaticBlock",
  "WhileStatement",
]);

function isInRepeatedScope(node: ESTree.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (REPEATED_SCOPES.has(current.type)) return true;
  }
  return false;
}

function isFixedString(node: ESTree.Node): boolean {
  return (
    (node.type === "Literal" && typeof node.value === "string") ||
    (node.type === "TemplateLiteral" && node.expressions.length === 0)
  );
}

function isGlobalRegExp(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (callee.type !== "Identifier" || callee.name !== "RegExp") return false;
  if (sourceCode.isGlobalReference(callee)) return true;
  const variable = resolveVariable(sourceCode, callee);
  return variable === null || variable.defs.length === 0;
}

export const noInlineRegexRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow fixed regexes inside functions and loops; declare them as module-level constants.",
    },
    messages: {
      inlineRegex:
        "Move this regex to a module-level constant named for what it matches. " +
        "A shared g/y regex keeps lastIndex between calls, so reset it before exec/test.",
    },
  },
  createOnce(context) {
    return {
      Literal(node) {
        if ("regex" in node && node.regex && isInRepeatedScope(node)) {
          context.report({ node, messageId: "inlineRegex" });
        }
      },
      "NewExpression, CallExpression"(node: ESTree.NewExpression | ESTree.CallExpression) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (
          isGlobalRegExp(context.sourceCode, node.callee) &&
          node.arguments.length > 0 &&
          node.arguments.every(isFixedString) &&
          isInRepeatedScope(node)
        ) {
          context.report({ node, messageId: "inlineRegex" });
        }
      },
    };
  },
});
