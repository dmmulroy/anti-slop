import { RuleTester } from "oxlint/plugins-dev";

import { noConditionalEmptyObjectSpreadRule } from "./no-conditional-empty-object-spread.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "avoid" };

if (noConditionalEmptyObjectSpreadRule.meta?.fixable !== undefined) {
  throw new Error("The rule must not offer an unsafe semantics-changing fix.");
}

tester.run(
  "anti-slop/no-conditional-empty-object-spread",
  noConditionalEmptyObjectSpreadRule,
  {
    valid: [
      "const result = { value };",
      "const result = { ...values };",
      "const result = condition ? { value } : {};",
    ],
    invalid: [
      {
        code: "const result = { ...(value !== undefined ? { value } : {}) };",
        errors: [error],
      },
      {
        code: "const result = { ...(condition ? {} : { value }) };",
        errors: [error],
      },
      // Regression: assertions around the empty branch or the whole conditional must be peeled.
      {
        code: "const result = { ...(condition ? { value } : ({} as { value?: string })) };",
        errors: [error],
      },
      {
        code: "const result = { ...(condition ? { value } : ({} satisfies { value?: string })) };",
        errors: [error],
      },
      {
        code: "const result = { ...((condition ? { value } : {}) as { value?: string }) };",
        errors: [error],
      },
      {
        code: "const result = { ...(condition ? { value } : {})! };",
        errors: [error],
      },
    ],
  },
);
