---
name: install-anti-slop
description: Install, configure, update, or upgrade vendored anti-slop Oxlint plugins. Use when adding anti-slop, picking up upstream rules or fixes, or migrating an existing installation while preserving local customizations.
---

# Install or update anti-slop

Anti-slop is vendored code: the target repository owns its rules, diagnostics, tests, and configuration. Preserve those choices when bringing in upstream changes.

## Choose the path

Read the repository's agent instructions and `git status`. Identify its package manager, Oxlint/Vite+ configuration, and any existing anti-slop entry points, including renamed or relocated copies referenced by `jsPlugins`.

- **Existing installation — update, upgrade, migrate, or reconfigure:** read [Update a vendored installation](references/update.md) and follow that procedure instead of the fresh-install steps below.
- **No installation — fresh install:** follow the procedure below. If the user requested an update but no installation can be found, confirm the target before installing.

Complete when the operation and target path are established and pre-existing work is identified.

## Fresh install

1. Copy the bundled plugin from this skill. Run from the target repository:

   ```bash
   node <skill-directory>/scripts/install.mjs
   ```

   This creates `tools/oxlint/anti-slop/`. Pass another relative destination as the first argument when the repository has an established tooling layout. Add `--jev` when the user opts into the jev checks below: it also copies the built `oxlint-plugin-jev` fork from `assets/oxlint-plugin-jev/` to `oxlint-plugin-jev/` beside the plugin (`--jev=<path>` for another place). The script refuses to replace an existing destination; route existing copies through the update procedure rather than `--force`.

   Preserve the nested `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md`; they travel with the copied rule. Readability enforcement is self-contained and requires no Stylistic plugin dependency.

   Complete when the files, including vendored license and provenance, exist at the agreed destination without replacing an existing copy.

2. Install current compatible dependencies rather than trusting versions remembered by the agent:
   - If the repository already depends on `oxlint`, read its installed version from the package manager or lockfile and install `@oxlint/plugins` at exactly that version. Pin it exactly rather than by range so future upgrades move both packages together.
   - Only when the repository has no `oxlint` dependency, query `npm view oxlint version` and `npm view @oxlint/plugins version`, then install the same current version of both packages.
   - `oxlint` is a development dependency. The copied source imports `@oxlint/plugins`, so install it as a development dependency for a local-only plugin.
   - Do not replace the package manager or rewrite unrelated dependency ranges.

   Complete when matching compatible versions are installed and unrelated dependency ranges are preserved.

