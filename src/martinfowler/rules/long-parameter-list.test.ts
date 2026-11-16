import { RuleTester } from "oxlint/plugins-dev";

import { longParameterListRule } from "./long-parameter-list.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("anti-slop-martinfowler/long-parameter-list", longParameterListRule, {
	valid: [
		"function send(to, subject, body, options) {}",
		// Rest parameters and destructured objects are not extra positions.
		"function log(level, message, context, tags, ...rest) {}",
		"function create({ a, b, c, d, e, f }) {}",
		// TypeScript `this` parameters are not positional.
		"function bind(this: Window, a: A, b: B, c: C, d: D) {}",
		// Overload signatures and declarations have no body.
		"declare function external(a, b, c, d, e): void;",
		"interface Api { call(a: A, b: B, c: C, d: D, e: E): void }",
		{ code: "function pair(a, b) {}", options: [{ max: 2 }] },
	],
	invalid: [
		{
			code: "function send(to, cc, subject, body, attachments) {}",
			errors: [{ messageId: "long", data: { subject: "`send`", count: 5, max: 4 } }],
		},
		{
			code: "const build = (a, b = 1, [c], d, e) => a;",
			errors: [{ messageId: "long", data: { subject: "`build`", count: 5, max: 4 } }],
		},
		{
			code: "class Store { constructor(a, b, c, d, e) {} }",
			errors: [{ messageId: "long", data: { subject: "`constructor`", count: 5, max: 4 } }],
		},
		{
			code: "items.map(function (a, b, c) {});",
			options: [{ max: 2 }],
			errors: [{ messageId: "long", data: { subject: "This function", count: 3, max: 2 } }],
		},
	],
});
