import { singleUseSetupRule } from "../single-use-setup.ts";

/** Reject `setup({ guards })` entries the machine references once. */
export const noSingleUseXStateGuardsRule = singleUseSetupRule("guards", "guard");
