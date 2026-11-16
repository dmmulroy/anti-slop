# anti-slop

Oxlint rules that reject the low-evidence TypeScript that coding agents tend to write: casts without a stated invariant, `unknown` leaking through contracts, conditional spreads, module mocks, and similar patterns. The diagnostics tell the agent what to do instead.

anti-slop was created by [Dillon Mulroy](https://github.com/dmmulroy) at [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop). This fork, maintained by [Kyle Mistele](https://github.com/K-Mistele), keeps his core rules and adds:

- **An oxlint Jev plugin with 23 LLM-judged rules.** Each rule is a plain-English yes/no question that a pattern-based linter can't answer, asked of a [Jev](https://typesafe.ai) decision model or any AI SDK chat model. There are two sets:
  - `anti-slop-effect-jev`: 11 Effect review questions, such as `shallow-service`, `swallow-without-capture`, `read-then-write-race`, `network-call-in-transaction`, and, for tests, `test-cannot-fail`.
  - `anti-slop-martinfowler-jev`: 12 of Martin Fowler's code smells from *Refactoring*, such as `feature-envy`, `data-clumps`, `primitive-obsession`, and `middle-man`.
- More Effect AST rules (`anti-slop-effect`).
- A Martin Fowler AST code-smell bundle (`anti-slop-martinfowler`).
- Diff rules that judge a whole change set, for smells such as shotgun surgery and scope creep.

See [Jev rules](#jev-rules-llm-judged) and the [rule catalog](#jev-and-diff-rules).

The plugin is meant to be vendored, not installed from npm. Copy the source into your repository, then treat the rules as your own code: read them, change them, and keep them in sync with your team's standards.

## Install

anti-slop needs Node 22.18 or later, and Oxlint with `@oxlint/plugins` at the same exact version. A TypeScript `oxlint.config.ts` also needs `"type": "module"` in `package.json`.

### With the agent skill

```sh
npx skills add K-Mistele/anti-slop --skill install-anti-slop
```

Then ask your coding agent to install anti-slop. The skill does the following:

- runs `scripts/install.mjs`, which copies the plugin to `tools/oxlint/anti-slop/`;
- installs `oxlint` and `@oxlint/plugins` at matching versions;
- merges the plugin into your existing Oxlint or Vite+ config, with every core rule enabled;
- enables the Effect rules and the `@effect/tsgo` diagnostics when `effect` is a direct dependency;
- runs your lint and typecheck.

The Jev rules and diff rules make paid model requests, so the skill sets them up only when you ask.

To update an existing copy, ask the agent to update anti-slop while keeping local changes. The skill merges upstream changes into the vendored copy instead of replacing it ([skills/install-anti-slop/references/update.md](skills/install-anti-slop/references/update.md)).

You can run the copy script yourself from the target repository. `<skill-directory>` is where the skill was installed, such as `.agents/skills/install-anti-slop`:

```sh
node <skill-directory>/scripts/install.mjs                     # copies to tools/oxlint/anti-slop/
node <skill-directory>/scripts/install.mjs lint/anti-slop      # copies to another directory
node <skill-directory>/scripts/install.mjs --jev               # also copies the built Jev fork to tools/oxlint/oxlint-plugin-jev/
node <skill-directory>/scripts/install.mjs --jev=vendor/jev    # puts the Jev fork somewhere else
```

The script refuses to overwrite an existing directory. `--force` overrides that check; use it only after you have reviewed the existing copy.

### Manually

```sh
git clone --depth 1 https://github.com/K-Mistele/anti-slop /tmp/anti-slop
mkdir -p tools/oxlint && cp -R /tmp/anti-slop/src tools/oxlint/anti-slop
npm install --save-dev --save-exact oxlint@1.93.0 @oxlint/plugins@1.93.0
```

If you already depend on `oxlint`, install `@oxlint/plugins` at exactly that version instead. The upstream repository is tested with 1.86.0. Running `node /tmp/anti-slop/skills/install-anti-slop/scripts/install.mjs --jev` from your repository does the same copy and also adds the Jev fork.

Keep `src/vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` with the copy, because `require-readable-spacing` includes MIT-licensed code from ESLint Stylistic.

## Configure

The following `oxlint.config.ts` enables the core rules, the Effect rules, and the Fowler bundle. The same `ignorePatterns`, `jsPlugins`, and `rules` work in `.oxlintrc.json` or under `lint` in a Vite+ config.

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  // Do not lint the vendored plugin or installed agent assets. Add any other agent directories you use.
  ignorePatterns: [".agents/**", ".claude/**", ".cursor/**", "tools/oxlint/**"],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" }, // Effect repositories only
    { name: "anti-slop-martinfowler", specifier: "./tools/oxlint/anti-slop/martinfowler/index.ts" },
  ],
  rules: {
    "oxc/no-accumulating-spread": "error",
    "anti-slop/max-ternary-depth": ["error", { maxDepth: 2 }],
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-spread": "error",
    "anti-slop/no-disabled-type-assertion-rules": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-reprovide-ambient-service": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",

    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-manual-tagged-type": "error",
    "anti-slop-effect/no-ordie-in-service-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/no-service-parameters": "error",
    "anti-slop-effect/no-test-code-in-src": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "anti-slop-effect/prefer-tagged-error-handling": "error",
    "anti-slop-effect/prefer-yield-service": "error",
    "anti-slop-effect/require-cause-when-narrowing": "error",
    "anti-slop-effect/require-operation-span": "error",
    "anti-slop-effect/require-service-make-layer": "error",

    // Smells are prompts to look, so they warn. message-chains is left off by default.
    "anti-slop-martinfowler/global-data": "warn",
    "anti-slop-martinfowler/long-function": "warn",
    "anti-slop-martinfowler/long-parameter-list": "warn",
    "anti-slop-martinfowler/loops": "warn",
    "anti-slop-martinfowler/mutable-data": "warn",
    "anti-slop-martinfowler/mysterious-name": "warn",
    "anti-slop-martinfowler/repeated-switches": "warn",
  },
});
```

Effect repositories should also run every `@effect/tsgo` diagnostic as an error. The skill sets this up, and [`oxlint.config.ts`](oxlint.config.ts) in this repository shows the configuration.

## What the rules catch

The following input produces three errors under the config above:

```ts
export const toUserId = (value: string) => value as UserId;

