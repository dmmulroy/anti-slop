import { RuleTester } from "oxlint/plugins-dev";

import { throwInEffectGenRule } from "./throw-in-effect-gen.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const imports = `import { Effect, Stream } from "effect";`;
const thrown = [{ messageId: "throwInEffectGen" }];

tester.run("anti-slop-effect/throw-in-effect-gen", throwInEffectGenRule, {
	valid: [
		// Effect.try and Effect.tryPromise capture throws from their callbacks, whatever else the options hold.
		`${imports}
		const consume = (stream: Stream.Stream<Uint8Array>) =>
			Effect.gen(function* () {
				const decoder = new TextDecoder("utf-8", { fatal: true });
				const decode = (bytes: Uint8Array | undefined) =>
					Effect.try({
						try: () => {
							const text = decoder.decode(bytes, { stream: bytes !== undefined });
							if (text.includes("\\0")) throw new Error("null byte in process output");
							return text;
						},
						catch: (cause) => new OutputNotText({ cause }),
					});
				yield* Stream.runForEach(stream, (bytes) => decode(bytes));
			});`,
		`${imports}
		const read = Effect.gen(function* () {
			return yield* Effect.try(() => {
				if (!ready) throw new Error("not ready");
				return value;
			});
		});`,
		`${imports}
		const load = Effect.fn("load")(function* (url: string) {
			return yield* Effect.tryPromise({
				try: async (signal) => {
					const response = await fetch(url, { signal });
					if (!response.ok) throw new Error(response.statusText);
					return response.json();
				},
				catch: (cause) => new LoadError({ cause }),
				...retryOptions,
			});
		});`,
		// A synchronous helper declared in the generator throws to its own caller.
		`${imports}
		const open = Effect.gen(function* () {
			const contributions = new Map<string, Contribution>();
			const realize = (tools: ReadonlyArray<Tool>) => {
				const realized: Array<Contribution> = [];
				for (const tool of tools) {
					const contribution = contributions.get(tool.name);
					if (contribution === undefined) {
						throw new Error(\`tool "\${tool.name}" was never initialized\`);
					}
					realized.push(contribution);
				}
				return realized;
			};
			return { realize };
		});`,
		`${imports}
		const program = Effect.gen(function* () {
			function invariant(condition: boolean, message: string): asserts condition {
				if (!condition) throw new Error(message);
			}
			invariant(enabled, "disabled");
		});`,
		// Promise callbacks and methods of a returned object run outside the generator.
		`${imports}
		const daemon = Effect.gen(function* () {
			let binary: Promise<string> | undefined;
			return yield* makeTransport(() =>
				(binary ??= resolveBinary().catch((error) => {
					binary = undefined;
					throw error;
				})),
			);
		});`,
		`${imports}
		const facade = Effect.gen(function* () {
			let open = false;
			return {
				send: (data: string) => {
					if (!open) throw new Error("WebSocket is not open");
					queue.push(data);
				},
			};
		});`,
		`${imports}
		const program = Effect.gen(function* () {
			const value = (async () => {
				if (!ready) throw new Error("not ready");
				return 1;
			})();
			return yield* Effect.promise(() => value);
		});`,
		// The thunk of Effect.sync is its own function; the rule only looks at generator bodies.
		`${imports}
		const handler = Effect.gen(function* () {
			return yield* Effect.sync(() => {
				if (!window) throw new Error("Window not found");
				window.show();
			});
		});`,
		// A catch clause in the same generator handles the throw.
		`${imports}
		const program = Effect.gen(function* () {
			try {
				if (!valid) throw new Error("invalid");
				return 1;
			} catch {
				return yield* Effect.fail(new Invalid());
			}
		});`,
		// Pipeable arguments of Effect.fn are functions of their own.
		`${imports}
		const program = Effect.fn("program")(
			function* () {
				return yield* step;
			},
			Effect.catchCause((cause) => {
				throw cause;
			}),
		);`,
		// Generators that Effect does not run.
		`${imports}
		function* numbers() {
			throw new Error("not a program");
		}`,
		`
		import { Effect } from "other-library";
		const program = Effect.gen(function* () {
			throw new Error("not effect");
		});`,
	],
	invalid: [
		{
			code: `
			import { Effect } from "effect";
			import { FileSystem } from "effect/platform";
			export function readAttachment(filePath: string, maxBytes: number) {
				return Effect.scoped(
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem;
						const info = yield* (yield* fs.open(filePath, { flag: "r" })).stat;
						if (info.size > maxBytes) throw new Error("attachment too large");
						return info;
					}),
				);
			}`,
			errors: thrown,
		},
		{
			code: `${imports}
			const executeTool = Effect.fn("executeTool")(function* (name: string, args: ReadonlyArray<unknown>) {
				if (args.length !== 1) throw new ToolRuntimeError("InvalidToolInput", name);
				return yield* run(name, args[0]);
			}, Effect.withSpan("executeTool"));`,
			errors: thrown,
		},
		{
			code: `${imports}
			const upsert = (input: Input) =>
				db.transaction((tx) =>
					Effect.gen(function* () {
						const [settings] = yield* tx.query(insert(input).returning());
						if (!settings) throw new Error("upsert returned no row");
						return settings;
					}),
				);`,
			errors: thrown,
		},
		{
			code: `
			import * as Effect from "effect/Effect";
			const check = Effect.fnUntraced(function* (code: number) {
				if (code !== 0) throw new Error(\`exited with \${code}\`);
			});`,
			errors: thrown,
		},
		{
			code: `${imports}
			class Service {
				run() {
					return Effect.gen(this, function* () {
						for (const item of this.items) {
							if (item.broken) {
								throw new Error("broken item");
							}
						}
					});
				}
			}`,
			errors: thrown,
		},
		// An immediately invoked function runs inside the generator.
		{
			code: `${imports}
			const find = Effect.gen(function* () {
				const items = (() => {
					const found = finder.search(query);
					if (!found.ok) throw found.error;
					return found.value.items;
				})();
				return items;
			});`,
			errors: thrown,
		},
		// Rethrowing from a catch clause, or throwing past a try without catch, still escapes.
		{
			code: `${imports}
			const generate = Effect.gen(function* () {
				for (const model of models) {
					try {
						generateService(model);
					} catch (error) {
						if (!continueOnError) throw error;
						yield* Effect.logError(error);
					}
				}
			});`,
			errors: thrown,
		},
		{
			code: `${imports}
			const program = Effect.gen(function* () {
				try {
					throw new Error("boom");
				} finally {
					yield* release;
				}
			});`,
			errors: thrown,
		},
	],
});
