# Jev rules: LLM-judged Effect review

`src/jev/effect-rules.ts` is a preset of plain-English lint rules for
[`oxlint-plugin-jev`](https://github.com/K-Mistele/oxlint-plugin-jev), and `src/jev/plugin.ts` turns
it into an oxlint plugin, `anti-slop-effect-jev`, with one rule per question. Each rule asks
[TypeSafe Jev](https://typesafe.ai) (or an LLM judge) a yes/no question about a file, and oxlint
reports when the yes-probability reaches the rule's cutoff. The rules catch Effect design problems
that the AST rules in this repository cannot see, such as a service operation that only forwards to
a dependency or a recovery that discards an error without logging it. The questions encode the
review policy in [`skills/effect-program-design`](../skills/effect-program-design/SKILL.md).

Every match is a paid request, and answers are not deterministic. Run these rules on changed code
before pushing and in CI, never in the editor.

## The jev fork

anti-slop uses Kyle Mistele's fork of `oxlint-plugin-jev`, which adds `createJevPlugin` (one oxlint
rule per question, all of a plugin's rules sharing one request per file), per-rule `message`,
`changedOnly`, LLM-judge mode, and an AI SDK transport. The fork is not published to npm, so:

- This repository includes it as a git submodule at `vendor/oxlint-plugin-jev`, pinned to a commit
  on the fork's `main` (`741b19b`). To update it, check out a newer `main` commit in the submodule,
  then run `pnpm build:jev` and `pnpm sync:skill-assets`. `pnpm build:jev` installs the submodule's own dependencies
  with npm, builds it with `vp pack`, and reinstalls, and anti-slop depends on it as
  `"oxlint-plugin-jev": "file:vendor/oxlint-plugin-jev"`. Clone with `--recurse-submodules`, or run
  `git submodule update --init`, then `pnpm install && pnpm build:jev`.
- `pnpm sync:skill-assets` copies the built package (`dist/`, `LICENSE`, `README.md`, a
  `package.json` without build-only fields, and an `UPSTREAM.md` naming the fork commit) to
  `skills/install-anti-slop/assets/oxlint-plugin-jev/`, and `pnpm check:skill-assets` fails when it
  drifts from the submodule.
- Consumers vendor that built package next to anti-slop (the install script's `--jev` flag copies it
  to `tools/oxlint/oxlint-plugin-jev/`) and add it as a local package, so its dependencies (`ai`,
  `@ai-sdk/typesafe-ai`, `zod`, `synckit`) install normally and the plugin entries import the bare
  specifier `oxlint-plugin-jev`:

  ```json
  { "devDependencies": { "oxlint-plugin-jev": "file:./tools/oxlint/oxlint-plugin-jev" } }
  ```

The fork needs Node 22 or later. Its README documents every option.

## Rules

Each question lists its carve-outs first and ends with the yes/no question. "Yes" means "report".
Each id is configured as `anti-slop-effect-jev/<id>`.

### Source rules (`effectSourceJevRules`)

| Id | Reports | Source |
| --- | --- | --- |
| `single-use-abstraction` | A non-exported type, interface, schema fragment, spread-in shared-fields object, or helper that only regroups, renames, or forwards fields, where inlining it would be as clear. | Review on humanlayer/fold#2 of a new `StoredLogEntryEnvelope` spread into schemas: "why do we have a new type here? … why not just add the event id inline here?" |
| `error-as-value` | A failure returned as a success value: `{ ok: false }`, an `error` field, Either/Result/Exit, an Error instance, or null/`Option.none()` meaning "it failed". | `SKILL.md` creed 3: "Respect the error channel! Errors stay in the error channel and are not passed as values". `DEEP_MODULES.md`: avoid modules that "return `unknown`, `any`, raw rows, or errors as values". |
| `shallow-service` | A service operation that only calls one dependency method and returns its result, or whose inputs or outputs include a client, row, connection, or credential. | `SKILL.md` creed 1: "callers do not supply credentials, clients, rows, or other internals". `DEEP_MODULES.md`: "deleting a shallow pass-through merely removes indirection". |
| `swallow-without-capture` | A catch, `orElse`, or `ignore` that turns a failure into void or a fallback without logging or reporting it first. | `ERRORS_OBSERVABILITY.md`: "Best-effort work must log or report before swallowing." `RESOURCES_CONCURRENCY.md`: "Never silently `.ignore` important work." |
| `unbounded-retry` | A retry with no attempt or elapsed-time bound, or one that retries every error. | `SCHEDULING_WORKERS.md`: "Never retry all errors merely because they come from an upstream." `RESOURCES_CONCURRENCY.md`: "a maximum elapsed time or attempt count". |
| `network-call-in-transaction` | A transaction body that makes HTTP, SDK, or provider calls, sends messages, or sleeps or backs off. | `BOUNDARIES_PERSISTENCE.md`: "Do not keep a database transaction open across a network call." `SCHEDULING_WORKERS.md`: "do not hold a database transaction open during backoff or a network call". |
| `read-then-write-race` | A read of a row followed by a separate conditional write of that row with no guard, upsert, lock, or claim. | `BOUNDARIES_PERSISTENCE.md`: "Prefer a conditional update/upsert with an asserted affected-row result over read-then-write races." |
| `unbounded-fanout` | `Effect.forEach`, `Effect.all`, or `Stream.mapEffect` over a runtime-sized collection doing I/O with `"unbounded"` or length-derived concurrency. | `RESOURCES_CONCURRENCY.md`: "Use bounded concurrency for fan-out over runtime-sized collections". |
| `decode-after-status` | A success-schema or JSON decode before the status is checked, or a body read twice. | `HTTP_CLIENTS.md`: "Check/classify status before decoding a success schema." and "Do not consume a body twice." |
| `cache-in-method` | A cache or memo built on every call, or a hand-built TTL cache from a `Map` plus timestamps or in-flight promises. | `CACHING_BATCHING.md`: "A cache constructed in a public method is effectively no cache." and "Do not build a `Map` + timestamps + prune timer + in-flight promises when `Cache` fits." |

### Test rules (`effectTestJevRules`)

| Id | Reports | Source |
| --- | --- | --- |
| `test-cannot-fail` | A test that would still pass if the behavior in its title were broken: no assertions, assertions on values the test built, a mock echoing its configured return, type-only facts, or loop-only assertions over a possibly empty list. | `TESTING.md`: "Assert both sides of the contract". |

All source cutoffs are 0.7 except `single-use-abstraction`, `error-as-value`, and `shallow-service`,
which use 0.75 because they are the most judgment-dependent. Every location cutoff is 0.7.

### Why every rule targets the whole file

The plugin sends one match per rule for every node of the rule's target type, and
`maxMatchesPerFile` (default 25) caps matches across all of a plugin's rules in source order. An
Effect module has hundreds of call expressions and dozens of arrow callbacks, so with several
`"call"` or `"function"` rules the cap is reached within the first few lines and the rest of the file
is never checked. A `"file"` rule is exactly one match per file, and its `location` question still
moves the diagnostic to the offending line. The file is sent once per request however many file
rules read it, with one question (plus a location question) per enabled rule. `effectJevOptions`
raises `maxSnippetChars` to 24000 and `timeoutMs` to 60000 to fit typical modules; a longer file is
truncated and reported on its first line.

## Setup

Get an API key from <https://console.typesafe.ai>, or use an LLM judge (see [Judge mode](#judge-mode)).

| Variable | Meaning |
| --- | --- |
| `TYPESAFE_API_KEY` | TypeSafe API key (`TYPESAFE_AI_API_KEY` works too). |
| `AI_GATEWAY_API_KEY` | Needed instead when `model` is an AI Gateway id such as `typesafe-ai/jev`, or for an LLM judge without a `provider` module. |
| `TYPESAFE_BASE_URL` | Another TypeSafe host, such as a mock, without `/v1`. |
| `JEV_CHANGED_ONLY` | `1` or `0`; overrides `changedOnly`. `lint-changed.ts` sets it (see below). |
| `JEV_CHANGED_BASE` | The git ref `changedOnly` diffs against (default `HEAD`), such as `origin/main` in CI. |
| `CI` | With `ci: "fail"` (set in both plugin entries), a run that cannot reach Jev fails instead of skipping. |

Register the plugin entries in the base config, but enable none of their rules there, so the editor
and plain `oxlint` runs never call Jev:

```ts
// oxlint.config.ts
export default defineConfig({
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "anti-slop-effect-jev", specifier: "./tools/oxlint/anti-slop/jev/plugin.ts" },
  ],
  rules: {
    // ...normal rules, no anti-slop-effect-jev rules
  },
});
```

Enable the questions in an overlay config. Each question is its own rule, so its severity, or `"off"`,
is set here; an `"off"` rule is not sent at all. The recommended setup runs every source question at
`"error"` and, for test files, turns the source questions off and `test-cannot-fail` on. Adjust the
globs to your layout.

```ts
// oxlint.jev.config.ts
import type { OxlintConfig } from "oxlint";

import baseConfig from "./oxlint.config.ts";
import {
  effectJevPluginName,
  effectSourceJevRules,
  effectTestJevRules,
} from "./tools/oxlint/anti-slop/jev/effect-rules.ts";

type Severity = "error" | "warn" | "off";

const severities = (plugin: string, rules: ReadonlyArray<{ id: string }>, severity: Severity) =>
  Object.fromEntries(rules.map((rule) => [`${plugin}/${rule.id}`, severity]));

// Widened so `base.rules` and `base.overrides` typecheck even when the base sets neither.
const base: OxlintConfig = baseConfig;
const testFiles = ["**/*.test.*", "**/*.spec.*", "test/**", "tests/**"];

// Spread the base rather than `extends: [base]`: oxlint 1.86 rejects relative jsPlugins
// specifiers that arrive through `extends` in a TypeScript config.
// An annotation rather than `defineConfig`: TypeScript 7 reports this spread as "a union type that
// is too complex to represent" when inferred through `defineConfig`.
const config: OxlintConfig = {
  ...base,
  rules: {
    ...base.rules,
    ...severities(effectJevPluginName, effectSourceJevRules, "error"),
    // Per-question severity, for example:
    // "anti-slop-effect-jev/read-then-write-race": "warn",
    // "anti-slop-effect-jev/cache-in-method": "off",
  },
  overrides: [
    ...(base.overrides ?? []),
    {
      files: testFiles,
      rules: {
        ...severities(effectJevPluginName, effectSourceJevRules, "off"),
        ...severities(effectJevPluginName, effectTestJevRules, "error"),
      },
    },
  ],
};

export default config;
```

A source file then sends the 10 source questions and their 10 location questions in one request,
and a test file sends only `test-cannot-fail` and its location question.

`plugin.ts` sets `ci: "fail"` and `effectJevOptions`. To change plugin-level settings (`model`,
`judge`, `changedBase`, `longContext`, limits), edit the vendored `plugin.ts`; the rules take no
options in the oxlint config.

### Judge mode

To answer with any AI SDK chat model instead of Jev, add `judge` in `plugin.ts`:

```ts
export default createJevPlugin({
  ...effectJevOptions,
  name: effectJevPluginName,
  ci: "fail",
  judge: { model: "openai/gpt-5-mini" }, // an AI Gateway id; needs AI_GATEWAY_API_KEY
  rules: [...effectSourceJevRules, ...effectTestJevRules],
});
```

Or `judge: { model: "gpt-5-mini", provider: "./judge-provider.mjs" }`, where the module (relative to
the working directory) default-exports an AI SDK provider, for example
`createOpenAI({ apiKey: process.env.OPENAI_API_KEY })` from `@ai-sdk/openai`, installed separately.
A judge's confidence is self-reported, so retune cutoffs, and file rules report on the first line
because a judge does not answer location questions.

### Two plugins, or one

anti-slop ships two jev plugins, `anti-slop-effect-jev` and `anti-slop-martinfowler-jev`
([docs/martinfowler.md](./martinfowler.md)). Each plugin sends its own request per file, so
enabling both means up to two requests per file, each with its own `maxMatchesPerFile` budget.
Answers are cached per question and snippet, so a re-run only re-asks what changed. For one request
per file, build a single plugin from both presets (the ids do not collide) and register it instead
of the two entries:

```ts
// tools/oxlint/jev-plugin.ts
import { createJevPlugin } from "oxlint-plugin-jev";

import { effectJevOptions, effectSourceJevRules, effectTestJevRules } from "./anti-slop/jev/effect-rules.ts";
import { martinFowlerJevOptions, martinFowlerJevRules } from "./anti-slop/martinfowler/jev-rules.ts";

export default createJevPlugin({
  ...effectJevOptions,
  maxMatchesPerFile: martinFowlerJevOptions.maxMatchesPerFile,
  name: "jev",
  ci: "fail",
  rules: [...effectSourceJevRules, ...effectTestJevRules, ...martinFowlerJevRules],
});
```

Rules are then `jev/<id>` (for example `"jev/error-as-value": "error"`,
`"jev/feature-envy": "warn"`). The same approach builds a plugin from a subset of the presets or
from your own questions; the preset modules export plain arrays of the fork's `JevRule` type.

## Lint only what changed

Two filters combine:

- `tools/oxlint/anti-slop/jev/lint-changed.ts` passes oxlint only the JS and TS files changed in the
  working tree, so unchanged files are not even parsed. It collects staged, unstaged, and
  untracked-but-not-ignored files, drops deleted files, and keeps only existing files with a
  lintable extension.
- It also sets `JEV_CHANGED_ONLY=1` (unless already set), so within those files the plugin only asks
  about functions and calls that overlap changed lines. File rules still send a changed file whole,
  since any changed line counts. With `--all` it sets `JEV_CHANGED_ONLY=0` and lints everything.

`changedOnly` alone would already skip unchanged files' questions, but oxlint would still parse and
run every other rule on every file, so the runner stays for fast local runs.

```text
node lint-changed.ts [--all] [--ext=.ts,.tsx] [--oxlint=<bin>] [oxlint args...]
```

- `--all` lints the whole project by running oxlint with no file arguments, with `JEV_CHANGED_ONLY=0`.
- `--ext` replaces the default extensions (`.js .mjs .cjs .jsx .ts .mts .cts .tsx`).
- `--oxlint` names another oxlint binary; the default is `oxlint` on `PATH`, which package-manager
  scripts provide.
- Every other argument goes to oxlint unchanged, such as `-c oxlint.jev.config.ts` or
  `--format=github`.

Before the first commit, when there is no `HEAD`, it uses `git ls-files --cached` for the staged
set. Paths are relative to and limited to the current directory, so running it from a workspace
package lints only that package's changes. When nothing lintable changed it prints
`lint-changed: no changed lintable files.` and exits 0. Otherwise it exits with oxlint's status, or
2 when git or oxlint cannot run. It uses only Node built-ins and erasable type syntax, so `node`
runs it directly with built-in type stripping (Node 22.18 or later).

### Recommended scripts

```json
{
  "scripts": {
    "lint": "oxlint",
    "lint:jev": "node tools/oxlint/anti-slop/jev/lint-changed.ts -c oxlint.jev.config.ts",
    "lint:jev:full": "node tools/oxlint/anti-slop/jev/lint-changed.ts --all -c oxlint.jev.config.ts",
    "check:fast": "npm run lint:jev",
    "check:full": "npm run lint:jev:full"
  }
}
```

The overlay includes the base config, so one oxlint pass runs the normal rules and the jev rules
together. `check:fast` is the default before pushing: changed files, changed functions. `check:full`
asks about everything. When Jev is skipped (no key outside CI), the normal rules still run. `lint`
stays the jev-free command for the editor and quick runs. Add your typecheck and tests to both
`check` scripts.

## CI

- Set `TYPESAFE_API_KEY` (or `AI_GATEWAY_API_KEY`) as a secret. Without it, or when Jev times out or
  errors, the plugin warns and reports nothing, except under `CI` with `ci: "fail"`, which both
  plugin entries set, where the run fails.
- On pull requests, run `oxlint -c oxlint.jev.config.ts` with `JEV_CHANGED_ONLY=1` and
  `JEV_CHANGED_BASE=origin/main` (fetch the base first) to check everything the branch touched, or
  run `check:full` on a schedule.
- Keep `node_modules/.cache/oxlint-plugin-jev` between runs (for example with `actions/cache`).

## Tuning

- **Set severities per question.** Downgrade a noisy question to `"warn"` or turn it `"off"` in the
  overlay rather than editing the preset.
- **Pin the model.** Once the cutoffs suit your codebase, set `model` in `plugin.ts` to the versioned
  id shown in each diagnostic (for example `"jev-1.13.0"`).
- **Tune cutoffs per rule.** Every diagnostic prints the score and cutoff. Raise a rule's cutoff when
  it reports false positives, lower it when it misses known violations, and keep each change in the
  vendored `effect-rules.ts`. Changing a cutoff, id, message, or severity does not invalidate the
  answer cache; changing a question or the code does.
- **Edit questions, not code.** The question text is the rule. Add a carve-out to the leading
  "Ignore ..." sentence when a legitimate pattern keeps firing, and keep one concern per rule.
- `src/jev/effect-rules.test.ts` checks that ids are unique kebab-case, targets are valid, cutoffs are
  in (0, 1], location cutoffs are in (0.5, 1], and questions end in "?". `src/jev/plugin.test.ts`
  loads both plugin entries and checks that every preset id is a rule named `<plugin>/<id>` that
  oxlint accepts.
