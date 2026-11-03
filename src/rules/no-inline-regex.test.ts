import { RuleTester } from "oxlint/plugins-dev";

import { noInlineRegexRule } from "./no-inline-regex.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "inlineRegex" };

tester.run("anti-slop/no-inline-regex", noInlineRegexRule, {
  valid: [
    "const DIGITS = /\\d+/u;",
    "const DIGITS = new RegExp('\\\\d+', 'u');",
    "const LOOKUP = { digits: /\\d+/u };",
    "if (ready) { const DIGITS = /\\d+/u; }",
    "function build(source: string) { return new RegExp(source, 'u'); }",
    "function build(flags: string) { return new RegExp('a', flags); }",
    "function build(word: string) { return new RegExp(`^${word}$`, 'u'); }",
    "function build() { return new RegExp(); }",
    "function build() { const RegExp = createMatcher; return new RegExp('a'); }",
    "function build(RegExp: MatcherFactory) { return RegExp('a'); }",
  ],
  invalid: [
    { name: "literal in function", code: "function test(value: string) { return /\\d+/u.test(value); }", errors: [error] },
    { name: "literal in arrow", code: "const test = (value: string) => /\\d+/u.test(value);", errors: [error] },
    { name: "literal in method", code: "class Parser { parse(value: string) { return value.split(/,\\s*/u); } }", errors: [error] },
    { name: "literal in loop", code: "for (const value of values) { value.replace(/\\s+/gu, ''); }", errors: [error] },
    { name: "literal in while", code: "while (next()) { /a/u.test(current); }", errors: [error] },
    { name: "literal in static block", code: "class Parser { static { PATTERNS.push(/a/u); } }", errors: [error] },
    { name: "fixed constructor", code: "function build() { return new RegExp('\\\\d+', 'u'); }", errors: [error] },
    { name: "fixed call", code: "function build() { return RegExp('a'); }", errors: [error] },
    { name: "fixed template", code: "function build() { return new RegExp(`a`, `u`); }", errors: [error] },
    { name: "nested function", code: "export function outer() { return () => /a/u; }", errors: [error] },
  ],
});
