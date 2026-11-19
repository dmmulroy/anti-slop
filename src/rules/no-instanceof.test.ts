import { RuleTester } from "oxlint/plugins-dev";

import { noInstanceofRule } from "./no-instanceof.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const general = { messageId: "instanceof" };

tester.run("anti-slop/no-instanceof", noInstanceofRule, {
	valid: [
		"const ok = Schema.is(User)(value);",
		"const ok = Predicate.isTagged(error, 'NotFound');",
		"const ok = Array.isArray(value);",
		"const ok = 'key' in value;",
		"const instanceofName = value;",
	],
	invalid: [
		{ name: "schema class", code: "const ok = value instanceof User;", errors: [general] },
		{ name: "member expression", code: "const ok = value instanceof Schema.Class;", errors: [general] },
		{ name: "negated", code: "if (!(error instanceof NotFound)) throw error;", errors: [general] },
		{
			name: "global Error",
			code: "const message = error instanceof Error ? error.message : String(error);",
			errors: [{ messageId: "builtin", data: { name: "Error", check: "`Predicate.isError(value)`" } }],
		},
		{
			name: "global Array",
			code: "const ok = value instanceof Array;",
			errors: [{ messageId: "builtin", data: { name: "Array", check: "`Array.isArray(value)`" } }],
		},
		{
			name: "global Date",
			code: "const ok = value instanceof Date;",
			errors: [{ messageId: "builtin", data: { name: "Date", check: "`Predicate.isDate(value)`" } }],
		},
		{ name: "shadowed builtin name", code: "class Error {} const ok = value instanceof Error;", errors: [general] },
		{
			name: "every occurrence",
			code: "const a = x instanceof A; const b = y instanceof B;",
			errors: [general, general],
		},
	],
});
