import { createJevPlugin } from "oxlint-plugin-jev";

import {
  effectJevOptions,
  effectJevPluginName,
  effectSourceJevRules,
  effectTestJevRules,
} from "./effect-rules.ts";

/**
 * One oxlint rule per Effect question, `anti-slop-effect-jev/<id>`, so each question's severity
 * lives in the oxlint config. All enabled rules share one request per file. Recommended: every
 * source rule at "error", turned "off" for test files, where only `test-cannot-fail` runs.
 */
export default createJevPlugin({
  ...effectJevOptions,
  name: effectJevPluginName,
  ci: "fail",
  rules: [...effectSourceJevRules, ...effectTestJevRules],
});
