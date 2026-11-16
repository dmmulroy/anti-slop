import { RuleTester } from "oxlint/plugins-dev";

import { longFunctionRule } from "./long-function.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const statements = (count: number) =>
	Array.from({ length: count }, (_, index) => `step${index}();`).join("\n");

tester.run("anti-slop-martinfowler/long-function", longFunctionRule, {
	valid: [
		`function short() {\n${statements(30)}\n}`,
		// Nested function bodies count toward the nested function, not the outer one.
		`function outer() {\n  const inner = () => {\n${statements(25)}\n  };\n  const other = () => {\n${statements(25)}\n  };\n  return [inner, other];\n}`,
		// Expression-bodied arrows have no statements.
		"const pick = (value) => value.a + value.b;",
		{ code: `function short() {\n${statements(10)}\n}`, options: [{ maxStatements: 10 }] },
	],
	invalid: [
		{
			code: `function long() {\n${statements(31)}\n}`,
			errors: [
				{
					messageId: "long",
					data: {
						subject: "`long`",
						statements: 31,
						lines: 33,
						maxStatements: 30,
						maxLines: 80,
					},
				},
			],
		},
		{
			code: `export const make = Effect.fn("users.make")(function* () {\n${statements(12)}\n});`,
			options: [{ maxStatements: 10 }],
			errors: [
				{
					messageId: "long",
					data: {
						subject: "`users.make`",
						statements: 12,
						lines: 14,
						maxStatements: 10,
						maxLines: 80,
					},
				},
			],
		},
		{
			// Blank lines count toward the line limit.
			code: `const spread = () => {\n  a();\n${"\n".repeat(10)}  b();\n};`,
			options: [{ maxLines: 8 }],
			errors: [
				{
					messageId: "long",
					data: {
						subject: "`spread`",
						statements: 2,
						lines: 14,
						maxStatements: 30,
						maxLines: 8,
					},
				},
			],
		},
		{
			code: `items.forEach(function () {\n${statements(4)}\n});`,
			options: [{ maxStatements: 3 }],
			errors: [
				{
					messageId: "long",
					data: {
						subject: "This function",
						statements: 4,
						lines: 6,
						maxStatements: 3,
						maxLines: 80,
					},
				},
			],
		},
	],
});
