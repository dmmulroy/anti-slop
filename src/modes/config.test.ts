// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console -- tests a config helper that oxlint evaluates outside any Effect runtime
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { defineAntiSlopConfig, type AntiSlopConfig } from "./config.ts";

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void): void => {
	tests.push([name, run]);
};

const scratch: string[] = [];
function root(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "anti-slop-config-")));
	scratch.push(dir);
	return dir;
}

const wrapperPath = (dir: string, name: string): string => join(dir, "node_modules", ".cache", "anti-slop", "plugins", `${name}.mjs`);

const config: AntiSlopConfig = {
	ignorePatterns: ["dist/**"],
	jsPlugins: [
		{ name: "anti-slop", specifier: "./tools/anti-slop/index.ts" },
		{ name: "landmines", specifier: "@interfere/landmines/testing" },
		{ name: "anti-slop-effect-jev", specifier: "./tools/anti-slop/jev/plugin.ts" },
	],
	settings: { react: { version: "19" } },
	rules: {
		"typescript/no-non-null-assertion": "error",
		"landmines/no-fixed-sleep": "error",
		"landmines/no-flake-masking": "off",
		"anti-slop/max-ternary-depth": { level: "error", mode: "changed", options: [{ maxDepth: 2 }] },
		"anti-slop/no-reflect-get": ["warn"],
		"anti-slop-effect-jev/unbounded-retry": { level: "error" },
		"anti-slop-effect-jev/error-as-value": { level: "warn", mode: "all" },
	},
	overrides: [{ files: ["**/*.test.ts"], rules: { "anti-slop-effect-jev/unbounded-retry": "off" } }],
};

test("expands modes into standard rules, settings, and a wrapped plugin entry", () => {
	const dir = root();
	const expanded = defineAntiSlopConfig(config, { root: dir, env: {} });
	assert.deepEqual(expanded, {
		ignorePatterns: ["dist/**"],
		jsPlugins: [
			{ name: "anti-slop", specifier: wrapperPath(dir, "anti-slop") },
			{ name: "landmines", specifier: "@interfere/landmines/testing" },
			{ name: "anti-slop-effect-jev", specifier: "./tools/anti-slop/jev/plugin.ts" },
		],
		rules: {
			"typescript/no-non-null-assertion": "error",
			"landmines/no-fixed-sleep": "error",
			"landmines/no-flake-masking": "off",
			"anti-slop/max-ternary-depth": ["error", { maxDepth: 2 }],
			"anti-slop/no-reflect-get": ["warn"],
			// Jev rules stay off without ANTI_SLOP_JEV=1.
			"anti-slop-effect-jev/unbounded-retry": "off",
			"anti-slop-effect-jev/error-as-value": "off",
		},
		overrides: [{ files: ["**/*.test.ts"], rules: { "anti-slop-effect-jev/unbounded-retry": "off" } }],
		settings: {
			react: { version: "19" },
			changedLines: {
				rules: {
					"anti-slop-effect-jev/error-as-value": "all",
					"anti-slop-effect-jev/unbounded-retry": "changed",
					"anti-slop/max-ternary-depth": "changed",
					"anti-slop/no-reflect-get": "all",
					"landmines/no-fixed-sleep": "all",
				},
			},
		},
	});
	const wrapper = readFileSync(wrapperPath(dir, "anti-slop"), "utf8");
	assert.ok(wrapper.includes(`import plugin from ${JSON.stringify(pathToFileURL(join(dir, "tools/anti-slop/index.ts")).href)};`), wrapper);
	assert.ok(wrapper.includes(`${JSON.stringify(new URL("./wrap.ts", import.meta.url).href)}`), wrapper);
	assert.equal(existsSync(wrapperPath(dir, "landmines")), false, "a plugin with no changed rule is not wrapped");
});

test("ANTI_SLOP_JEV=1 enables Jev rules at their configured severity", () => {
	const expanded = defineAntiSlopConfig(config, { root: root(), env: { ANTI_SLOP_JEV: "1" } });
	assert.equal(expanded.rules?.["anti-slop-effect-jev/unbounded-retry"], "error");
	assert.equal(expanded.rules?.["anti-slop-effect-jev/error-as-value"], "warn");
});

test("ANTI_SLOP_MODE=all checks every line with every rule and wraps nothing", () => {
	const dir = root();
	const expanded = defineAntiSlopConfig(config, { root: dir, env: { ANTI_SLOP_MODE: "all", ANTI_SLOP_JEV: "1" } });
	assert.deepEqual(new Set(Object.values(expanded.settings.changedLines.rules)), new Set(["all"]));
	assert.deepEqual(expanded.jsPlugins, config.jsPlugins);
	assert.equal(existsSync(wrapperPath(dir, "anti-slop")), false);
	assert.throws(() => defineAntiSlopConfig(config, { root: dir, env: { ANTI_SLOP_MODE: "changed" } }), /ANTI_SLOP_MODE must be "all"/);
});

test("the base comes from the base option, then ANTI_SLOP_BASE", () => {
	const dir = root();
	assert.equal(defineAntiSlopConfig(config, { root: dir, env: { ANTI_SLOP_BASE: "origin/develop" } }).settings.changedLines.base, "origin/develop");
	assert.equal(defineAntiSlopConfig(config, { root: dir, base: "v1", env: { ANTI_SLOP_BASE: "origin/develop" } }).settings.changedLines.base, "v1");
	assert.equal(defineAntiSlopConfig(config, { root: dir, env: {} }).settings.changedLines.base, undefined);
});

test('"changed" on a rule that does not come from a named JS plugin is a config error', () => {
	const dir = root();
	for (const rule of ["typescript/no-non-null-assertion", "effecttsgo/node-builtin-import", "eqeqeq", "unregistered/rule"]) {
		assert.throws(
			() => defineAntiSlopConfig({ jsPlugins: config.jsPlugins, rules: { [rule]: { level: "error", mode: "changed" } } }, { root: dir, env: {} }),
			new RegExp(`"${rule}" cannot use mode "changed".*run natively`),
			rule,
		);
	}
	assert.throws(
		() => defineAntiSlopConfig({ jsPlugins: ["./plugin.js"], rules: { "plugin/rule": { level: "error", mode: "changed" } } }, { root: dir, env: {} }),
		/registered as \{ name, specifier \}/,
		"a plugin registered by bare specifier has no name the helper can match",
	);
	// "all" is how those rules always run, so it is accepted.
	defineAntiSlopConfig({ rules: { "typescript/no-non-null-assertion": { level: "error", mode: "all" } } }, { root: dir, env: {} });
});

test("a rule given two different modes is a config error", () => {
	assert.throws(
		() =>
			defineAntiSlopConfig(
				{
					jsPlugins: config.jsPlugins,
					rules: { "landmines/no-fixed-sleep": { level: "error", mode: "changed" } },
					overrides: [{ files: ["a.ts"], rules: { "landmines/no-fixed-sleep": { level: "warn", mode: "all" } } }],
				},
				{ root: root(), env: {} },
			),
		/one mode/,
	);
});

let failed = 0;
for (const [name, run] of tests) {
	try {
		run();
		console.log(`ok - ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`not ok - ${name}`);
		console.error(error);
	}
}
for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
if (failed > 0) process.exit(1);
