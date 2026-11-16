import { RuleTester } from "oxlint/plugins-dev";

import { messageChainsRule } from "./message-chains.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = (chain: string, depth: number, maxDepth = 3) => ({
	messageId: "chain",
	data: { chain, depth, maxDepth },
});

tester.run("anti-slop-martinfowler/message-chains", messageChainsRule, {
	valid: [
		"const city = order.customer.address;",
		"const city = order.customer.address.city;",
		// Fluent builders and pipelines are calls with arguments, not navigation.
		"const q = db.select().from(users).where(eq(users.id, id)).orderBy(users.name).limit(1);",
		"const s = z.string().min(1).max(10).optional();",
		"const out = rows.filter(isActive).map(toDto).slice(0, 10).join(',');",
		"const program = layer.services.client.users.list.pipe(Effect.map(toUser));",
		// Namespaces, classes, and platform globals.
		"const schema = Schema.Struct.fields.id.annotations;",
		"const flag = process.env.FEATURE.value.enabled;",
		"const v = import.meta.env.VITE_APP.url.host;",
		// Dynamic index access breaks the navigation run.
		"const x = config.servers[name].tls.cert;",
		{ code: "const city = order.customer.address.city.name;", options: [{ maxDepth: 4 }] },
	],
	invalid: [
		{
			code: "const name = order.customer.address.city.name;",
			errors: [error("order.customer.address.city.name", 4)],
		},
		{
			code: "const theme = session.getUser().getProfile().getSettings().getTheme();",
			errors: [error("session.getUser().getProfile().getSettings().getTheme()", 4)],
		},
		{
			code: "send(ctx.request.headers.authorization.token);",
			errors: [error("ctx.request.headers.authorization.token", 4)],
		},
		{
			// The method call at the end is a command; the path before it still navigates four objects.
			code: "this.deps.store.cache.entries.clear();",
			errors: [error("this.deps.store.cache.entries.clear()", 4)],
		},
		{
			code: "const id = rows[0].owner.team.org.id;",
			errors: [error("rows[0].owner.team.org.id", 4)],
		},
		{
			code: "const p = Schema.Struct.fields.id.annotations;",
			options: [{ ignorePascalCaseRoots: false }],
			errors: [error("Schema.Struct.fields.id.annotations", 4)],
		},
	],
});
