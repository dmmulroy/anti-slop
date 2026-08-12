import { RuleTester } from "oxlint/plugins-dev";

import { noFraudRule } from "./no-fraud.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const fakeSuccess = { messageId: "fakeSuccess" };
const errorSwallowedSuccess = { messageId: "errorSwallowedSuccess" };
const placeholderData = { messageId: "placeholderData" };

tester.run("anti-slop/no-fraud", noFraudRule, {
	valid: [
		"function saveOrder(order: Order) { return repository.save(order); }",
		"function isEnabled(flag: Flag) { return flag.enabled; }",
		"function isEnabled(_flag: Flag) { return true; }",
		"function defaults() { return { retries: 3 }; }",
		"function run(input: string) { try { work(input); } catch (cause) { return { ok: false, cause }; } }",
		"function run(input: string) { try { work(input); } catch (cause) { throw new Error('sync failed', { cause }); } }",
		"function run(input: string) { try { work(input); } catch { return { ok: false }; } }",
		"const contact = process.env.SUPPORT_EMAIL;",
		{ code: 'const user = { name: "John Doe" };', filename: "user.test.ts" },
		{ code: 'const user = { name: "John Doe" };', filename: "fixtures/user.ts" },
	],
	invalid: [
		{ code: "function saveOrder(order: Order) { return { ok: true }; }", errors: [fakeSuccess] },
		{ code: "function validate(input: Input) { return true; }", errors: [fakeSuccess] },
		{ code: "const listUsers = (filter: Filter) => [{ id: '1' }];", errors: [fakeSuccess] },
		{
			code: "function validate(input: Input) { report(input); /* TODO: implement */ return true; }",
			errors: [fakeSuccess],
		},
		{
			code: "function run(input: string) { try { work(input); } catch (cause) { return true; } }",
			errors: [errorSwallowedSuccess],
		},
		{
			code: "async function sync(id: string) { try { await push(id); } catch { return { ok: true }; } }",
			errors: [errorSwallowedSuccess],
		},
		{ code: 'const contact = "support@example.com";', errors: [placeholderData] },
		{ code: "const message = `Lorem ipsum dolor sit amet`;", errors: [placeholderData] },
		{ code: 'const user = { name: "John Doe" };', errors: [placeholderData] },
	],
});
