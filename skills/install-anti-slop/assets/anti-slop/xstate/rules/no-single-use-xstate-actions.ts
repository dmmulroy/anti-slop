import { singleUseSetupRule } from "../single-use-setup.ts";

/** Reject `setup({ actions })` entries the machine references once. */
export const noSingleUseXStateActionsRule = singleUseSetupRule("actions", "action");
