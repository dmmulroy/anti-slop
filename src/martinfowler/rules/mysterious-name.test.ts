import { RuleTester } from "oxlint/plugins-dev";

import { mysteriousNameRule } from "./mysterious-name.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const generic = (name: string) => ({ messageId: "genericName", data: { name } });

tester.run("anti-slop-martinfowler/mysterious-name", mysteriousNameRule, {
	valid: [
		"export function loadAndReconcileConfigurationSources() {}",
		"export const getCachedOrAcquireCredential = () => cache.get();",
		// `handle` as a noun: a value, not a function.
		"export const handle = openFile(path);",
		"const handle = { close() {} };",
		// Framework-required names are allowed by default.
		"export const make = Effect.gen(function* () { return {} });",
		"export function fetch(request: Request) { return respond(request); }",
		"export const layer = Layer.effect(Service, make);",
		// Nested functions are not module API.
		"export function syncMailbox() { const run = () => step(); run(); }",
		// A specific noun after the verb.
		"export function processRefund() {}",
		"export const runMigrations = Effect.fn('db.runMigrations')(function* () {});",
		// Aliasing an import, not a local function.
		"import { load } from './load.ts'; export const loadUser = load;",
		// A `let` that starts as a function and is reassigned later is not a pure alias.
		"function a() {} function f() { let current = a; current = b; return current; }",
		// Aliasing a parameter of a function declaration.
		"function parseItems(payload) { const raw = payload; return raw; }",
		// Aliasing a non-function value.
		"const config = readConfig(); export const settings = config;",
		{ code: "export function handle() {}", filename: "src/handler.test.ts" },
		{ code: "export function handle() {}", filename: "src/__tests__/handler.ts" },
		{ code: "export function handle() {}", options: [{ allowNames: ["handle"] }] },
		{
			code: "const refresh = () => 1; export const run = refresh;",
			options: [{ verbs: [], checkAliases: false }],
		},
	],
	invalid: [
		{ code: "export function resolve() {}", errors: [generic("resolve")] },
		{ code: "export async function process(input: Input) {}", errors: [generic("process")] },
		{ code: "function handle() {}", errors: [generic("handle")] },
		{ code: "export default function execute() {}", errors: [generic("execute")] },
		{ code: "export const run = () => step();", errors: [generic("run")] },
		{ code: "export const doWork = async () => {};", errors: [generic("doWork")] },
		{ code: "const processData = function (rows) {};", errors: [generic("processData")] },
		{
			code: "export const update = Effect.fn('slots.update')(function* () {});",
			errors: [generic("update")],
		},
		{
			code: "export const sync = Effect.fn(function* () {});",
			errors: [generic("sync")],
		},
		{
			code: "export function load() {}",
			options: [{ verbs: ["load"] }],
			errors: [generic("load")],
		},
		{
			code: `
				function refreshAuthentication() {}
				export const executeMutation = refreshAuthentication;
			`,
			errors: [
				{
					messageId: "alias",
					data: { name: "executeMutation", target: "refreshAuthentication" },
				},
			],
		},
		{
			code: `
				const make = Effect.gen(function* () {
					const refreshAuthentication = (id, procedure) => run(id, procedure);
					const executeMutation = refreshAuthentication;
					return { executeMutation };
				});
			`,
			errors: [
				{
					messageId: "alias",
					data: { name: "executeMutation", target: "refreshAuthentication" },
				},
			],
		},
		{
			code: `
				const loadSlot = Effect.fn("slot.load")(function* () {});
				const fetchSlot = loadSlot;
			`,
			errors: [{ messageId: "alias", data: { name: "fetchSlot", target: "loadSlot" } }],
		},
	],
});
