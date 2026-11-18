# Diff rules

Diff rules judge a whole change set: smells that span several files or only show up against git
history, which a rule looking at one function or one file cannot see. A diff rule is a yes/no
question about the change. Yes means the change violates the rule.

## Three kinds of checks

| Kind | Looks at | Answered by | Runs in |
| --- | --- | --- | --- |
| AST rules (`anti-slop/*`, `anti-slop-effect/*`) | One syntax node at a time | Deterministic code in Oxlint | Editor, pre-commit, pre-push, CI |
| Jev rules (`anti-slop-effect-jev/*`, `anti-slop-martinfowler-jev/*`, see [jev.md](jev.md)) | One function, call, or file | A decision model or LLM judge, one request per file per plugin | Pre-push and CI on changed lines; `modes/lint.ts full` on everything |
| Diff rules (`diff-rules/run.ts`, this page) | The whole change: every touched file, the commits, and their history | A decision model, a chat model, or a CLI agent | CI on pull requests, optionally a pre-push hook |

Use an AST rule whenever the pattern is syntactic, because it is free, exact, and instant. Use a
Jev rule when the judgment needs to read code but fits inside one file. Use a diff rule only when
the evidence is spread across files or commits: the same small edit in six modules, a module that
keeps changing for unrelated reasons, or a branch that does more than it says.

## Default rules

The defaults live in `diff-rules/rules.ts`. All are `warn`. The first three smells are from Martin
Fowler, *Refactoring*, 2nd ed., chapter 3 ("Bad Smells in Code").

| Id | Fires when | Suggests |
| --- | --- | --- |
| `shotgun-surgery` | One logical change makes small, similar edits across three or more modules, and the next change of the same kind would need the same edits again | Move Function, Move Field, Combine Functions into Class, Inline Function |
| `divergent-change` | One module is edited for several unrelated reasons, in this diff or in its recent commit subjects | Split Phase, Move Function, Extract Class |
| `duplicated-code` | Added code repeats logic that appears elsewhere in the added or context lines | Extract Function, Slide Statements, Pull Up Method |
| `scope-creep` | The diff contains substantial work unrelated to its stated purpose | Split the unrelated work into its own change |

`scope-creep` is a review-process smell rather than one of Fowler's. The stated purpose is
`--purpose`, `ANTI_SLOP_DIFF_RULES_PURPOSE`, or `purpose` in the config, and otherwise the branch
name and commit subjects. Passing the pull request title as `--purpose` in CI gives the best
signal.

## What is sent

`run.ts` builds the change set with git and sends it as text:

- **Change set.** By default, everything since the merge-base of `HEAD` with
  `origin/HEAD`, falling back to `origin/main`, `origin/master`, `main`, then `master` (the same
  default base as the [rule modes](./modes.md)), plus staged, unstaged, and untracked changes.
  `--base <ref>`, or `ANTI_SLOP_BASE`, picks another base. `--committed` judges only the
  commits since the base, which suits a pre-push hook. `--staged` judges the index, which suits a
  pre-commit hook. `--working` judges uncommitted changes against `HEAD`. Before the first commit
  everything staged or untracked is new. When no base branch exists, uncommitted changes are judged
  and a note says so.
- **Excludes.** Lockfiles, `node_modules`, `vendor`, `third_party`, `dist`, `build`, `out`,
  `.next`, `coverage`, `generated` and `__generated__` directories, `*.generated.*`, minified files,
  source maps, and snapshots are left out, as are binary files and untracked files over 1 MiB. Add
  git glob pathspecs with `exclude`, or set `defaultExcludes: false` to start from nothing.
- **Summary.** Purpose, branch, base, commit subjects, every changed file with its status and
  `+added -deleted` counts, the last `historyCommits` subjects for each modified file, and how often
  pairs of touched files changed together in the last `coChangeCommits` commits. History is read at
  the base commit, so the branch's own commits count as the change, not as history. Commits that
  touch more than 50 files are ignored for co-change counts.
