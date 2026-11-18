import { RuleTester } from "oxlint/plugins-dev";

import { noStaticEffectServiceForwardersRule } from "./no-static-effect-service-forwarders.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const imports = `
	import { Context, Effect, Layer } from "effect";
`;
const forwarder = (name: string, method: string) => ({
	messageId: "staticForwarder",
	data: { service: "Users", name, method },
});

tester.run("anti-slop-effect/no-static-effect-service-forwarders", noStaticEffectServiceForwardersRule, {
	valid: [
		// Layers and constructors are the statics a service is for.
		`${imports}
		class Users extends Context.Service<Users, UsersShape>()("app/Users") {
			static readonly layer = Layer.effect(Users, make);
			static readonly make = Effect.gen(function* () {
				const sql = yield* Sql;
				return { find: (id: string) => sql.find(id) };
			});
		}`,
		// The static adds work after the call.
		`${imports}
		class Users extends Context.Service<Users, UsersShape>()("app/Users") {
			static readonly findOrFail = (id: string) =>
				Effect.gen(function* () {
					const users = yield* Users;
					const user = yield* users.find(id);
					if (user === undefined) return yield* new UserNotFound({ id });
					return user;
				});
		}`,
		// The static transforms its arguments before passing them on.
		`${imports}
		class Users extends Context.Service<Users, UsersShape>()("app/Users") {
			static readonly findByEmail = (email: string) => Users.use((users) => users.find(email.toLowerCase()));
		}`,
		`${imports}
		class Users extends Context.Service<Users, UsersShape>()("app/Users") {
			static readonly find = (id: string) =>
				Effect.flatMap(Users, (users) => users.find(id).pipe(Effect.withSpan("Users.find")));
		}`,
		// It forwards to another service, not its own.
		`${imports}
		class Users extends Context.Service<Users, UsersShape>()("app/Users") {
			static readonly find = (id: string) =>
				Effect.gen(function* () {
					const sql = yield* Sql;
					return yield* sql.find(id);
				});
		}`,
		// An Effect.fn with pipeline steps adds work.
		`${imports}
		class Users extends Context.Service<Users, UsersShape>()("app/Users") {
			static readonly find = Effect.fn("Users.find")(function* (id: string) {
				const users = yield* Users;
				return yield* users.find(id);
			}, Effect.orDie);
		}`,
		// Not a service class.
		`${imports}
		class Users {
			static find = (id: string) => Effect.flatMap(Users, (users) => users.find(id));
		}`,
		// A generator has its own `this`, which is not the class.
		`${imports}
		class Users extends Context.Service<Users, UsersShape>()("app/Users") {
			static readonly count = Effect.gen({ self: other }, function* () {
				const users = yield* this;
				return yield* users.count();
			});
		}`,
		// Instance members are not statics.
		`${imports}
		class Users extends Context.Service<Users, UsersShape>()("app/Users") {
			find = (id: string) => Users.use((users) => users.find(id));
		}`,
	],
	invalid: [
		{
			code: `${imports}
			class Users extends Context.Service<Users, UsersShape>()("app/Users") {
				static readonly find = (id: string) =>
					Effect.gen(function* () {
						const users = yield* Users;
						return yield* users.find(id);
					});
			}`,
			errors: [forwarder("find", "find")],
		},
		{
			code: `${imports}
			class Users extends Context.Service<Users, UsersShape>()("app/Users") {
				static readonly find = (id: string) => Effect.flatMap(Users, (users) => users.find(id));
				static readonly all = Effect.andThen(this, (users) => users.all());
			}`,
			errors: [forwarder("find", "find"), forwarder("all", "all")],
		},
		{
			code: `${imports}
			class Users extends Context.Service<Users, UsersShape>()("app/Users") {
				static rename(id: string, name: string) {
					return Users.use(({ rename }) => rename(id, name));
				}
			}`,
			errors: [forwarder("rename", "rename")],
		},
		{
			code: `${imports}
			class Users extends Context.Service<Users, UsersShape>()("app/Users") {
				static readonly remove = (...ids: string[]) => Users.pipe(Effect.flatMap((users) => users.remove(...ids)));
			}`,
			errors: [forwarder("remove", "remove")],
		},
		{
			code: `${imports}
			class Users extends Context.Service<Users, UsersShape>()("app/Users") {
				static readonly find = Effect.fn("Users.find")(function* (id: string) {
					return yield* (yield* Users).find(id);
				});
			}`,
			errors: [forwarder("find", "find")],
		},
		{
			code: `${imports}
			class Users extends Effect.Service<Users>()("app/Users", { effect: make }) {
				static readonly count = Effect.gen(function* () {
					const users = yield* Users;
					return yield* users.count();
				});
			}`,
			errors: [forwarder("count", "count")],
		},
	],
});
