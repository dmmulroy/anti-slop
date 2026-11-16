import { RuleTester } from "oxlint/plugins-dev";

import { repeatedSwitchesRule } from "./repeated-switches.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = (expression: string, count: number) => ({
	messageId: "repeated",
	data: { expression, count },
});

tester.run("anti-slop-martinfowler/repeated-switches", repeatedSwitchesRule, {
	valid: [
		// One switch is a dispatch, not a repeated one.
		"function label(e) { switch (e._tag) { case 'A': return 1; case 'B': return 3; default: return 2; } }",
		// Different discriminants.
		"switch (a.kind) { case 'x': case 'y': } switch (b.kind) { case 'x': case 'y': }",
		// Same text, but the case sets barely overlap, so these are likely different unions.
		"switch (part.type) { case 'text': case 'image': } switch (part.type) { case 'text': case 'tool_use': }",
		// A single comparison is a guard, not a switch.
		"if (event.type === 'click') a(); function f() { if (event.type === 'key') b(); }",
		// `switch (true)` has no discriminant.
		"switch (true) { case a: case b: break; } switch (true) { case a: case b: break; }",
		// Ifs separated by other statements are separate guards.
		"if (k === 'a') a(); log(); if (k === 'b') b(); if (k === 'a') a(); log(); if (k === 'b') b();",
		// Comparing two non-literal values is not a case test.
		"if (a.id === b.id) x(); else if (a.id === c.id) y(); if (a.id === b.id) z(); else if (a.id === c.id) w();",
		{
			code: "switch (e._tag) { case 'A': case 'B': } switch (e._tag) { case 'A': case 'B': }",
			options: [{ minOccurrences: 3 }],
		},
		{
			code: "switch (e._tag) { case 'A': case 'B': } switch (e._tag) { case 'A': case 'B': }",
			filename: "src/e.test.ts",
		},
	],
	invalid: [
		{
			code: `
				function area(shape) { switch (shape.kind) { case 'circle': return 1; case 'square': return 2; } }
				function name(shape) { switch (shape.kind) { case 'circle': return 'c'; case 'square': return 's'; } }
			`,
			errors: [error("shape.kind", 2), error("shape.kind", 2)],
		},
		{
			code: `
				function a(e) { if (e._tag === 'Ready') return 1; else if (e._tag === 'Done') return 2; }
				function b(e) { return e._tag === 'Ready' ? 'r' : e._tag === 'Done' ? 'd' : 'x'; }
			`,
			errors: [error("e._tag", 2), error("e._tag", 2)],
		},
		{
			code: `
				function a(kind) {
					if (kind === Kind.A) return 1;
					if (kind === Kind.B || kind === Kind.C) return 2;
					return 3;
				}
				function b(kind) { switch (kind) { case Kind.A: return 'a'; case Kind.C: return 'c'; } }
			`,
			errors: [error("kind", 2), error("kind", 2)],
		},
		{
			code: "switch (typeof value) { case 'string': case 'number': } const t = typeof value === 'string' ? 1 : typeof value === 'number' ? 2 : 3;",
			errors: [error("typeof value", 2), error("typeof value", 2)],
		},
		{
			code: "switch (part.type) { case 'text': case 'image': } switch (part.type) { case 'text': case 'tool_use': }",
			options: [{ minSharedCases: 1 }],
			errors: [error("part.type", 2), error("part.type", 2)],
		},
		{
			code: "switch (e._tag) { case 'A': case 'B': } switch (e._tag) { case 'A': case 'B': }",
			filename: "src/e.test.ts",
			options: [{ ignoreTests: false }],
			errors: [error("e._tag", 2), error("e._tag", 2)],
		},
	],
});
