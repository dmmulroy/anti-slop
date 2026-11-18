import { RuleTester } from "oxlint/plugins-dev";

import { requireXStateEventSatisfiesRule } from "./require-xstate-event-satisfies.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });

tester.run("anti-slop-xstate/require-xstate-event-satisfies", requireXStateEventSatisfiesRule, {
	valid: [
		`import { useMachine } from "@xstate/react";
		function Toggle() {
			const [snapshot, send] = useMachine(toggleMachine);
			return <button onClick={() => send({ type: "toggle" } satisfies ToggleEvent)}>{snapshot.value}</button>;
		}`,
		`import { createActor } from "xstate";
		const actor = createActor(toggleMachine).start();
		actor.send({ type: "toggle" } satisfies ToggleEvent);
		actor.send(toggleEvent);`,
		// Files without XState imports send other kinds of messages.
		`channel.send({ type: "broadcast", event: "cursor", payload });`,
	],
	invalid: [
		{
			code: `import { useMachine } from "@xstate/react";
			function Toggle() {
				const [snapshot, send] = useMachine(toggleMachine);
				return <button onClick={() => send({ type: "toggle" })}>{snapshot.value}</button>;
			}`,
			errors: [{ messageId: "missingSatisfies" }],
		},
		{
			code: `import { createActor } from "xstate";
			const actor = createActor(uploadMachine).start();
			actor.send({ type: "file.selected", file });`,
			errors: [{ messageId: "missingSatisfies" }],
		},
	],
});
