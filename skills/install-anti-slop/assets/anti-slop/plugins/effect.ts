import plugin from "oxlint-plugin-effect/plugin";

import { withModes } from "../modes/wrap.ts";

/** cevr's `oxlint-plugin-effect/plugin` with a `mode` option on every rule. Register it as `{ name: "effect", specifier: "<this file>" }`. */
export default withModes(plugin);