3. Register the generic plugin, configure ignores, and enable all generic rules. For `oxlint.config.ts` or `.oxlintrc.json`, merge these fields with the existing configuration:

   ```ts
   ignorePatterns: [
     ".agent/**",
     ".agents/**",
     ".claude/**",
     ".codex/**",
     ".continue/**",
     ".cursor/**",
     ".gemini/**",
     ".opencode/**",
     ".pi/**",
     ".roo/**",
     ".windsurf/**",
     "tools/oxlint/anti-slop/**",
   ],
   jsPlugins: [
     { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
   ],
   ```

   Keep every existing ignore. Adjust the final pattern when the plugin was copied elsewhere. Inspect the repository for other project-local agent tooling directories and add them rather than linting installed skills, hooks, or generated agent configuration as application source. Do not broadly ignore all dot-directories, because some repositories keep owned source or checks in them.

   For Vite+, add these fields to `lint.ignorePatterns` and `lint.jsPlugins`. Also merge the same patterns into `fmt.ignorePatterns` so `vp check` does not reformat installed agent assets or the vendored plugin. Merge existing entries instead of replacing them.

   Enable these rules at `"error"`, including the native Oxlint companion rule:

   ```json
   {
     "anti-slop/max-ternary-depth": ["error", { "maxDepth": 2 }],
     "oxc/no-accumulating-spread": "error",
     "anti-slop/no-array-filter-map": "error",
     "anti-slop/no-reduce-accumulator-copy": "error",
     "anti-slop/no-chained-type-assertions": "error",
     "anti-slop/no-conditional-spread": "error",
     "anti-slop/no-disabled-type-assertion-rules": "error",
     "anti-slop/no-known-value-widening": "error",
     "anti-slop/no-module-mocking": "error",
     "anti-slop/no-object-parameters": "error",
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
     "anti-slop/require-safety-comment-for-type-assertion": "error"
   }
   ```

   For `no-array-filter-map`, prefer lazy `.values().filter(...).map(...).toArray()` pipelines only when the target runtime supports iterator helpers; otherwise use an appropriate single `flatMap` or locally mutating reducer. Review callback order, indexes, sparse arrays, `thisArg`, and filtering semantics rather than mechanically rewriting chains. Unknown receiver types are deliberately not inferred by this AST/scope rule.

   Pair `no-reduce-accumulator-copy` with native `oxc/no-accumulating-spread`: the custom rule catches supported non-spread copies such as `Object.assign({}, acc, item)`, `Array.from(acc)`, and array accumulator `concat`/`slice` calls. Mutating a fresh local accumulator is allowed; copying individual input items is also allowed. Named callbacks, indirect helpers, and nested accumulator properties are not fully analyzed, so do not claim all quadratic reducers are ruled out.

   If the repository declares `effect` in a package manifest, or the user explicitly requests Effect rules, also register the opt-in Effect plugin:

   ```ts
   jsPlugins: [
     {
       name: "anti-slop-effect",
       specifier: "./tools/oxlint/anti-slop/effect/index.ts",
     },
   ],
   rules: {
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
   },
   ```

   Merge these entries with the generic plugin configuration rather than replacing it. Do not enable the Effect plugin merely because Effect appears transitively in a lockfile; require a direct package-manifest dependency or an explicit user request. The rule covers relative project imports. Report package-alias imports as a current limitation rather than pretending they are enforced.

   For Effect repositories, also install `@effect/tsgo` and enable every Effect language service rule as an error. Pick the newest `@effect/tsgo` whose README lists the installed `oxlint`, `oxlint-tsgolint`, and `typescript` versions under "Supported Package Versions"; Vite+ pins its own Oxlint, so check that version too. Install `@effect/tsgo` and `oxlint-tsgolint` as development dependencies, add `"prepare": "effect-tsgo patch --oxlint"` and run it, and add `{ "name": "@effect/language-service", "diagnostics": false }` to `compilerOptions.plugins` in `tsconfig.json`. Then extend every preset and promote each rule except `missing-pipeable-signature`, which demands Effect-style data-last overloads on every exported multi-argument function:

   ```ts
   import { presets } from "@effect/tsgo/oxlint-presets";

   const effectTsgoRules = Object.values(presets).flatMap((preset) =>
     Object.keys(preset.rules ?? {}),
   );

   export default defineConfig({
     extends: Object.values(presets),
     rules: {
       ...Object.fromEntries(effectTsgoRules.map((rule) => [rule, "error"])),
       "effecttsgo/missing-pipeable-signature": "off",
     },
   });
   ```

   Complete when the generic rules and eligible Effect rules are registered and existing configuration is preserved.

   Optional, paid checks. Offer them only when the user opts in, because each match or diff is a paid model request:

   - **Jev rules** (the Effect questions for Effect repositories, the Martin Fowler smell questions for any repository): these use Kyle Mistele's fork of `oxlint-plugin-jev`, which is not on npm. Run the installer with `--jev` and add the vendored build as a local package so its dependencies (`ai`, `@ai-sdk/typesafe-ai`, `zod`, `synckit`) install normally, for example `npm install --save-dev ./tools/oxlint/oxlint-plugin-jev`, which records `"oxlint-plugin-jev": "file:tools/oxlint/oxlint-plugin-jev"`. It needs Node 22 or later. Add `tools/oxlint/oxlint-plugin-jev/**` to the lint and format ignores.
     - Register the plugin entries in the base `jsPlugins` without enabling any of their rules: `{ name: "anti-slop-effect-jev", specifier: "./tools/oxlint/anti-slop/jev/plugin.ts" }` (Effect repositories) and `{ name: "anti-slop-martinfowler-jev", specifier: "./tools/oxlint/anti-slop/martinfowler/jev-plugin.ts" }`. Every question is its own rule, `<plugin>/<id>`.
     - Create `oxlint.jev.config.ts` from the overlay in `docs/jev.md` upstream. It spreads the base config (`...base`, `rules: { ...base.rules }`, `overrides: [...(base.overrides ?? [])]`) instead of `extends: [base]`, because oxlint rejects relative `jsPlugins` specifiers that arrive through `extends` in a TypeScript config. Enable every `effectSourceJevRules` id at `"error"` and every `martinFowlerJevRules` id at `"warn"`, then add an `overrides` block for test globs that turns the source and smell rules `"off"` and `anti-slop-effect-jev/test-cannot-fail` `"error"`. Keep the user's per-question severity choices; `"off"` sends nothing.
     - Add `"lint:jev": "node tools/oxlint/anti-slop/jev/lint-changed.ts -c oxlint.jev.config.ts"` and `"lint:jev:full": "node tools/oxlint/anti-slop/jev/lint-changed.ts --all -c oxlint.jev.config.ts"`, then `check:fast` running the normal checks plus `lint:jev`, and `check:full` running them plus `lint:jev:full`. `lint-changed.ts` lints only changed files and sets `JEV_CHANGED_ONLY=1`, so jev asks only about changed functions; `--all` sets it to `0`. The runner needs Node 22.18 or later.
     - Tell the user to set `TYPESAFE_API_KEY` (or `FACTORY_API_KEY` for Factory's decision endpoint, or `AI_GATEWAY_API_KEY` for an AI Gateway model id), as a CI secret too; both plugin entries set `ci: "fail"`, so a CI run without a key fails. For pull-request jobs, set `JEV_CHANGED_ONLY=1` and `JEV_CHANGED_BASE=origin/<base>`. For judge mode (any AI SDK chat model instead of Jev), add `judge: { model }` in the vendored `plugin.ts` and `jev-plugin.ts`; a bare model id goes through AI Gateway (`AI_GATEWAY_API_KEY`), or `judge.provider` names a module default-exporting an AI SDK provider, whose package the user installs.
     - The two plugins send up to two requests per file. If the user wants one, build a single `createJevPlugin` from both presets as `docs/jev.md` ("Two plugins, or one") shows and register it instead.
   - **Martin Fowler AST smells:** register `anti-slop-martinfowler` with its rules at `"warn"` (see the README). These are free and can run in the editor.
   - **Diff rules:** add `"lint:diff": "node tools/oxlint/anti-slop/diff-rules/run.ts"` and append it to `check:full` only, never `check:fast`. They need `TYPESAFE_API_KEY`, `FACTORY_API_KEY`, `AI_GATEWAY_API_KEY`, `LLM_JUDGE_BASE_URL` plus `LLM_JUDGE_MODEL`, or a judge `command`; without credentials they warn and exit 0. The model backends load the Vercel AI SDK from the consumer's `node_modules`, so install, as development dependencies, only what the chosen backend needs (versions from `docs/diff-rules.md` "Dependencies" upstream): `ai zod @ai-sdk/typesafe-ai` for the decision model against TypeSafe directly or through Factory, `ai zod @ai-sdk/anthropic` for an LLM judge through Factory, `ai zod` for the decision model or LLM judge through AI Gateway, and `ai zod @ai-sdk/openai-compatible` for an LLM judge at `LLM_JUDGE_BASE_URL`; the `command` backend needs nothing. A typecheck that includes the vendored folder needs `ai` installed. Keep the vendored copy outside `node_modules`, where Node does not strip types. Add `anti-slop-diff-rules.config.ts` only for local rule, cutoff, or exclude changes.

   Record the vendored `oxlint-plugin-jev` fork commit (from `tools/oxlint/oxlint-plugin-jev/UPSTREAM.md`) in anti-slop's `UPSTREAM.md` when any jev rules are installed.

4. Run the repository's lint command and typecheck. For Vite+, run the repository's full `vp check` command after adding both lint and format ignores. If findings appear in owned project source, report them and fix them only when the user asked for migration/cleanup. Do not suppress rules, weaken rule severity, add unsafe casts, or mechanically launder types to make lint pass.

   When cleanup is authorized, apply `require-readable-spacing` with lint autofix, then run the repository's formatter and lint again. Confirm a second fix/format pass leaves files unchanged. Keep whitespace fixes separate from semantic edits, preserve documentation attachment and overload groups, and do not enable an entire competing formatting preset.

   Complete when checks have run, fix/format stability has been verified for authorized cleanup, and every failure is resolved or reported with its diagnostics.

5. Record provenance in `UPSTREAM.md` beside the vendored entry point: source repository, exact source commit or recoverable pristine snapshot when available, installed plugin paths, and intentional deviations. Verify that the revision identifies the actual copied assets; a package version or the current upstream HEAD alone is insufficient. If provenance cannot be established, record it as unknown rather than guessing.

   Review the final diff and report the installed path, source identity, dependency/configuration changes, and check results. Complete when the record and report describe the files actually installed and any remaining findings.
