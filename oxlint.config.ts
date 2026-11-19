import { presets } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

const effectTsgoRules = Object.values(presets).flatMap((preset) =>
	Object.keys(preset.rules ?? {}),
);

export default defineConfig({
	extends: Object.values(presets),
	ignorePatterns: ["src/vendor/**"],
	jsPlugins: [
		{ name: "anti-slop", specifier: "./src/index.ts" },
		{ name: "landmines", specifier: "@interfere/landmines/testing" },
		{ name: "effect", specifier: "oxlint-plugin-effect/plugin" },
		{ name: "enfect", specifier: "@enfect/oxlint" },
		{ name: "ai-guard", specifier: "eslint-plugin-ai-guard" },
	],
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
		"effect/noAliasTestLayer": "error",
		"effect/noEagerAcquire": "error",
		"effect/noManagedRuntimeInEffect": "error",
		"effect/noPerCallCacheConstruction": "error",
		"effect/noPointFreeLog": "error",
		"effect/noRunCollectOnUnboundedStream": "error",
		"effect/noSilentCatchAll": "error",
		"effect/noUnboundedConcurrency": "error",
		"effect/requireSuppressionReason": "error",
		"effect/requireForceKillAfter": "error",
		"enfect/throw-in-effect-gen": "error",
		"enfect/effect-promise-vs-trypromise": "error",
		"enfect/prefer-redacted-config": "error",
		"enfect/avoid-option-getorthrow": "error",
		"enfect/effect-run-in-body": "error",
		"enfect/no-cause-in-http-response": "error",
		"enfect/no-effect-ignore-then-as": "error",
		"enfect/avoid-expect-in-if": "error",
		"enfect/yield-in-for-loop": "warn",
		"enfect/prefer-duration-constructors": "error",
		"enfect/avoid-mutable-state": "error",
		"ai-guard/no-placeholder-implementation": "error",
		"ai-guard/no-test-env-branch": "error",
		"ai-guard/no-assertionless-test": "error",
		"ai-guard/no-undeclared-import": "error",
		"ai-guard/no-silent-fallback": "error",
		"anti-slop/no-tautological-assertion": "error",
	},
	overrides: [
		{
			files: ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**", "**/__tests__/**"],
			rules: {
				"effect/noUnboundedConcurrency": "off",
				"enfect/effect-promise-vs-trypromise": "off",
				"enfect/avoid-option-getorthrow": "off",
				"enfect/effect-run-in-body": "off",
			},
		},
		{
			// Command-line entry points, the only place an Effect program may be run.
			files: ["src/integrity/run.ts", "src/diff-rules/run.ts", "src/modes/lint.ts"],
			rules: { "enfect/effect-run-in-body": "off" },
		},
		{
			files: ["src/rules/require-readable-spacing-cli.test.ts", "src/jev/plugin.test.ts"],
			rules: { "effecttsgo/node-builtin-import": "off" },
		},
	],
});
