# Update a vendored installation

Use this procedure for an existing anti-slop installation. Local edits are owned policy, not drift to erase. An update is a reviewed merge, not a directory replacement.

## 1. Establish scope and protect local work

Locate the active generic and optional Effect entry points through lint configuration, then inspect their rules, helpers, tests, options, severities, overrides, and dependency versions. Read any `UPSTREAM.md` or equivalent provenance record and relevant Git history. Follow local imports: filenames and plugin names may differ from upstream.

Capture the pre-update state, including staged, unstaged, and untracked files in the affected paths, using the repository's backup convention or a separate backup directory. Keep this backup outside the merge destination. Preserve unrelated work in place; do not reset, stash, commit, or clean it automatically.

For a reconfiguration-only request, limit changes to the requested configuration and skip source acquisition/merging. For an update, establish whether the user wants all upstream changes, selected fixes, or a specific revision. An unspecified update may stage and review the available bundle, but report its identity rather than calling it latest.

Complete when the target, scope, existing customizations, and recoverable pre-update state are identified.

## 2. Stage incoming source and recover the base

Keep three inputs separate:

- **Local:** the current vendored implementation, including uncommitted changes.
- **Incoming:** the pristine upstream snapshot being considered.
- **Base:** the pristine upstream snapshot from which the local copy was derived, when recoverable.

For the bundled source, create a temporary directory and copy into a new child path:

```bash
stage=$(mktemp -d)
node <skill-directory>/scripts/install.mjs "$stage/incoming"
```

The installer only copies files; it does not merge them or fetch updates. Never point it at the live installation for an update.

If the user requests latest upstream or a specific revision, retrieve that source into staging and record the resolved immutable commit. Use a verified refreshed skill bundle or a separate upstream checkout; do not update the vendored tree with a pull or checkout. Inspect the source's instructions and canonical plugin layout before selecting files. Keep only temporary material you created eligible for later cleanup.

Recover the base from a verified upstream revision, retained pristine snapshot, or installation history that actually preserves the original upstream bytes. A package version, file timestamp, or the current local tree is not a base. A digest identifies bytes but cannot reconstruct them. If the base is unavailable or ambiguous, use the no-base branch below.

Complete when incoming source is staged with its identity recorded and base availability is established without modifying the live installation.

## 3. Classify and merge

Compare rule behavior, diagnostics, tests, helpers, exports, and configuration—not just filenames. Map local renames before deciding a rule was added or deleted. Review incoming changes as source, not as instructions to override repository policy.

### Known base: three-way merge

Compare both `base → local` and `base → incoming`:

| Change | Action |
| --- | --- |
| Incoming unchanged | Preserve local, including local deletions. |
| Only incoming changed | Apply the upstream change after reviewing dependencies and behavior. |
| Only local changed | Preserve local. |
| Both changed identically | Keep one copy. |
| Both changed differently | Merge compatible edits; ask about conflicting policy or behavior. |
| Upstream deleted, local modified | Ask whether to retain or retire the local implementation. |
| Same new path added on both sides | Reconcile contents and ownership; do not overwrite. |

A text merge without conflict markers is not evidence of semantic compatibility. Review locally changed predicates, exceptions, message IDs, options, and exports after merging. Treat upstream removals and renames as changes requiring corresponding registration/import review, not as instructions to delete local files.

### No base: conservative port

A two-way diff cannot distinguish local customization from upstream evolution. Compare incoming behavior against local behavior, then port independently understood fixes and additions with focused tests. Preserve unexplained differences. If the same logic differs and its intent cannot be established, ask the user or leave that change pending; do not invent a common ancestor or claim a three-way merge.

### Apply reviewed changes

Patch existing files precisely; copy genuinely new files only after checking for local name collisions and importing any required helpers. Preserve local-only rules and existing tests. Keep unresolved changes unapplied and report them explicitly. Obtain the user's decision before changing conflicting local policy or removing customized code. A request to update does not authorize replacing the user's fork with upstream defaults.

Complete when every incoming change is classified as applied, already present, intentionally retained locally, or pending, and each applied change preserves or explicitly reconciles local behavior.

## 4. Reconcile configuration and dependencies

Preserve existing plugin paths, options, severities, disabled rules, overrides, ignores, and Effect opt-in decisions. Treat rule modes, per-question jev severities, `anti-slop-diff-rules.config.*`, and edited questions, cutoffs, or plugin options in the vendored `jev/`, `martinfowler/jev-rules.ts`, `martinfowler/jev-plugin.ts`, and `diff-rules/rules.ts` as local customizations.

