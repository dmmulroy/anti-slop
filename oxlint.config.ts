import { presets } from "@effect/tsgo/oxlint-presets";

import { defineAntiSlopConfig } from "./src/modes/config.ts";

const effectTsgoRules = Object.values(presets).flatMap((preset) =>
	Object.keys(preset.rules ?? {}),
);

export default defineAntiSlopConfig({
	extends: Object.values(presets),
	ignorePatterns: ["src/vendor/**"],
	jsPlugins: [
		{ name: "landmines", specifier: "@interfere/landmines/testing" },
		{ name: "effect", specifier: "oxlint-plugin-effect/plugin" },
		{ name: "enfect", specifier: "@enfect/oxlint" },
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
		"enfect/yield-in-for-loop": "error",
	},
	overrides: [
		{
			files: ["src/rules/require-readable-spacing-cli.test.ts", "src/jev/plugin.test.ts"],
			rules: { "effecttsgo/node-builtin-import": "off" },
		},
	],
});
