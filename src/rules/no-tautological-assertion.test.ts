import { RuleTester } from "oxlint/plugins-dev";

import { noTautologicalAssertionRule } from "./no-tautological-assertion.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const alwaysPasses = [{ messageId: "alwaysPasses" }];
const comparesWithItself = [{ messageId: "comparesWithItself" }];
const constantSubject = [{ messageId: "constantSubject" }];

tester.run("anti-slop/no-tautological-assertion", noTautologicalAssertionRule, {
	valid: [
		"expect(parse(input)).toBe(2);",
		"expect(result).toEqual(expected);",
		"expect(1).toSatisfy(isOdd);",
		// The constant is on the wrong side, but the code under test produced the other value.
		"expect(200).toBe(response.status);",
		// Always fails: a "should not reach" sentinel.
		"expect(true).toBe(false);",
		"expect(x).not.toBe(x);",
		// A locally declared invariant helper named `assert` is not Node's assert.
		`function assert(condition: unknown, message: string): asserts condition {
			if (!condition) throw new Error(message);
		}
		assert(true, "unreachable");
		assert(1 === 1, "math works");`,
		`const assert = (condition: boolean) => {
			if (!condition) throw new Error("invariant");
		};
		assert(true);`,
		// An `assert` imported from the project or from a package that is not an assertion module.
		`import { assert } from "./invariant.ts";
		assert(true, "unreachable");`,
		`import assert from "tiny-invariant";
		assert(true);`,
		`import * as assert from "../shared/assertions.ts";
		assert.equal(2, 2);`,
		`import { strict } from "./modes.ts";
		strict.ok(true);`,
		// A parameter named `assert` shadows the global.
		`function check(assert: (condition: boolean) => void) {
			assert(true);
		}`,
		// Type-level test files use runtime placeholders on purpose.
		{ code: "expect(true).toBe(true);", filename: "src/types.test.ts" },
		`import assert from "node:assert"; assert.equal(compute(), 2);`,
		`import assert from "node:assert"; assert.notEqual(1, 2 - 1);`,
	],
	invalid: [
		{ code: "expect(true).toBe(true);", errors: alwaysPasses },
		{ code: "expect(1 + 1).toBe(2);", errors: alwaysPasses },
		{ code: `expect("abc").toContain("b");`, errors: alwaysPasses },
		{ code: "expect([1, 2]).toHaveLength(2);", errors: alwaysPasses },
		{ code: "expect({ a: 1 }).toEqual({ a: 1 });", errors: alwaysPasses },
		{ code: "expect(3).toBeGreaterThan(2);", errors: alwaysPasses },
		{ code: "expect(1).toMatchSnapshot();", errors: constantSubject },
		{ code: "expect(result).toEqual(result);", errors: comparesWithItself },
		{ code: "expect(this.user.name).toBe(this.user.name);", errors: comparesWithItself },
		{ code: `test("t", ({ expect }) => { expect(true).toBeTruthy(); });`, errors: alwaysPasses },
		{ code: `import { expect as check } from "vitest"; check(true).toBe(true);`, errors: alwaysPasses },
		// Node's assert, imported, required, or global.
		{ code: `import assert from "node:assert"; assert.equal(2, 2);`, errors: alwaysPasses },
		{ code: `import assert from "node:assert/strict"; assert(true);`, errors: alwaysPasses },
		{ code: `import * as assert from "assert"; assert.deepStrictEqual([1], [1]);`, errors: alwaysPasses },
		{ code: `import { strictEqual } from "node:assert"; strictEqual(1, 1);`, errors: alwaysPasses },
		{ code: `import { strict as a } from "node:assert"; a.equal(value, value);`, errors: comparesWithItself },
		{ code: `import assert from "node:assert"; assert.strict.ok(1);`, errors: alwaysPasses },
		{ code: `const assert = require("assert"); assert(1);`, errors: alwaysPasses },
		{ code: `const { ok } = require("node:assert"); ok("yes");`, errors: alwaysPasses },
		{ code: "assert.ok(1);", errors: alwaysPasses },
		{ code: "assert(true);", errors: alwaysPasses },
		// Test runners and chai.
		{ code: `import { assert } from "vitest"; assert.isTrue(true);`, errors: alwaysPasses },
		{ code: `import { assert } from "chai"; assert.isNull(null);`, errors: alwaysPasses },
		{ code: "chai.assert.isTrue(true);", errors: alwaysPasses },
		{ code: "chai.expect(true).to.be.true;", errors: alwaysPasses },
	],
});
