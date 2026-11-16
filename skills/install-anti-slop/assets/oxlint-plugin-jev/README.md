# oxlint-plugin-jev

> [!WARNING]
> This package is experimental. Use at your own risk.

[Oxlint](https://oxc.rs/docs/guide/usage/linter.html) rules written in plain English. Each rule is a yes/no question about a function, a call, a JSX element, or a whole file. The plugin sends every match to [TypeSafe Jev](https://typesafe.ai), a decision model, or, in judge mode, to any [AI SDK](https://ai-sdk.dev) chat model, and reports when the yes-probability reaches the rule's cutoff.

This is Kyle Mistele's fork of [wobsoriano/oxlint-plugin-jev](https://github.com/wobsoriano/oxlint-plugin-jev). It adds per-rule messages, `jev/suggest`, `createJevPlugin`, `changedOnly`, a per-match cache, judge mode, the AI Gateway fallback, and Factory credentials.

## Install

Requires Node.js 22 or later and oxlint 1.83 or later.

The fork is not on npm: `npm i oxlint-plugin-jev` installs the upstream package, which has none of the features above. Install it from GitHub instead. A `prepare` script builds `dist/` during the install. npm 11 prints an `install-scripts` warning about that script, which is expected.

```sh
npm i -D oxlint github:K-Mistele/oxlint-plugin-jev
# or pin a commit:
npm i -D oxlint github:K-Mistele/oxlint-plugin-jev#<sha>
```

You can also vendor a built copy. The `install-anti-slop` skill in [K-Mistele/anti-slop](https://github.com/K-Mistele/anti-slop) does this with `--jev`: it copies the build to `tools/oxlint/oxlint-plugin-jev/`, which you then add as a local package (`npm i -D ./tools/oxlint/oxlint-plugin-jev`, recorded as `file:tools/oxlint/oxlint-plugin-jev`).

### Credentials

The first credential that is set wins:

| Order | Variable                                      | Backend                                                                                                                                                                                                                                                                                   |
| ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `TYPESAFE_API_KEY` or `TYPESAFE_AI_API_KEY`   | TypeSafe directly ([console](https://console.typesafe.ai)).                                                                                                                                                                                                                               |
| 2     | `FACTORY_API_KEY`                             | Factory's decision endpoint, billed to your Factory org. The org needs the `decision_models` feature, or every request gets a 403. Factory serves only aliases such as `jev-latest` and `jev-preview`, so a pinned `model` such as `jev-1.13.0` is refused, and `longContext` is ignored. |
| 3     | `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN`) | [AI Gateway](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway): `jev-latest` maps to `typesafe-ai/jev`, and another id to `typesafe-ai/<id>`.                                                                                                                                     |

AI Gateway credentials are also what a `model` containing `/` (such as `"typesafe-ai/jev"`) and a judge without a `provider` module use, regardless of the other keys.

Other variables:

| Variable               | Meaning                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `TYPESAFE_BASE_URL`    | Another TypeSafe host, without `/v1`. `TYPESAFE_AI_BASE_URL` is the same with `/v1`; this one wins. |
| `FACTORY_API_BASE_URL` | Another Factory host, such as `https://dev.api.factory.ai`. Defaults to `https://api.factory.ai`.   |
| `JEV_CHANGED_ONLY`     | `1` or `0` overrides `changedOnly`.                                                                 |
| `JEV_CHANGED_BASE`     | Overrides `changedBase`.                                                                            |

With no credential, the plugin warns once and reports nothing. Set `ci: "fail"` so CI fails instead.

## Example

Three rules no pattern linter can express. `.oxlintrc.json`:

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
            "message": "Personal data is written to a log. Log an opaque user id instead.",
            "cutoff": 0.8
          },
          {
            "id": "name-matches-behavior",
            "target": "function",
            "question": "Does this function's name imply it only reads data, while its body also writes or sends something?",
            "message": "The name says read-only, but the body has side effects. Rename it or split it.",
            "cutoff": 0.6
          },
          {
            "id": "no-prompt-injection",
            "target": "function",
            "question": "Does this function build a language model prompt by concatenating untrusted user input into the instructions?",
            "message": "Untrusted input is spliced into the prompt instructions. Pass it as a separate user message.",
            "cutoff": 0.6
          }
        ]
      }
    ]
  }
}
```

Against this file:

```js
export async function getUser(id) {
  const user = await db.users.find(id);
  console.log('loaded', user.email, user.phone);
  await mailer.send(user.email, 'New sign-in to your account');
  return user;
}
```

oxlint reports (real output, trimmed):

```text
  x jev(ask): [no-pii-in-logs] Personal data is written to a log. Log an opaque user id instead. (jev-1.14.0 answered yes, 0.98 >= 0.80)
   ,-[fail.js:5:3]
 5 |   console.log('loaded', user.email, user.phone);
   :   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

  x jev(ask): [name-matches-behavior] The name says read-only, but the body has side effects. Rename it or split it. (jev-1.14.0 answered yes, 0.93 >= 0.60)
   ,-[fail.js:3:8]
 3 | export async function getUser(id) {
   :        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

Without `message`, the diagnostic shows the question instead. The rule id, the model version that answered, and the score are always shown. `example/` in this repo has a failing and a passing file; run them with `npm run example`.

### Rule fields

| Field      | Meaning                                                                                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | Shown in the diagnostic. Unique in its list.                                                                                                                                                                                                                                      |
| `target`   | What the model reads, and what gets underlined: `"function"` (the whole function, including an arrow's or method's name; underlines the signature line), `"call"` (the call), `"jsx"` (the element; underlines the opening tag), or `"file"` (the whole file; underlines line 1). |
| `question` | A yes/no question. "Yes" means "report this". Its wording is the rule, so say exactly what counts.                                                                                                                                                                                |
| `cutoff`   | 0 to 1. Report when the yes-probability is at or above it.                                                                                                                                                                                                                        |
| `message`  | Optional. Shown instead of the question. Not sent to the model.                                                                                                                                                                                                                   |
| `location` | Optional, file rules only: `{ "question", "cutoff" }`, with a cutoff above 0.5, to point the diagnostic at a line. See below.                                                                                                                                                     |

A file rule with `location` asks a second question to find the offending line. If that answer is uncertain, or the file was truncated, the finding stays on line 1:

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

### Settings

Set next to `rules`, for `jev/ask`, `jev/suggest`, or `createJevPlugin`.

| Setting             | Default        | Meaning                                                                                                                      |
| ------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ci`                | `"skip"`       | When the model can't be reached and `CI` is set: `"skip"` warns and reports nothing, `"fail"` fails the run.                 |
| `timeoutMs`         | `10000`        | Per-file request budget, retries included.                                                                                   |
| `maxMatchesPerFile` | `25`           | Matches sent per file. Extras are dropped in source order, with a warning.                                                   |
| `maxSnippetChars`   | `4000`         | Longer snippets are truncated.                                                                                               |
| `model`             | `"jev-latest"` | Jev model id. Pin one such as `"jev-1.13.0"` once cutoffs are tuned (TypeSafe only). An id with `/` goes through AI Gateway. |
| `longContext`       | `false`        | Raise Jev's limit from 64k to 262k tokens per request. Slower and less accurate.                                             |
| `judge`             | none           | Use an LLM judge instead of Jev. See [Judge mode](#judge-mode).                                                              |
| `changedOnly`       | `false`        | Only ask about matches on lines changed against `changedBase`.                                                               |
| `changedBase`       | `"HEAD"`       | The git ref for `changedOnly`.                                                                                               |

## Severity per question

oxlint takes severity from the rule's config entry, so `jev/ask` reports every question at one severity. `jev/suggest` is the same rule under a second name: configure it at `"warn"` for findings that should not fail the run. Each of the two sends its own request per file.

For per-question severities, `createJevPlugin` makes each question its own oxlint rule, `<name>/<id>`. All of a plugin's enabled rules share one request per file, and `"off"` drops a question from the request.

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
      message: 'Personal data is written to a log. Log an opaque user id instead.',
      cutoff: 0.8,
    },
    {
      id: 'name-matches-behavior',
      target: 'function',
      question:
        "Does this function's name imply it only reads data, while its body also writes or sends something?",
      message: 'The name says read-only, but the body has side effects. Rename it or split it.',
      cutoff: 0.6,
    },
  ],
});
```

```json
{
  "jsPlugins": ["./jev-rules.mjs"],
  "rules": {
    "acme/no-pii-in-logs": "error",
    "acme/name-matches-behavior": "warn"
  }
}
```

```text
  x acme(no-pii-in-logs): [no-pii-in-logs] Personal data is written to a log. Log an opaque user id instead. (jev-1.14.0 answered yes, 0.98 >= 0.80)
  ! acme(name-matches-behavior): [name-matches-behavior] The name says read-only, but the body has side effects. Rename it or split it. (jev-1.14.0 answered yes, 0.93 >= 0.60)
```

The options are validated when the plugin loads. Ids cannot contain `/`, and the rules take no options in the oxlint config.

## Judge mode

`judge` answers the same questions with any AI SDK chat model. The model returns `{ violation, confidence }` per question, read as a yes-probability. Self-reported confidence is less calibrated than Jev's probabilities, so retune cutoffs. File rules with `location` stay at the file level.

A bare `model` is an AI Gateway id and needs `AI_GATEWAY_API_KEY`:

```json
{ "judge": { "model": "openai/gpt-5-mini" }, "rules": [] }
```

To call a provider directly, point `provider` at an ES module, relative to the working directory, whose default export is an AI SDK provider or registry:

```js
// judge-provider.mjs
import { createOpenAI } from '@ai-sdk/openai';
export default createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

```json
{ "judge": { "model": "gpt-5-mini", "provider": "./judge-provider.mjs" }, "rules": [] }
```

## CI

Check only what a pull request changed, and fail if the model can't be reached (`ci: "fail"` in the config):

```yaml
- run: npx oxlint -c .oxlintrc.ci.json
  env:
    JEV_CHANGED_ONLY: '1'
    JEV_CHANGED_BASE: origin/${{ github.base_ref }}
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

Fetch the base ref first (for example `actions/checkout` with `fetch-depth: 0`). Changed lines come from `git diff -U0 <base>` plus untracked files; a match counts when any of its lines changed, and a file with no changes sends no request. If git can't produce a diff, the plugin warns and checks every line.

To save cost across runs, cache `node_modules/.cache/oxlint-plugin-jev` (for example with `actions/cache`).

## In the editor

The oxlint editor extension lints as you type, and every edit inside a match is a paid request that blocks the language server. Keep the jev rules out of the config your editor reads, and put them in an overlay for CI and pre-push. Leave `jsPlugins` in the base config; the overlay inherits it.

```json
// .oxlintrc.ci.json
{
  "extends": [".oxlintrc.json"],
  "rules": { "jev/ask": ["error", { "ci": "fail", "rules": [] }] }
}
```

```sh
oxlint                        # editor and local runs, no model calls
oxlint -c .oxlintrc.ci.json   # CI and pre-push
```

## Caching and cost

Each answer is cached under `node_modules/.cache/oxlint-plugin-jev`, keyed by backend, model, question, and snippet. Editing one function re-asks only the matches inside it. Changing a cutoff, id, message, or severity re-asks nothing; changing the model, backend, or a question's wording re-asks every match of that question.

Every uncached match is a paid question, and a `file` rule sends the whole file. Keep costs down with `maxMatchesPerFile`, `changedOnly`, the cache, and the editor overlay.

## Development

TypeScript, built with [Vite+](https://viteplus.dev). ESM only.

```sh
npm run build
npm run check   # format, lint, typecheck
npm test        # builds first, since the worker tests run against dist/
JEV_LIVE=1 TYPESAFE_API_KEY=... npm test   # also runs example/ against the real API
JEV_LIVE=1 FACTORY_API_KEY=... npm test    # the same, through Factory's decision endpoint
```

## License

MIT. Original work by [Robert Soriano](https://github.com/wobsoriano/oxlint-plugin-jev).
