import { presets } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

const effectTsgoRules = Object.values(presets).flatMap((preset) =>
	Object.keys(preset.rules ?? {}),
);

export default defineConfig({
	extends: Object.values(presets),
	ignorePatterns: ["src/vendor/**"],
	rules: {
		...Object.fromEntries(effectTsgoRules.map((rule) => [rule, "error"])),
		"effecttsgo/missing-pipeable-signature": "off",
		"oxc/no-accumulating-spread": "error",
	},
	overrides: [
		{
			files: ["src/rules/require-readable-spacing-cli.test.ts", "src/jev/plugin.test.ts"],
			rules: { "effecttsgo/node-builtin-import": "off" },
		},
	],
});
