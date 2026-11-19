# Rule modes, hooks, and CI

Every rule checks the whole file. A rule checks only changed lines when its own options say so,
using Oxlint's normal rule syntax:

```ts
"anti-slop/no-object-parameters": "error", // the whole file
"anti-slop/no-reflect-get": ["error", { mode: "changed" }], // only lines changed on the branch
"anti-slop/max-ternary-depth": ["error", { mode: "changed", maxDepth: 2 }], // with the rule's own options
```

- `"all"` (the default, and what a bare severity means) checks every line.
- `"changed"` reports only findings on lines changed on the branch. On a deterministic rule this is
  a ratchet: new code must pass, and old violations stay until someone edits those lines. On a Jev
  rule it also saves money: matches on unchanged lines are never sent.

Nothing switches a rule's mode implicitly. Jev rules check whole files too unless they say
`mode: "changed"`.

Changed lines are the working tree (commits on the branch, staged and unstaged edits, untracked
files) diffed against the merge base of `HEAD` and the default branch. The default branch is what
`refs/remotes/origin/HEAD` points at, else the first of `origin/main`, `origin/master`, `main`, and
`master` that exists. A finding counts when any of its lines changed. If git cannot produce a diff
(not a repository, no default branch, no common ancestor), every line is checked and a warning says
why. The diff rules use the same default base.

## Which rules take a mode

| Rules | How |
| --- | --- |
| `anti-slop/*`, `anti-slop-effect/*`, `anti-slop-xstate/*`, `anti-slop-martinfowler/*` | Built in: every rule's options accept `mode` and `base`. |
| `anti-slop-effect-jev/*`, `anti-slop-martinfowler-jev/*`, `createJevPlugin` rules, `jev/ask` | Built into the `oxlint-plugin-jev` fork. |
| `landmines/*`, `ai-guard/*`, `effect/*` (cevr), `enfect/*` | Register anti-slop's checked-in wrapper modules instead of the package (below). |
| Built-in Oxlint rules (`eslint`, `typescript`, `oxc`, `unicorn`, ...) and `effecttsgo/*` | Cannot take a mode; they always check every line. Do not put `mode` in their options. |

The wrappers in `plugins/` import the real plugin and re-export every rule with a schema that also
accepts `mode` and `base`. The rule never sees those two options, so its own options pass through
unchanged, and in `"changed"` mode its reports on unchanged lines are dropped. Register a wrapper
under the plugin's usual name, so rule names and disable comments stay the same:

```ts
// oxlint.config.ts
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "landmines", specifier: "./tools/oxlint/anti-slop/plugins/landmines.ts" },
    { name: "ai-guard", specifier: "./tools/oxlint/anti-slop/plugins/ai-guard.ts" },
    { name: "effect", specifier: "./tools/oxlint/anti-slop/plugins/effect.ts" },
    { name: "enfect", specifier: "./tools/oxlint/anti-slop/plugins/enfect.ts" },
    { name: "anti-slop-effect-jev", specifier: "./tools/oxlint/anti-slop/jev/plugin.ts" },
  ],
  rules: {
    "typescript/no-non-null-assertion": "error", // built-in: always the whole file
    "landmines/no-fixed-sleep": "error",
    "landmines/no-flake-masking": ["error", { mode: "changed" }],
    "effect/noUnboundedConcurrency": ["error", { mode: "changed" }],
    "anti-slop/no-object-parameters": ["error", { mode: "changed" }],
    "anti-slop-effect-jev/unbounded-retry": ["error", { mode: "changed" }],
  },
});
```

The same entries work in `.oxlintrc.json` and under `lint` in a Vite+ config. Each wrapper imports
only its own package, so copy or register only the wrappers for plugins you install. A rule whose
first option is not an object, or that already has its own `mode` or `base` option, is left as it
is.

### Options and environment

| Setting | Effect |
| --- | --- |
| `mode: "changed"` | Only changed lines, for that rule. |
| `base: "<ref>"` | Next to `mode`: diff against the merge base with this ref instead of the default branch. |
| `ANTI_SLOP_BASE=<ref>` | The base for anti-slop's rules and the wrapped plugins when a rule sets no `base`. The diff rules read it too. |
| `JEV_CHANGED_BASE=<ref>` | The same for the Jev rules. `modes/lint.ts` copies `ANTI_SLOP_BASE` into it when it is unset. |
| `ANTI_SLOP_MODE=all`, `JEV_MODE=all` | Every rule checks every line, whatever its `mode`, for full runs. `modes/lint.ts full` sets both. |

## Jev rules and credentials

