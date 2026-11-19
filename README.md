# anti-slop

Oxlint rules that reject the low-evidence TypeScript that coding agents tend to write: casts without a stated invariant, `unknown` leaking through contracts, conditional spreads, module mocks, and similar patterns. The diagnostics tell the agent what to do instead.

anti-slop was created by [Dillon Mulroy](https://github.com/dmmulroy) at [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop). This fork, maintained by [Kyle Mistele](https://github.com/K-Mistele), keeps his core rules and adds:

- **An oxlint Jev plugin with 23 LLM-judged rules.** Each rule is a plain-English yes/no question that a pattern-based linter can't answer, asked of a [Jev](https://typesafe.ai) decision model or any AI SDK chat model. There are two sets:
  - `anti-slop-effect-jev`: 11 Effect review questions, such as `shallow-service`, `swallow-without-capture`, `read-then-write-race`, `network-call-in-transaction`, and, for tests, `test-cannot-fail`.
  - `anti-slop-martinfowler-jev`: 12 of Martin Fowler's code smells from *Refactoring*, such as `feature-envy`, `data-clumps`, `primitive-obsession`, and `middle-man`.
- More Effect AST rules (`anti-slop-effect`), including `no-unbounded-retry`, ported from cevr/effect-oxlint (MIT) to accept Effect 4.1's `Schedule.upTo` bounds, and `throw-in-effect-gen`, ported from mpsuesser/enfect (MIT) to report only throws that run in the Effect generator itself.
- Opt-in XState 5 rules (`anti-slop-xstate`) for repositories that depend on `xstate`.
- A Martin Fowler AST code-smell bundle (`anti-slop-martinfowler`).
- Diff rules that judge a whole change set, for smells such as shotgun surgery and scope creep.
- Four test-honesty rules from [interfere-inc/landmines](https://github.com/interfere-inc/landmines) (MIT), installed from npm as `@interfere/landmines`: `strict-msw`, `no-fixed-sleep`, `no-unsignaled-poll`, and `no-flake-masking`.
- Ten Effect runtime rules from [cevr/effect-oxlint](https://github.com/cevr/effect-oxlint) (MIT), installed from npm as `oxlint-plugin-effect` in repositories on Effect 4.1 or later, such as `noSilentCatchAll`, `noUnboundedConcurrency`, and `requireForceKillAfter`.
- Ten Effect rules from [mpsuesser/enfect](https://github.com/mpsuesser/enfect/tree/main/plugins/oxlint) (MIT), installed from npm as `@enfect/oxlint` in Effect repositories, such as `effect-promise-vs-trypromise`, `prefer-redacted-config`, and `avoid-mutable-state`, and `anti-slop-effect/stream-large-files`, ported from enfect's `stream-large-files` pattern.
- Seven AI-shortcut rules from [ai-guard-dev/eslint-plugin-ai-guard](https://github.com/ai-guard-dev/eslint-plugin-ai-guard) (MIT), installed from npm as `eslint-plugin-ai-guard`, such as `no-placeholder-implementation`, `no-test-env-branch`, and `no-undeclared-import`, and `anti-slop/no-dev-env-branch`, a development-mode variant of `no-test-env-branch`.
- An `integrity` script that fails a branch that weakens its own checks: it runs `ai-guard integrity` and adds checks for oxlint disable comments without a reason and weakened oxlint configs.

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
- installs `oxlint` and `@oxlint/plugins` at matching versions, `@interfere/landmines`, `eslint-plugin-ai-guard`, and `@typescript-eslint/parser`;
- merges the plugin into your existing Oxlint or Vite+ config, with every core rule, the four landmines testing rules, and the seven ai-guard rules enabled;
- enables the Effect rules, the `@effect/tsgo` diagnostics, and the ten `@enfect/oxlint` rules when `effect` is a direct dependency, plus the ten cevr/effect-oxlint rules from `oxlint-plugin-effect` on Effect 4.1 or later;
- enables the XState rules when `xstate` is a direct dependency;
- adds an `integrity` script, a pre-commit hook (free rules on staged files), and a pre-push hook (free rules plus Jev rules on changed lines, then `integrity`) with your existing hook tool;
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
npm install --save-dev --save-exact oxlint@1.93.0 @oxlint/plugins@1.93.0 @interfere/landmines@0.1.0
npm install --save-dev --save-exact eslint-plugin-ai-guard@1.4.7 @typescript-eslint/parser@8.73.0
npm install --save-dev --save-exact @enfect/oxlint@0.10.0 # Effect repositories only
npm install --save-dev --save-exact oxlint-plugin-effect@0.32.4 # Effect 4.1 or later only
```

If you already depend on `oxlint`, install `@oxlint/plugins` at exactly that version instead. The upstream repository is tested with 1.86.0. Running `node /tmp/anti-slop/skills/install-anti-slop/scripts/install.mjs --jev` from your repository does the same copy and also adds the Jev fork.

Keep `src/vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` with the copy, because `require-readable-spacing` includes MIT-licensed code from ESLint Stylistic.

## Configure

The following `oxlint.config.ts` enables the core rules, the landmines testing rules, the Effect rules, and the Fowler bundle. The same `ignorePatterns`, `jsPlugins`, and `rules` work in `.oxlintrc.json` or under `lint` in a Vite+ config.

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  // Do not lint the vendored plugin or installed agent assets. Add any other agent directories you use.
  ignorePatterns: [".agents/**", ".claude/**", ".cursor/**", "tools/oxlint/**"],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" }, // Effect repositories only
    { name: "anti-slop-martinfowler", specifier: "./tools/oxlint/anti-slop/martinfowler/index.ts" },
    // Wrappers around @interfere/landmines/testing, eslint-plugin-ai-guard, @enfect/oxlint, and oxlint-plugin-effect/plugin that add a `mode` option.
    { name: "landmines", specifier: "./tools/oxlint/anti-slop/plugins/landmines.ts" },
    { name: "ai-guard", specifier: "./tools/oxlint/anti-slop/plugins/ai-guard.ts" },
    { name: "enfect", specifier: "./tools/oxlint/anti-slop/plugins/enfect.ts" }, // Effect repositories only
    { name: "effect", specifier: "./tools/oxlint/anti-slop/plugins/effect.ts" }, // Effect 4.1 or later only
    { name: "anti-slop-xstate", specifier: "./tools/oxlint/anti-slop/xstate/index.ts" }, // xstate repositories only
  ],
  rules: {
    "oxc/no-accumulating-spread": "error",
    // `value!` is an assertion the type-assertion rules don't see; narrow with a check instead.
    "typescript/no-non-null-assertion": "error",
    "anti-slop/max-ternary-depth": ["error", { maxDepth: 2 }],
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-spread": "error",
    "anti-slop/no-dev-env-branch": "error",
    "anti-slop/no-disabled-type-assertion-rules": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    // Only lines changed on the branch: a ratchet for a rule the codebase does not pass yet.
    "anti-slop/no-object-parameters": ["error", { mode: "changed" }],
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

    "landmines/strict-msw": "error",
    "landmines/no-fixed-sleep": "error",
    "landmines/no-unsignaled-poll": "error",
    "landmines/no-flake-masking": "error",

    "ai-guard/no-placeholder-implementation": "error",
    "ai-guard/no-test-env-branch": "error",
    "ai-guard/no-tautological-assertion": "error",
    "ai-guard/no-assertionless-test": "error",
    "ai-guard/no-undeclared-import": "error",
    "ai-guard/no-silent-fallback": "error",
    "ai-guard/no-invisible-unicode": "error",

    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-manual-tagged-type": "error",
    "anti-slop-effect/no-ordie-in-service-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/no-service-parameters": "error",
    "anti-slop-effect/no-static-effect-service-forwarders": "error",
    "anti-slop-effect/no-test-code-in-src": "error",
    "anti-slop-effect/no-unbounded-retry": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "anti-slop-effect/prefer-tagged-error-handling": "error",
    "anti-slop-effect/prefer-yield-service": "error",
    "anti-slop-effect/require-cause-when-narrowing": "error",
    "anti-slop-effect/require-operation-span": "error",
    "anti-slop-effect/require-service-make-layer": "error",
    "anti-slop-effect/stream-large-files": "error",
    "anti-slop-effect/throw-in-effect-gen": "error",

    "effect/noAliasTestLayer": "error",
    "effect/noEagerAcquire": "error",
    "effect/noManagedRuntimeInEffect": "error",
    "effect/noPerCallCacheConstruction": "error",
    "effect/noPointFreeLog": "error",
    "effect/noRunCollectOnUnboundedStream": "error",
    "effect/noSilentCatchAll": "error",
    "effect/noUnboundedConcurrency": "error",
    "effect/requireSuppressionReason": "error",
    "effect/requireForceKillAfter": "error",

    "enfect/effect-promise-vs-trypromise": "error",
    "enfect/prefer-redacted-config": "error",
    "enfect/avoid-option-getorthrow": "error",
    "enfect/effect-run-in-body": "error",
    "enfect/no-cause-in-http-response": "error",
    "enfect/no-effect-ignore-then-as": "error",
    "enfect/avoid-expect-in-if": "error",
    "enfect/yield-in-for-loop": "error",
    "enfect/prefer-duration-constructors": "error",
    "enfect/avoid-mutable-state": "error",

    "anti-slop-xstate/no-direct-xstate-create-machine": "error",
    "anti-slop-xstate/no-direct-xstate-use-selector": "error",
    "anti-slop-xstate/no-multiple-xstate-hooks": "error",
    "anti-slop-xstate/no-single-use-xstate-actions": "error",
    "anti-slop-xstate/no-single-use-xstate-guards": "error",
    "anti-slop-xstate/require-xstate-event-satisfies": "error",

    // Smells are prompts to look, so they warn. message-chains is left off by default.
    "anti-slop-martinfowler/global-data": "warn",
    "anti-slop-martinfowler/long-function": "warn",
    "anti-slop-martinfowler/long-parameter-list": "warn",
    "anti-slop-martinfowler/loops": "warn",
    "anti-slop-martinfowler/mutable-data": "warn",
    "anti-slop-martinfowler/mysterious-name": "warn",
    "anti-slop-martinfowler/repeated-switches": "warn",
  },
  overrides: [
    {
      // Tests throw inside Effect generators on purpose.
      files: ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**"],
      rules: { "anti-slop-effect/throw-in-effect-gen": "off" },
    },
  ],
});
```

Every rule checks the whole file. `["error", { mode: "changed" }]` checks only lines changed on the branch (against the merge base with the default branch), which ignores old violations and checks new code. Nothing defaults to `"changed"`, Jev rules included. anti-slop's own rules and the Jev rules accept `mode` directly; the `plugins/` wrappers add it to the landmines, ai-guard, cevr `effect`, and `enfect` rules. Built-in Oxlint rules and `effecttsgo/*` cannot take a mode and always check every line. [docs/modes.md](docs/modes.md) covers modes, the pre-commit and pre-push hooks, and CI.

Effect repositories should also run every `@effect/tsgo` diagnostic as an error. Those diagnostics are type-aware and run on the Effect-patched tsrs through `effect-tsgo --tsrs-lint oxlint`, which this repository's `lint` script uses with `--type-check` so the same tsrs pass also typechecks, with no `tsc`; tsrs mode is experimental, and the skill falls back to `oxlint-tsgolint` when it fails. The skill sets this up, and [`oxlint.config.ts`](oxlint.config.ts) in this repository shows the configuration.

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

Register both plugins and enable their questions in the same `oxlint.config.ts`, choosing a severity for each one. A rule set to `"off"` sends nothing. The rules run whenever a decision-model credential is set and skip with a warning otherwise. Like every rule they check whole files; add `{ mode: "changed" }` to ask only about the branch's changes:

```ts
// oxlint.config.ts
export default defineConfig({
  jsPlugins: [
    // ...the plugins above
    { name: "anti-slop-effect-jev", specifier: "./tools/oxlint/anti-slop/jev/plugin.ts" },
    { name: "anti-slop-martinfowler-jev", specifier: "./tools/oxlint/anti-slop/martinfowler/jev-plugin.ts" },
  ],
  rules: {
    // ...the rules above
    "anti-slop-effect-jev/error-as-value": ["error", { mode: "changed" }],
    "anti-slop-effect-jev/shallow-service": "error",
    "anti-slop-effect-jev/swallow-without-capture": "error",
    "anti-slop-effect-jev/read-then-write-race": "warn",
    "anti-slop-effect-jev/cache-in-method": "off",
    "anti-slop-martinfowler-jev/feature-envy": "warn",
    "anti-slop-martinfowler-jev/primitive-obsession": "warn",
    "anti-slop-martinfowler-jev/comments": "off",
  },
  overrides: [
    {
      files: ["**/*.test.*", "**/*.spec.*", "test/**", "tests/**"],
      rules: {
        "anti-slop-effect-jev/error-as-value": "off",
        "anti-slop-effect-jev/shallow-service": "off",
        "anti-slop-effect-jev/swallow-without-capture": "off",
        "anti-slop-effect-jev/test-cannot-fail": "error",
      },
    },
  ],
});
```

Run them with the pre-push and CI command, `node tools/oxlint/anti-slop/modes/lint.ts push` ([docs/modes.md](docs/modes.md)).
Without credentials, Jev prints a warning and skips its checks. Under `CI`, both plugins fail instead, because they set `ci: "fail"`. The editor extension calls Jev too when a credential is in the editor's environment, so keep it out of there. [docs/jev.md](docs/jev.md) covers judge mode, combining both plugins into one request per file, CI, and tuning. [docs/martinfowler.md](docs/martinfowler.md) covers the smells.

## Diff rules

Diff rules judge the whole branch for problems that span files or show up only in git history: `shotgun-surgery`, `divergent-change`, `duplicated-code`, and `scope-creep`. Every request costs money, so run them in CI ([docs/modes.md](docs/modes.md#ci)), not on every save:

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
| [`no-dev-env-branch`](src/rules/no-dev-env-branch.ts) | Disallow production code that returns fake data (mock-named values, literal objects and arrays) or a success result, or skips a check, when it detects development mode (`process.env.NODE_ENV === "development"`, `!== "production"`, `import.meta.env.DEV`, `__DEV__`). Development-only tooling, logging, and configuration are allowed. Ported from ai-guard's `no-test-env-branch` (MIT). |
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

### Testing (`landmines`, error)

These four rules come from [interfere-inc/landmines](https://github.com/interfere-inc/landmines) by Interfere, Inc., under the MIT license. anti-slop does not vendor them: install `@interfere/landmines` from npm and register its `testing` entry point as the `landmines` plugin. Use only these four, not the package's recommended config, whose other rules (`no-test-doubles`, `no-comments`, `colocated-tests`, `test-file-names`, `package-exports`, `no-explicit-return-types`) conflict with anti-slop's rules or with policies anti-slop leaves to each repository.

| Rule | What it checks |
| --- | --- |
| `strict-msw` | MSW started without `onUnhandledRequest: "error"`, so unmocked requests silently reach the network. |
| `no-fixed-sleep` | Awaiting a fixed real-time delay in a test or hook. Await the operation or a signal it emits. |
| `no-unsignaled-poll` | `expect.poll` and `vi.waitFor` on request recorders and spy state, which race a deadline instead of awaiting an event. |
| `no-flake-masking` | Test retries and raised timeouts. A test that passes on rerun is a flake to fix. |

### AI shortcuts (`ai-guard`, error)

These seven rules come from [ai-guard-dev/eslint-plugin-ai-guard](https://github.com/ai-guard-dev/eslint-plugin-ai-guard) under the MIT license. anti-slop does not vendor them: install `eslint-plugin-ai-guard` from npm and register it, or the `plugins/ai-guard.ts` wrapper that adds a `mode` option, as the `ai-guard` plugin. It is an ESLint plugin that runs unchanged in Oxlint. Use only these seven, not its presets: most of its other rules duplicate anti-slop, Oxlint, or `@effect/tsgo` checks.

| Rule | What it checks |
| --- | --- |
| `no-placeholder-implementation` | Elision comments such as `// ... existing code ...`, stub bodies next to a `TODO`, `throw new Error("Not implemented")` bodies, and mock-named data returned from production code. |
| `no-test-env-branch` | Production code that returns a hard-coded result when it detects a test runner (`if (process.env.NODE_ENV === "test") return { ok: true }`). |
| `no-tautological-assertion` | Assertions that pass whatever the code does: `expect(true).toBe(true)`, `expect(x).toEqual(x)`, `assert.equal(2, 2)`. |
| `no-assertionless-test` | Tests with no assertion, which pass whatever the code does. |
| `no-undeclared-import` | Imports of packages that no `package.json` up to the repository root declares, which may not exist (slopsquatting) or only arrive transitively. |
| `no-silent-fallback` | Hard-coded fallbacks for secret environment variables, and `catch` blocks that turn a failed awaited call into empty data. |
| `no-invisible-unicode` | Bidirectional controls, zero-width characters, Unicode tag characters, and variation-selector runs in source. |

### Effect runtime (`effect`, error)

These ten rules come from [cevr/effect-oxlint](https://github.com/cevr/effect-oxlint) by cevr, under the MIT license. anti-slop does not vendor them: in repositories whose direct `effect` dependency is 4.1 or later, install `oxlint-plugin-effect` from npm and register its `plugin` entry point as the `effect` plugin. The package imports `effect` at runtime, so Effect 3 and 4.0 repositories skip it. Use only these ten, not the package's recommended preset, which also enables rules that duplicate anti-slop, landmines, or `@effect/tsgo` checks, bans ordinary language features such as `null`, ternaries, `async`, and `throw`, and bans the SAFETY comments that `require-safety-comment-for-type-assertion` requires. `noUnboundedRetry` stays off because version 0.32.4 reports retries bounded with `Schedule.upTo` or a later `Effect.timeout`; use `anti-slop-effect/no-unbounded-retry`, a corrected port, instead.

| Rule | What it checks |
| --- | --- |
| `noAliasTestLayer` | A `Test`, `Fake`, `Stub`, or `Mock` layer static that only returns the live layer. |
| `noEagerAcquire` | An `acquireRelease` whose resource is built or captured before acquire runs, so an interruption in between leaks it. |
| `noManagedRuntimeInEffect` | `ManagedRuntime.make` inside an Effect program instead of at a non-Effect host boundary. |
| `noPerCallCacheConstruction` | `Effect.cached` or `Cache.make` inside an `Effect.fn` operation, which builds new cache state on every call. |
| `noPointFreeLog` | A logger passed point-free to a callback that also receives an index, which then prints the index too. |
| `noRunCollectOnUnboundedStream` | Collecting a stream that never ends without terminating it first. |
| `noSilentCatchAll` | `catch` or `catchCause` handlers that turn every failure into `Effect.void`. |
| `noUnboundedConcurrency` | `concurrency: "unbounded"` over a collection that can grow. |
| `requireSuppressionReason` | Lint, Effect, and TypeScript suppressions that do not name their target and give a ` -- ` reason. |
| `requireForceKillAfter` | `ChildProcess.make` without `forceKillAfter`, so a child that ignores SIGTERM holds its scope open forever when interrupted. |

### Effect conventions (`enfect`, error)

These ten rules come from [mpsuesser/enfect](https://github.com/mpsuesser/enfect/tree/main/plugins/oxlint) by Marc Suesser, under the MIT license. anti-slop does not vendor them: in Effect repositories, install `@enfect/oxlint` from npm and register it as the `enfect` plugin, a name that cannot collide with cevr's `effect` plugin. The package brings its own `effect`, so it works with any Effect version. Its other rules duplicate anti-slop, `@effect/tsgo`, or cevr checks, or ban ordinary language features. `throw-in-effect-gen` stays off because version 0.10.0 reports throws in helpers, promise callbacks, and object methods that are only declared inside the generator, and misses `Effect.fn("name")(function* ...)`; use `anti-slop-effect/throw-in-effect-gen`, a corrected port, instead.

| Rule | What it checks |
| --- | --- |
| `effect-promise-vs-trypromise` | `Effect.promise`, which turns a rejection into a defect. Use `Effect.tryPromise` with a `catch`. |
| `prefer-redacted-config` | Secret-named configuration read as a plain string instead of a redacted value. |
| `avoid-option-getorthrow` | Any `.getOrThrow` access, which turns a modeled absence or failure back into a throw. |
| `effect-run-in-body` | `Effect.runSync`, `Effect.runPromise`, and `Effect.runFork`. Turn it off for entry points and test harnesses. |
| `no-cause-in-http-response` | `Cause.pretty`, `Cause.squash`, or a caught error rendered into an HTTP response body. |
| `no-effect-ignore-then-as` | `Effect.ignore` immediately before `Effect.as`, which only hides the failure. |
| `avoid-expect-in-if` | `expect` inside an `if`, which passes when the branch is skipped. |
| `yield-in-for-loop` | `yield*` inside a `for` loop instead of `Effect.forEach` with an explicit concurrency. |
| `prefer-duration-constructors` | A raw number of milliseconds passed to `Effect.sleep`, `Effect.delay`, `Effect.timeout*`, `Schedule.spaced`, `Schedule.fixed`, `Schedule.windowed`, or `Schedule.duration`, or as a `duration` option, instead of a `Duration` constructor. |
| `avoid-mutable-state` | `let` bindings inside `Layer.effect`, `Layer.succeed`, or a `Context.Service` `make`, which hide fiber-visible state. Use `Ref`, `SynchronizedRef`, or `Effect.cached`. |

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
| [`no-static-effect-service-forwarders`](src/effect/rules/no-static-effect-service-forwarders.ts) | Disallow static members of a service class that only yield the service and call one of its methods; callers should `yield*` the service. |
| [`no-test-code-in-src`](src/effect/rules/no-test-code-in-src.ts) | Disallow test files, imports from test directories, and test-named exports such as `layerTest` inside production source directories. |
| [`no-unbounded-retry`](src/effect/rules/no-unbounded-retry.ts) | Require `Effect.retry`, `Effect.retryOrElse`, `Stream.retry`, and `HttpClient.retryTransient` policies to stop, through `times`, `Schedule.upTo`, `Schedule.max` with a bounded schedule, or a later `Effect.timeout`. Ported from cevr/effect-oxlint's `noUnboundedRetry` (MIT). |
| [`prefer-effect-match`](src/effect/rules/prefer-effect-match.ts) | Use Match from Effect for chained literal ternaries over the same value. |
| [`prefer-tagged-error-handling`](src/effect/rules/prefer-tagged-error-handling.ts) | Use Effect tagged error handlers instead of `Predicate.isTagged` checks in a broad catch handler. |
| [`prefer-yield-service`](src/effect/rules/prefer-yield-service.ts) | Disallow `yield* Effect.context()` results that are passed back to Effect.provide, Effect.provideContext, Layer.provide, or Layer.succeedContext. |
| [`require-cause-when-narrowing`](src/effect/rules/require-cause-when-narrowing.ts) | Require Effect.mapError/catch/catchAll/catchCause/orElse handlers that construct a new error to keep the original error as `cause`. |
| [`require-operation-span`](src/effect/rules/require-operation-span.ts) | Require each operation returned by a Context.Service make to be traced with Effect.fn("name") or Effect.withSpan. |
| [`require-service-make-layer`](src/effect/rules/require-service-make-layer.ts) | Require Context.Service classes to define `make` and `static layer = Layer.effect(this, this.make)`, with variant layers derived from them. |
| [`stream-large-files`](src/effect/rules/stream-large-files.ts) | `fs.readFile` or `fs.readFileString` on a path named like large data (`log`, `export`, `csv`, `jsonl`, ...), taken from a listing (`files[i]`, `entry.path`), or built with a computed file name, which loads the whole file into memory. Stream it with `fs.stream`. Ported from mpsuesser/enfect's `stream-large-files` pattern (MIT). |
| [`throw-in-effect-gen`](src/effect/rules/throw-in-effect-gen.ts) | `throw` whose nearest enclosing function is the generator of `Effect.gen`, `Effect.fn`, or `Effect.fnUntraced`, which becomes a defect instead of a typed failure. Throws in nested helpers, callbacks, and `try` blocks with a `catch` are not reported. Off for test files. Ported from mpsuesser/enfect's `throw-in-effect-gen` (MIT). |

### XState (`anti-slop-xstate`, error)

Enable these only in repositories that depend on `xstate` directly.

| Rule | What it checks |
| --- | --- |
| [`no-direct-xstate-create-machine`](src/xstate/rules/no-direct-xstate-create-machine.ts) | `createMachine(...)` instead of `setup({ ... }).createMachine(...)`. |
| [`no-direct-xstate-use-selector`](src/xstate/rules/no-direct-xstate-use-selector.ts) | `useSelector` from `@xstate/react`. Read state from the snapshot of the component's actor hook. |
| [`no-multiple-xstate-hooks`](src/xstate/rules/no-multiple-xstate-hooks.ts) | More than one `useMachine`, `useActor`, or `useActorRef` call in one component. |
| [`no-single-use-xstate-actions`](src/xstate/rules/no-single-use-xstate-actions.ts) | A `setup({ actions })` entry the machine references once. |
| [`no-single-use-xstate-guards`](src/xstate/rules/no-single-use-xstate-guards.ts) | A `setup({ guards })` entry the machine references once. |
| [`require-xstate-event-satisfies`](src/xstate/rules/require-xstate-event-satisfies.ts) | `send({ type: ... })` without `satisfies <Event>` in files that import XState. |

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
pnpm check       # oxlint with the tsrs typecheck, every RuleTester suite, and the skill-asset drift check
pnpm integrity   # fails if this branch weakens a check compared with its merge base with main
```

## Integrity

`node tools/oxlint/anti-slop/integrity/run.ts` (`pnpm integrity` here) compares the working tree, untracked files included, with the merge base of `HEAD` and the default branch (`--base <ref>` or `ANTI_SLOP_BASE` picks another), and fails when the change weakens the checks instead of fixing the code. It is deterministic and uses no network. It runs two analyses:

- `ai-guard integrity --enforce` from `eslint-plugin-ai-guard`: skipped, focused, or deleted tests, new eslint and TypeScript suppressions, downgraded ESLint, TypeScript, and coverage settings, weakened `package.json` scripts, removed CI steps, and Git hook bypasses. High-confidence findings fail; advisory findings only print. It needs `@typescript-eslint/parser` to read TypeScript.
- anti-slop's checks for what ai-guard does not read: an `oxlint-disable` or `eslint-disable` comment added without a ` -- reason`, and changes to `.oxlintrc.json` or `oxlint.config.ts` that lower a rule's severity, turn a rule off (including in an override), remove a rule, add an `ignorePatterns` entry, or remove a `jsPlugins` entry. Config files are read as text, never executed, so entries computed at runtime are not compared.

```text
anti-slop integrity: compared with origin/main (3944fc34ea79)
  3 finding(s):
  src/session.ts:41  suppression-without-reason
      Added `// oxlint-disable-next-line anti-slop/no-object-parameters` without a reason. Fix the finding, or say why the rule does not apply after ` -- `.
  oxlint.config.ts:52  rule-weakened
      Turned off `landmines/no-fixed-sleep` (was error).
  oxlint.config.ts:9  ignore-pattern-added
      Added ignore pattern `src/legacy/**`; oxlint no longer checks matching files.
```

It exits 0 when nothing is weakened, 1 when something is, and 2 when the comparison cannot run. Run it in the pre-push hook and CI ([docs/modes.md](docs/modes.md)).

`src/` is the canonical source. After you change it or move the submodule pin, run `pnpm sync:skill-assets` so the copies bundled in `skills/install-anti-slop/assets/` stay identical.

## License

MIT. `src/vendor/eslint-stylistic/` is vendored from [ESLint Stylistic](src/vendor/eslint-stylistic/UPSTREAM.md) under its MIT license. The `landmines` testing rules are the MIT-licensed [`@interfere/landmines`](https://github.com/interfere-inc/landmines) npm package, the `effect` runtime rules are the MIT-licensed [`oxlint-plugin-effect`](https://github.com/cevr/effect-oxlint) npm package, the `enfect` rules are the MIT-licensed [`@enfect/oxlint`](https://github.com/mpsuesser/enfect) npm package, and the `ai-guard` rules and `ai-guard integrity` are the MIT-licensed [`eslint-plugin-ai-guard`](https://github.com/ai-guard-dev/eslint-plugin-ai-guard) npm package; all four are used as dependencies. [`src/effect/rules/no-unbounded-retry.ts`](src/effect/rules/no-unbounded-retry.ts) is ported from cevr/effect-oxlint's `noUnboundedRetry` under its MIT license, [`src/effect/rules/throw-in-effect-gen.ts`](src/effect/rules/throw-in-effect-gen.ts) from mpsuesser/enfect's `throw-in-effect-gen` and [`src/effect/rules/stream-large-files.ts`](src/effect/rules/stream-large-files.ts) from enfect's `stream-large-files` pattern under its MIT license, and [`src/rules/no-dev-env-branch.ts`](src/rules/no-dev-env-branch.ts) from eslint-plugin-ai-guard's `no-test-env-branch` under its MIT license.
