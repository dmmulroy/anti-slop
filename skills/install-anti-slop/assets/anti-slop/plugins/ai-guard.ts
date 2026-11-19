import { rules } from "eslint-plugin-ai-guard";

import type { Rule } from "@oxlint/plugins";

import { withModes } from "../modes/wrap.ts";

// The package's rules are typed as typescript-eslint RuleModules, which Oxlint runs unchanged but whose types do
// not match Oxlint's `Rule`, and its `types` condition points the ESM entry at CJS declarations, so a default
// import types as the module namespace. Take the named `rules` map and keep each entry that has a `create`.
const isRule = (value: unknown): value is Rule =>
	typeof value === "object" && value !== null && "create" in value && typeof value.create === "function";

const entries: ReadonlyArray<readonly [string, unknown]> = Object.entries(rules);

/** `eslint-plugin-ai-guard` with a `mode` option on every rule. Register it as `{ name: "ai-guard", specifier: "<this file>" }`. */
export default withModes({
	meta: { name: "ai-guard" },
	rules: Object.fromEntries(entries.flatMap(([name, rule]) => (isRule(rule) ? [[name, rule] as const] : []))),
});
