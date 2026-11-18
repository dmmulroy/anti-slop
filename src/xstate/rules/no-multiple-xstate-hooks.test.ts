import { RuleTester } from "oxlint/plugins-dev";

import { noMultipleXStateHooksRule } from "./no-multiple-xstate-hooks.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });

tester.run("anti-slop-xstate/no-multiple-xstate-hooks", noMultipleXStateHooksRule, {
	valid: [
		`import { useMachine } from "@xstate/react";
		function Checkout() {
			const [snapshot, send] = useMachine(checkoutMachine);
			return <Cart snapshot={snapshot} send={send} />;
		}`,
		// Each component uses one actor hook.
		`import { useActor, useMachine } from "@xstate/react";
		function Checkout() {
			const [snapshot] = useMachine(checkoutMachine);
			return <Payment />;
		}
		function Payment() {
			const [payment] = useActor(paymentMachine);
			return <span>{payment.value}</span>;
		}`,
		// Not XState's hooks.
		`import { useMachine } from "./local-hooks.ts";
		function Checkout() {
			const [a] = useMachine(one);
			const [b] = useMachine(two);
			return <span>{a.value}{b.value}</span>;
		}`,
	],
	invalid: [
		{
			code: `import { useActorRef, useMachine } from "@xstate/react";
			function Checkout() {
				const [checkout, send] = useMachine(checkoutMachine);
				const payment = useActorRef(paymentMachine);
				return <Payment actor={payment} total={checkout.context.total} onPay={() => send({ type: "pay" })} />;
			}`,
			errors: [{ messageId: "multipleHooks", data: { first: "useMachine", second: "useActorRef" } }],
		},
		{
			code: `import { useMachine } from "@xstate/react";
			const Checkout = () => {
				const [cart] = useMachine(cartMachine);
				const [payment] = useMachine(paymentMachine);
				return <span>{cart.value}{payment.value}</span>;
			};`,
			errors: [{ messageId: "multipleHooks", data: { first: "useMachine", second: "useMachine" } }],
		},
	],
});