- **Chunks.** Hunks are packed into chunks of at most `maxChunkChars` (default 60,000) in path
  order, so a directory's files tend to share a chunk. A file larger than the budget is truncated.
  Every chunk repeats the full summary, so cross-file rules such as `shotgun-surgery` still see the
  whole change. A rule's result is its strongest answer across chunks.

Diff text goes to the backend you configure. Do not enable diff rules for code that must not leave
the machine unless the backend runs locally.

## Backends

All backends answer every enabled rule in one request per chunk. The `decision-model` and
`llm-judge` backends call models through the [Vercel AI SDK](https://ai-sdk.dev); the `command`
backend runs a CLI.

### Dependencies

`run.ts` and the `command` backend need only Node. The AI SDK backends load their packages from the
consumer's `node_modules` when they run, so install only what the backend you use needs (versions
this repository tests with):

| Backend and target | Install |
| --- | --- |
| `decision-model`, TypeSafe directly or through Factory | `ai@7.0.173 zod@4.6.7 @ai-sdk/typesafe-ai@3.0.40` |
| `llm-judge` through Factory | `ai@7.0.173 zod@4.6.7 @ai-sdk/anthropic@4.0.105` |
| `decision-model` or `llm-judge` through AI Gateway | `ai@7.0.173 zod@4.6.7` (the gateway provider ships with `ai`) |
| `llm-judge`, an OpenAI-compatible server | `ai@7.0.173 zod@4.6.7 @ai-sdk/openai-compatible@3.0.92` |
| `command` | Nothing |

```sh
npm install --save-dev ai@7.0.173 zod@4.6.7 @ai-sdk/typesafe-ai@3.0.40 @ai-sdk/openai-compatible@3.0.92 @ai-sdk/anthropic@4.0.105
```

`zod` is a peer dependency of `ai`; npm 7+ and pnpm install it automatically, but listing it keeps
the version explicit. When a package is missing, the backend fails like any other backend error
(one warning, exit 0 unless `--fail` or `ci: "fail"`), naming the packages to install, for example
`the decision-model backend needs ai zod @ai-sdk/typesafe-ai; install them with ...`. Type
stripping erases the `import type` from `ai`, so the command backend runs without the AI SDK
installed; a typecheck that includes the vendored folder does need it.

### `decision-model` (TypeSafe Jev)

```sh
export TYPESAFE_API_KEY="..."           # or TYPESAFE_AI_API_KEY, the AI SDK provider's name
# Optional:
export TYPESAFE_AI_BASE_URL="https://api.typesafe.ai/v1"   # or the legacy TYPESAFE_BASE_URL="https://api.typesafe.ai"
export TYPESAFE_DEFAULT_MODEL="jev-latest"
```

The runner calls `experimental_decide` from `ai` with `createTypeSafeAi({ apiKey, baseURL })
.decisionModel(model)` from `@ai-sdk/typesafe-ai`. Every rule is a `boolean` question
(`{ type: "boolean", instructions: <rule question> }`) against the change set as `state`, and the
provider sends one `POST {baseURL}/systemone` with the questions as TypeSafe `noul` questions.
`TYPESAFE_AI_BASE_URL` includes `/v1`; a legacy `TYPESAFE_BASE_URL` host gets `/v1` appended. The
answer's `probability` is the probability of yes, and `result.response.modelId` is the version that
answered (the requested id when TypeSafe does not report one), which the report prints. The
decision model gives a probability only, without evidence or file lists.

