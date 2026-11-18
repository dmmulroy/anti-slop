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
   - Install [`@interfere/landmines`](https://github.com/interfere-inc/landmines) as a development dependency, pinned exactly at the version `npm view @interfere/landmines version` reports. Its testing rules load from the package, not from the vendored copy. It needs `oxlint` 1.81 or later and Node 22.18 or later; if the repository's `oxlint` is older, report that and ask before upgrading `oxlint` and `@oxlint/plugins` together.
   - Do not replace the package manager or rewrite unrelated dependency ranges.

   Complete when matching compatible versions are installed and unrelated dependency ranges are preserved.

3. Register the generic plugin, configure ignores, and enable all generic rules. For `oxlint.config.ts`, wrap the exported config in `defineAntiSlopConfig` from `./tools/oxlint/anti-slop/modes/config.ts` (keep existing fields; it replaces `defineConfig`), so each rule can carry a mode next to its severity (`docs/modes.md` upstream). For Vite+, wrap the `lint` object the same way. A `.oxlintrc.json` cannot use modes; offer converting it to `oxlint.config.ts` when the user wants a ratchet or Jev rules. Merge these fields with the existing configuration:

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
     { name: "landmines", specifier: "@interfere/landmines/testing" },
   ],
   ```

   Keep every existing ignore. Adjust the final pattern when the plugin was copied elsewhere. Inspect the repository for other project-local agent tooling directories and add them rather than linting installed skills, hooks, or generated agent configuration as application source. Do not broadly ignore all dot-directories, because some repositories keep owned source or checks in them.

   For Vite+, add these fields to `lint.ignorePatterns` and `lint.jsPlugins`. Also merge the same patterns into `fmt.ignorePatterns` so `vp check` does not reformat installed agent assets or the vendored plugin. Merge existing entries instead of replacing them.

   Enable these rules at `"error"`, including the native Oxlint companion rules:

   ```json
   {
     "anti-slop/max-ternary-depth": ["error", { "maxDepth": 2 }],
     "oxc/no-accumulating-spread": "error",
     "typescript/no-non-null-assertion": "error",
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
     "anti-slop/require-safety-comment-for-type-assertion": "error",
     "landmines/strict-msw": "error",
     "landmines/no-fixed-sleep": "error",
     "landmines/no-unsignaled-poll": "error",
     "landmines/no-flake-masking": "error"
   }
   ```

   The four `landmines/*` rules come from the `@interfere/landmines/testing` plugin and catch tests that pass without proving anything: MSW started without `onUnhandledRequest: "error"` (`strict-msw`), fixed real-time sleeps in tests and hooks (`no-fixed-sleep`), `vi.waitFor` or `expect.poll` on spy or recorder state (`no-unsignaled-poll`), and test retries or raised timeouts (`no-flake-masking`). Enable exactly these four. Do not use the package's `configs/recommended.json`: it has no `plugins` list, so extending it also turns on Oxlint's default plugins, and it enables `no-test-doubles`, `no-comments`, `colocated-tests`, `test-file-names`, `package-exports`, and `no-explicit-return-types`, which conflict with anti-slop's own rules and with comment and return-type policies that anti-slop leaves to the repository. When cleanup is authorized, fix each finding at its cause: await the operation or a deferred its handler resolves instead of sleeping, use fake timers to move time, make MSW fail on unhandled requests, and remove retries and timeout bumps by fixing what the test waits on. Do not add disable comments or the rules' `allow` lists. When the user wants a ratchet instead of cleanup, set the rule to `{ level: "error", mode: "changed" }`: it then checks only lines changed on the branch, so new code must pass and old violations stay until edited.

   For `no-array-filter-map`, prefer lazy `.values().filter(...).map(...).toArray()` pipelines only when the target runtime supports iterator helpers; otherwise use an appropriate single `flatMap` or locally mutating reducer. Review callback order, indexes, sparse arrays, `thisArg`, and filtering semantics rather than mechanically rewriting chains. Unknown receiver types are deliberately not inferred by this AST/scope rule.

   Pair `no-reduce-accumulator-copy` with native `oxc/no-accumulating-spread`: the custom rule catches supported non-spread copies such as `Object.assign({}, acc, item)`, `Array.from(acc)`, and array accumulator `concat`/`slice` calls. Mutating a fresh local accumulator is allowed; copying individual input items is also allowed. Named callbacks, indirect helpers, and nested accumulator properties are not fully analyzed, so do not claim all quadratic reducers are ruled out.

   Pair the type-assertion rules with native `typescript/no-non-null-assertion`: `value!` asserts that a value is present with no check and no stated invariant, and `require-safety-comment-for-type-assertion` and `no-chained-type-assertions` only see `as` and `<T>` assertions. When cleanup is authorized, replace each one with a check that narrows (an early return, a thrown invariant error, or an `Option`/`undefined` branch), never with an `as` cast or a disable comment. The rule is in Oxlint's `typescript` plugin, which is on by default; a config that sets `plugins` must list `"typescript"`.

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
     "anti-slop-effect/no-static-effect-service-forwarders": "error",
     "anti-slop-effect/no-test-code-in-src": "error",
     "anti-slop-effect/no-unbounded-retry": "error",
     "anti-slop-effect/prefer-effect-match": "error",
     "anti-slop-effect/prefer-tagged-error-handling": "error",
     "anti-slop-effect/prefer-yield-service": "error",
     "anti-slop-effect/require-cause-when-narrowing": "error",
     "anti-slop-effect/require-operation-span": "error",
     "anti-slop-effect/require-service-make-layer": "error",
     "anti-slop-effect/throw-in-effect-gen": "error",
   },
   overrides: [
     {
       files: ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**"],
       rules: { "anti-slop-effect/throw-in-effect-gen": "off" },
     },
   ],
   ```

   `no-static-effect-service-forwarders` rejects static members of a service class that only fetch the service and call one of its methods (`static find = (id) => Users.use((users) => users.find(id))`); callers should `yield* Users` and call the method, so the dependency is visible where it is used. `no-unbounded-retry` is ported from cevr/effect-oxlint's `noUnboundedRetry` (MIT) and requires every `Effect.retry`, `Effect.retryOrElse`, `Stream.retry`, and `HttpClient.retryTransient` policy to stop: a `times` option, `Schedule.upTo({ times })` or `Schedule.upTo({ duration })`, `Schedule.max` with `Schedule.recurs` or `Schedule.during`, a bounded constructor, or a later `Effect.timeout` in the same pipeline. Schedules it cannot read (imports, function results, custom combinators) are left alone. `throw-in-effect-gen` is ported from mpsuesser/enfect's `throw-in-effect-gen` (MIT) and rejects a `throw` whose nearest enclosing function is the generator passed to `Effect.gen`, `Effect.fn` (including `Effect.fn("name")(function* ...)`), or `Effect.fnUntraced`, where it becomes a defect instead of a typed failure. A synchronous function invoked in place counts as part of the generator, and a `throw` inside a `try` block with a `catch` clause is allowed. Throws in helpers, promise callbacks, object methods, and callbacks passed to `Effect.try`, `Effect.tryPromise`, or `Effect.sync` belong to those functions and are not reported. Turn it off for test files with the `overrides` block above, adapted to the repository's test layout, because tests throw inside generators on purpose. When cleanup is authorized, replace each finding with `return yield* Effect.fail(...)` or `return yield* new MyTaggedError({...})`.

   Merge these entries with the generic plugin configuration rather than replacing it. Do not enable the Effect plugin merely because Effect appears transitively in a lockfile; require a direct package-manifest dependency or an explicit user request. The rule covers relative project imports. Report package-alias imports as a current limitation rather than pretending they are enforced.

   For Effect repositories, also install `@effect/tsgo` and enable every Effect language service rule as an error. These rules are type-aware, and they run on the Effect-patched build of tsrs, Oxlint's Rust type-aware backend. Pick the newest `@effect/tsgo` whose README lists the installed `oxlint` and `tsrs` versions under "Supported Package Versions"; Vite+ pins its own Oxlint, so check that version too. Install `@effect/tsgo` and that `tsrs` version as development dependencies, and do not install `oxlint-tsgolint`. Run the lint through the wrapper, which loads the patched Oxlint binding and the patched tsrs without modifying `node_modules`: `"lint": "effect-tsgo --tsrs-lint oxlint --type-check"` (keep the existing paths and flags), or `effect-tsgo --tsrs-lint vp check` and `effect-tsgo --tsrs-lint vp lint` for Vite+. `--type-check` reports TypeScript errors for the whole `tsconfig.json` program in the same tsrs pass, so replace a separate `tsc --noEmit` typecheck with it; if the lint cannot take `--type-check`, typecheck with `effect-tsgo tsrs --noEmit` instead of `tsc`. Plain `oxlint` rejects the `effecttsgo` plugin, so every script, CI step, and hook that lints must use the wrapper. Do not add `effect-tsgo patch --oxlint`: it requires `oxlint-tsgolint`. Add `{ "name": "@effect/language-service", "diagnostics": false }` to `compilerOptions.plugins` in `tsconfig.json`. Then extend every preset and promote each rule except `missing-pipeable-signature`, which demands Effect-style data-last overloads on every exported multi-argument function:

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

   `--tsrs-lint` is experimental in `@effect/tsgo`. If `effect-tsgo --tsrs-lint` fails to start or crashes on the repository, fall back to tsgolint: install the `oxlint-tsgolint` version the same README lists, add `"prepare": "effect-tsgo patch --oxlint"` and run it, and lint with plain `oxlint`. Report the fallback and the tsrs failure to the user.

   When the repository's direct `effect` dependency is 4.1 or later, also install [`oxlint-plugin-effect`](https://github.com/cevr/effect-oxlint) (cevr/effect-oxlint, MIT) as a development dependency, pinned exactly at the version `npm view oxlint-plugin-effect version` reports. Its rules load from the package, not from the vendored copy. The plugin imports `effect` at runtime (peer range `>=4.1.0 <5`) and depends on `@oxlint/plugins` ^1.94. On Effect 3 or 4.0, skip it and report why; do not upgrade `effect` for it. If the repository's `oxlint` is older than 1.94, report that and ask before upgrading `oxlint` and `@oxlint/plugins` together. Register it and enable exactly these ten rules:

   ```ts
   jsPlugins: [
     { name: "effect", specifier: "oxlint-plugin-effect/plugin" },
   ],
   rules: {
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
   },
   ```

   These rules catch Effect code that type-checks but misbehaves at runtime: a `Test`/`Fake`/`Stub`/`Mock` layer that only returns the live layer (`noAliasTestLayer`), an `acquireRelease` whose resource is built before acquire runs (`noEagerAcquire`), `ManagedRuntime.make` inside an Effect program (`noManagedRuntimeInEffect`), `Effect.cached` or `Cache.make` inside an `Effect.fn` operation, which builds new cache state on every call (`noPerCallCacheConstruction`), a logger passed point-free to a callback that also receives an index (`noPointFreeLog`), `Stream.runCollect` on a stream that never ends (`noRunCollectOnUnboundedStream`), `catch`/`catchCause` handlers that turn every failure into `Effect.void` (`noSilentCatchAll`), `concurrency: "unbounded"` over a collection that can grow (`noUnboundedConcurrency`), lint, Effect, or TypeScript suppressions without a ` -- ` reason (`requireSuppressionReason`), and `ChildProcess.make` commands without `forceKillAfter`, whose child can ignore SIGTERM and hold its scope open forever when interrupted (`requireForceKillAfter`). `noUnboundedConcurrency` pairs with `effecttsgo/missing-concurrency-option`: the tsgo rule asks for a concurrency option and this rule rejects `"unbounded"` as the answer.

   Do not extend `presets/recommended.json` or spread the `recommended` preset, and do not enable other `effect/*` rules. The preset turns on rules that duplicate anti-slop, landmines, or `@effect/tsgo` checks (the anti-slop copies such as `noChainedTypeAssertions`, plus `noModuleMocks`, `noFixedWaitInTests`, `noNestedEffectGen`, `preferEffectFn`, `noEffectDo`, `noGlobals`, and `noNodeBuiltinImport`), bans ordinary language features (`noNullish`, `noTernary`, `noAsyncFunction`, `noThrowStatement`, `noTryCatch`, `noNewPromise`, `noNewError`, `noAs`, and `noComments`, which also deletes the SAFETY comments `require-safety-comment-for-type-assertion` requires), and encodes runtime or test-layout policy that anti-slop leaves to the repository. `effect/noUnboundedRetry` stays off because version 0.32.4 reports retries bounded with `Schedule.upTo({ times })` or `Schedule.upTo({ duration })`, the Effect 4.1 way to bound a schedule, and retries followed by `Effect.timeout`; `anti-slop-effect/no-unbounded-retry` is the corrected port.

   When cleanup is authorized, fix each finding at its cause: give each suppression a reason after ` -- ` that says why the check does not apply (or remove the suppression), choose a finite concurrency, record the cause before recovering or recover a named failure instead of erasing it (switching to `Effect.ignore` hides the same failure), build the resource inside acquire, construct caches once in the owning layer, terminate a stream with `take`, `takeUntil`, `takeWhile`, or `timeout` before collecting it, and name `forceKillAfter` (for example `"5 seconds"`) on each `ChildProcess.make`, or `killSignal: "SIGKILL"`.

   In every Effect repository, also install [`@enfect/oxlint`](https://github.com/mpsuesser/enfect/tree/main/plugins/oxlint) (mpsuesser/enfect, MIT) as a development dependency, pinned exactly at the version `npm view @enfect/oxlint version` reports. It depends on its own `effect` and `@oxlint/plugins` ^1.85, so it does not constrain the repository's Effect version. Register it under the name `enfect`, never `effect`, which is cevr's plugin, and enable exactly these eight rules:

   ```ts
   jsPlugins: [
     { name: "enfect", specifier: "@enfect/oxlint" },
   ],
   rules: {
     "enfect/effect-promise-vs-trypromise": "error",
     "enfect/prefer-redacted-config": "error",
     "enfect/avoid-option-getorthrow": "error",
     "enfect/effect-run-in-body": "error",
     "enfect/no-cause-in-http-response": "error",
     "enfect/no-effect-ignore-then-as": "error",
     "enfect/avoid-expect-in-if": "error",
     "enfect/yield-in-for-loop": "error",
   },
   ```

   They reject every `Effect.promise`, whose rejection becomes a defect instead of a typed failure (`effect-promise-vs-trypromise`), secret-named configuration read with `Config.String` or `Config.NonEmptyString`, or a secret-named `Schema.String` field in `Config.schema`, instead of a redacted value (`prefer-redacted-config`), any `.getOrThrow` member access (`avoid-option-getorthrow`), every `Effect.runSync`, `Effect.runPromise`, and `Effect.runFork` (`effect-run-in-body`; turn it off in an `overrides` block for entry points and test harnesses), `Cause.pretty`, `Cause.squash`, or a caught cause or error rendered into an HTTP response body (`no-cause-in-http-response`), `Effect.ignore` immediately before `Effect.as` in a pipe, which only hides the failure (`no-effect-ignore-then-as`), `expect` inside an `if`, which passes when the branch is skipped (`avoid-expect-in-if`), and `yield*` inside a `for` loop instead of `Effect.forEach` with an explicit concurrency (`yield-in-for-loop`). Do not use the package's other rules: most duplicate anti-slop, `@effect/tsgo`, or cevr checks, or ban ordinary language features. `enfect/throw-in-effect-gen` stays off because version 0.10.0 reports every `throw` lexically inside the generator, including throws in nested helpers, promise callbacks, object methods, and `Effect.sync` thunks, and misses `Effect.fn("name")(function* ...)`; `anti-slop-effect/throw-in-effect-gen` is the corrected port. `effect-promise-vs-trypromise`, `yield-in-for-loop`, `effect-run-in-body`, and `avoid-expect-in-if` produce many findings in established codebases, mostly in tests; report the counts and fix them only when cleanup is authorized.

   Complete when the generic rules, eligible Effect rules, the eight `enfect/*` rules, and, on Effect 4.1 or later, the ten `effect/*` rules are registered and existing configuration is preserved.

   If a package manifest declares `xstate` as a direct dependency, or the user asks for XState rules, also register the opt-in XState plugin. Do not enable it for a transitive `xstate` in a lockfile:

   ```ts
   jsPlugins: [
     { name: "anti-slop-xstate", specifier: "./tools/oxlint/anti-slop/xstate/index.ts" },
   ],
   rules: {
     "anti-slop-xstate/no-direct-xstate-create-machine": "error",
     "anti-slop-xstate/no-direct-xstate-use-selector": "error",
     "anti-slop-xstate/no-multiple-xstate-hooks": "error",
     "anti-slop-xstate/no-single-use-xstate-actions": "error",
     "anti-slop-xstate/no-single-use-xstate-guards": "error",
     "anti-slop-xstate/require-xstate-event-satisfies": "error",
   },
   ```

   They require machines built with `setup({ ... }).createMachine(...)` rather than `createMachine`, reject `useSelector` from `@xstate/react` and a second `useMachine`, `useActor`, or `useActorRef` in one component, reject `setup` actions and guards the machine references only once (inline those), and require `send({ type: ... } satisfies MachineEvent)` in files that import XState. The `no-direct-xstate-use-selector` and `no-multiple-xstate-hooks` rules only apply to React code.

   Rule modes: `"all"` (the default for deterministic rules) checks every line; `"changed"` (the default for Jev rules) checks only lines changed against the merge base of `HEAD` and the default branch. `"changed"` works on rules from JS plugins registered as `{ name, specifier }` (anti-slop, landmines, `oxlint-plugin-effect`, `@enfect/oxlint`), which the helper registers as wrapped copies that need the `oxlint-plugin-jev` package (`--jev`) installed. Built-in Oxlint rules and `effecttsgo/*` run natively, and the helper rejects `"changed"` on them; do not work around that error.

   Optional, paid checks. Offer them only when the user opts in, because each match or diff is a paid model request:

   - **Jev rules** (the Effect questions for Effect repositories, the Martin Fowler smell questions for any repository): these use Kyle Mistele's fork of `oxlint-plugin-jev`, which is not on npm. Run the installer with `--jev` and add the vendored build as a local package so its dependencies (`ai`, `@ai-sdk/typesafe-ai`, `zod`, `synckit`) install normally, for example `npm install --save-dev ./tools/oxlint/oxlint-plugin-jev`, which records `"oxlint-plugin-jev": "file:tools/oxlint/oxlint-plugin-jev"`. It needs Node 22 or later. Add `tools/oxlint/oxlint-plugin-jev/**` to the lint and format ignores.
     - Register the plugin entries in `jsPlugins`: `{ name: "anti-slop-effect-jev", specifier: "./tools/oxlint/anti-slop/jev/plugin.ts" }` (Effect repositories) and `{ name: "anti-slop-martinfowler-jev", specifier: "./tools/oxlint/anti-slop/martinfowler/jev-plugin.ts" }`. Every question is its own rule, `<plugin>/<id>`.
     - Enable them in the same `defineAntiSlopConfig` config, as `docs/jev.md` upstream shows: every `effectSourceJevRules` id at `"error"` and every `martinFowlerJevRules` id at `"warn"`, plus an `overrides` block for test globs that turns the source and smell rules `"off"` and `anti-slop-effect-jev/test-cannot-fail` `"error"`. Keep the user's per-question severity choices; `"off"` sends nothing. The helper keeps Jev rules off unless `ANTI_SLOP_JEV=1`, so the editor never calls Jev, and runs them in `"changed"` mode unless a rule sets `mode: "all"`. Do not create a separate `oxlint.jev.config.ts`.
     - Tell the user to set `TYPESAFE_API_KEY` (or `FACTORY_API_KEY` for Factory's decision endpoint, or `AI_GATEWAY_API_KEY` for an AI Gateway model id), as a CI secret too; both plugin entries set `ci: "fail"`, so a CI run without a key fails. For pull-request jobs, set `ANTI_SLOP_BASE=origin/<base>` and fetch the base. For judge mode (any AI SDK chat model instead of Jev), add `judge: { model }` in the vendored `plugin.ts` and `jev-plugin.ts`; a bare model id goes through AI Gateway (`AI_GATEWAY_API_KEY`), or `judge.provider` names a module default-exporting an AI SDK provider, whose package the user installs.
     - The two plugins send up to two requests per file. If the user wants one, build a single `createJevPlugin` from both presets as `docs/jev.md` ("Two plugins, or one") shows and register it instead.
   - **Martin Fowler AST smells:** register `anti-slop-martinfowler` with its rules at `"warn"` (see the README). These are free and can run in the editor.
   - **Diff rules:** add `"lint:diff": "node tools/oxlint/anti-slop/diff-rules/run.ts"` and run it in CI after the lint, not in the editor or pre-commit hook. They need `TYPESAFE_API_KEY`, `FACTORY_API_KEY`, `AI_GATEWAY_API_KEY`, `LLM_JUDGE_BASE_URL` plus `LLM_JUDGE_MODEL`, or a judge `command`; without credentials they warn and exit 0. The model backends load the Vercel AI SDK from the consumer's `node_modules`, so install, as development dependencies, only what the chosen backend needs (versions from `docs/diff-rules.md` "Dependencies" upstream): `ai zod @ai-sdk/typesafe-ai` for the decision model against TypeSafe directly or through Factory, `ai zod @ai-sdk/anthropic` for an LLM judge through Factory, `ai zod` for the decision model or LLM judge through AI Gateway, and `ai zod @ai-sdk/openai-compatible` for an LLM judge at `LLM_JUDGE_BASE_URL`; the `command` backend needs nothing. A typecheck that includes the vendored folder needs `ai` installed. Keep the vendored copy outside `node_modules`, where Node does not strip types. Add `anti-slop-diff-rules.config.ts` only for local rule, cutoff, or exclude changes.

   Install git hooks with the repository's existing hook tool (husky, lefthook, simple-git-hooks, or Vite+'s hook configuration); without one, commit `.githooks/pre-commit` and `.githooks/pre-push` and add `"prepare": "git config core.hooksPath .githooks"`. Use `node tools/oxlint/anti-slop/modes/lint.ts commit` for pre-commit (free rules on staged files) and `node tools/oxlint/anti-slop/modes/lint.ts push` for pre-push (free rules plus Jev rules on changed lines); Effect repositories append their lint command, for example `... push effect-tsgo --tsrs-lint oxlint --type-check`. CI runs the pre-push command plus the diff rules; add the GitHub Actions workflow from `docs/modes.md` upstream when the repository uses GitHub Actions and the user wants CI. Never add `--no-verify` or other hook bypasses. Ask before adding hooks to a repository that has none.

   Record the vendored `oxlint-plugin-jev` fork commit (from `tools/oxlint/oxlint-plugin-jev/UPSTREAM.md`) in anti-slop's `UPSTREAM.md` when any jev rules are installed.

4. Run the repository's lint command and typecheck. When tsrs is installed, the typecheck is the lint's `--type-check` or `effect-tsgo tsrs --noEmit`, not `tsc`. For Vite+, run the repository's full `vp check` command after adding both lint and format ignores. If findings appear in owned project source, report them and fix them only when the user asked for migration/cleanup. Do not suppress rules, weaken rule severity, add unsafe casts, or mechanically launder types to make lint pass.

   When cleanup is authorized, apply `require-readable-spacing` with lint autofix, then run the repository's formatter and lint again. Confirm a second fix/format pass leaves files unchanged. Keep whitespace fixes separate from semantic edits, preserve documentation attachment and overload groups, and do not enable an entire competing formatting preset.

   Complete when checks have run, fix/format stability has been verified for authorized cleanup, and every failure is resolved or reported with its diagnostics.

5. Record provenance in `UPSTREAM.md` beside the vendored entry point: source repository, exact source commit or recoverable pristine snapshot when available, installed plugin paths, and intentional deviations. Verify that the revision identifies the actual copied assets; a package version or the current upstream HEAD alone is insufficient. If provenance cannot be established, record it as unknown rather than guessing.

   Review the final diff and report the installed path, source identity, dependency/configuration changes, and check results. Complete when the record and report describe the files actually installed and any remaining findings.