export const handlers: Record<string, Handler> = { start };

export const parse = (text: string) =>
  decode(text).pipe(Effect.mapError(() => BadRequest.make({ reason: "Invalid JSON" })));
```

```text
x anti-slop(require-safety-comment-for-type-assertion): This type assertion has no `SAFETY:` justification.
  State the checked invariant immediately before the assertion or its containing statement.

x anti-slop(no-known-value-widening): The explicit open dictionary type on binding `handlers` discards known
  type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

x anti-slop-effect(require-cause-when-narrowing): This Effect.mapError handler discards the original error and
  constructs a new one without it. Name the handler's parameter and pass it as `cause`
  (`(error) => new BadRequest({ ..., cause: error })`), or log it first with `Effect.tapError(Effect.logError)`
  before narrowing.
```

The fixed version passes:

```ts
// SAFETY: callers pass identifiers that parseUserId already validated.
export const toUserId = (value: string) => value as UserId;

export const handlers = { start } satisfies Record<string, Handler>;

export const parse = (text: string) =>
  decode(text).pipe(Effect.mapError((cause) => BadRequest.make({ reason: "Invalid JSON", cause })));
```

The rules work on the syntax tree and same-file scopes. They do not use the type checker, so they cannot see imported type definitions or call signatures from other files. Each rule's source file documents its options and the cases it skips.

## Jev rules (LLM-judged)

Some problems need judgment, such as a service that only forwards calls, a recovery that drops an error without logging it, or feature envy. anti-slop ships two plugins of yes/no questions for these. Each question is its own Oxlint rule:

- `anti-slop-effect-jev`: 10 questions for Effect source files and 1 for tests.
- `anti-slop-martinfowler-jev`: 12 Fowler smells, meant to run at `warn`.

They run on [Kyle's fork of `oxlint-plugin-jev`](https://github.com/K-Mistele/oxlint-plugin-jev), which provides `createJevPlugin`. The fork is not on npm. It lives in this repository as the `vendor/oxlint-plugin-jev` submodule, and `install.mjs --jev` copies its built package for a `file:` dependency:

```sh
node <skill-directory>/scripts/install.mjs --jev
npm install --save-dev ./tools/oxlint/oxlint-plugin-jev   # brings ai, @ai-sdk/typesafe-ai, zod, synckit
```

Register both plugins in the base config without enabling any of their rules. That way the editor and plain `oxlint` runs never send a request:

```ts
// oxlint.config.ts, in jsPlugins
{ name: "anti-slop-effect-jev", specifier: "./tools/oxlint/anti-slop/jev/plugin.ts" },
{ name: "anti-slop-martinfowler-jev", specifier: "./tools/oxlint/anti-slop/martinfowler/jev-plugin.ts" },
```

Enable the questions in an overlay config and choose a severity for each one. A rule set to `"off"` sends nothing.

```ts
// oxlint.jev.config.ts
import type { OxlintConfig } from "oxlint";

