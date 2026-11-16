# Jev rules: LLM-judged Effect review

`src/jev/effect-rules.ts` is a preset of plain-English lint rules for
[`oxlint-plugin-jev`](https://github.com/wobsoriano/oxlint-plugin-jev). Each rule asks
[TypeSafe Jev](https://typesafe.ai) a yes/no question about a file, and oxlint reports an error when
the yes-probability reaches the rule's cutoff. The rules catch Effect design problems that the
AST rules in this repository cannot see, such as a service operation that only forwards to a
dependency or a recovery that discards an error without logging it. The questions encode the review
policy in [`skills/effect-program-design`](../skills/effect-program-design/SKILL.md).

Every match is a paid request, and answers are not deterministic. Run these rules on changed files
before pushing and in CI, never in the editor.

## Rules

Each question lists its carve-outs first and ends with the yes/no question. "Yes" means "report".

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
`maxMatchesPerFile` (default 25) caps matches across all rules in source order. An Effect module has
hundreds of call expressions and dozens of arrow callbacks, so with several `"call"` or `"function"`
rules the cap is reached within the first few lines and the rest of the file is never checked. A
`"file"` rule is exactly one match per file, and its `location` question still moves the diagnostic
to the offending line. The trade-off is request size: each rule resends the whole file, so a request
is roughly the rule count times the file size. `effectJevOptions` raises `maxSnippetChars` to 24000
and `timeoutMs` to 60000 to fit typical modules; a longer file is truncated and reported on its
first line.

## Setup

Install the plugin next to your existing `oxlint`, and get an API key from
<https://console.typesafe.ai>:

```sh
npm i -D oxlint-plugin-jev
export TYPESAFE_API_KEY="..."
```

Keep your normal `oxlint.config.ts` free of `jev/ask`, so the editor and plain `oxlint` runs never
call Jev. Register the plugin there so the overlay inherits it:

```ts
// oxlint.config.ts
export default defineConfig({
  jsPlugins: [
    "oxlint-plugin-jev",
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  rules: {
    // ...normal rules, no jev/ask
  },
});
```

Put the Jev rules in an overlay config that extends the base. Overrides apply the source rules to
source files and replace them with the test rules on test files. Adjust the globs to your layout.

```ts
// oxlint.jev.config.ts
import { defineConfig } from "oxlint";

import base from "./oxlint.config.ts";
import {
  effectJevOptions,
  effectSourceJevRules,
  effectTestJevRules,
} from "./tools/oxlint/anti-slop/jev/effect-rules.ts";

const testFiles = ["**/*.test.*", "**/*.spec.*", "test/**", "tests/**"];
const jevOptions = { ...effectJevOptions, ci: "fail", model: "jev-latest" } as const;

export default defineConfig({
  extends: [base],
  overrides: [
    {
      files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
      excludeFiles: testFiles,
      rules: { "jev/ask": ["error", { ...jevOptions, rules: [...effectSourceJevRules] }] },
    },
    {
      files: testFiles,
      rules: { "jev/ask": ["error", { ...jevOptions, rules: [...effectTestJevRules] }] },
    },
  ],
});
```

With `oxlint@1.86.0` and `oxlint-plugin-jev@0.1.3`, the plugin accepts these options, a source file
sends the 10 source rules with their 10 location questions, and a test file sends only
`test-cannot-fail` and its location question.

## Lint only what changed

`tools/oxlint/anti-slop/jev/lint-changed.ts` runs oxlint on the JS and TS files changed in the
working tree, so a local run pays for the files you touched rather than the whole repository. It
collects staged, unstaged, and untracked-but-not-ignored files, drops deleted files, and keeps only
existing files with a lintable extension:

```sh
git diff --name-only --relative --diff-filter=d HEAD
git diff --name-only --relative --diff-filter=d --cached
git ls-files --others --exclude-standard
```

Before the first commit, when there is no `HEAD`, it uses `git ls-files --cached` for the staged
set. Paths are relative to and limited to the current directory, so running it from a workspace
package lints only that package's changes.

```text
node lint-changed.ts [--all] [--ext=.ts,.tsx] [--oxlint=<bin>] [oxlint args...]
```

- `--all` lints the whole project by running oxlint with no file arguments.
- `--ext` replaces the default extensions (`.js .mjs .cjs .jsx .ts .mts .cts .tsx`).
- `--oxlint` names another oxlint binary; the default is `oxlint` on `PATH`, which package-manager
  scripts provide.
- Every other argument goes to oxlint unchanged, such as `-c oxlint.jev.config.ts` or
  `--format=github`.

When nothing lintable changed it prints `lint-changed: no changed lintable files.` and exits 0.
Otherwise it exits with oxlint's status, or 2 when git or oxlint cannot run, including outside a git
work tree without `--all`. The script uses only Node built-ins and erasable type syntax, so `node`
runs it directly with built-in type stripping (Node 22.18 or later), which oxlint also relies on to
load the vendored TypeScript plugin. It needs no dependencies or build step.

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

The overlay extends the base config, so one oxlint pass runs the normal rules and the Jev rules
together. `check:fast` is the default before pushing and lints only the changed files; `check:full`
lints everything. When Jev is skipped (no key outside CI), the normal rules still run. `lint` stays
the Jev-free command for the editor and quick runs. Add your typecheck and tests to both `check`
scripts.

## CI

- Set `TYPESAFE_API_KEY` as a secret. Without it, or when Jev times out or errors, the plugin warns
  and reports nothing.
- Set `ci: "fail"` (as in the overlay above) so a CI run that could not reach Jev fails instead of
  passing quietly. The option only takes effect when the `CI` environment variable is set.
- On pull requests, lint the files the branch changed against its base instead of the working tree,
  for example `git diff --name-only --diff-filter=d origin/main...HEAD` passed to
  `oxlint -c oxlint.jev.config.ts`, or run `lint:jev:full` on a schedule.

## Tuning

- **Pin the model.** Once the cutoffs suit your codebase, replace `"jev-latest"` with the versioned id
  shown in each diagnostic (for example `"jev-1.13.0"`), so a model upgrade cannot move your results
  without a config change.
- **Tune cutoffs per rule.** Every diagnostic prints the score and cutoff. Raise a rule's cutoff when
  it reports false positives, lower it when it misses known violations, and keep each change in the
  vendored `effect-rules.ts`. Changing a cutoff or id does not invalidate the answer cache under
  `node_modules/.cache/oxlint-plugin-jev`; changing a question or the file does.
- **Edit questions, not code.** The question text is the rule. Add a carve-out to the leading
  "Ignore ..." sentence when a legitimate pattern keeps firing, and keep one concern per rule.
- **Drop rules you do not need.** Request size grows with the number of rules, so filter the arrays
  (for example `effectSourceJevRules.filter((rule) => rule.id !== "read-then-write-race")`) in
  repositories without a database.
- `src/jev/effect-rules.test.ts` checks that ids are unique kebab-case, targets are valid, cutoffs are
  in (0, 1], location cutoffs are in (0.5, 1], and questions end in "?". Run it after editing rules.
