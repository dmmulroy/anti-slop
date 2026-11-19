import { eslintCompatPlugin } from "@oxlint/plugins";

import { noDirectXStateCreateMachineRule } from "./rules/no-direct-xstate-create-machine.ts";
import { noDirectXStateUseSelectorRule } from "./rules/no-direct-xstate-use-selector.ts";
import { noMultipleXStateHooksRule } from "./rules/no-multiple-xstate-hooks.ts";
import { noSingleUseXStateActionsRule } from "./rules/no-single-use-xstate-actions.ts";
import { noSingleUseXStateGuardsRule } from "./rules/no-single-use-xstate-guards.ts";
import { requireXStateEventSatisfiesRule } from "./rules/require-xstate-event-satisfies.ts";
import { withModes } from "../modes/wrap.ts";

/** Opt-in Oxlint rules for repositories that build state machines with XState 5. */
const antiSlopXStatePlugin = eslintCompatPlugin({
	meta: { name: "anti-slop-xstate" },
	rules: {
		"no-direct-xstate-create-machine": noDirectXStateCreateMachineRule,
		"no-direct-xstate-use-selector": noDirectXStateUseSelectorRule,
		"no-multiple-xstate-hooks": noMultipleXStateHooksRule,
		"no-single-use-xstate-actions": noSingleUseXStateActionsRule,
		"no-single-use-xstate-guards": noSingleUseXStateGuardsRule,
		"require-xstate-event-satisfies": requireXStateEventSatisfiesRule,
	},
});

/** Every rule also takes `mode` in its options; see `modes/wrap.ts`. */
export default withModes(antiSlopXStatePlugin);
