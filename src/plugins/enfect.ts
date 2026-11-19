import plugin from "@enfect/oxlint";

import { withModes } from "../modes/wrap.ts";

/** `@enfect/oxlint` with a `mode` option on every rule. Register it as `{ name: "enfect", specifier: "<this file>" }`. */
export default withModes(plugin);
