import { eslintCompatPlugin } from "@oxlint/plugins";

import { noManualEffectErrorTagRule } from "./rules/no-manual-effect-error-tag.ts";
import { noManualTagComparisonRule } from "./rules/no-manual-tag-comparison.ts";
import { noManualTaggedConstructionRule } from "./rules/no-manual-tagged-construction.ts";
import { noManualTaggedTypeRule } from "./rules/no-manual-tagged-type.ts";
import { noOrDieInServiceConstructionRule } from "./rules/no-ordie-in-service-construction.ts";
import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.ts";
import { noServiceParametersRule } from "./rules/no-service-parameters.ts";
import { noStaticEffectServiceForwardersRule } from "./rules/no-static-effect-service-forwarders.ts";
import { noTestCodeInSrcRule } from "./rules/no-test-code-in-src.ts";
import { noUnboundedRetryRule } from "./rules/no-unbounded-retry.ts";
import { preferEffectMatchRule } from "./rules/prefer-effect-match.ts";
import { preferTaggedErrorHandlingRule } from "./rules/prefer-tagged-error-handling.ts";
import { preferYieldServiceRule } from "./rules/prefer-yield-service.ts";
import { requireCauseWhenNarrowingRule } from "./rules/require-cause-when-narrowing.ts";
import { requireOperationSpanRule } from "./rules/require-operation-span.ts";
import { requireServiceMakeLayerRule } from "./rules/require-service-make-layer.ts";
import { streamLargeFilesRule } from "./rules/stream-large-files.ts";
import { throwInEffectGenRule } from "./rules/throw-in-effect-gen.ts";
import { withModes } from "../modes/wrap.ts";

/** Opt-in Oxlint rules for Effect service and Layer architecture. */
const antiSlopEffectPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop-effect" },
	rules: {
		"no-manual-effect-error-tag": noManualEffectErrorTagRule,
		"no-manual-tag-comparison": noManualTagComparisonRule,
		"no-manual-tagged-construction": noManualTaggedConstructionRule,
		"no-manual-tagged-type": noManualTaggedTypeRule,
		"no-ordie-in-service-construction": noOrDieInServiceConstructionRule,
		"no-service-constructor-imports": noServiceConstructorImportsRule,
		"no-service-parameters": noServiceParametersRule,
		"no-static-effect-service-forwarders": noStaticEffectServiceForwardersRule,
		"no-test-code-in-src": noTestCodeInSrcRule,
		"no-unbounded-retry": noUnboundedRetryRule,
		"prefer-effect-match": preferEffectMatchRule,
		"prefer-tagged-error-handling": preferTaggedErrorHandlingRule,
		"prefer-yield-service": preferYieldServiceRule,
		"require-cause-when-narrowing": requireCauseWhenNarrowingRule,
		"require-operation-span": requireOperationSpanRule,
		"require-service-make-layer": requireServiceMakeLayerRule,
		"stream-large-files": streamLargeFilesRule,
		"throw-in-effect-gen": throwInEffectGenRule,
	},
});

/** Every rule also takes `mode` in its options; see `modes/wrap.ts`. */
export default withModes(antiSlopEffectPlugin);
