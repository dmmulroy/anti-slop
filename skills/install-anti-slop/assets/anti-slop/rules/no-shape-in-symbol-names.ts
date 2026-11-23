import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

const FORBIDDEN_SYMBOL_NAME = "shape";

function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

/** Return whether an identifier names a statically accessed member owned by another value. */
function isBorrowedMemberName(node: ESTree.Node): boolean {
  const parent = node.parent;
  if (parent === null || parent.type !== "MemberExpression") return false;
  return parent.property === node && parent.computed === false;
}

/** Return whether a specifier names a package rather than a relative, absolute, or aliased local path. */
function isPackageSpecifier(specifier: string): boolean {
  return !/^(?:\.|\/|#|~\/|@\/)/.test(specifier);
}

/** Return the identifier whose binding decides where a JSX element's component comes from. */
function findComponentRoot(name: ESTree.JSXElementName): ESTree.JSXIdentifier | null {
  if (name.type === "JSXNamespacedName") return null;
  if (name.type === "JSXIdentifier") return /^[a-z]|-/.test(name.name) ? null : name;
  let root: ESTree.JSXMemberExpressionObject = name.object;
  while (root.type === "JSXMemberExpression") root = root.object;
  return root;
}

/** Return whether an identifier names an attribute that an imported package component defines. */
function isPackageComponentAttributeName(sourceCode: SourceCode, node: ESTree.Node): boolean {
  const attribute = node.parent;
  if (attribute === null || attribute.type !== "JSXAttribute" || attribute.name !== node) return false;
  const element = attribute.parent;
  if (element === null || element.type !== "JSXOpeningElement") return false;
  const root = findComponentRoot(element.name);
  if (root === null) return false;
  const variable = resolveVariable(sourceCode, root);
  return (
    variable?.defs.some(
      (definition) =>
        definition.type === "ImportBinding" &&
        definition.parent?.type === "ImportDeclaration" &&
        isPackageSpecifier(definition.parent.source.value),
    ) ?? false
  );
}

/** Ban the case-insensitive substring "shape" in every JavaScript and TypeScript symbol name. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in JavaScript, TypeScript, private, and JSX symbol names.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
      if (!containsForbiddenSymbolName(node.name) || isBorrowedMemberName(node)) return;
      if (isPackageComponentAttributeName(context.sourceCode, node)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    return {
      Identifier: reportForbiddenSymbolName,
      PrivateIdentifier: reportForbiddenSymbolName,
      JSXIdentifier: reportForbiddenSymbolName,
    };
  },
});
