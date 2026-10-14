import type { CreateRule, ESTree, SourceCode } from "@oxlint/plugins";

import createPaddingLineRule from "../vendor/eslint-stylistic/padding-line-between-statements.ts";

import type { NodeTestObject } from "../vendor/eslint-stylistic/padding-line-between-statements.ts";

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

/** A `const`/`let`/`var`/`using` declaration, optionally exported, written on one line. */
function isSinglelineBinding(node: ESTree.Node): boolean {
  const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  return declaration?.type === "VariableDeclaration" && node.loc.start.line === node.loc.end.line;
}

/** Comments above a statement belong to it; a comment trailing the previous line does not. */
function hasLeadingComment(node: ESTree.Node, sourceCode: SourceCode): boolean {
  const previousLine = sourceCode.getTokenBefore(node)?.loc.end.line;
  return sourceCode
    .getCommentsBefore(node)
    .some((comment) => comment.loc.start.line !== previousLine);
}

const singlelineBinding: NodeTestObject = {
  test: (node) => isSinglelineBinding(node),
};

const undocumentedSinglelineBinding: NodeTestObject = {
  test: (node, sourceCode) => isSinglelineBinding(node) && !hasLeadingComment(node, sourceCode),
};

const paddingRule = createPaddingLineRule(
  [
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
    // Consecutive single-line bindings form one group at any scope, including
    // module scope. A binding with its own leading comment starts a new group.
    { blankLine: "any", prev: "singleline-binding", next: "undocumented-singleline-binding" },
  ],
  {
    "singleline-binding": singlelineBinding,
    "undocumented-singleline-binding": undocumentedSinglelineBinding,
  },
  skipAttachedStatementPair,
);

/** Restore structural blank lines with whitespace-only fixes; keep single-line binding groups and overloads grouped. */
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
