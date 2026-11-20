import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
  createTypeAliasEnvironment,
  resolvedTypeMatches,
  type TypeAliasEnvironment,
} from "../shared/type-alias-resolution.ts";

type FunctionWithReturnType =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

const unwrapExport = (node: ESTree.Node): ESTree.Node | null => {
  if (node.type === "ExportNamedDeclaration") return node.declaration;
  if (node.type === "ExportDefaultDeclaration") return node.declaration;
  return node;
};

const statementBody = (node: ESTree.Node): Array<ESTree.Node> | null => {
  if (
    node.type === "Program" ||
    node.type === "BlockStatement" ||
    node.type === "TSModuleBlock"
  ) {
    return node.body;
  }
  return null;
};

const hasPreviousFunctionOverload = (node: ESTree.Function): boolean => {
  if (node.type !== "FunctionDeclaration" || node.id === null) return false;

  const declaration =
    node.parent.type === "ExportNamedDeclaration" ? node.parent : node;
  const siblings = statementBody(declaration.parent);
  if (siblings === null) return false;

  const index = siblings.findIndex((sibling) => sibling === declaration);
  if (index <= 0) return false;

  const previous = unwrapExport(siblings[index - 1]);
  return (
    previous?.type === "TSDeclareFunction" &&
    previous.id?.name === node.id.name
  );
};

const staticMethodKey = (method: ESTree.MethodDefinition): string | null => {
  if (!method.computed && method.key.type === "Identifier") {
    return method.key.name;
  }
  if (!method.computed && method.key.type === "PrivateIdentifier") {
    return `#${method.key.name}`;
  }
  if (
    method.computed &&
    method.key.type === "Literal" &&
    (typeof method.key.value === "string" || typeof method.key.value === "number")
  ) {
    return String(method.key.value);
  }
  return null;
};

const hasPreviousMethodOverload = (node: ESTree.Function): boolean => {
  const method = node.parent;
  if (method.type !== "MethodDefinition") return false;

  const classBody = method.parent;
  if (classBody.type !== "ClassBody") return false;

  const key = staticMethodKey(method);
  if (key === null) return false;

  const index = classBody.body.findIndex((element) => element === method);
  if (index <= 0) return false;

  const previous = classBody.body[index - 1];
  if (
    previous.type !== "MethodDefinition" ||
    previous.kind !== method.kind ||
    previous.static !== method.static ||
    staticMethodKey(previous) !== key
  ) {
    return false;
  }

  return previous.value.body === null;
};

const hasPreviousOverload = (node: ESTree.Function): boolean =>
  hasPreviousFunctionOverload(node) || hasPreviousMethodOverload(node);

/** Ban function contracts that return unknown instead of a parsed domain type. */
export const noUnknownReturnsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow functions whose explicit return contract is unknown or Promise<unknown>.",
    },
    messages: {
      unknownReturn:
        "This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.",
    },
  },
  createOnce(context) {
    let environment: TypeAliasEnvironment | null = null;

    const resolvesToUnknown = (type: ESTree.TSType): boolean =>
      environment !== null &&
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === "TSUnknownKeyword") return true;
        if (resolved.type === "TSParenthesizedType") {
          return matches(resolved.typeAnnotation);
        }
        if (resolved.type === "TSUnionType") return resolved.types.some(matches);
        if (
          resolved.type !== "TSTypeReference" ||
          resolved.typeName.type !== "Identifier" ||
          (resolved.typeName.name !== "Promise" &&
            resolved.typeName.name !== "PromiseLike")
        ) {
          return false;
        }
        const value = resolved.typeArguments?.params[0];
        return value !== undefined && matches(value);
      });

    const checkReturnType = (node: FunctionWithReturnType) => {
      const annotation = node.returnType;
      if (annotation === null || annotation === undefined) return;
      if (!resolvesToUnknown(annotation.typeAnnotation)) return;
      context.report({ node: annotation.typeAnnotation, messageId: "unknownReturn" });
    };

    return {
      Program(node) {
        environment = createTypeAliasEnvironment(
          node,
          context.sourceCode.visitorKeys,
        );
      },
      ArrowFunctionExpression: checkReturnType,
      FunctionDeclaration(node) {
        if (!hasPreviousOverload(node)) checkReturnType(node);
      },
      FunctionExpression(node) {
        if (!hasPreviousOverload(node)) checkReturnType(node);
      },
      TSCallSignatureDeclaration: checkReturnType,
      TSConstructSignatureDeclaration: checkReturnType,
      TSConstructorType: checkReturnType,
      TSDeclareFunction: checkReturnType,
      TSEmptyBodyFunctionExpression: checkReturnType,
      TSFunctionType: checkReturnType,
      TSMethodSignature: checkReturnType,
    };
  },
});
