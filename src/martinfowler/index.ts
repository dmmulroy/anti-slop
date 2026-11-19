import { eslintCompatPlugin } from "@oxlint/plugins";

import { globalDataRule } from "./rules/global-data.ts";
import { longFunctionRule } from "./rules/long-function.ts";
import { longParameterListRule } from "./rules/long-parameter-list.ts";
import { loopsRule } from "./rules/loops.ts";
import { messageChainsRule } from "./rules/message-chains.ts";
import { mutableDataRule } from "./rules/mutable-data.ts";
import { mysteriousNameRule } from "./rules/mysterious-name.ts";
import { repeatedSwitchesRule } from "./rules/repeated-switches.ts";
import { withModes } from "../modes/wrap.ts";

/**
 * Opt-in Oxlint rules named after the code smells in Martin Fowler's *Refactoring* (2nd ed.,
 * chapter 3). Every message names the smell and the refactoring to apply; enable them at `warn`.
 */
const antiSlopMartinFowlerPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop-martinfowler" },
	rules: {
		"global-data": globalDataRule,
		"long-function": longFunctionRule,
		"long-parameter-list": longParameterListRule,
		loops: loopsRule,
		"message-chains": messageChainsRule,
		"mutable-data": mutableDataRule,
		"mysterious-name": mysteriousNameRule,
		"repeated-switches": repeatedSwitchesRule,
	},
});

/** Every rule also takes `mode` in its options; see `modes/wrap.ts`. */
export default withModes(antiSlopMartinFowlerPlugin);