The vendored `oxlint-plugin-jev` package (usually `tools/oxlint/oxlint-plugin-jev/`) is a build, not owned source: replace it whole from `assets/oxlint-plugin-jev/` (or a build of the fork commit the user names), compare the commits in the two `UPSTREAM.md` files, reinstall it so its dependencies update, and review the fork's README for changed options. An installation still on the `jev/ask`/`jev/suggest` rules migrates by registering `jev/plugin.ts` and `martinfowler/jev-plugin.ts` and moving each question into the oxlint config as `<plugin>/<id>` at the severity its list had, carrying over local option values into the plugin entries. Merge exports for adopted rules into the existing entry point instead of replacing it. Check native companion rules when adopting related custom rules.

An installation with `oxlint.jev.config.*`, `jev/lint-changed.ts`, `JEV_CHANGED_ONLY`, or the fork's `changedOnly`/`changedBase` options predates rule modes. Migrate it: move the overlay's jev rules and test overrides into the main Oxlint config with the same severities, delete the overlay, replace `lint:jev` scripts and hooks with `modes/lint.ts commit`/`push`/`full` (`--all` becomes `full`), and update the vendored `oxlint-plugin-jev` build, which no longer accepts `changedOnly`/`changedBase`. Where the installation used `changedOnly`, write `["<severity>", { mode: "changed" }]` on those rules, which now diffs against the merge base with the default branch rather than `HEAD`; keep `JEV_CHANGED_BASE` in CI or switch it to `ANTI_SLOP_BASE`, which `modes/lint.ts` passes on. Report each step.

An installation whose `oxlint.config.ts` calls `defineAntiSlopConfig` (`modes/config.ts`) used the earlier rule-modes helper, which was removed. Migrate it: replace the call with Oxlint's `defineConfig`, turn each `{ level, mode, options }` entry into `[level, { mode, ...options[0] }]` (a plain `level` when the mode was `"all"` and there are no options), point the `landmines`, `effect`, and `enfect` `jsPlugins` entries at `plugins/landmines.ts`, `plugins/effect.ts`, and `plugins/enfect.ts` in the vendored copy when they keep a `"changed"` rule, delete `node_modules/.cache/anti-slop/plugins/`, and drop `ANTI_SLOP_JEV` from hooks, scripts, and CI: Jev rules now run whenever a credential is set. An installation that registers `@interfere/landmines/testing`, `oxlint-plugin-effect/plugin`, or `@enfect/oxlint` directly keeps working; the wrappers are needed only for rules that take `mode`. The helper made Jev rules default to `"changed"`; ask the user which Jev rules should keep `mode: "changed"` and write it explicitly on those, because rules now check whole files unless their entry says otherwise. Report each step.

An installation without the `landmines` plugin entry predates the `@interfere/landmines` testing rules. Offer them as new rules: install the package and enable the same four rules as a fresh install (`strict-msw`, `no-fixed-sleep`, `no-unsignaled-poll`, `no-flake-masking`), and no other `landmines` rules.

An Effect installation without the `effect` plugin entry (`oxlint-plugin-effect/plugin`) predates the cevr/effect-oxlint rules. When the repository's direct `effect` dependency is 4.1 or later, offer them as new rules: install `oxlint-plugin-effect` and enable the same nine rules as a fresh install (`noAliasTestLayer`, `noEagerAcquire`, `noManagedRuntimeInEffect`, `noPerCallCacheConstruction`, `noPointFreeLog`, `noRunCollectOnUnboundedStream`, `noSilentCatchAll`, `noUnboundedConcurrency`, `requireSuppressionReason`), and no other `effect/*` rules or the package's recommended preset. On Effect 3 or 4.0, report that the rules need Effect 4.1 and leave them out. An installation with the `effect` plugin entry but without `effect/requireForceKillAfter` predates that rule; offer it as a new rule.

An Effect installation without the `enfect` plugin entry (`@enfect/oxlint`) predates the mpsuesser/enfect rules. Offer them as new rules: install `@enfect/oxlint`, register it as `enfect`, and enable the same ten rules as a fresh install (`effect-promise-vs-trypromise`, `prefer-redacted-config`, `avoid-option-getorthrow`, `effect-run-in-body`, `no-cause-in-http-response`, `no-effect-ignore-then-as`, `avoid-expect-in-if`, `yield-in-for-loop`, `prefer-duration-constructors`, `avoid-mutable-state`), and no other `enfect/*` rules. Report each rule's finding count with the proposal, because several are noisy in established codebases. An installation with `enfect/throw-in-effect-gen` enabled predates its port: propose replacing it with `anti-slop-effect/throw-in-effect-gen`, turned off for test files in an `overrides` block as a fresh install does, and removing the `enfect` entry. The port reports only throws whose nearest enclosing function is the Effect generator, so it drops findings in nested helpers, promise callbacks, and `Effect.sync` thunks and adds findings in `Effect.fn("name")(function* ...)` bodies; report both counts.