Without a TypeSafe key, `AI_GATEWAY_API_KEY` (or a Vercel deployment's `VERCEL_OIDC_TOKEN`) sends
the same questions through AI Gateway (`POST {gateway}/decision-model`) with the model
`typesafe-ai/jev`. A `--model` or config `model` containing `/` is used as the gateway id; a bare
id such as `jev-1.13.0` becomes `typesafe-ai/jev-1.13.0`. `AI_GATEWAY_BASE_URL` overrides the
gateway URL. A TypeSafe key wins when both are set.

#### Through Factory

```sh
export FACTORY_API_KEY="..."
export FACTORY_API_BASE_URL="https://api.factory.ai"   # optional, for example https://dev.api.factory.ai
```

Without a TypeSafe key, `FACTORY_API_KEY` sends the same TypeSafe request to Factory's
TypeSafe-compatible route, `POST {FACTORY_API_BASE_URL}/api/llm/decision/v1/systemone`, billed to
the key's Factory organization. It wins over AI Gateway. Factory serves only aliases such as
`jev-latest` and `jev-preview`, so a pinned model is refused before any request, and Factory ignores
`longContext`. The organization needs the `decision_models` feature; without it every request is a
`403 Decision models are not enabled for your organization`.

Limits: Jev accepts 64k tokens per request (state plus all questions) and 32k per question by
default. The default `maxChunkChars` of 60,000 stays well inside both. Set `longContext: true` in the
config to send TypeSafe's long-context option (`providerOptions.typesafe.longContext`, header
`TypeSafe-Danger-Zone-Long-Context: true`), raising both limits to 262k tokens; TypeSafe describes
it as slower and less accurate, so raise `maxChunkChars` with it only when needed.

### `llm-judge` (chat model with structured output)

```sh
# Factory: an Anthropic model through Factory's inference proxy, billed to the key's organization.
export FACTORY_API_KEY="..."
export LLM_JUDGE_MODEL="claude-sonnet-4-5-20250929"
export FACTORY_CLIENT_VERSION="0.233.0"        # optional: the Droid CLI version sent as X-Client-Version

# AI Gateway: any provider/model id from the gateway catalog.
export AI_GATEWAY_API_KEY="..."
export LLM_JUDGE_MODEL="openai/gpt-5-mini"

# Or an OpenAI-compatible server (OpenAI, a proxy, vLLM, Ollama, LM Studio, ...).
export LLM_JUDGE_BASE_URL="https://api.openai.com/v1"
export LLM_JUDGE_MODEL="gpt-5-mini"
export LLM_JUDGE_API_KEY="..."                  # omit for local servers
export LLM_JUDGE_STRUCTURED_OUTPUTS="false"     # optional: for servers without json_schema support
```

The runner calls `generateText` from `ai` with `output: Output.object({ schema, name: "diff_rules" })`
(the AI SDK 7 replacement for the deprecated `generateObject`), `temperature: 0`, and up to two
retries. With `LLM_JUDGE_BASE_URL` set, the model is `createOpenAICompatible({ baseURL, apiKey,
supportsStructuredOutputs }).chatModel(model)` from `@ai-sdk/openai-compatible`, which posts to
`{LLM_JUDGE_BASE_URL}/chat/completions` with `response_format: { type: "json_schema", json_schema:
{ name: "diff_rules", strict: true, schema } }`, or `{ type: "json_object" }` when
`LLM_JUDGE_STRUCTURED_OUTPUTS` is `false` (the AI SDK then logs that the schema is not sent).
With `FACTORY_API_KEY` and no `LLM_JUDGE_BASE_URL`, the model is `createAnthropic({ baseURL:
"{FACTORY_API_BASE_URL}/api/llm/a/v1" })` from `@ai-sdk/anthropic`, which posts to
`/api/llm/a/v1/messages` with the key as a bearer token and `X-Client-Version`. Factory's proxy
serves only requests whose system prompt starts with `You are Droid, an AI software engineering
agent built by Factory.`, so that sentence is prepended to the judge's system prompt, and it rejects
clients older than its minimum Droid CLI version, so raise `FACTORY_CLIENT_VERSION` if it answers
`too old to use this endpoint`. Otherwise the model id goes to AI Gateway. Every path asks for exactly:

