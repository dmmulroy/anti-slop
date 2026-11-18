import type { ESTree } from "@oxlint/plugins";

/** Local bindings of one XState package's exports in a file. */
export interface XStateImports {
	/** Local name to exported name, for named imports: `{ createMachine as cm }` maps `cm` to `createMachine`. */
	readonly named: ReadonlyMap<string, string>;
	/** Locals of `import * as xstate from "..."`. */
	readonly namespaces: ReadonlySet<string>;
}

const importedName = (specifier: ESTree.ImportSpecifier): string =>
	specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;

/** Collect the value imports of `source` (`"xstate"` or `"@xstate/react"`). */
export function collectXStateImports(program: ESTree.Program, source: string): XStateImports {
	const named = new Map<string, string>();
	const namespaces = new Set<string>();
	for (const statement of program.body) {
		if (statement.type !== "ImportDeclaration" || statement.source.value !== source || statement.importKind === "type") continue;
		for (const specifier of statement.specifiers) {
			if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
			else if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") named.set(specifier.local.name, importedName(specifier));
		}
	}
	return { named, namespaces };
}

/** Whether the file imports any value or type from `xstate` or an `@xstate/*` package. */
export function importsXState(program: ESTree.Program): boolean {
	return program.body.some(
		(statement) =>
			statement.type === "ImportDeclaration" &&
			(statement.source.value === "xstate" || statement.source.value.startsWith("@xstate/")),
	);
}

/** The XState export a callee reads (`createMachine`, `xstate.createMachine`), or null. */
export function importedCallee(callee: ESTree.Node, imports: XStateImports): string | null {
	if (callee.type === "Identifier") return imports.named.get(callee.name) ?? null;
	if (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.object.type === "Identifier" &&
		imports.namespaces.has(callee.object.name) &&
		callee.property.type === "Identifier"
	) {
		return callee.property.name;
	}
	return null;
}

/** Strip parentheses, type assertions, and `satisfies` from an expression. */
export function unwrap(expression: ESTree.Expression): ESTree.Expression {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSSatisfiesExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression"
	) {
		current = current.expression;
	}
	return current;
}
