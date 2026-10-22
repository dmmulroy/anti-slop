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

   This creates `tools/oxlint/anti-slop/`. Pass another relative destination as the first argument when the repository has an established tooling layout. The script refuses to replace an existing destination; route existing copies through the update procedure rather than `--force`.

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

   Keep any other formatter out of the same paths. A reformatted vendored copy turns every later update into a whitespace-only diff against upstream. Merge the patterns into the ignore list the repository's formatter reads, for example `ignorePatterns` in `.oxfmtrc.json`, `.prettierignore` (also read by `bun fmt`), `[fmt] ignorePatterns` in `bunfig.toml`, negated `files.includes` entries in `biome.json`, or `excludes` in `dprint.json`. If a pre-commit hook formats staged files (lefthook, lint-staged, husky), exclude the same paths there too: some formatters exit with an error when every file they are given is ignored, which blocks commits that touch only agent assets or the plugin.

   Enable these rules at `"error"`, including the native Oxlint companion rule:

   ```json
   {
     "oxc/no-accumulating-spread": "error",
     "anti-slop/no-array-filter-map": "error",
     "anti-slop/no-reduce-accumulator-copy": "error",
     "anti-slop/no-chained-type-assertions": "error",
     "anti-slop/no-conditional-empty-object-spread": "error",
     "anti-slop/no-known-value-widening": "error",
     "anti-slop/no-module-mocking": "error",
     "anti-slop/no-object-parameters": "error",
     "anti-slop/no-reflect-apply": "error",
     "anti-slop/no-reflect-get": "error",
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
     "anti-slop-effect/no-service-constructor-imports": "error",
     "anti-slop-effect/prefer-effect-match": "error",
   },
   ```

   Merge these entries with the generic plugin configuration rather than replacing it. Do not enable the Effect plugin merely because Effect appears transitively in a lockfile; require a direct package-manifest dependency or an explicit user request. The rule covers relative project imports. Report package-alias imports as a current limitation rather than pretending they are enforced.

   Complete when the generic rules and eligible Effect rules are registered, the formatter and any formatting hook ignore the same paths, and existing configuration is preserved.

4. Run the repository's lint command and typecheck. For Vite+, run the repository's full `vp check` command after adding both lint and format ignores. If findings appear in owned project source, report them and fix them only when the user asked for migration/cleanup. Do not suppress rules, weaken rule severity, add unsafe casts, or mechanically launder types to make lint pass.

   When cleanup is authorized, apply `require-readable-spacing` with lint autofix, then run the repository's formatter and lint again. Confirm a second fix/format pass leaves files unchanged. Keep whitespace fixes separate from semantic edits, preserve documentation attachment and overload groups, and do not enable an entire competing formatting preset.

   Complete when checks have run, fix/format stability has been verified for authorized cleanup, and every failure is resolved or reported with its diagnostics.

5. Record provenance in `UPSTREAM.md` beside the vendored entry point: source repository, exact source commit or recoverable pristine snapshot when available, installed plugin paths, and intentional deviations. Verify that the revision identifies the actual copied assets; a package version or the current upstream HEAD alone is insufficient. If provenance cannot be established, record it as unknown rather than guessing.

   Review the final diff and report the installed path, source identity, dependency/configuration changes, and check results. Complete when the record and report describe the files actually installed and any remaining findings.
