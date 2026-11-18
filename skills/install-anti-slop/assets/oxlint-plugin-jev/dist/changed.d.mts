//#region src/changed.d.ts
/**
 * How a rule picks what to check. `"all"` checks every line; `"changed"` checks only lines that
 * differ from the merge base of `HEAD` and the default branch, so findings on untouched lines are
 * ignored.
 */
type Mode = 'all' | 'changed';
/** Changed line numbers of one file, or `'all'` when every line counts as changed. */
type ChangedLines = ReadonlySet<number> | 'all';
/**
 * The oxlint `settings` key that carries per-rule modes and the base ref, so a rule reads its mode
 * from `context.settings` instead of from its own options:
 *
 * `settings: { changedLines: { rules: { "<plugin>/<rule>": "changed" }, base: "origin/main" } }`
 */
declare const SETTINGS_KEY = "changedLines";
/** Tried in order after `refs/remotes/origin/HEAD` when resolving the default branch. */
declare const DEFAULT_BRANCHES: readonly string[];
/** The mode `settings.changedLines.rules` gives `ruleId`, or `fallback` when it names none. */
declare function ruleMode(settings: unknown, ruleId: string, fallback: Mode): Mode;
/** The base ref `settings.changedLines.base` names, if any. */
declare function settingsBase(settings: unknown): string | undefined;
/** Parses `git diff -U0` output into the new-side line numbers each file changed. */
declare function parseDiff(diff: string): Map<string, Set<number>>;
/**
 * The default branch: what `refs/remotes/origin/HEAD` points at (`origin/main` or
 * `origin/master`), else the first of `DEFAULT_BRANCHES` that names a commit, else `null`.
 */
declare function defaultBase(cwd: string): string | null;
/** The explicit base when given, then `JEV_CHANGED_BASE`, then the default branch. */
declare function resolveBase(cwd: string, base: string | undefined): string | null;
/**
 * The lines of a file changed against the merge base of `HEAD` and `base` (default: see
 * `resolveBase`), computed once per repository per run. An empty set means the file is unchanged.
 * Untracked files, and every file before the first commit, count as entirely changed. When git
 * cannot answer, every line counts as changed and `warn` is told why, so a broken diff never
 * silently turns checks off.
 */
declare function changedLines(filename: string, base: string | undefined, warn: (message: string) => void): ChangedLines;
declare function overlaps(lines: ChangedLines, start: number, end: number): boolean;
//#endregion
export { ChangedLines, DEFAULT_BRANCHES, Mode, SETTINGS_KEY, changedLines, defaultBase, overlaps, parseDiff, resolveBase, ruleMode, settingsBase };