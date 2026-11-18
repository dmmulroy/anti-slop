import { RuleTester } from "oxlint/plugins-dev";

import { noDirectXStateUseSelectorRule } from "./no-direct-xstate-use-selector.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });

tester.run("anti-slop-xstate/no-direct-xstate-use-selector", noDirectXStateUseSelectorRule, {
	valid: [
		`import { useMachine } from "@xstate/react";
		function Toggle() {
			const [snapshot, send] = useMachine(toggleMachine);
			return <button onClick={() => send({ type: "toggle" })}>{snapshot.value}</button>;
		}`,
		// Not XState's useSelector.
		`import { useSelector } from "react-redux";
		function Count() {
			return <span>{useSelector((state) => state.count)}</span>;
		}`,
	],
	invalid: [
		{
			code: `import { useActorRef, useSelector } from "@xstate/react";
			function Toggle() {
				const actor = useActorRef(toggleMachine);
				const isOn = useSelector(actor, (snapshot) => snapshot.matches("on"));
				return <span>{String(isOn)}</span>;
			}`,
			errors: [{ messageId: "directUseSelector" }],
		},
		{
			code: `import * as XStateReact from "@xstate/react";
			const useIsOn = () => XStateReact.useSelector(toggleActor, (snapshot) => snapshot.matches("on"));`,
			errors: [{ messageId: "directUseSelector" }],
		},
	],
});
