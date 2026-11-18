import { RuleTester } from "oxlint/plugins-dev";

import { noDirectXStateCreateMachineRule } from "./no-direct-xstate-create-machine.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("anti-slop-xstate/no-direct-xstate-create-machine", noDirectXStateCreateMachineRule, {
	valid: [
		`import { setup } from "xstate";
		const toggle = setup({ types: {} as { events: { type: "toggle" } } }).createMachine({ initial: "off", states: { off: {}, on: {} } });`,
		`import * as xstate from "xstate";
		const toggle = xstate.setup({}).createMachine({ initial: "off", states: { off: {} } });`,
		// Not XState's createMachine.
		`import { createMachine } from "./local-machines.ts";
		const toggle = createMachine({ initial: "off" });`,
		`import type { createMachine } from "xstate";
		declare const make: typeof createMachine;`,
	],
	invalid: [
		{
			code: `import { createMachine } from "xstate";
			const toggle = createMachine({ initial: "off", states: { off: { on: { toggle: "on" } }, on: {} } });`,
			errors: [{ messageId: "directCreateMachine" }],
		},
		{
			code: `import { createMachine as machine } from "xstate";
			const toggle = machine({ initial: "off", states: { off: {} } });`,
			errors: [{ messageId: "directCreateMachine" }],
		},
		{
			code: `import * as xstate from "xstate";
			const toggle = xstate.createMachine({ initial: "off", states: { off: {} } });`,
			errors: [{ messageId: "directCreateMachine" }],
		},
	],
});
