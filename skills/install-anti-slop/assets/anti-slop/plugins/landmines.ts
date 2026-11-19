import plugin from "@interfere/landmines/testing";

import { withModes } from "../modes/wrap.ts";

/** `@interfere/landmines/testing` with a `mode` option on every rule. Register it as `{ name: "landmines", specifier: "<this file>" }`. */
export default withModes(plugin);
