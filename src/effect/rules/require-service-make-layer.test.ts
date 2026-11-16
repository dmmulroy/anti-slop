import { RuleTester } from "oxlint/plugins-dev";

import { requireServiceMakeLayerRule } from "./require-service-make-layer.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const imports = `
	import * as Context from "effect/Context";
	import * as Effect from "effect/Effect";
	import * as Layer from "effect/Layer";
`;

tester.run("anti-slop-effect/require-service-make-layer", requireServiceMakeLayerRule, {
	valid: [
		`${imports}
		export class AppRegistry extends Context.Service<AppRegistry, { readonly find: () => Effect.Effect<void> }>()("@app/AppRegistry", {
			make: Effect.gen(function* () {
				return { find: () => Effect.void };
			}),
		}) {
			static readonly layer = Layer.effect(this, this.make);
		}`,
		`${imports}
		export class Mailbox extends Context.Service<Mailbox, { readonly id: string }>()("@app/Mailbox") {
			static readonly make = (options: { readonly id: string }) => Effect.gen(function* () {
				return { id: options.id };
			});
			static readonly layer = (options: { readonly id: string }) => Layer.effect(this, this.make(options));
		}`,
		`${imports}
		export class Widgets extends Context.Service<Widgets, { readonly id: string }>()("@app/Widgets", {
			make: Effect.succeed({ id: "w" }),
		}) {
			static readonly layer = Layer.effect(Widgets, Widgets.make).pipe(Layer.provide(Other.layer));
			static readonly layerSelfBinding = Widgets.layer.pipe(Layer.provide(selfBinding));
			static readonly layerFor = (id: string) => Layer.effect(this, this.make).pipe(Layer.provide(Config.layer(id)));
			static readonly layerRouter = HttpRouter.middleware(Effect.succeed(1));
			static readonly layerStreams = Layer.effect(Streams, Widgets.use((widgets) => Effect.succeed(widgets)));
		}`,
		// A tag-only service is provided by its host; allowed by default.
		`${imports}
		export class WorkerBindings extends Context.Service<WorkerBindings, { readonly loader: Loader }>()("@app/WorkerBindings") {}`,
		// Layer.effect from the service's own make, outside the class.
		`${imports}
		export const live = Layer.effect(AppRegistry, AppRegistry.make);
		export const configured = Layer.effect(Mailbox, Mailbox.make({ id: "x" }));`,
		// Tags owned by the Effect packages cannot be given a make.
		`${imports}
		import { LanguageModel } from "effect/unstable/ai";
		export const layer = Layer.effect(LanguageModel.LanguageModel, make(options));`,
		// Not Effect's Context.
		`
		import * as Context from "other-library";
		import * as Layer from "effect/Layer";
		export class Plain extends Context.Service<Plain, {}>()("plain") {
			static readonly layer = Layer.succeed(this, {});
		}`,
		{
			filename: "registry.test.ts",
			code: `${imports}
			export const layerTest = Layer.effect(AppRegistry, Effect.gen(function* () { return {}; }));`,
		},
	],
	invalid: [
		{
			code: `${imports}
			export class WorkerBindings extends Context.Service<WorkerBindings, { readonly loader: Loader }>()("@app/WorkerBindings") {}`,
			options: [{ allowTagOnly: false }],
			errors: [{ messageId: "missingMake", data: { name: "WorkerBindings" } }],
		},
		{
			code: `${imports}
			export class Builds extends Context.Service<Builds, { readonly latest: Effect.Effect<void> }>()("@app/Builds") {
				static readonly layerWatch = (input: Input) => Layer.effect(this, Effect.gen(function* () { return { latest: Effect.void }; }));
			}`,
			errors: [{ messageId: "missingMake", data: { name: "Builds" } }],
		},
		{
			code: `${imports}
			export class SkillsRoot extends Context.Service<SkillsRoot, string>()("@app/SkillsRoot", {
				make: Effect.succeed(""),
			}) {}`,
			errors: [{ messageId: "missingLayer", data: { name: "SkillsRoot" } }],
		},
		{
			code: `${imports}
			export class Store extends Context.Service<Store, StoreShape>()("@app/Store", {
				make: (impl: StoreShape) => Effect.succeed(impl),
			}) {
				static readonly layer = (impl: StoreShape) => Layer.succeed(this, impl);
			}`,
			errors: [{ messageId: "invalidLayer", data: { name: "Store" } }],
		},
		{
			code: `${imports}
			export class Client extends Context.Service<Client, ClientShape>()("@app/Client") {
				static readonly make = makeClient;
				static readonly layer = (config: Config) => Layer.effect(Client, makeClient(config));
			}`,
			errors: [{ messageId: "invalidLayer", data: { name: "Client" } }],
		},
		{
			code: `${imports}
			export class Photon extends Context.Service<Photon, PhotonShape>()("@app/Photon", {
				make: Effect.succeed(photon),
			}) {
				static readonly layer = Layer.effect(this, this.make);
				static readonly layerUnavailable = (cause: Error) => Layer.succeed(Photon, unavailable(cause));
			}`,
			errors: [{ messageId: "invalidVariantLayer", data: { name: "Photon", member: "layerUnavailable" } }],
		},
		{
			code: `${imports}
			import { Foo } from "./foo.ts";
			export const FooLive = Layer.effect(Foo, Effect.gen(function* () {
				return { run: () => Effect.void };
			}));`,
			errors: [{ messageId: "inlineLayerEffect", data: { service: "Foo" } }],
		},
		{
			code: `
			import { Context, Effect, Layer } from "effect";
			export class Board extends Context.Service<Board, BoardShape>()("@app/Board") {}
			export const layerBoard = Layer.effect(Board, makeBoard);`,
			errors: [{ messageId: "inlineLayerEffect", data: { service: "Board" } }],
		},
	],
});