import baseConfig from "./oxlint.config.ts";

// Spread the base instead of using `extends`: Oxlint rejects relative jsPlugins that arrive through `extends`.
const base: OxlintConfig = baseConfig;

const baseOverrides = base.overrides ?? [];

const testFiles = ["**/*.test.*", "**/*.spec.*", "test/**", "tests/**"];

const config: OxlintConfig = {
  ...base,
  rules: {
    ...base.rules,
    "anti-slop-effect-jev/error-as-value": "error",
    "anti-slop-effect-jev/shallow-service": "error",
    "anti-slop-effect-jev/swallow-without-capture": "error",
    "anti-slop-effect-jev/read-then-write-race": "warn",
    "anti-slop-effect-jev/cache-in-method": "off",
    "anti-slop-martinfowler-jev/feature-envy": "warn",
    "anti-slop-martinfowler-jev/primitive-obsession": "warn",
    "anti-slop-martinfowler-jev/comments": "off",
  },
  overrides: [
    ...baseOverrides,
    {
      files: testFiles,
      rules: {
        "anti-slop-effect-jev/error-as-value": "off",
        "anti-slop-effect-jev/shallow-service": "off",
        "anti-slop-effect-jev/swallow-without-capture": "off",
        "anti-slop-effect-jev/test-cannot-fail": "error",
      },
    },
  ],
};

export default config;
```

Use `jev/lint-changed.ts` to lint only the files changed in the working tree. Within those files, it asks Jev only about the functions you changed:

```json
{
  "scripts": {
    "lint:jev": "node tools/oxlint/anti-slop/jev/lint-changed.ts -c oxlint.jev.config.ts",
    "lint:jev:full": "node tools/oxlint/anti-slop/jev/lint-changed.ts --all -c oxlint.jev.config.ts"
  }
}
```

Without credentials, Jev prints a warning and skips its checks. Under `CI`, both plugins fail instead, because they set `ci: "fail"`. [docs/jev.md](docs/jev.md) covers judge mode, combining both plugins into one request per file, CI, and tuning. [docs/martinfowler.md](docs/martinfowler.md) covers the smells.

## Diff rules

Diff rules judge the whole branch for problems that span files or show up only in git history: `shotgun-surgery`, `divergent-change`, `duplicated-code`, and `scope-creep`. Every request costs money, so run them in `check:full` only, not on every save:

```sh
node tools/oxlint/anti-slop/diff-rules/run.ts [--base <ref>] [--committed|--staged|--working] \
  [--backend decision-model|llm-judge|command] [--model <name>] [--command <cmd>] [--purpose <text>] \
  [--config <path>] [--fail] [--json]
```

The output looks like this:

```text
diff-rules: judged 3 changed file(s) in 1 request(s) against main (c842b87) with command (claude -p); 0 cached answer(s).

