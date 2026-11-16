# Diff rules

Diff rules judge a whole change set: smells that span several files or only show up against git
history, which a rule looking at one function or one file cannot see. A diff rule is a yes/no
question about the change. Yes means the change violates the rule.

## Three kinds of checks

| Kind | Looks at | Answered by | Runs in |
| --- | --- | --- | --- |
| AST rules (`anti-slop/*`, `anti-slop-effect/*`) | One syntax node at a time | Deterministic code in Oxlint | Editor, `lint`, `check:fast`, `check:full`, CI |
| Jev rules (`jev/ask`, see [jev.md](jev.md)) | One function, call, or file | A decision model, per match | `check:fast` (changed files), `check:full` (all files) |
| Diff rules (`diff-rules/run.ts`, this page) | The whole change: every touched file, the commits, and their history | A decision model, a chat model, or a CLI agent | `check:full`, optionally a pre-push hook, CI on pull requests |

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

- **Change set.** By default (`check:full`), everything since the merge-base of `HEAD` with
  `origin/HEAD`, falling back to `origin/main`, `main`, `origin/master`, then `master`, plus staged,
  unstaged, and untracked changes. `--base <ref>` picks another base. `--committed` judges only the
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

All backends answer every enabled rule in one request per chunk.

### `decision-model` (TypeSafe Jev)

```sh
export TYPESAFE_API_KEY="..."
# Optional:
export TYPESAFE_BASE_URL="https://api.typesafe.ai"
export TYPESAFE_DEFAULT_MODEL="jev-latest"
```

The runner calls `POST {TYPESAFE_BASE_URL}/v1/systemone` with built-in `fetch`, in the same wire
format as `@typesafe-ai/sdk` 0.7.0's `client.systemOne`:

```json
{
  "state": "<change set text>",
  "questions": { "r0": { "type": "noul", "instructions": "<rule question>" } },
  "model": "jev-latest"
}
```

Headers are `Authorization: Bearer <key>`, `Accept: application/json`, and
`Content-Type: application/json`; bodies of 1 KiB or more are zstd-compressed with
`Content-Encoding: zstd`, as the SDK does. Like the SDK, it retries 408, 429, 5xx, and connection
errors twice, honoring `retry-after-ms` and `Retry-After`. The response's `answers.rN.noul` is the
probability of yes, and `model` is the version that answered, which the report prints. The
decision model gives a probability only, without evidence or file lists.

### `llm-judge` (OpenAI-compatible chat completions)

```sh
export LLM_JUDGE_BASE_URL="https://api.openai.com/v1"   # or any compatible server
export LLM_JUDGE_MODEL="gpt-5-mini"
export LLM_JUDGE_API_KEY="..."                           # omit for local servers
```

The runner posts to `{LLM_JUDGE_BASE_URL}/chat/completions` with `temperature: 0` and
`response_format: { "type": "json_object" }`, asking for exactly:

```json
{ "rules": [{ "id": "shotgun-surgery", "violation": true, "confidence": 0.9, "evidence": "...", "files": ["src/a.ts"] }] }
```

The reply must answer every rule with a boolean `violation` and a `confidence` from 0 to 1; prose or
code fences around the object are tolerated, anything else is an error. The probability of yes is
`confidence` when `violation` is true and `1 - confidence` otherwise, compared with the cutoff.

### `command` (any CLI judge)

```sh
node tools/oxlint/anti-slop/diff-rules/run.ts --backend command --command 'claude -p'
node tools/oxlint/anti-slop/diff-rules/run.ts --backend command --command 'droid exec'
```

The command runs through the shell with the prompt on stdin and must print the same JSON object as
the LLM judge on stdout. A `{ "result": "<reply text>" }` wrapper, as printed by
`claude -p --output-format json`, is unwrapped. Set the command with `--command`,
`ANTI_SLOP_DIFF_RULES_COMMAND`, or `command` in the config. A non-zero exit is a backend error.
Use a read-only mode of the agent: the prompt contains the diff, and the judge needs no tools.

### Choosing a backend

`--backend` wins, then `backend` in the config, then the first backend with credentials:
`TYPESAFE_API_KEY`, then `LLM_JUDGE_BASE_URL`, then a configured command. The model is `--model`,
then `TYPESAFE_DEFAULT_MODEL` or `LLM_JUDGE_MODEL`, then `model` in the config, then `jev-latest`
for the decision model.

### Missing credentials and backend errors

As with Jev, a missing key or an unreachable, failing, or malformed backend prints one warning and
exits 0, so a laptop without credentials is not blocked. Pass `--fail`, or set `ci: "fail"` in the
config and run with `CI` set, to exit 2 instead. Failed answers are never cached.

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

The vendored entry point is `tools/oxlint/anti-slop/diff-rules/run.ts`. It uses only Node built-ins
and erasable type syntax, so `node` runs it directly with built-in type stripping (Node 22.18 or
later; tested on Node 24). Node refuses to strip types under `node_modules`, so keep the vendored
copy outside it.

```json
{
  "scripts": {
    "lint": "oxlint",
    "lint:jev": "node tools/oxlint/anti-slop/jev/lint-changed.ts -c oxlint.jev.config.ts",
    "lint:jev:full": "node tools/oxlint/anti-slop/jev/lint-changed.ts --all -c oxlint.jev.config.ts",
    "lint:diff": "node tools/oxlint/anti-slop/diff-rules/run.ts",
    "check:fast": "npm run lint:jev",
    "check:full": "npm run lint:jev:full && npm run lint:diff"
  }
}
```

`check:fast` stays cheap: AST rules plus Jev on changed files, and no diff rules. `check:full` runs
AST rules and Jev on everything, then the diff rules against the base. Add your typecheck and tests
to both.

### Pre-push hook

```sh
#!/bin/sh
# .git/hooks/pre-push, or the equivalent husky/lefthook entry
exec node tools/oxlint/anti-slop/diff-rules/run.ts --committed
```

`--committed` judges what is being pushed, without uncommitted edits. Only `error` rules block the
push; add `--fail` to block on warnings too. A hook re-run on an unchanged branch is answered from
the cache. For a pre-commit hook use `--staged`.

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

- Start every rule at `warn`, run `check:full` on a handful of recent branches with `--json`, and
  look at each rule's `probability` next to whether a reviewer would agree.
- Raise a rule's cutoff when it fires on changes you would accept; lower it when it misses known
  cases. Promote a rule to `error` only once its false positives are rare, since `error` rules block
  hooks and CI.
- Cutoffs are not portable between backends: a decision-model probability and an LLM's
  self-reported confidence are calibrated differently. Tune per backend and model, and pin both.
- Re-tuning is cheap because cutoff edits are answered from the cache.
