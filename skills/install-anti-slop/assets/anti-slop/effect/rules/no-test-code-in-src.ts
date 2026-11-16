import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const defaultSourceDirectories = ["src"];
const defaultTestDirectories = ["test", "tests", "__tests__"];
const defaultTestNamePatterns = [
	"^layer(?:Test|Fake|Mock|Stub)",
	"(?:Test|Fake|Mock|Stub)Layer$",
	"^(?:Fake|Mock|Stub)[A-Z]",
	"[a-z0-9](?:Fake|Mock|Stub)$",
	"^(?:make|create)(?:Test|Fake|Mock|Stub)[A-Z]",
];
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

interface Options {
	readonly sourceDirectories: ReadonlySet<string>;
	readonly testDirectories: ReadonlySet<string>;
	readonly testNamePatterns: readonly RegExp[];
}

function stringList(option: unknown, key: string, fallback: readonly string[]): readonly string[] {
	if (typeof option !== "object" || option === null || !(key in option)) return fallback;
	const value: unknown = Object.entries(option).find(([name]) => name === key)?.[1];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function readOptions(option: unknown): Options {
	return {
		sourceDirectories: new Set(stringList(option, "sourceDirectories", defaultSourceDirectories)),
		testDirectories: new Set(stringList(option, "testDirectories", defaultTestDirectories)),
		testNamePatterns: stringList(option, "testNamePatterns", defaultTestNamePatterns).map((pattern) => new RegExp(pattern, "u")),
	};
}

function exportedName(node: ESTree.ModuleExportName): string {
	return node.type === "Literal" ? node.value : node.name;
}

/** The names a local export declaration binds. */
function declaredNames(declaration: ESTree.Declaration): readonly ESTree.BindingIdentifier[] {
	if (declaration.type === "VariableDeclaration") {
		return declaration.declarations.flatMap((declarator) => (declarator.id.type === "Identifier" ? [declarator.id] : []));
	}
	if (
		(declaration.type === "FunctionDeclaration" ||
			declaration.type === "ClassDeclaration" ||
			declaration.type === "TSTypeAliasDeclaration" ||
			declaration.type === "TSInterfaceDeclaration" ||
			declaration.type === "TSEnumDeclaration") &&
		declaration.id !== null
	) {
		return [declaration.id];
	}
	return [];
}

const staticKeyName = (key: ESTree.Node): string | null =>
	key.type === "Identifier" || key.type === "PrivateIdentifier" ? key.name : null;

/** Keep test files, test-only exports, and test imports out of production source directories. */
export const noTestCodeInSrcRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow test files, imports from test directories, and test-named exports such as `layerTest` inside production source directories.",
		},
		messages: {
			testFileInSource:
				"This test file lives in production source (`{{directory}}/`). Move it to the package's test/ directory, with shared helpers in test/support/.",
			testImport:
				"Production source imports `{{source}}` from a test directory. Production modules never depend on test code: move what it needs into source, or move this module to test/.",
			testExport:
				"`{{name}}` is test code in production source. Move it to the package's test/ directory (shared helpers in test/support/) and build test layers there from the production class, e.g. `Service.layer.pipe(Layer.provide(Layer.succeed(Dep, Dep.of({ ... }))))`.",
		},
		schema: [
			{
				type: "object",
				properties: {
					sourceDirectories: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
					testDirectories: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
					testNamePatterns: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [
			{
				sourceDirectories: defaultSourceDirectories,
				testDirectories: defaultTestDirectories,
				testNamePatterns: defaultTestNamePatterns,
			},
		],
	},
	create(context) {
		const options = readOptions(context.options?.[0]);
		const segments = context.filename.replaceAll("\\", "/").split("/");
		const sourceIndex = segments.findIndex((segment) => options.sourceDirectories.has(segment));
		if (sourceIndex < 0) return {};
		const sourceDirectory = segments[sourceIndex] ?? "src";

		const isTestName = (name: string) => options.testNamePatterns.some((pattern) => pattern.test(name));
		const reportName = (node: ESTree.Node, name: string) => {
			if (isTestName(name)) context.report({ node, messageId: "testExport", data: { name } });
		};
		const checkSource = (source: ESTree.Node | null) => {
			if (source?.type !== "Literal" || typeof source.value !== "string") return;
			const path = source.value;
			if (!(path.startsWith("./") || path.startsWith("../"))) return;
			if (!path.split("/").some((segment) => options.testDirectories.has(segment))) return;
			context.report({ node: source, messageId: "testImport", data: { source: path } });
		};

		return {
			Program(node) {
				const inTestDirectory = segments.slice(sourceIndex + 1, -1).some((segment) => options.testDirectories.has(segment));
				if (TEST_FILE.test(context.filename) || inTestDirectory) {
					context.report({ node, messageId: "testFileInSource", data: { directory: sourceDirectory } });
				}
			},
			ImportDeclaration(node) {
				checkSource(node.source);
			},
			ImportExpression(node) {
				checkSource(node.source);
			},
			ExportAllDeclaration(node) {
				checkSource(node.source);
			},
			ExportNamedDeclaration(node) {
				checkSource(node.source);
				if (node.declaration !== null) {
					for (const identifier of declaredNames(node.declaration)) reportName(identifier, identifier.name);
				}
				for (const specifier of node.specifiers) reportName(specifier, exportedName(specifier.exported));
			},
			PropertyDefinition(node) {
				const name = node.static && !node.computed ? staticKeyName(node.key) : null;
				if (name !== null) reportName(node.key, name);
			},
			MethodDefinition(node) {
				const name = node.static && !node.computed ? staticKeyName(node.key) : null;
				if (name !== null) reportName(node.key, name);
			},
		};
	},
});