warn  shotgun-surgery  0.86 >= 0.75
  Possibly Shotgun Surgery: one logical change spreads small, similar edits across many modules, and the next change of this kind will need the same edits again. Consider Move Function, Move Field, Combine Functions into Class, or Inline Function to gather the behavior in one place.
  evidence: The new currency field is threaded by hand through three modules.
  files: src/api/order.ts, src/db/order.ts, src/ui/order.ts

diff-rules: 1 warning(s), 0 error(s).
```

The diff rules have three backends:

- `decision-model`: TypeSafe Jev, reached directly, through Factory, or through AI Gateway.
- `llm-judge`: a chat model through Factory, AI Gateway, or any OpenAI-compatible server.
- `command`: any CLI agent, such as `claude -p` or `droid exec`.

The model backends load the Vercel AI SDK from your `node_modules`. Install only the packages your backend needs; [docs/diff-rules.md](docs/diff-rules.md#dependencies) lists them. With no backend configured, the runner prints a warning and exits 0.

## Credentials

Both Jev and the diff rules use the first credential they find.

| Variable | Used by | Notes |
| --- | --- | --- |
| `TYPESAFE_API_KEY` (or `TYPESAFE_AI_API_KEY`) | Jev, diff rules (`decision-model`) | Get a key at <https://console.typesafe.ai>. |
| `FACTORY_API_KEY`, optional `FACTORY_API_BASE_URL` | Jev, diff rules (`decision-model`; `llm-judge` when `LLM_JUDGE_MODEL` is set) | The decision endpoint accepts only aliases such as `jev-latest`. The organization needs the `decision_models` flag. The judge goes through Factory's Anthropic proxy and needs `@ai-sdk/anthropic`. |
| `AI_GATEWAY_API_KEY` | Jev (gateway model ids, judge mode), diff rules (both model backends) | Uses AI Gateway model ids, such as `typesafe-ai/jev` or `openai/gpt-5-mini`. |
| `LLM_JUDGE_BASE_URL` with `LLM_JUDGE_MODEL`, optional `LLM_JUDGE_API_KEY` | Diff rules (`llm-judge`) | Works with any OpenAI-compatible server. Needs `@ai-sdk/openai-compatible`. |
| `--command`, `ANTI_SLOP_DIFF_RULES_COMMAND`, or `command` in the config | Diff rules (`command`) | The command reads the prompt on stdin and prints JSON. It needs no packages. |

## Rules

### Core (`anti-slop`, error)

| Rule | What it checks |
| --- | --- |
| [`max-ternary-depth`](src/rules/max-ternary-depth.ts) | Limit ternary expression chains to a configurable depth. |
| [`no-array-filter-map`](src/rules/no-array-filter-map.ts) | Disallow adjacent array filter/map passes in favor of lazy iterator helpers or a single transformation. |
| [`no-chained-type-assertions`](src/rules/no-chained-type-assertions.ts) | Disallow chained TypeScript as and angle-bracket assertions, including parenthesized chains. |
| [`no-conditional-spread`](src/rules/no-conditional-spread.ts) | Disallow spreading ternary and logical expressions. Build the value explicitly instead. |
| [`no-disabled-type-assertion-rules`](src/rules/no-disabled-type-assertion-rules.ts) | Disallow inline disable comments for the type-assertion rules, and disable comments that name no rule. |
| [`no-known-value-widening`](src/rules/no-known-value-widening.ts) | Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence. |
| [`no-module-mocking`](src/rules/no-module-mocking.ts) | Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces. |
| [`no-object-parameters`](src/rules/no-object-parameters.ts) | Disallow object function parameters; inputs must use an owner-provided type and be parsed at their boundary. |
| [`no-reduce-accumulator-copy`](src/rules/no-reduce-accumulator-copy.ts) | Disallow copying growing reducer accumulators with Object.assign, Array.from, or array copy methods. |
| [`no-reflect-apply`](src/rules/no-reflect-apply.ts) | Disallow Reflect.apply; call typed functions directly or model dynamic dispatch behind an interface. |
| [`no-reflect-get`](src/rules/no-reflect-get.ts) | Disallow Reflect.get; use typed property access or parse dynamic input into a domain type. |
| [`no-reprovide-ambient-service`](src/rules/no-reprovide-ambient-service.ts) | Disallow re-providing an Effect service that was yielded directly from the surrounding environment. |
| [`no-runtime-typeof`](src/rules/no-runtime-typeof.ts) | Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary. |
| [`no-shape-in-symbol-names`](src/rules/no-shape-in-symbol-names.ts) | Disallow the case-insensitive substring "shape" in JavaScript, TypeScript, private, and JSX symbol names. |
| [`no-unknown-parameters`](src/rules/no-unknown-parameters.ts) | Disallow explicitly unknown function parameters except `cause` and type-predicate subjects; decode unknown input at its I/O boundary instead. |
| [`no-unknown-returns`](src/rules/no-unknown-returns.ts) | Disallow functions whose explicit return contract is `unknown` or `Promise<unknown>`. |
| [`no-unknown-type-aliases`](src/rules/no-unknown-type-aliases.ts) | Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary. |
| [`no-unsafe-dictionary-type`](src/rules/no-unsafe-dictionary-type.ts) | Disallow object-dictionary contracts whose direct value type is unknown, any, object, {}, or a union/alias containing one of those escape hatches. |
| [`no-widen-then-assert`](src/rules/no-widen-then-assert.ts) | Disallow local const flows that explicitly widen a known value before asserting the widened binding to a narrower type. |
| [`require-readable-spacing`](src/rules/require-readable-spacing.ts) | Require readable spacing between declarations and logical statement groups. |
| [`require-safety-comment-for-type-assertion`](src/rules/require-safety-comment-for-type-assertion.ts) | Require a nearby SAFETY comment for every TypeScript type assertion except const assertions. |

### Effect (`anti-slop-effect`, error)

| Rule | What it checks |
| --- | --- |
| [`no-manual-effect-error-tag`](src/effect/rules/no-manual-effect-error-tag.ts) | Use Effect tagged error handlers instead of manually branching on `_tag` in a catch handler. |
| [`no-manual-tag-comparison`](src/effect/rules/no-manual-tag-comparison.ts) | Use Effect Match or Predicate helpers instead of manually branching on `_tag`. |
| [`no-manual-tagged-construction`](src/effect/rules/no-manual-tagged-construction.ts) | Construct tagged values with their existing Effect constructor instead of writing `_tag` manually. |
| [`no-manual-tagged-type`](src/effect/rules/no-manual-tagged-type.ts) | Derive tagged types from a tagged Schema or Data constructor instead of declaring `_tag` in a type or interface. |
| [`no-ordie-in-service-construction`](src/effect/rules/no-ordie-in-service-construction.ts) | Disallow `Effect.orDie` while constructing a service (its make, its static layers, or Layer.effect/unwrap arguments) and `Layer.orDie` anywhere. |
| [`no-service-constructor-imports`](src/effect/rules/no-service-constructor-imports.ts) | Disallow project-local `make<CapabilityName>` imports outside test and spec files. |
| [`no-service-parameters`](src/effect/rules/no-service-parameters.ts) | Disallow function parameters typed as Context.Context, ManagedRuntime.ManagedRuntime, Layer.Layer, or a Context.Service declared in the same file. |
| [`no-test-code-in-src`](src/effect/rules/no-test-code-in-src.ts) | Disallow test files, imports from test directories, and test-named exports such as `layerTest` inside production source directories. |
| [`prefer-effect-match`](src/effect/rules/prefer-effect-match.ts) | Use Match from Effect for chained literal ternaries over the same value. |
| [`prefer-tagged-error-handling`](src/effect/rules/prefer-tagged-error-handling.ts) | Use Effect tagged error handlers instead of `Predicate.isTagged` checks in a broad catch handler. |
| [`prefer-yield-service`](src/effect/rules/prefer-yield-service.ts) | Disallow `yield* Effect.context()` results that are passed back to Effect.provide, Effect.provideContext, Layer.provide, or Layer.succeedContext. |
| [`require-cause-when-narrowing`](src/effect/rules/require-cause-when-narrowing.ts) | Require Effect.mapError/catch/catchAll/catchCause/orElse handlers that construct a new error to keep the original error as `cause`. |
| [`require-operation-span`](src/effect/rules/require-operation-span.ts) | Require each operation returned by a Context.Service make to be traced with Effect.fn("name") or Effect.withSpan. |
| [`require-service-make-layer`](src/effect/rules/require-service-make-layer.ts) | Require Context.Service classes to define `make` and `static layer = Layer.effect(this, this.make)`, with variant layers derived from them. |

### Martin Fowler AST (`anti-slop-martinfowler`, warn)

| Rule | What it checks |
| --- | --- |
| [`global-data`](src/martinfowler/rules/global-data.ts) | Flag exported mutable module state: exported `let`/`var`, or exported objects, arrays, Maps, and Sets mutated in the file (Refactoring, Global Data). |
| [`long-function`](src/martinfowler/rules/long-function.ts) | Flag functions whose own statements or lines exceed a threshold (Refactoring, Long Function). |
| [`long-parameter-list`](src/martinfowler/rules/long-parameter-list.ts) | Flag functions with more positional parameters than a threshold (Refactoring, Long Parameter List). |
| [`loops`](src/martinfowler/rules/loops.ts) | Flag loops that build an array, object, Map, or Set declared outside the loop (Refactoring, Loops). |
| [`message-chains`](src/martinfowler/rules/message-chains.ts) | Flag property and getter chains that navigate through more objects than a threshold (Refactoring, Message Chains). Off by default. |
| [`mutable-data`](src/martinfowler/rules/mutable-data.ts) | Flag module-level `let`/`var` bindings reassigned inside functions (Refactoring, Mutable Data). Exported bindings are reported by global-data instead. |
| [`mysterious-name`](src/martinfowler/rules/mysterious-name.ts) | Flag top-level functions whose name is a bare generic verb, or that only alias another function (Refactoring, Mysterious Name). |
| [`repeated-switches`](src/martinfowler/rules/repeated-switches.ts) | Flag a discriminant expression that is switched on, or compared in if/else or ternary chains, over the same cases in several places in one file (Refactoring, Repeated Switches). |

### Jev and diff rules

| Plugin or runner | Rules | Docs |
| --- | --- | --- |
| `anti-slop-effect-jev` ([`src/jev/effect-rules.ts`](src/jev/effect-rules.ts)) | Source: `single-use-abstraction`, `error-as-value`, `shallow-service`, `swallow-without-capture`, `unbounded-retry`, `network-call-in-transaction`, `read-then-write-race`, `unbounded-fanout`, `decode-after-status`, `cache-in-method`. Tests: `test-cannot-fail`. | [docs/jev.md](docs/jev.md) |
| `anti-slop-martinfowler-jev` ([`src/martinfowler/jev-rules.ts`](src/martinfowler/jev-rules.ts)) | `mysterious-name`, `feature-envy`, `data-clumps`, `primitive-obsession`, `middle-man`, `lazy-element`, `speculative-generality`, `temporary-field`, `insider-trading`, `data-class`, `comments`, `repeated-switches` | [docs/martinfowler.md](docs/martinfowler.md) |
| `diff-rules/run.ts` ([`src/diff-rules/rules.ts`](src/diff-rules/rules.ts)) | `shotgun-surgery`, `divergent-change`, `duplicated-code`, `scope-creep` | [docs/diff-rules.md](docs/diff-rules.md) |

The repository also ships an [`effect-program-design`](skills/effect-program-design/SKILL.md) skill. It holds the Effect review policy that the Effect rules and the Jev questions encode.

## Development

```sh
git clone --recurse-submodules https://github.com/K-Mistele/anti-slop
pnpm install
pnpm build:jev   # builds the vendor/oxlint-plugin-jev submodule
pnpm check       # oxlint, every RuleTester suite, typecheck, and the skill-asset drift check
```

`src/` is the canonical source. After you change it or move the submodule pin, run `pnpm sync:skill-assets` so the copies bundled in `skills/install-anti-slop/assets/` stay identical.

## License

MIT. `src/vendor/eslint-stylistic/` is vendored from [ESLint Stylistic](src/vendor/eslint-stylistic/UPSTREAM.md) under its MIT license.