```json
{ "rules": [{ "id": "shotgun-surgery", "violation": true, "confidence": 0.9, "evidence": "...", "files": ["src/a.ts"] }] }
```

The schema requires every field (strict mode); the runner then checks that every rule is answered
with a boolean `violation` and a `confidence` from 0 to 1. A reply that is not JSON, or misses a
rule, is an error. The probability of yes is `confidence` when `violation` is true and
`1 - confidence` otherwise, compared with the cutoff. A direct `@ai-sdk/openai` provider is not
wired in: AI Gateway covers those models with one key, and OpenAI's API works through
`LLM_JUDGE_BASE_URL`. `@ai-sdk/anthropic` is used only for Factory's proxy.

### Retries and timeouts

Both AI SDK backends pass `maxRetries: 2`: the AI SDK retries 408, 409, 429, 5xx, and connection
errors with exponential backoff from 2 seconds, honoring `retry-after-ms` and `Retry-After` up to 60
seconds. `timeoutMs` aborts the whole call, retries included. Errors are reported as
`http <status>: <provider message>`, with `(after 3 attempts)` when retries ran out.

### `command` (any CLI judge)

```sh
node tools/oxlint/anti-slop/diff-rules/run.ts --backend command --command 'claude -p'
node tools/oxlint/anti-slop/diff-rules/run.ts --backend command --command 'droid exec'
```

The command runs through the shell with the prompt on stdin and must print the same JSON object as
the LLM judge on stdout; prose or code fences around the object are tolerated. A
`{ "result": "<reply text>" }` wrapper, as printed by `claude -p --output-format json`, is
unwrapped. Set the command with `--command`, `ANTI_SLOP_DIFF_RULES_COMMAND`, or `command` in the
config. A non-zero exit is a backend error. Use a read-only mode of the agent: the prompt contains
the diff, and the judge needs no tools.

### Choosing a backend

`--backend` wins, then `backend` in the config, then the first backend with credentials: a TypeSafe
key (`decision-model`), then `LLM_JUDGE_BASE_URL` (`llm-judge`), then `FACTORY_API_KEY` or an AI
Gateway credential (`llm-judge` when `LLM_JUDGE_MODEL` is set, otherwise `decision-model`; Factory
wins over the gateway), then a configured command.
The model is `--model`, then `TYPESAFE_DEFAULT_MODEL` or `LLM_JUDGE_MODEL`, then `model` in the
config, then `jev-latest` (TypeSafe or Factory) or `typesafe-ai/jev` (gateway) for the decision model.

### Missing credentials and backend errors

As with Jev, a missing key or package, or an unreachable, failing, or malformed backend prints one
warning and exits 0, so a laptop without credentials is not blocked. Pass `--fail`, or set
`ci: "fail"` in the config and run with `CI` set, to exit 2 instead. Failed answers are never
cached.
## Configuration

`run.ts` loads `--config <path>`, or the first of `anti-slop-diff-rules.config.ts`, `.mjs`, `.js`,
or `.json` in the current directory. Every field is optional.

```ts
// anti-slop-diff-rules.config.ts
export default {
  backend: "decision-model",
  ci: "fail",
  model: "jev-1.13.0",
  exclude: ["**/*.pb.go", "docs/api/**"],
  disable: ["duplicated-code"],
  rules: [
    // Same id: override fields of the default.
    { id: "shotgun-surgery", cutoff: 0.85, severity: "error" },
    // New id: every field is required.
    {
      id: "migration-without-backfill",
      question:
        "Does this change add a database column that new code reads as non-null without a migration or backfill for existing rows?",
      message: "Possibly a missing backfill: existing rows will not have the new column. Consider adding a backfill step.",
      cutoff: 0.8,
      severity: "error",
    },
  ],
  maxChunkChars: 60000,
  historyCommits: 5,
  coChangeCommits: 200,
  timeoutMs: 120000,
  concurrency: 4,
  longContext: false, // decision model only: Jev's 262k-token mode
};
```

## Output and exit status

