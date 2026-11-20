import { RuleTester } from "oxlint/plugins-dev";

import { noManualEffectErrorTagRule } from "./no-manual-effect-error-tag.ts";

new RuleTester().run(
	"no-manual-effect-error-tag",
	noManualEffectErrorTagRule,
	{
		valid: [
			'error._tag === "NotFound";',
			'Effect.catchTag("NotFound", recover);',
			'Effect.catchTag("Wrapper", (error) => error.reason._tag === "Timeout" ? retry : fail);',
			// A nested helper is its own function, so the catch handler does not own
			// its comparison and catchTag is the wrong advice.
			`Effect.catchAll((error) => {
				function isNotFound(value) {
					return value._tag === "NotFound";
				}
				return isNotFound(error) ? recover : fail;
			});`,
		],
		invalid: [
			{
				code: 'Effect.catch((error) => error._tag === "NotFound" ? recover : fail);',
				errors: [{ messageId: "tag" }],
			},
			{
				code: 'Effect.catchAll(function (error) { return error.reason._tag === "Timeout" ? retry : fail; });',
				errors: [{ messageId: "reason" }],
			},
			{
				code: 'Effect.catchIf(predicate, (error) => { switch (error._tag) { case "NotFound": return recover; } });',
				errors: [{ messageId: "tag" }],
			},
		],
	},
);
