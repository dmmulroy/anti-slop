// oxlint-disable effecttsgo/global-console -- a test runner outside any Effect runtime
import assert from "node:assert/strict";

import type { Plugin, RuleOptionsSchema } from "@oxlint/plugins";

import antiSlop from "../index.ts";
import antiSlopEffect from "../effect/index.ts";
import antiSlopMartinFowler from "../martinfowler/index.ts";
import effect from "../plugins/effect.ts";
import enfect from "../plugins/enfect.ts";
import landmines from "../plugins/landmines.ts";
import antiSlopXState from "../xstate/index.ts";
import { schemaWithMode, splitOptions } from "./wrap.ts";

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void): void => {
	tests.push([name, run]);
};

const modeOf = (schema: RuleOptionsSchema | undefined): unknown =>
	Array.isArray(schema) ? schema[0]?.properties?.mode : undefined;

test("every anti-slop rule and every rule of the wrapped plugins accepts mode in its schema", () => {
	const plugins: Record<string, Plugin> = { antiSlop, antiSlopEffect, antiSlopMartinFowler, antiSlopXState, effect, enfect, landmines };
	for (const [name, plugin] of Object.entries(plugins)) {
		const rules = Object.entries(plugin.rules);
		assert.ok(rules.length > 0, `${name} has rules`);
		for (const [id, rule] of rules) {
			assert.deepEqual(modeOf(rule.meta?.schema), { enum: ["all", "changed"] }, `${name}/${id}`);
		}
	}
});

test("mode joins the rule's own first options object and keeps its other constraints", () => {
	const own: RuleOptionsSchema = [{ type: "object", properties: { max: { type: "integer" } }, additionalProperties: false }, { type: "string" }];
	assert.deepEqual(schemaWithMode(own), [
		{
			type: "object",
			properties: { max: { type: "integer" }, mode: { enum: ["all", "changed"] }, base: { type: "string", minLength: 1 } },
			additionalProperties: false,
		},
		{ type: "string" },
	]);
	assert.deepEqual(schemaWithMode(undefined), schemaWithMode([]), "a rule without options gets an options object holding only mode and base");
});

test("a rule with nowhere to put mode, or with its own mode or base option, is left unwrapped", () => {
	assert.equal(schemaWithMode([{ enum: ["always", "never"] }]), undefined);
	assert.equal(schemaWithMode({ type: "array" }), undefined);
	assert.equal(schemaWithMode([{ type: "object", properties: { mode: { type: "string" } } }]), undefined);
	assert.equal(schemaWithMode([{ type: "object", properties: { base: { type: "number" } } }]), undefined);
	assert.equal(schemaWithMode(false), false, "a rule that disabled validation keeps it disabled");
});

test("splitOptions hands the rule its own options and reads mode and base", () => {
	assert.deepEqual(splitOptions([{ mode: "changed", base: "origin/develop", max: 3 }, "extra"]), {
		mode: "changed",
		base: "origin/develop",
		own: [{ max: 3 }, "extra"],
	});
	assert.deepEqual(splitOptions([{ mode: "changed" }]), { mode: "changed", base: undefined, own: [] });
	const untouched = [{ max: 3 }];
	assert.equal(splitOptions(untouched).own, untouched, "options without mode or base pass through unchanged");
	assert.equal(splitOptions(untouched).mode, "all");
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
if (failed > 0) process.exit(1);
