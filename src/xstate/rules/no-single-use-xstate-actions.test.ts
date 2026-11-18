import { RuleTester } from "oxlint/plugins-dev";

import { noSingleUseXStateActionsRule } from "./no-single-use-xstate-actions.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("anti-slop-xstate/no-single-use-xstate-actions", noSingleUseXStateActionsRule, {
	valid: [
		// Each named action is used twice.
		`import { assign, setup } from "xstate";
		const counter = setup({
			actions: {
				increment: assign({ count: ({ context }) => context.count + 1 }),
				log: () => console.log("changed"),
			},
		}).createMachine({
			context: { count: 0 },
			on: {
				inc: { actions: ["increment", "log"] },
				double: { actions: ["increment", { type: "increment" }, "log"] },
			},
		});`,
		// Inline actions need no name.
		`import { assign, setup } from "xstate";
		const counter = setup({}).createMachine({
			on: { inc: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
		});`,
		// An event type with the same name is not an action reference, but this action is used twice anyway.
		`import { setup } from "xstate";
		const machine = setup({
			types: {} as { events: { type: "reset" } },
			actions: { reset: () => undefined },
		}).createMachine({ entry: "reset", on: { reset: { actions: "reset" } } });`,
		// The machine is created elsewhere, so references cannot be counted.
		`import { setup } from "xstate";
		const base = setup({ actions: { save: () => undefined } });
		const machine = base.createMachine({ entry: "save" });`,
	],
	invalid: [
		{
			code: `import { assign, setup } from "xstate";
			const counter = setup({
				actions: {
					increment: assign({ count: ({ context }) => context.count + 1 }),
					log: () => console.log("changed"),
				},
			}).createMachine({
				context: { count: 0 },
				on: { inc: { actions: ["increment", "log"] }, reset: { actions: "log" } },
			});`,
			errors: [{ messageId: "singleUse", data: { name: "increment" } }],
		},
		{
			code: `import * as xstate from "xstate";
			const machine = xstate.setup({
				types: {} as { events: { type: "save" } },
				actions: { "persist": () => undefined },
			}).createMachine({ on: { save: { actions: { type: "persist" } } } });`,
			errors: [{ messageId: "singleUse", data: { name: "persist" } }],
		},
	],
});
