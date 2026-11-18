# Rule modes, hooks, and CI

Each rule in the Oxlint config says how much code it checks:

- `"all"` checks every line. This is the default for deterministic rules.
- `"changed"` checks only lines changed on the branch and ignores findings on untouched lines. This
  is the default for Jev rules, where every match is a paid request. On a deterministic rule it is a
  ratchet: new code must pass, and old violations are left alone until someone edits those lines.

Changed lines are the working tree (commits on the branch, staged and unstaged edits, untracked
files) diffed against the merge base of `HEAD` and the default branch. The default branch is what
`refs/remotes/origin/HEAD` points at, else the first of `origin/main`, `origin/master`, `main`, and
`master` that exists. A finding counts when any of its lines changed. If git cannot produce a diff
(not a repository, no default branch, no common ancestor), every line is checked and a warning says
why. The diff rules use the same default base.

## Configure

Wrap the config in `defineAntiSlopConfig` and set a mode next to a rule's severity:

```ts
// oxlint.config.ts
import { defineAntiSlopConfig } from "./tools/oxlint/anti-slop/modes/config.ts";

export default defineAntiSlopConfig({
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "landmines", specifier: "@interfere/landmines/testing" },
    { name: "anti-slop-effect-jev", specifier: "./tools/oxlint/anti-slop/jev/plugin.ts" },
    { name: "anti-slop-martinfowler-jev", specifier: "./tools/oxlint/anti-slop/martinfowler/jev-plugin.ts" },
  ],
  rules: {
    "typescript/no-non-null-assertion": "error", // built-in: always "all"
    "landmines/no-fixed-sleep": "error", // "all"
    "anti-slop/no-object-parameters": { level: "error", mode: "changed" }, // ratchet
    "anti-slop/max-ternary-depth": { level: "error", options: [{ maxDepth: 2 }] },
    "anti-slop-effect-jev/unbounded-retry": "error", // Jev: "changed"
    "anti-slop-martinfowler-jev/middle-man": { level: "warn", mode: "all" },
  },
});
```

A rule entry is a severity, Oxlint's `[severity, ...options]`, or `{ level, mode, options }`. Only
the rules the config enables run; a mode never enables a rule. Overrides take the same entries, but
a rule has one mode everywhere. Jev plugins are recognized by name: `jev`, or a name ending in
`-jev`.

The helper returns a standard Oxlint config:

- Each enabled rule's mode goes to `settings.changedLines`, which the Jev plugins and the wrapped
  plugins below read.
- A JS plugin with a rule in `"changed"` mode is registered as a wrapped copy under the same name,
  so rule names and disable comments do not change. The copy calls each original rule with a
  context whose `report` drops findings that touch no changed line. It is a generated module in
  `node_modules/.cache/anti-slop/plugins/` and needs the `oxlint-plugin-jev` package installed,
  which provides the changed-lines module.
- Built-in Oxlint rules (`eslint`, `typescript`, `oxc`, `unicorn`, and the rest) and `effecttsgo/*`
  run natively and cannot be wrapped, so `"changed"` on one of them is a config error. So is
  `"changed"` on a rule whose plugin is registered by a bare specifier string instead of
  `{ name, specifier }`.
- Jev rules are turned off unless `ANTI_SLOP_JEV=1`, so the editor and plain `oxlint` runs never make
  paid requests. Without credentials, Jev warns and skips, except under `CI`.

| Variable | Effect |
| --- | --- |
| `ANTI_SLOP_JEV=1` | Runs the Jev rules. |
| `ANTI_SLOP_MODE=all` | Every rule checks every line, for full runs. |
| `ANTI_SLOP_BASE=<ref>` | Diffs against the merge base with this ref instead of the default branch. The `base` option of `defineAntiSlopConfig` does the same. The diff rules read it too. |

Relative `jsPlugins` specifiers resolve from the config file's directory; pass
`{ root: import.meta.dirname }` as the second argument if the helper cannot find it.

## Hooks

`modes/lint.ts` runs the lint with the right environment for each stage:

```text
node tools/oxlint/anti-slop/modes/lint.ts <commit|push|full> [command...]
```

| Stage | Runs |
| --- | --- |
| `commit` | The free rules on the staged JS and TS files (`ANTI_SLOP_JEV=0`). |
| `push` | The free rules and the Jev rules on the whole project, each in its mode (`ANTI_SLOP_JEV=1`). |
| `full` | Like `push`, with `ANTI_SLOP_MODE=all`. |

The command defaults to `oxlint`. Effect repositories pass their wrapper, for example
`node tools/oxlint/anti-slop/modes/lint.ts push effect-tsgo --tsrs-lint oxlint --type-check`.

- Pre-commit: `node tools/oxlint/anti-slop/modes/lint.ts commit`
- Pre-push: `node tools/oxlint/anti-slop/modes/lint.ts push`
- CI: the pre-push command, then the [diff rules](./diff-rules.md).

Add them with the hook tool the repository already uses:

```sh
# husky: .husky/pre-commit and .husky/pre-push
node tools/oxlint/anti-slop/modes/lint.ts commit
node tools/oxlint/anti-slop/modes/lint.ts push
```

```yaml
# lefthook.yml
pre-commit:
  commands:
    anti-slop:
      run: node tools/oxlint/anti-slop/modes/lint.ts commit
pre-push:
  commands:
    anti-slop:
      run: node tools/oxlint/anti-slop/modes/lint.ts push
```

```json
{
  "simple-git-hooks": {
    "pre-commit": "node tools/oxlint/anti-slop/modes/lint.ts commit",
    "pre-push": "node tools/oxlint/anti-slop/modes/lint.ts push"
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
      - run: node tools/oxlint/anti-slop/diff-rules/run.ts --committed --purpose "$PR_TITLE"
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
```

The Jev plugins set `ci: "fail"`, so a CI run that cannot reach Jev fails. Run
`node tools/oxlint/anti-slop/modes/lint.ts full` on a schedule to see every finding.
