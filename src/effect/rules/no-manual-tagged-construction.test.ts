import { RuleTester } from "oxlint/plugins-dev";

import { noManualTaggedConstructionRule } from "./no-manual-tagged-construction.ts";

new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
}).run(
	"no-manual-tagged-construction",
	noManualTaggedConstructionRule,
	{
		valid: [
			'Match.when({ _tag: "Ready" }, handleReady);',
			'Match.not({ "_tag": "Pending" });',
			'Match.not({ reason: { _tag: "Pending" } });',
			'Match.not({ reason: { _tag: "Pending" } }, () => false);',
			`Match.whenAnd(
				HttpClientError.isHttpClientError,
				{ reason: { _tag: "StatusCodeError", response: { status: 429 } } },
				() => true,
			);`,
			'Match.when({ reason: { _tag: "StatusCodeError" } }, handle);',
			'Match.whenOr(isFirst, { _tag: "Second" }, () => true);',
			'Match.whenAnd({ _tag: "First" }, { nested: { _tag: "Second" } }, () => true);',
			'Match.when([{ _tag: "Ready" }], handle);',
			'Match.when({ items: [{ _tag: "Item" }] }, handle);',
			'Match.whenOr([{ _tag: "Item" }], { _tag: "Fallback" }, handle);',
			'Effect.Match.when({ _tag: "Ready" }, handleReady);',
			'Match.when(({ _tag: "Ready" }), handleReady);',
			'Match.type<User>().pipe(Match.when({ _tag: "Ready" }, handleReady));',
			'Match.when({ _tag: "Outer" }, () => Match.when({ _tag: "Inner" }, () => true));',
			'Match.when({ reason: [{ nested: { _tag: "Deep" } }] }, handle);',
			'Match.whenOr({ _tag: "A" }, { _tag: "B" }, { _tag: "C" }, () => true);',
			"Ready.make({ value });",
			"new NotFound({ id });",
			"({ _tag: tag, value });",
		],
		invalid: [
			{
				code: 'const value = { _tag: "Ready", payload };',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'const value = { ["_tag"]: "Ready" };',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.when(isReady, () => ({ _tag: "Ready" }));',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.whenAnd(isReady, pred, () => { return { _tag: "Done" }; });',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.whenOr(isReady, () => [{ _tag: "Result" }]);',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.when({ type: "check" }, { _tag: "Handler" });',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.when(createPredicate({ _tag: "Ready" }), () => true);',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.when({ reason: parseError({ _tag: "StatusCodeError" }) }, () => true);',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'const pattern = { _tag: "Ready" }; Match.when(pattern, handle);',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.value({ _tag: "Ready" });',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.when({ _tag: "Outer" }, () => Match.when({ _tag: "Inner" }, () => ({ _tag: "Result" })));',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.tags({ Ready: () => ({ _tag: "Done" }) });',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.orElse(() => ({ _tag: "Fallback" }));',
				errors: [{ messageId: "manualConstruction" }],
			},
		],
	},
);
