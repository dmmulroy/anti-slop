import { RuleTester } from "oxlint/plugins-dev";

import { noServiceParametersRule } from "./no-service-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const imports = `
	import * as Context from "effect/Context";
	import * as Effect from "effect/Effect";
	import * as Layer from "effect/Layer";
	import * as ManagedRuntime from "effect/ManagedRuntime";
`;

tester.run("anti-slop-effect/no-service-parameters", noServiceParametersRule, {
	valid: [
		`${imports}
		const find = (input: { readonly id: string }) => Effect.gen(function* () {
			const store = yield* Store;
			return yield* store.find(input.id);
		});`,
		// Layer combinators are composition code.
		`${imports}
		const withLogging = <A>(layer: Layer.Layer<A>) => layer.pipe(Layer.provide(Logging.layer));
		const merged = (left: Layer.Layer<A>, right: Layer.Layer<B>) => Layer.merge(left, right);
		function provideAll(layer: Layer.Layer<A>): Layer.Layer<A> {
			return layer;
		}`,
		// Callbacks whose parameter type the Effect API dictates.
		`${imports}
		const config = Effect.contextWith((context: Context.Context<never>) => Effect.succeed(context));`,
		// A class from another file is not known to be a service.
		`${imports}
		import { Store } from "./store.ts";
		const save = (store: Store) => store;`,
		// Not Effect's modules.
		`
		import * as Context from "other-library";
		const run = (context: Context.Context) => context;`,
		{
			filename: "store.test.ts",
			code: `${imports}
			const run = (context: Context.Context<Store>) => context;`,
		},
	],
	invalid: [
		{
			code: `${imports}
			const runAllow = <R>(allow: Allow<R>, context: Context.Context<R>) => Effect.runPromiseWith(context)(allow);`,
			errors: [{ messageId: "carrierParameter", data: { type: "Context.Context" } }],
		},
		{
			code: `${imports}
			function handle(runtime: ManagedRuntime.ManagedRuntime<Store, never>, request: Request) {
				return runtime.runPromise(serve(request));
			}`,
			errors: [{ messageId: "carrierParameter", data: { type: "ManagedRuntime.ManagedRuntime" } }],
		},
		{
			code: `${imports}
			const operation = (input: Input, layer: Layer.Layer<Store>) => run(input).pipe(Effect.provide(layer));`,
			errors: [{ messageId: "carrierParameter", data: { type: "Layer.Layer" } }],
		},
		{
			code: `${imports}
			export class Store extends Context.Service<Store, StoreShape>()("@app/Store") {}
			const save = (store: Store, value: string) => store.save(value);
			class Worker { run(store: Store) {} }`,
			errors: [
				{ messageId: "serviceParameter", data: { type: "Store" } },
				{ messageId: "serviceParameter", data: { type: "Store" } },
			],
		},
		{
			code: `${imports}
			interface Operations {
				readonly run: (context: Context.Context<Store>) => Effect.Effect<void>;
				execute(runtime: ManagedRuntime.ManagedRuntime<Store, never>): void;
			}`,
			errors: [{ messageId: "carrierParameter" }, { messageId: "carrierParameter" }],
		},
	],
});
