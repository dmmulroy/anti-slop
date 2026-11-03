import { RuleTester } from "oxlint/plugins-dev";

import { noRedundantUrlParseRule } from "./no-redundant-url-parse.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("anti-slop/no-redundant-url-parse", noRedundantUrlParseRule, {
  valid: [
    "const url = new URL(input); url.searchParams.set('a', '1');",
    "const url = new URL(input); const copy = new URL(url);",
    "const copy = new URL(window.location.href);",
    "const copy = new URL(builder.toString());",
    "let url = new URL(a); url = other; const copy = new URL(url.href);",
    "const url = new URL(a); const copy = new URL(url.toString(16));",
    "const url = URL.parse(input);",
    "const url = URL.canParse(input) ? new URL(other) : null;",
    "const url = URL.canParse(input, base) ? new URL(input) : null;",
    "await fetch(new URL(path, base));",
    "function handle(request: Request) { return new URL(request.url).pathname; }",
    "function handle(request: Request) { const { pathname } = new URL(request.url); return pathname; }",
    "const a = () => new URL(request.url).pathname; const b = () => new URL(request.url).pathname;",
    "function handle(request: Request) { const a = new URL(request.url); const b = new URL(request.url); }",
    "function handle() { return new URL(next()).pathname + new URL(next()).pathname; }",
    "function handle(input: string) { const a = new URL(input).host; input = other; return new URL(input).host; }",
    "function handle(urls: string[], i: number) { return new URL(urls[i]).host + new URL(urls[i]).host; }",
    "function handle() { const URL = Parser; const url = new URL(a); return new URL(url.href); }",
    "function load(fetch: Fetcher) { return fetch(new URL(path)); }",
  ],
  invalid: [
    {
      name: "href reparse",
      code: "const url = new URL(input); const copy = new URL(url.href);",
      errors: [{ messageId: "reparse" }],
    },
    {
      name: "toString reparse",
      code: "const url = new URL(input); const copy = new URL(url.toString());",
      errors: [{ messageId: "reparse" }],
    },
    {
      name: "canParse then construct",
      code: "const url = URL.canParse(input) ? new URL(input) : null;",
      errors: [{ messageId: "canParse" }],
    },
    {
      name: "canParse with base",
      code: "const url = URL.canParse(input, base) ? new URL(input, base) : undefined;",
      errors: [{ messageId: "canParse" }],
    },
    {
      name: "fetch wrapper",
      code: "await fetch(new URL(`${base}/path`));",
      errors: [{ messageId: "fetchString" }],
    },
    {
      name: "repeated throwaway reads",
      code: "function handle(request: Request) { if (new URL(request.url).pathname === '/') return new URL(request.url).search; }",
      errors: [{ messageId: "repeated" }],
    },
    {
      name: "repeated in arrow body",
      code: "const handle = (input: string) => [new URL(input).host, new URL(input).port, new URL(input).protocol];",
      errors: [{ messageId: "repeated" }, { messageId: "repeated" }],
    },
  ],
});
