import { presets } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

const effectTsgoRules = Object.values(presets).flatMap((preset) =>
	Object.keys(preset.rules ?? {}),
);

export default defineConfig({
	extends: Object.values(presets),
	ignorePatterns: ["src/vendor/**"],
	jsPlugins: [{ name: "landmines", specifier: "@interfere/landmines/testing" }],
	rules: {
		...Object.fromEntries(effectTsgoRules.map((rule) => [rule, "error"])),
		"effecttsgo/missing-pipeable-signature": "off",
		// The plugin walks ESTree nodes with native arrays, strings, objects and JSON and does not depend on effect.
		"effecttsgo/global-json": "off",
		"effecttsgo/prefer-effect-array": "off",
		"effecttsgo/prefer-effect-record": "off",
		"effecttsgo/prefer-effect-string": "off",
		"oxc/no-accumulating-spread": "error",
		"typescript/no-non-null-assertion": "error",
		"landmines/strict-msw": "error",
		"landmines/no-fixed-sleep": "error",
		"landmines/no-unsignaled-poll": "error",
		"landmines/no-flake-masking": "error",
	},
	overrides: [
		{
			files: ["src/rules/require-readable-spacing-cli.test.ts", "src/jev/plugin.test.ts"],
			rules: { "effecttsgo/node-builtin-import": "off" },
		},
	],
});
