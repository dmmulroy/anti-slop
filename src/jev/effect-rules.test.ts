import assert from "node:assert/strict";

import type { JevRule } from "oxlint-plugin-jev";

import { effectSourceJevRules, effectTestJevRules } from "./effect-rules.ts";

const targets = new Set(["function", "call", "jsx", "file"]);
const rules: ReadonlyArray<JevRule> = [...effectSourceJevRules, ...effectTestJevRules];

assert.ok(effectSourceJevRules.length > 0, "source rules must not be empty");
assert.ok(effectTestJevRules.length > 0, "test rules must not be empty");

const seen = new Set<string>();

for (const rule of rules) {
  assert.ok(!seen.has(rule.id), `duplicate rule id "${rule.id}"`);
  seen.add(rule.id);
  assert.match(rule.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, `rule id "${rule.id}" must be kebab-case`);
  assert.ok(targets.has(rule.target), `rule "${rule.id}" has invalid target "${rule.target}"`);
  assert.ok(rule.cutoff > 0 && rule.cutoff <= 1, `rule "${rule.id}" cutoff must be in (0, 1]`);
  assert.ok(rule.question.trim().endsWith("?"), `rule "${rule.id}" question must end in "?"`);

  if (rule.location === undefined) continue;

  assert.equal(rule.target, "file", `rule "${rule.id}" uses location without a file target`);
  assert.ok(rule.location.question.trim().length > 0, `rule "${rule.id}" location question is empty`);
  assert.ok(
    rule.location.cutoff > 0.5 && rule.location.cutoff <= 1,
    `rule "${rule.id}" location cutoff must be in (0.5, 1]`,
  );
}
