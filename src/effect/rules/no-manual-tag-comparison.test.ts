import { RuleTester } from "oxlint/plugins-dev";

import { noManualTagComparisonRule } from "./no-manual-tag-comparison.ts";

new RuleTester().run("no-manual-tag-comparison", noManualTagComparisonRule, {
	valid: [
		"Predicate.isTagged(\"Ready\")(value);",
		"Match.value(value).pipe(Match.tag(\"Ready\", handleReady));",
		'if (value.status === "Ready") handleReady(value);',
		'Effect.catch((error) => error._tag === "NotFound" ? recover : fail);',
	],
	invalid: [
		{
			code: 'value._tag === "Ready";',
			errors: [{ messageId: "manualComparison" }],
		},
		// A nested function declaration is its own scope, so the comparison is a
		// plain tag check rather than a catch-handler one.
		{
			code: `Effect.catchAll((error) => {
				function isReady(value) {
					return value._tag === "Ready";
				}
				return isReady(state) ? ready : fail(error);
			});`,
			errors: [{ messageId: "manualComparison" }],
		},
		// The arrow form of that helper reports the same rule, so both spellings
		// of a nested helper behave alike.
		{
			code: 'Effect.catchAll((error) => { const isNotFound = (value) => value._tag === "NotFound"; return isNotFound(error) ? recover : fail; });',
			errors: [{ messageId: "manualComparison" }],
		},
		{
			code: `Effect.catchAll((error) => {
				function classify(value) {
					switch (value._tag) {
						case "Ready":
							return ready;
					}
				}
				return classify(state);
			});`,
			errors: [{ messageId: "manualSwitch" }],
		},
		{
			code: '"Ready" !== value["_tag"];',
			errors: [{ messageId: "manualComparison" }],
		},
		{
			code: "switch (value._tag) { case \"Ready\": handleReady(value); }",
			errors: [{ messageId: "manualSwitch" }],
		},
	],
});
