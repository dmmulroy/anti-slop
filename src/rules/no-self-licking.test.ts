import { RuleTester } from "oxlint/plugins-dev";

import { noSelfLickingRule } from "./no-self-licking.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const tautological = { messageId: "tautologicalAssertion" };
const mockOnly = { messageId: "mockOnlyAssertion" };
const passThrough = { messageId: "passThroughWrapper" };

tester.run("anti-slop/no-self-licking", noSelfLickingRule, {
	valid: [
		"expect(total).toBe(42);",
		"expect(user.id).toEqual(other.id);",
		"assert.strictEqual(parsed.name, 'ada');",
		"assert(total > 0);",
		"it('saves', () => { const save = vi.fn(); saveOrder(save); expect(store.rows).toEqual([order]); });",
		"it('saves', () => { const save = vi.fn(); saveOrder(save); expect(save).toHaveBeenCalledWith(order); expect(store.rows).toEqual([order]); });",
		"it('saves', () => { const save = vi.fn(); saveOrder(save); });",
		"it('parses', () => { const parsed = parse(input); expect(parsed.name).toBe('ada'); });",
		"function getUser(id: UserId) { const row = repository.getUser(id); return parseUser(row); }",
		"function getUser(id: UserId) { return repository.getUser(id.value); }",
		"function getUser(id: UserId, includeDeleted: boolean) { return repository.getUser(id); }",
		"const forward = (...args: readonly string[]) => join(...args);",
		"const now = () => clock.now();",
		"const match = candidates.find((candidate) => text.includes(candidate));",
		"const names = users.map((user) => format(user));",
	],
	invalid: [
		{ code: "expect(true).toBe(true);", errors: [tautological] },
		{ code: "expect(total).toBe(total);", errors: [tautological] },
		{ code: "expect(user.id).toEqual(user.id);", errors: [tautological] },
		{ code: "expect(total).not.toBe(total);", errors: [tautological] },
		{ code: "assert.strictEqual(config, config);", errors: [tautological] },
		{ code: "strictEqual(config, config);", errors: [tautological] },
		{ code: "assert(total === total);", errors: [tautological] },
		{ code: "expect(total === total).toBe(true);", errors: [tautological] },
		{
			code: "it('saves', () => { const save = vi.fn(); saveOrder(save); expect(save).toHaveBeenCalledWith(order); });",
			errors: [mockOnly],
		},
		{
			code: "test('saves', () => { const save = jest.fn(); saveOrder(save); expect(save).toHaveBeenCalled(); expect(save.mock.calls).toHaveLength(1); });",
			errors: [mockOnly],
		},
		{
			code: "it('reads', () => { const read = sinon.stub(); readOrder(read); assert.strictEqual(read.callCount, 1); });",
			errors: [mockOnly],
		},
		{ code: "function getUser(id: UserId) { return repository.getUser(id); }", errors: [passThrough] },
		{ code: "const toUser = (user: User): User => user;", errors: [passThrough] },
		{ code: "const getUser = (id: UserId) => repository.getUser(id);", errors: [passThrough] },
		{
			code: "class Store { save(order: Order) { return this.repository.save(order); } }",
			errors: [passThrough],
		},
	],
});