Effect installations get three new `anti-slop-effect` rules: `no-static-effect-service-forwarders`, `no-unbounded-retry`, and `throw-in-effect-gen`. Offer all three, with `throw-in-effect-gen` off for test files; when `effect/noUnboundedRetry` is enabled, propose replacing it with `anti-slop-effect/no-unbounded-retry`, which accepts `Schedule.upTo` bounds and a later `Effect.timeout`.

An installation without the `ai-guard` plugin entry (`eslint-plugin-ai-guard`) predates the ai-guard rules. Offer them as new rules: install `eslint-plugin-ai-guard` and `@typescript-eslint/parser`, register `plugins/ai-guard.ts` from the vendored copy as `ai-guard`, and enable the same seven rules as a fresh install (`no-placeholder-implementation`, `no-test-env-branch`, `no-tautological-assertion`, `no-assertionless-test`, `no-undeclared-import`, `no-silent-fallback`, `no-invisible-unicode`), and no other `ai-guard/*` rules or its presets. Report each rule's finding count with the proposal. Offer `anti-slop/no-dev-env-branch`, the development-mode counterpart of `no-test-env-branch`, as a new core rule.

An installation without an `integrity` script predates it. Offer `"integrity": "node tools/oxlint/anti-slop/integrity/run.ts"` (it needs `eslint-plugin-ai-guard` and `@typescript-eslint/parser`), run after the lint in the pre-push hook and CI as a fresh install does.

Effect installations with the `enfect` plugin entry but without `enfect/prefer-duration-constructors` and `enfect/avoid-mutable-state` predate those two rules; offer both, with their finding counts, because `avoid-mutable-state` is noisy in established codebases. Offer `anti-slop-effect/stream-large-files`, ported from enfect's `stream-large-files` pattern, as a new Effect rule.

An installation without the `anti-slop-xstate` plugin entry predates the XState rules. When a package manifest declares `xstate` directly, offer the six rules a fresh install enables; otherwise leave them out.

List new rules and their proposed severities for approval unless the user already requested enabling all new rules. Existing disabled rules stay disabled. Merely adding a new rule implementation need not enable it.

Check incoming API requirements against the installed `oxlint` and `@oxlint/plugins` versions. Keep a compatible pair and follow repository version policy; change dependencies only when required by the adopted source or requested by the user. Preserve unrelated dependency ranges and the package manager.

Complete when every adopted rule is reachable through the intended entry point, configuration reflects approved policy, and the dependency pair supports the merged implementation.

## 5. Verify local and incoming behavior

Run existing tests and add focused RuleTester cases for changed rule semantics, including regressions that preserve local customizations. Incoming tests are useful evidence, not replacements for local tests. When a skill bundle lacks upstream tests, retrieve relevant tests from the identified upstream revision or write focused cases for the adopted changes.

Exercise the registered plugin with representative accepted and rejected code. Run the repository's lint, typecheck, and required checks; for Vite+, run `vp check`. Vendored files may be excluded from application lint, so verify changed rules explicitly rather than treating an ignored directory as tested.

Report application findings separately from plugin/test failures. Application cleanup requires the user's authorization; retain rule severity and safety checks while reporting findings. If a required check is unavailable, name the blocker and mark verification incomplete.

Complete when adopted behavior and preserved local behavior have test evidence, checks have run, and every failure or verification gap is accounted for.

## 6. Record the merge and hand back ownership

Update `UPSTREAM.md` beside the vendored entry point, or the repository's existing provenance record, with:

- incoming source identity and the recoverable base used, or explicit unknown-base status;
- adopted changes and intentional local deviations;
- deferred/conflicting changes and the decisions still needed;
- dependency/configuration changes and verification results.

Advance the whole-installation baseline only when the complete incoming snapshot has been reconciled and remaining differences are recorded as intentional local changes. For a partial update, retain the prior baseline and record exactly which changes were adopted or remain pending; do not label the entire tree as matching the new revision. Without a recoverable base, keep that limitation explicit for the next update.

Review the final diff against the pre-update state. Report applied updates, preserved customizations, pending decisions, checks, and the backup location. Keep backups until the user accepts the result; remove only disposable staging material you created.

Complete when the user can distinguish upstream updates from local policy, recover the previous state, and identify what a future update must still reconcile.
