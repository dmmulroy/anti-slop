import { a as JevPlugin, c as JevRulesPlugin, d as Target, f as Mode, i as JevOptions, l as JudgeOptions, o as JevPluginOptions, r as CiBehavior, s as JevRule, u as ModeOptions } from "./types-3pI5u-ld.mjs";
//#region src/index.d.ts
declare const plugin: JevPlugin;
/**
 * Builds an oxlint plugin with one rule per question, named `<name>/<id>`, so each question's
 * severity and on/off state live in the oxlint config. All of the plugin's enabled rules share one
 * request per file.
 */
declare function createJevPlugin(options: JevPluginOptions): JevRulesPlugin;
//#endregion
export { type CiBehavior, type JevOptions, type JevPlugin, type JevPluginOptions, type JevRule, type JevRulesPlugin, type JudgeOptions, type Mode, type ModeOptions, type Target, createJevPlugin, plugin as default };