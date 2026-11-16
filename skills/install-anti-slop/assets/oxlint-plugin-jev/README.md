# oxlint-plugin-jev

> [!WARNING]
> This package is experimental. Use at your own risk.

[Oxlint](https://oxc.rs/docs/guide/usage/linter.html) rules written in plain English, answered by [TypeSafe Jev](https://typesafe.ai) or, as an LLM judge, by any [AI SDK](https://ai-sdk.dev) model.

A rule is a yes/no question about a function, a call, a JSX element, or a whole file. Each match is sent to Jev with the question, and the plugin reports an error when the yes-probability clears your cutoff.

## Install

Requires Node.js 22 or later.

```sh
npm i -D oxlint oxlint-plugin-jev
export TYPESAFE_API_KEY="..."   # https://console.typesafe.ai
```

Requests go through the Vercel AI SDK: `experimental_decide` from [`ai`](https://www.npmjs.com/package/ai) with the
[`@ai-sdk/typesafe-ai`](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai) provider. Both are dependencies
of the plugin, so there is nothing else to install.

| Variable               | Meaning                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`     | TypeSafe API key. `TYPESAFE_AI_API_KEY`, the AI SDK provider's name for it, works too.                                                                                                                                                               |
| `TYPESAFE_BASE_URL`    | Another TypeSafe host, such as a mock, without the `/v1` prefix. The tests use it.                                                                                                                                                                   |
| `TYPESAFE_AI_BASE_URL` | The AI SDK provider's form of the same setting, with the `/v1` prefix. `TYPESAFE_BASE_URL` wins when both are set.                                                                                                                                   |
| `AI_GATEWAY_API_KEY`   | Needed when `model` is an AI Gateway id such as `"typesafe-ai/jev"`, or for an LLM judge without a `provider` module. Without a TypeSafe key, it is also the fallback: `jev-latest` goes to `typesafe-ai/jev` and a pinned id to `typesafe-ai/<id>`. |
| `JEV_CHANGED_ONLY`     | `1` or `0` overrides the `changedOnly` setting. See [Changed lines only](#changed-lines-only).                                                                                                                                                       |
| `JEV_CHANGED_BASE`     | Overrides `changedBase`.                                                                                                                                                                                                                             |

In CI, set `ci: "fail"` so a run that could not reach Jev fails instead of passing quietly.

## Config

Add the plugin and its rule, `jev/ask`, to `.oxlintrc.json`. Your English rules go in the options.

```json
{
  "jsPlugins": ["oxlint-plugin-jev"],
  "rules": {
    "jev/ask": [
      "error",
      {
        "rules": [
          {
            "id": "no-pii-in-logs",
            "target": "call",
            "question": "Does this call write personal data, such as an email or phone number, to a log or console?",
            "cutoff": 0.8
          },
          {
            "id": "name-matches-behavior",
            "target": "function",
            "question": "Does this function's name imply it only reads data, while its body also writes or sends something?",
            "cutoff": 0.6
          }
        ]
      }
    ]
  }
}
```

| Field      | What it is                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`       | Shown in the error message. Unique in the list.                                                                   |
| `target`   | `"function"`, `"call"`, `"jsx"`, or `"file"`.                                                                     |
| `question` | A yes/no question. "Yes" means "report this".                                                                     |
| `cutoff`   | 0 to 1. Report when Jev's yes-probability is at or above it.                                                      |
| `location` | Optional for file rules: a source-location `question` and a `cutoff` greater than 0.5 and at most 1.              |
| `message`  | Optional. Shown instead of the question when the rule fires. See [Messages and warnings](#messages-and-warnings). |

`target` decides what Jev gets to read. There is no selector syntax and no other target.

| Target       | Jev sees                                                                                                     | The error underlines |
| ------------ | ------------------------------------------------------------------------------------------------------------ | -------------------- |
| `"function"` | The whole function. An arrow or method includes its name, so `const getUser = () => ...` reads as `getUser`. | The signature line   |
| `"call"`     | The whole call expression.                                                                                   | The whole call       |
| `"jsx"`      | The whole element, children included.                                                                        | The opening tag      |
| `"file"`     | The whole file.                                                                                              | The first line       |

The wording of the question is the rule, so be precise about what counts. "Does this send personal data" also fires on a legitimate `mailer.send(user.email, ...)`. "To a log or console" does not.

File rules can point editor diagnostics and GitHub annotations to the suspected violation:

```json
{
  "id": "prefer-boolean-state-helper",
  "target": "file",
  "question": "Does any boolean React state have a memoized callback that only sets it to true or false?",
  "cutoff": 0.9,
  "location": {
    "question": "Select the declaration of the state used by the offending callback.",
    "cutoff": 0.75
  }
}
```

The violation and location have separate confidence cutoffs. An uncertain or invalid location keeps
the finding on the first line. Files truncated by `maxSnippetChars` also keep the first-line
diagnostic; location questions only use complete source. Rules without `location` behave as before.

| Setting             | Default        | Meaning                                                                                                                                                                                                                    |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci`                | `"skip"`       | What happens when Jev can't be asked and `CI` is set. `"skip"` warns once and reports nothing. `"fail"` fails the run. Outside CI it always skips.                                                                         |
| `timeoutMs`         | `10000`        | Per-file request timeout, retries included.                                                                                                                                                                                |
| `maxMatchesPerFile` | `25`           | Snippets sent per file across all rules. Extra matches are dropped in source order and the file is named on stderr.                                                                                                        |
| `maxSnippetChars`   | `4000`         | Longer snippets are cut and end with `/* ...truncated */`.                                                                                                                                                                 |
| `model`             | `"jev-latest"` | TypeSafe model id. Pin a versioned id such as `"jev-1.13.0"` once your cutoffs are tuned. Each diagnostic names the version that answered. An id with a `/`, such as `"typesafe-ai/jev"`, goes through AI Gateway instead. |
| `longContext`       | `false`        | Raise Jev's limits from 64k tokens per request (32k per question) to 262k. Same price per token, but slower and less accurate.                                                                                             |
| `judge`             | none           | Answer with an LLM judge instead of Jev. See [LLM judge](#llm-judge).                                                                                                                                                      |
| `changedOnly`       | `false`        | Only ask about matches on lines changed against `changedBase`. See [Changed lines only](#changed-lines-only).                                                                                                              |
| `changedBase`       | `"HEAD"`       | The git ref `changedOnly` diffs against, such as `"origin/main"` in CI.                                                                                                                                                    |

## Messages and warnings

A rule's optional `message` replaces the question in the diagnostic. Use it to say what to do about
a finding. The rule id, the model that answered, and both numbers are still appended:

```text
[feature-envy] Possibly Feature Envy: ... Consider Move Function. (jev-1.13.0 answered yes, 0.91 >= 0.85)
```

`message` is plain text with no placeholders, since the id and numbers are always shown. It is not
sent to Jev, so changing it does not re-ask anything.

Oxlint takes a diagnostic's severity from the rule's config entry, and a JS plugin cannot set it per
report. So the plugin has a second rule, `jev/suggest`, that behaves exactly like `jev/ask` and takes
the same options. Configure it at `"warn"` for findings that should not fail the run, such as code
smells:

```json
{
  "jsPlugins": ["oxlint-plugin-jev"],
  "rules": {
    "jev/ask": [
      "error",
      {
        "ci": "fail",
        "rules": [
          {
            "id": "no-pii-in-logs",
            "target": "call",
            "question": "Does this call write personal data, such as an email or phone number, to a log or console?",
            "cutoff": 0.8,
            "message": "Personal data is written to a log. Log an opaque id instead."
          }
        ]
      }
    ],
    "jev/suggest": [
      "warn",
      {
        "rules": [
          {
            "id": "feature-envy",
            "target": "function",
            "question": "Does this function mostly read or change the fields of an object passed in or imported from another module, rather than its own module's data?",
            "cutoff": 0.85,
            "message": "Possibly Feature Envy: this function mostly reads another module's data. Consider Move Function into the module that owns that data."
          }
        ]
      }
    ]
  }
}
```

The two rules are configured independently, so each has its own `rules` list and settings. Each
enabled rule sends its own request per file with its own `maxMatchesPerFile` budget, so enabling
both can double the requests per file. Answers are cached per question, so the same question about
the same code is asked once across both. Rule ids only need to be unique within one rule's list.
To set the severity of each question on its own, use [one rule per question](#one-rule-per-question).

## One rule per question

`createJevPlugin` builds a plugin in which every question is its own oxlint rule, named
`<name>/<id>`. Each question's severity, and whether it runs at all, then lives in the normal
oxlint config, where `"off"` removes it from the request entirely. All enabled rules of one plugin
share one request per file, so splitting a list into rules does not add requests.

```js
// jev-rules.mjs
import { createJevPlugin } from 'oxlint-plugin-jev';

export default createJevPlugin({
  name: 'acme',
  ci: 'fail',
  rules: [
    {
      id: 'no-pii-in-logs',
      target: 'call',
      question:
        'Does this call write personal data, such as an email or phone number, to a log or console?',
      cutoff: 0.8,
      message: 'Personal data is written to a log. Log an opaque id instead.',
    },
    {
      id: 'feature-envy',
      target: 'function',
      question:
        "Does this function mostly read or change the fields of an object passed in or imported from another module, rather than its own module's data?",
      cutoff: 0.85,
      message: 'Possibly Feature Envy. Consider Move Function.',
    },
  ],
});
```

```json
{
  "jsPlugins": ["./jev-rules.mjs"],
  "rules": {
    "acme/no-pii-in-logs": "error",
    "acme/feature-envy": "warn"
  }
}
```

`createJevPlugin` takes the same settings and rule fields as `jev/ask`, plus `name`, and checks them
when the plugin loads. Ids cannot contain `/`. `maxMatchesPerFile` is shared by all of the plugin's
rules, since they share the request. The rules take no options in the oxlint config.

Batching relies on how oxlint runs JS plugins: for each file it merges every enabled rule's visitor
into one AST walk, then runs the `Program:exit` handlers after the walk, then the `after` hooks. The
first `Program:exit` therefore sees every rule's matches and sends one request for all of them; the
other rules read the shared answers and report their own findings at their own severity.

## LLM judge

`judge` answers the same yes/no questions with any AI SDK language model instead of Jev. The model
returns, for each question, `{ violation: boolean, confidence: number }` through structured output,
and the plugin reads that as a yes-probability: `confidence` when `violation` is true and
`1 - confidence` otherwise. Cutoffs keep their meaning, but a judge's confidence is
self-reported and less calibrated than Jev's probabilities, so tune them again.

```json
{ "judge": { "model": "openai/gpt-5-mini" }, "rules": [ ... ] }
```

A bare `model` is an [AI Gateway](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway) id and needs
`AI_GATEWAY_API_KEY`. To use a provider directly, point `provider` at an ES module, relative to the
working directory, whose default export is an AI SDK provider or provider registry; `model` is then
passed to its `languageModel()`:

```js
// judge-provider.mjs
import { createOpenAI } from '@ai-sdk/openai';
export default createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

```json
{ "judge": { "model": "gpt-5-mini", "provider": "./judge-provider.mjs" }, "rules": [ ... ] }
```

A judge only answers yes/no questions, so file rules with `location` report at the file level.
Jev can also be reached through AI Gateway without a judge, by setting `model` to
`"typesafe-ai/jev"`; that uses `experimental_decide` like the direct provider.

## Changed lines only

With `changedOnly: true`, or `JEV_CHANGED_ONLY=1` in the environment, the plugin only asks about
matches that overlap lines changed against `changedBase` (`HEAD` by default). Changed means staged
or unstaged edits, from `git diff -U0 <changedBase>`; untracked files count as changed throughout.
A function or call matches when any of its lines changed, a file rule when any line of the file
changed, and an unchanged file sends no request. Set `changedBase` (or `JEV_CHANGED_BASE`) to
`origin/main` in a pull-request job to check everything the branch touched.

The diff is computed once per repository per oxlint run. If git cannot produce it, for example
outside a repository, the plugin warns once and checks every line rather than none.

## How it works

At most one initial request per file and rule list (or `createJevPlugin` plugin), holding every
match whose answer is not cached. A snippet that several questions read is sent once. A file rule
with `location` includes numbered source and a Choice question. Above 254 nonblank lines, Jev selects
a range and refines it in follow-up requests with the same full-file context. All requests share the
per-file `timeoutMs` budget.

Answers are cached one by one under `node_modules/.cache/oxlint-plugin-jev`, keyed by the backend
and model, the question, the location question if there is one, and the snippet text. Editing one
function re-asks only the matches inside it; the rest of the file comes from the cache. Changing a
cutoff, an `id`, a `message`, or a severity does not re-ask anything. Changing the model, the
backend, or the wording of a question re-asks every match of that question.

Location responses are cached too, including valid uncertain answers. Malformed location answers
are retried on the next run, including malformed entries already in the cache.

The request runs on a worker thread through the AI SDK, which retries rate limits and server errors
(two retries, honoring `retry-after`) within `timeoutMs`.

### Cost

Every uncached match is a paid question. A file costs roughly its matches times its questions, and
a `file` rule sends the whole file. To keep the bill down: cap `maxMatchesPerFile`, keep
`maxSnippetChars` near your largest functions, use `changedOnly` in local and pre-push runs, keep
the cache directory between CI runs (for example with `actions/cache` on
`node_modules/.cache/oxlint-plugin-jev`), and leave `longContext` off unless files exceed Jev's limits.
An LLM judge sends every snippet and question in one prompt and is billed by that provider.

If Jev can't be asked, because no credential is set (`TYPESAFE_API_KEY`, `TYPESAFE_AI_API_KEY`, or `AI_GATEWAY_API_KEY`), the request times out, or the API errors, the plugin prints one warning naming the cause and reports nothing for that file. Set `ci: "fail"` to fail the run instead.

If only a location refinement fails, confirmed violations are still reported at the file level.
Under CI with `ci: "fail"`, the refinement failure produces a separate diagnostic; otherwise it warns.
Later matches in that file keep their original locations without further refinement requests.

## In the editor

The oxlint VS Code extension lints as you type, and every keystroke inside a match is a paid request that blocks the language server until Jev answers.

Keep `jev/ask` and `jev/suggest` (or your `createJevPlugin` rules) out of the config your editor reads, and put them in an overlay for CI and pre-push. Leave `jsPlugins` in the base config, since the overlay inherits it. `changedOnly` and the per-match cache make editor runs cheaper, but each edit inside a match is still a request.

```json
{
  "extends": [".oxlintrc.json"],
  "rules": {
    "jev/ask": ["error", { "rules": [ ... ] }]
  }
}
```

```sh
oxlint                        # editor and local runs, no Jev
oxlint -c .oxlintrc.ci.json   # CI and pre-push, Jev included
```

## Example

`example/` has three rules that a pattern-based linter can't express, a file that fails all three, and a file that passes.

| Rule                    | Fails on                                                | Passes on                                   |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `no-pii-in-logs`        | `console.log("loaded", user.email, user.phone)`         | `console.log("notified", { userId: id })`   |
| `name-matches-behavior` | `getUser` that also sends an email                      | The same body named `notifySignIn`          |
| `no-prompt-injection`   | A customer message pasted into the system prompt string | The message passed as a separate user field |

```sh
npm run example
```

## Development

TypeScript, built with [Vite+](https://viteplus.dev). ESM only.

```sh
npm run build
npm run check   # format, lint, typecheck
npm test        # builds first, since the worker tests run against dist/
JEV_LIVE=1 TYPESAFE_API_KEY=... npm test   # also runs example/ against the real API
```

## License

MIT