```text
diff-rules: judged 7 changed file(s) in 1 request(s) against origin/HEAD (5360c12) with decision-model (jev-1.13.0); 0 cached answer(s).

warn  shotgun-surgery  0.88 >= 0.75
  Possibly Shotgun Surgery: one logical change spreads small, similar edits across many modules, ...
  evidence: ...
  files: src/api/order.ts, src/db/order.ts

diff-rules: 1 warning(s), 0 error(s).
```

`evidence` and `files` appear for the LLM and command backends. `--json` prints the full report,
including rules that did not fire, the base, the answering models, and errors.

| Exit | Meaning |
| --- | --- |
| 0 | Nothing failing: no rule fired, only `warn` rules fired, the diff was empty, or the backend was skipped |
| 1 | An `error` rule fired, or any rule fired under `--fail` |
| 2 | Usage, git, or config error; or the backend was unavailable or failed under `--fail` or `ci: "fail"` in CI |

## Consumer scripts

The vendored entry point is `tools/oxlint/anti-slop/diff-rules/run.ts`. It uses erasable type
syntax, and the AI SDK only inside the backends that need it (see [Dependencies](#dependencies)), so `node` runs it directly with built-in type stripping (Node 22.18 or
later; tested on Node 24). Node refuses to strip types under `node_modules`, so keep the vendored
copy outside it.

```json
{
  "scripts": {
    "lint": "oxlint",
    "lint:push": "node tools/oxlint/anti-slop/modes/lint.ts push",
    "lint:diff": "node tools/oxlint/anti-slop/diff-rules/run.ts"
  }
}
```

The recommended split ([docs/modes.md](./modes.md#hooks)) runs the free rules before committing,
adds the Jev rules on changed lines before pushing, and adds the diff rules in CI. To also judge the
diff before pushing, add `node tools/oxlint/anti-slop/diff-rules/run.ts --committed` to the pre-push
hook: `--committed` judges what is being pushed, without uncommitted edits. Only `error` rules
block; add `--fail` to block on warnings too. A re-run on an unchanged branch is answered from the
cache.

### CI on pull requests

```sh
node tools/oxlint/anti-slop/diff-rules/run.ts --base "origin/$GITHUB_BASE_REF" --committed \
  --purpose "$PR_TITLE"
```

Fetch enough history for the merge-base and the co-change window (`fetch-depth: 0`, or at least a
few hundred commits), and set the backend's key as a secret with `ci: "fail"` in the config.

## Cost

- One request per chunk, answering every enabled rule. A typical branch is one chunk, so one
  request per run; a 300 KB diff at the default budget is about five.
- Every chunk repeats the summary, so very large diffs cost more than their hunks alone. Raise
  `maxChunkChars` if your backend accepts long inputs, or tighten `exclude`.
- Answers are cached per rule under `node_modules/.cache/anti-slop-diff-rules`, keyed by the
  backend and endpoint or command, the requested model, the rule question, and a hash of the exact
  chunk text. Re-running on the same diff is free. Changing a rule's `message`, `severity`, or
  `cutoff` keeps the cache; changing its question, the model, or any byte of the diff, summary, or
  history does not. Delete the directory to force fresh answers.
- With `jev-latest`, cached answers stay valid after a model upgrade until the diff changes. Pin the
  versioned model the report prints to make upgrades explicit.

## Tuning cutoffs

- Start every rule at `warn`, run `run.ts` on a handful of recent branches with `--json`, and
  look at each rule's `probability` next to whether a reviewer would agree.
- Raise a rule's cutoff when it fires on changes you would accept; lower it when it misses known
  cases. Promote a rule to `error` only once its false positives are rare, since `error` rules block
  hooks and CI.
- Cutoffs are not portable between backends: a decision-model probability and an LLM's
  self-reported confidence are calibrated differently. Tune per backend and model, and pin both.
- Re-tuning is cheap because cutoff edits are answered from the cache.
