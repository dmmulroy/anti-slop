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

Preserve existing plugin paths, options, severities, disabled rules, overrides, ignores, and Effect opt-in decisions. Treat jev overlay configs (`oxlint.jev.config.*`), per-question jev severities, `anti-slop-diff-rules.config.*`, and edited questions, cutoffs, or plugin options in the vendored `jev/`, `martinfowler/jev-rules.ts`, `martinfowler/jev-plugin.ts`, and `diff-rules/rules.ts` as local customizations.

The vendored `oxlint-plugin-jev` package (usually `tools/oxlint/oxlint-plugin-jev/`) is a build, not owned source: replace it whole from `assets/oxlint-plugin-jev/` (or a build of the fork commit the user names), compare the commits in the two `UPSTREAM.md` files, reinstall it so its dependencies update, and review the fork's README for changed options. An installation still on the `jev/ask`/`jev/suggest` rules migrates by registering `jev/plugin.ts` and `martinfowler/jev-plugin.ts` and moving each question into the overlay as `<plugin>/<id>` at the severity its list had, carrying over local option values into the plugin entries. Merge exports for adopted rules into the existing entry point instead of replacing it. Check native companion rules when adopting related custom rules.

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
