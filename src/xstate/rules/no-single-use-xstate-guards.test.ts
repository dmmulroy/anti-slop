import { RuleTester } from "oxlint/plugins-dev";

import { noSingleUseXStateGuardsRule } from "./no-single-use-xstate-guards.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("anti-slop-xstate/no-single-use-xstate-guards", noSingleUseXStateGuardsRule, {
	valid: [
		`import { and, setup } from "xstate";
		const door = setup({
			guards: {
				isUnlocked: ({ context }) => !context.locked,
				isClosed: ({ context }) => !context.open,
			},
		}).createMachine({
			on: {
				open: { guard: and(["isUnlocked", "isClosed"]) },
				close: { guard: "isUnlocked" },
				lock: { guard: { type: "isClosed" } },
			},
		});`,
		`import { setup } from "xstate";
		const door = setup({}).createMachine({ on: { open: { guard: ({ context }) => !context.locked } } });`,
	],
	invalid: [
		{
			code: `import { setup } from "xstate";
			const door = setup({
				guards: { isUnlocked: ({ context }) => !context.locked },
			}).createMachine({ on: { open: { guard: "isUnlocked", target: ".open" } } });`,
			errors: [{ messageId: "singleUse", data: { name: "isUnlocked" } }],
		},
	],
});
