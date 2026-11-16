import { RuleTester } from "oxlint/plugins-dev";

import { requireOperationSpanRule } from "./require-operation-span.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const imports = `
	import * as Context from "effect/Context";
	import * as Effect from "effect/Effect";
	import * as Layer from "effect/Layer";
`;
const missingSpan = (operation: string, service: string) => ({ messageId: "missingSpan", data: { operation, service } });

tester.run("anti-slop-effect/require-operation-span", requireOperationSpanRule, {
	valid: [
		`${imports}
		const listWidgets = Effect.fn("widgets.list")(function* (input: Input) {});
		export class Widgets extends Context.Service<Widgets, WidgetsShape>()("@app/Widgets", {
			make: Effect.gen(function* () {
				const provider = yield* Provider;
				const find = Effect.fn("widgets.find")(function* (id: string) {
					return yield* provider.find(id);
				});
				return {
					find,
					get: Effect.fn("widgets.get")(function* (id: string) {}),
					status: (input: Input) => Effect.gen(function* () {}).pipe(Effect.withSpan("widgets.status", { attributes: { id: input.id } })),
					list: (input: Input) => listWidgets(input).pipe(Effect.provideService(Provider, provider)),
					all: provider.all.pipe(Effect.withSpan("widgets.all")),
					client: provider.client,
					format: (widget: Widget) => widget.name,
					delegate: (id: string) => provider.find(id),
					changes: Stream.fromQueue(queue),
				};
			}),
		}) {
			static readonly layer = Layer.effect(this, this.make);
		}`,
		// Operations of a nested function's returned object are not the service's.
		`${imports}
		export class Widgets extends Context.Service<Widgets, WidgetsShape>()("@app/Widgets", {
			make: Effect.gen(function* () {
				const helper = () => { return { run: () => Effect.void }; };
				return Widgets.of({ helper });
			}),
		}) {}`,
		{
			filename: "widgets.test.ts",
			code: `${imports}
			export class Fake extends Context.Service<Fake, FakeShape>()("@test/Fake", {
				make: Effect.gen(function* () { return { run: () => Effect.void }; }),
			}) {}`,
		},
	],
	invalid: [
		{
			code: `${imports}
			export class Widgets extends Context.Service<Widgets, WidgetsShape>()("@app/Widgets", {
				make: Effect.gen(function* () {
					const store = yield* Store;
					const remove = (id: string) => store.remove(id).pipe(Effect.asVoid);
					function count() { return Effect.succeed(1); }
					return {
						find: (id: string) => Effect.gen(function* () { return yield* store.find(id); }),
						remove,
						count,
						untraced: Effect.fnUntraced(function* () {}),
						refresh() { return Effect.sync(() => store.refresh()); },
					};
				}),
			}) {
				static readonly layer = Layer.effect(this, this.make);
			}`,
			errors: [
				missingSpan("find", "Widgets"),
				missingSpan("remove", "Widgets"),
				missingSpan("count", "Widgets"),
				missingSpan("untraced", "Widgets"),
				missingSpan("refresh", "Widgets"),
			],
		},
		{
			code: `${imports}
			export class Mailbox extends Context.Service<Mailbox, MailboxShape>()("@app/Mailbox") {
				static readonly make = (options: Options) =>
					Effect.gen(function* () {
						const operations = { process: (id: string) => Effect.log(id) };
						return Mailbox.of(operations);
					}).pipe(Effect.annotateLogs({ mailbox: options.name }));
				static readonly layer = (options: Options) => Layer.effect(this, this.make(options));
			}`,
			errors: [missingSpan("process", "Mailbox")],
		},
	],
});
