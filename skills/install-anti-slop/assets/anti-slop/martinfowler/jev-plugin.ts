import { createJevPlugin } from "oxlint-plugin-jev";

import { martinFowlerJevOptions, martinFowlerJevPluginName, martinFowlerJevRules } from "./jev-rules.ts";

/**
 * One oxlint rule per Fowler smell question, `anti-slop-martinfowler-jev/<id>`, meant to run at
 * "warn". All enabled rules share one request per file, separate from the Effect jev plugin's.
 */
export default createJevPlugin({
	...martinFowlerJevOptions,
	name: martinFowlerJevPluginName,
	ci: "fail",
	rules: [...martinFowlerJevRules],
});
