import { RuleTester } from "oxlint/plugins-dev";

import { globalDataRule } from "./global-data.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = (name: string, how: string) => ({ messageId: "globalData", data: { name, how } });

tester.run("anti-slop-martinfowler/global-data", globalDataRule, {
	valid: [
		"export const limits = { max: 10 };",
		"export const names = ['a', 'b']; console.log(names.length);",
		// Reading a property is not mutation, nor is mutating a copy.
		"export const cache = new Map(); const copy = new Map(cache); copy.set('a', 1);",
		"export const registry = new Map(); const value = registry.get('a');",
		// Non-exported state belongs to mutable-data, not global-data.
		"let count = 0; export function bump() { count += 1; }",
		"const seen = new Set(); export function mark(id) { seen.add(id); }",
		// Re-exports from another module are not owned here.
		"export { state } from './state.ts';",
		// A frozen-by-convention object built from a call is not a literal container.
		"export const config = loadConfig(); config.port = 1;",
	],
	invalid: [
		{
			code: "export let current = null;",
			errors: [error("current", "is declared with `let`, so it can be reassigned")],
		},
		{
			code: "export let current = null; export function set(value) { current = value; }",
			errors: [error("current", "is declared with `let` and reassigned in this file")],
		},
		{
			code: "export const registry = new Map(); export function add(k, v) { registry.set(k, v); }",
			errors: [error("registry", "is mutated in this file")],
		},
		{
			code: "export const queue = []; queue.push(1);",
			errors: [error("queue", "is mutated in this file")],
		},
		{
			code: "const state = { user: { name: '' } }; state.user.name = 'x'; export { state };",
			errors: [error("state", "is mutated in this file")],
		},
		{
			code: "const counters = {}; export default counters; counters.hits++;",
			errors: [error("counters", "is mutated in this file")],
		},
		{
			code: "export const settings = {}; Object.assign(settings, overrides);",
			errors: [error("settings", "is mutated in this file")],
		},
		{
			code: "export const flags = {} as Record<string, boolean>; delete flags.beta;",
			errors: [error("flags", "is mutated in this file")],
		},
	],
});