Jev rules run when a decision-model credential is set (`TYPESAFE_API_KEY` or `TYPESAFE_AI_API_KEY`,
`FACTORY_API_KEY`, or `AI_GATEWAY_API_KEY`, with their base URL variables), and otherwise warn once
and skip. Under `CI`, the anti-slop Jev plugins fail instead (`ci: "fail"`). The Oxlint editor
extension inherits the editor's environment, so if a credential is set there it asks Jev on every
edit; keep the key out of the editor's environment, or point the editor at a config without the Jev
plugins.

## Hooks

`modes/lint.ts` runs the lint for each stage:

```text
node tools/oxlint/anti-slop/modes/lint.ts <commit|push|full> [command...]
```

| Stage | Runs |
| --- | --- |
| `commit` | The staged JS and TS files, with the Jev credentials (and `CI`) removed from the environment, so only the free rules run and Jev prints its "no Jev credentials" warning. |
| `push` | The whole project as configured: every rule in the mode its options set, plus the Jev rules when a credential is set. |
| `full` | Like `push`, with `ANTI_SLOP_MODE=all` and `JEV_MODE=all`. |

Set `mode: "changed"` in the config on the rules you want limited to the branch's changes before
pushing, typically the Jev rules and any deterministic rule the codebase does not pass yet. The
command defaults to `oxlint`. Effect repositories pass their wrapper, for example
`node tools/oxlint/anti-slop/modes/lint.ts push effect-tsgo --tsrs-lint oxlint --type-check`.

- Pre-commit: `node tools/oxlint/anti-slop/modes/lint.ts commit`
- Pre-push: `node tools/oxlint/anti-slop/modes/lint.ts push`, then `npm run integrity`
- CI: the pre-push commands, then the [diff rules](./diff-rules.md).

`integrity` is the `"integrity": "node tools/oxlint/anti-slop/integrity/run.ts"` script. It fails when the
branch weakens its own checks: `ai-guard integrity --enforce` (skipped or deleted tests, new suppressions,
weakened ESLint, TypeScript, coverage, script, CI, and hook settings) plus anti-slop's checks for disable
comments without a ` -- reason` and oxlint config changes that lower or remove rules, add `ignorePatterns`, or
remove `jsPlugins`. It diffs against the same base as `"changed"` mode and honors `ANTI_SLOP_BASE`. It needs
`eslint-plugin-ai-guard` and `@typescript-eslint/parser` and no network or credentials. Use the package
manager the repository uses (`pnpm integrity`, `yarn integrity`).

Add them with the hook tool the repository already uses:

```sh
# husky: .husky/pre-commit
node tools/oxlint/anti-slop/modes/lint.ts commit
# husky: .husky/pre-push
node tools/oxlint/anti-slop/modes/lint.ts push
npm run integrity
```

```yaml
# lefthook.yml
pre-commit:
  commands:
    anti-slop:
      run: node tools/oxlint/anti-slop/modes/lint.ts commit
pre-push:
  piped: true
  commands:
    anti-slop:
      priority: 1
      run: node tools/oxlint/anti-slop/modes/lint.ts push
    integrity:
      priority: 2
      run: npm run integrity
```

```json
{
  "simple-git-hooks": {
    "pre-commit": "node tools/oxlint/anti-slop/modes/lint.ts commit",
    "pre-push": "node tools/oxlint/anti-slop/modes/lint.ts push && npm run integrity"
  }
}
```

Without a hook tool, commit `.githooks/pre-commit` and `.githooks/pre-push` (executable shell
scripts running the commands above) and add `"prepare": "git config core.hooksPath .githooks"`.

## CI

```yaml
# .github/workflows/anti-slop.yml
name: anti-slop
on: pull_request
jobs:
  lint:
    runs-on: ubuntu-latest
    env:
      ANTI_SLOP_BASE: origin/${{ github.base_ref }}
      TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the merge base and the diff rules' history
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - uses: actions/cache@v4
        with:
          path: |
            node_modules/.cache/oxlint-plugin-jev
            node_modules/.cache/anti-slop-diff-rules
          key: anti-slop-${{ github.head_ref }}-${{ github.sha }}
          restore-keys: anti-slop-${{ github.head_ref }}-
      - run: node tools/oxlint/anti-slop/modes/lint.ts push
      - run: npm run integrity
      - run: node tools/oxlint/anti-slop/diff-rules/run.ts --committed --purpose "$PR_TITLE"
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
```

The Jev plugins set `ci: "fail"`, so a CI run that cannot reach Jev fails. Run
`node tools/oxlint/anti-slop/modes/lint.ts full` on a schedule to see every finding.
