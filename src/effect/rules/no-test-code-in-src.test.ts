import { RuleTester } from "oxlint/plugins-dev";

import { noTestCodeInSrcRule } from "./no-test-code-in-src.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const source = "/repo/packages/widgets/src/widgets.ts";
const testExport = (name: string) => ({ messageId: "testExport", data: { name } });

tester.run("anti-slop-effect/no-test-code-in-src", noTestCodeInSrcRule, {
	valid: [
		{ filename: source, code: `export const layer = Widgets.layer;\nexport const hitTest = (x: number) => x > 0;` },
		// A documented stand-in for an unbuilt feature.
		{ filename: source, code: `/** Stands in for the billing service until it ships. */\nexport const layerFixtures = Layer.succeed(Billing, fixtures);` },
		{ filename: source, code: `export const TestConnection = () => null;\nexport class Widgets { static readonly layer = live; }` },
		{ filename: source, code: `import { widget } from "./latest/widget.ts";\nimport { helper } from "test-utils";` },
		// Test code outside a source directory.
		{ filename: "/repo/packages/widgets/test/support/layers.ts", code: `export const layerTest = Widgets.layer;\nimport { x } from "../../test/x.ts";` },
		{ filename: "/repo/packages/widgets/test/widgets.test.ts", code: `export const FakeClock = {};` },
		// Configured directories.
		{ filename: source, code: `export const layerTest = Widgets.layer;`, options: [{ sourceDirectories: ["lib"] }] },
		{ filename: source, code: `export const WidgetsMock = {};`, options: [{ testNamePatterns: ["^layerTest$"] }] },
	],
	invalid: [
		{
			filename: "/repo/packages/widgets/src/widgets.test.ts",
			code: `it("works", () => {});`,
			errors: [{ messageId: "testFileInSource", data: { directory: "src" } }],
		},
		{
			filename: "/repo/packages/widgets/src/__tests__/helpers.ts",
			code: `export const value = 1;`,
			errors: [{ messageId: "testFileInSource" }],
		},
		{
			filename: source,
			code: `import { fake } from "../test/support/fakes.ts";\nexport * from "./__tests__/helpers.ts";\nconst lazy = import("../tests/lazy.ts");`,
			errors: [
				{ messageId: "testImport", data: { source: "../test/support/fakes.ts" } },
				{ messageId: "testImport", data: { source: "./__tests__/helpers.ts" } },
				{ messageId: "testImport", data: { source: "../tests/lazy.ts" } },
			],
		},
		{
			filename: source,
			code: `
				export const layerTest = Widgets.layer;
				export function makeFakeWidgets() {}
				export class FakeClock {}
				export const WidgetsTestLayer = live;
				const recorder = {};
				export { recorder as WidgetsStub };
			`,
			errors: [
				testExport("layerTest"),
				testExport("makeFakeWidgets"),
				testExport("FakeClock"),
				testExport("WidgetsTestLayer"),
				testExport("WidgetsStub"),
			],
		},
		{
			filename: source,
			code: `export class Widgets { static readonly layerMock = mock; static layerStub() {} }`,
			errors: [testExport("layerMock"), testExport("layerStub")],
		},
		{
			filename: "/repo/lib/widgets.ts",
			code: `export const layerTest = Widgets.layer;`,
			options: [{ sourceDirectories: ["lib"] }],
			errors: [testExport("layerTest")],
		},
	],
});
