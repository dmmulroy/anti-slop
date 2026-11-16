import { RuleTester } from "oxlint/plugins-dev";

import { mutableDataRule } from "./mutable-data.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = (name: string, functions: string) => ({
	messageId: "mutableData",
	data: { name, functions },
});

tester.run("anti-slop-martinfowler/mutable-data", mutableDataRule, {
	valid: [
		"const count = 0; export function read() { return count; }",
		// Reassigned only during module initialization.
		"let mode = 'a'; if (process.env.B) mode = 'b'; export const read = () => mode;",
		// Function-local `let` is not module state.
		"export function sum(xs) { let total = 0; for (const x of xs) total += x; return total; }",
		// Exported bindings belong to global-data.
		"export let current = 0; export function bump() { current += 1; }",
		// Mutating the contents of a `const` container is a different smell (global-data when exported).
		"const seen = new Set(); export function mark(id) { seen.add(id); }",
	],
	invalid: [
		{
			code: "let count = 0; export function bump() { count += 1; }",
			errors: [error("count", "1 function")],
		},
		{
			code: "let cached; export const get = () => { cached ??= load(); return cached; }; export function reset() { cached = undefined; }",
			errors: [error("cached", "2 functions")],
		},
		{
			code: "var listeners = []; export function on(fn) { listeners = [...listeners, fn]; }",
			errors: [error("listeners", "1 function")],
		},
		{
			code: "let id = 0; export const next = () => id++;",
			errors: [error("id", "1 function")],
		},
		{
			code: "let a = 0, b = 0; export function swap() { [a, b] = [b, a]; }",
			errors: [error("a", "1 function"), error("b", "1 function")],
		},
	],
});
