import { defineRule } from "@oxlint/plugins";

/** The rules that keep type assertions out. An inline disable of any of them lets a cast through. */
const defaultTypeAssertionRules = [
  "anti-slop/no-chained-type-assertions",
  "anti-slop/no-widen-then-assert",
  "anti-slop/require-safety-comment-for-type-assertion",
  "effecttsgo/unsafe-effect-type-assertion",
  "typescript/consistent-type-assertions",
  "typescript/no-unsafe-type-assertion",
];

const directivePattern = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?=\s|$)(.*)$/su;

/** Rule names are compared with `@typescript-eslint/` read as `typescript/`. */
function normalizeRuleName(rule: string): string {
  return rule.trim().replace(/^@?typescript-eslint\//u, "typescript/");
}

/** The rule names a disable directive lists, or null when the comment is not a disable directive. */
function directiveRules(value: string): readonly string[] | null {
  const match = directivePattern.exec(value);
  if (match === null) return null;
  const list = (match[1] ?? "").split(/\s--\s|\s--$/u)[0] ?? "";
  return list
    .split(",")
    .map(normalizeRuleName)
    .filter((rule) => rule.length > 0);
}

function configuredAdditionalRules(option: unknown): readonly string[] {
  if (typeof option !== "object" || option === null || !("additionalRules" in option)) return [];
  const { additionalRules } = option;
  if (!Array.isArray(additionalRules)) return [];
  return additionalRules.filter((rule): rule is string => typeof rule === "string").map(normalizeRuleName);
}

/** Disallow inline disables of the type-assertion rules, and disables that name no rule at all. */
export const noDisabledTypeAssertionRulesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow inline disable comments for the type-assertion rules, and disable comments that name no rule.",
    },
    messages: {
      disabledRule:
        "Don't disable `{{rule}}` inline. Remove the cast, or add a file override with its reason in the lint config.",
      disabledEverything:
        "This disable comment names no rule, so it turns off the type-assertion rules too. Name the rules it disables.",
    },
    schema: [
      {
        type: "object",
        properties: {
          additionalRules: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ additionalRules: [] }],
  },
  createOnce(context) {
    return {
      Program() {
        const typeAssertionRules = new Set([
          ...defaultTypeAssertionRules,
          ...configuredAdditionalRules(context.options?.[0]),
        ]);
        for (const comment of context.sourceCode.getAllComments()) {
          const rules = directiveRules(comment.value);
          if (rules === null) continue;
          if (rules.length === 0) {
            context.report({ node: comment, messageId: "disabledEverything" });
            continue;
          }
          for (const rule of rules) {
            if (!typeAssertionRules.has(rule)) continue;
            context.report({ node: comment, messageId: "disabledRule", data: { rule } });
          }
        }
      },
    };
  },
});
