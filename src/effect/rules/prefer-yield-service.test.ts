import { RuleTester } from "oxlint/plugins-dev";

import { preferYieldServiceRule } from "./prefer-yield-service.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const imports = `
	import * as Effect from "effect/Effect";
	import * as Layer from "effect/Layer";
`;

tester.run("anti-slop-effect/prefer-yield-service", preferYieldServiceRule, {
	valid: [
		`${imports}
		const make = Effect.gen(function* () {
			const fs = yield* FileSystem;
			return { read: (path: string) => fs.read(path) };
		});`,
		// A runtime bridge for callbacks keeps the context but never re-provides it.
		`${imports}
		const make = Effect.gen(function* () {
			const context = yield* Effect.context<Store>();
			return { onMessage: (message: Message) => Effect.runForkWith(context)(handle(message)) };
		});`,
		`${imports}
		const make = Effect.gen(function* () {
			const services = yield* Effect.context<Store>();
			const store = Context.get(services, Store);
			return { store };
		});`,
		// Providing something that is not the captured context.
		`${imports}
		const make = Effect.gen(function* () {
			const services = yield* Effect.context<Store>();
			return { run: work.pipe(Effect.provide(Store.layer)), services };
		});`,
		// Not Effect's Effect.
		`
		import * as Effect from "other-library";
		const make = Effect.gen(function* () {
			const services = yield* Effect.context();
			return work.pipe(Effect.provide(services));
		});`,
	],
	invalid: [
		{
			code: `${imports}
			const make = Effect.gen(function* () {
				const fileAccess = yield* Effect.context<FileSystem | Path>();
				return { build: (dir: string) => runBuild(dir).pipe(Effect.provideContext(fileAccess)) };
			});`,
			errors: [{ messageId: "reprovidedContext", data: { provide: "Effect.provideContext" } }],
		},
		{
			code: `${imports}
			const make = Effect.gen(function* () {
				const services = yield* Effect.context<Store | Crypto>();
				return { process: Effect.provide(process, services) };
			});`,
			errors: [{ messageId: "reprovidedContext", data: { provide: "Effect.provide" } }],
		},
		{
			code: `
			import { Effect, Layer } from "effect";
			const layer = Layer.unwrap(Effect.gen(function* () {
				const context = yield* Effect.context<Store>();
				return Live.pipe(Layer.provide(context as never));
			}));`,
			errors: [{ messageId: "reprovidedContext", data: { provide: "Layer.provide" } }],
		},
		{
			code: `${imports}
			const layer = Layer.unwrap(Effect.gen(function* () {
				const context = yield* Effect.context<Store>();
				return Live.pipe(Layer.provide(Layer.succeedContext(context)));
			}));`,
			errors: [{ messageId: "reprovidedContext", data: { provide: "Layer.succeedContext" } }],
		},
	],
});
