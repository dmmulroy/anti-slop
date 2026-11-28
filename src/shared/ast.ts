import type { ESTree } from "@oxlint/plugins";

/** Recognize nodes when reading child properties selected by Oxlint's visitor keys. */
export function isNode(value: unknown): value is ESTree.Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/** Remove parentheses while preserving assertions and other expression wrappers. */
export function unwrapParenthesizedExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}
