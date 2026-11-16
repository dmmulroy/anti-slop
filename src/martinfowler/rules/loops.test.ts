import { RuleTester } from "oxlint/plugins-dev";

import { loopsRule } from "./loops.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = (target: string, how: string) => ({ messageId: "loop", data: { target, how } });

tester.run("anti-slop-martinfowler/loops", loopsRule, {
	valid: [
		// Side effects only: nothing is accumulated.
		"for (const user of users) { await notify(user); }",
		"const run = Effect.gen(function* () { for (const id of ids) { yield* remove(id); } });",
		// The collection is local to each iteration.
		"for (const row of rows) { const cells = []; cells.push(row.a); emit(cells); }",
		// Searches that exit early.
		"const out = []; for (const x of xs) { if (x.done) break; out.push(x); }",
		"function f(xs) { const out = []; for (const x of xs) { if (!x) return null; out.push(x); } return out; }",
		// Worklists that grow the collection they iterate.
		"const queue = [root]; for (const node of queue) { queue.push(...node.children); }",
		// Condition loops are cursors, pagination, or parsers; off by default.
		"const pages = []; let cursor; do { const page = await load(cursor); pages.push(page); cursor = page.next; } while (cursor);",
		"const parts = []; while (match = re.exec(text)) parts.push(match[1]);",
		// Numeric totals and flags are not collection building.
		"let total = 0; for (const x of xs) total += x.amount;",
		"const state = { done: false }; for (const x of xs) state.done = x.last;",
		// Parsers that also update other outer state are state machines.
		"const frames = []; const state = { afterCr: false }; for (const byte of chunk) { if (byte === 13) state.afterCr = true; else frames.push(byte); }",
		"const out = []; let depth = 0; for (const token of tokens) { depth += token.delta; out.push(depth); }",
		"const saved = new Map(); for (const m of methods) { saved.set(m, console[m]); console[m] = noop; }",
		// Index writes in counted loops are in-place buffer updates.
		"const out = new Uint8Array(n); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = src[x * h + y];",
		// Test files are skipped by default.
		{ code: "const out = []; for (const x of xs) out.push(x);", filename: "src/a.test.ts" },
		// A `break` inside a nested switch or loop does not leave the outer loop.
		"const out = []; for (const x of xs) { for (const y of x) { if (y) break; } }",
	],
	invalid: [
		{
			code: "const emails = []; for (const user of users) { if (user.active) emails.push(user.email); }",
			errors: [error("emails", "calling `.push`")],
		},
		{
			// Writing to per-iteration locals is fine.
			code: "const byId = {}; for (const item of items) { const copy = { ...item }; copy.seen = true; byId[item.id] = copy; }",
			errors: [error("byId", "assigning computed keys")],
		},
		{
			code: "const index = new Map(); for (let i = 0; i < rows.length; i++) index.set(rows[i].id, i);",
			errors: [error("index", "calling `.set`")],
		},
		{
			code: "let all = []; for (const group of groups) { all = [...all, ...group.items]; }",
			errors: [error("all", "copying it with a spread")],
		},
		{
			code: "let all = []; for (const key in record) all = all.concat(record[key]);",
			errors: [error("all", "calling `.concat`")],
		},
		{
			code: "const results = []; for (const id of ids) { const user = yield* load(id); results.push(user); }",
			errors: [error("results", "calling `.push`")],
		},
		{
			// Only the outermost loop over the shared target is reported.
			code: "const pairs = []; for (const a of xs) { for (const b of ys) { pairs.push([a, b]); } }",
			errors: [error("pairs", "calling `.push`")],
		},
		{
			// A `break` inside a nested switch leaves only the switch.
			code: "const out = []; for (const x of xs) { switch (x.kind) { case 'a': out.push(x); break; } }",
			errors: [error("out", "calling `.push`")],
		},
		{
			code: "const pages = []; while (hasMore()) pages.push(next());",
			options: [{ includeWhile: true }],
			errors: [error("pages", "calling `.push`")],
		},
	],
});
