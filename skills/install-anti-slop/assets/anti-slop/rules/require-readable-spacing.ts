import type { CreateRule, ESTree } from "@oxlint/plugins";

import createPaddingLineRule from "../vendor/eslint-stylistic/padding-line-between-statements.ts";

function declaration(node: ESTree.Node): ESTree.Node {
  if ((node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") && node.declaration) return node.declaration;

  return node;
}

function skipAttachedStatementPair(previous: ESTree.Node, next: ESTree.Node): boolean {
  if (next.type === "EmptyStatement" && previous.loc.end.line === next.loc.start.line) return true;

  const prevDeclaration = declaration(previous);
  const nextDeclaration = declaration(next);
  return prevDeclaration.type === "TSDeclareFunction"
    && (nextDeclaration.type === "TSDeclareFunction" || nextDeclaration.type === "FunctionDeclaration")
    && prevDeclaration.id != null
    && nextDeclaration.id != null
    && prevDeclaration.id.name === nextDeclaration.id.name;
}

const paddingRule = createPaddingLineRule([
  { blankLine: "always", prev: "import", next: "*" },
  { blankLine: "always", prev: "*", next: { selector: "Program > :not(ImportDeclaration)" } },
  { blankLine: "always", prev: { selector: "Program > :not(ImportDeclaration)" }, next: "*" },
  { blankLine: "always", prev: "*", next: ["function", "class", "interface", "type"] },
  { blankLine: "always", prev: ["function", "class", "interface", "type"], next: "*" },
  {
    blankLine: "always",
    prev: "*",
    next: ["multiline-const", "multiline-let", "multiline-var", "multiline-using"],
  },
  {
    blankLine: "always",
    prev: ["multiline-const", "multiline-let", "multiline-var", "multiline-using"],
    next: "*",
  },
  { blankLine: "always", prev: "*", next: ["return", "if", "switch", "try", "for", "while", "do"] },
  { blankLine: "always", prev: "block-like", next: "*" },
  { blankLine: "any", prev: "import", next: "import" },
], skipAttachedStatementPair);

/** Restore structural blank lines with whitespace-only fixes; keep local short bindings and overloads grouped. */
export const requireReadableSpacingRule: CreateRule = {
  ...paddingRule,
  meta: {
    ...paddingRule.meta,
    docs: {
      description: "Require readable spacing between declarations and logical statement groups.",
    },
    schema: [],
  },
};
