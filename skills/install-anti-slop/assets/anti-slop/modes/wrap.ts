// oxlint-disable effecttsgo/global-console, effecttsgo/process-env -- runs inside oxlint's plugin host, outside any Effect runtime, and warns the way oxlint plugins do

import type { Context, Diagnostic, Plugin, Rule, RuleOptionsSchema, VisitorWithHooks } from "@oxlint/plugins";

import { changedLines, overlaps, type Mode } from "./changed.ts";

/** The options `withModes` adds to every rule it wraps, next to the rule's own. */
export interface ModeOptions {
	/** `"changed"` reports only findings on lines changed since the merge base with the default branch. Default `"all"`. */
	readonly mode?: Mode;
	/** The ref whose merge base with `HEAD` `"changed"` diffs against. Default: `ANTI_SLOP_BASE`, then the default branch. */
	readonly base?: string;
}

interface LineSpan {
	readonly start: number;
	readonly end: number;
}

interface SplitOptions {
	readonly mode: Mode;
	readonly base: string | undefined;
	/** The options with `mode` and `base` removed, as the wrapped rule expects them. */
	readonly own: ReadonlyArray<unknown>;
}

const MODE_PROPERTIES = {
	mode: { enum: ["all", "changed"] },
	base: { type: "string" as const, minLength: 1 },
};

const MODE_KEYS: ReadonlyArray<string> = Object.keys(MODE_PROPERTIES);

const warned = new Set<string>();

function warnOnce(message: string): void {
	if (warned.has(message)) return;
	warned.add(message);
	console.warn(`anti-slop: ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** `ANTI_SLOP_MODE=all` checks every line with every rule, for full runs. */
function forcedAll(): boolean {
	const forced = process.env.ANTI_SLOP_MODE?.trim() ?? "";
	if (forced !== "" && forced !== "all") warnOnce(`ANTI_SLOP_MODE must be "all" or unset, not "${forced}"; ignoring it`);
	return forced === "all";
}

/**
 * The rule's schema with `mode` and `base` accepted in its first options object, or `undefined`
 * when there is nowhere to put them: the first option is not an object, or already has its own
 * `mode` or `base`.
 */
export function schemaWithMode(schema: RuleOptionsSchema | undefined): RuleOptionsSchema | undefined {
	if (schema === false) return false;
	if (schema === undefined || (Array.isArray(schema) && schema.length === 0)) {
		return [{ type: "object", properties: MODE_PROPERTIES, additionalProperties: false }];
	}
	if (!Array.isArray(schema)) return undefined;
	const [first, ...rest] = schema;
	if (first === undefined || first.type !== "object") return undefined;
	const properties = first.properties ?? {};
	if (MODE_KEYS.some((key) => Object.hasOwn(properties, key))) return undefined;
	return [{ ...first, properties: { ...properties, ...MODE_PROPERTIES } }, ...rest];
}

const splitByOptions = new WeakMap<ReadonlyArray<unknown>, SplitOptions>();

/** Reads `mode` and `base` from the first options object and removes them from what the rule sees. */
export function splitOptions(options: ReadonlyArray<unknown>): SplitOptions {
	const cached = splitByOptions.get(options);
	if (cached !== undefined) return cached;
	const [first, ...rest] = options;
	let split: SplitOptions = { mode: "all", base: undefined, own: options };
	if (isRecord(first) && MODE_KEYS.some((key) => Object.hasOwn(first, key))) {
		const { mode, base, ...own } = first;
		// Only `mode` and `base` were given, so the rule sees no options at all, as if none were set.
		const ownOptions = Object.keys(own).length === 0 && rest.length === 0 ? [] : [own, ...rest];
		split = { mode: mode === "changed" ? "changed" : "all", base: typeof base === "string" ? base : undefined, own: ownOptions };
	}
	splitByOptions.set(options, split);
	return split;
}

const lineOf = (position: unknown): number | undefined =>
	isRecord(position) && typeof position.line === "number" ? position.line : undefined;

/** The lines a `loc` covers: either `{ start, end }` or a single `{ line, column }`. */
function spanOfLoc(loc: unknown): LineSpan | undefined {
	if (!isRecord(loc)) return undefined;
	const single = lineOf(loc);
	if (single !== undefined) return { start: single, end: single };
	const start = lineOf(loc.start);
	if (start === undefined) return undefined;
	return { start, end: lineOf(loc.end) ?? start };
}

const spanOf = (diagnostic: Diagnostic): LineSpan | undefined =>
	spanOfLoc(diagnostic.loc) ?? (isRecord(diagnostic.node) ? spanOfLoc(diagnostic.node.loc) : undefined);

/** The changed lines of the current file when the rule runs in `"changed"` mode, else `"all"`. */
function linesToCheck(context: Context): ReturnType<typeof changedLines> {
	const { mode, base } = splitOptions(context.options);
	if (mode !== "changed" || forcedAll()) return "all";
	return changedLines(context.filename, base, warnOnce);
}

/**
 * A context that hides `mode` and `base` from the rule's options and, in `"changed"` mode, drops
 * reports that touch no changed line. A report whose lines cannot be read is kept.
 */
function modeContext(context: Context): Context {
	const report = (diagnostic: Diagnostic): void => {
		const span = spanOf(diagnostic);
		if (span !== undefined && !overlaps(linesToCheck(context), span.start, span.end)) return;
		context.report(diagnostic);
	};
	// Oxlint keeps a rule's per-file state (filename, options, settings) behind getters on the
	// context, so a context inheriting from the real one reads the current file's values.
	const wrapped: Context = Object.create(context, {
		options: { get: () => splitOptions(context.options).own, enumerable: true },
		report: { value: report, enumerable: true },
	});
	return wrapped;
}

const isUnchanged = (context: Context): boolean => {
	const lines = linesToCheck(context);
	return lines !== "all" && lines.size === 0;
};

function wrapRule(rule: Rule): Rule {
	const schema = schemaWithMode(rule.meta?.schema);
	if (schema === undefined) return rule;
	const meta = { ...rule.meta, schema };
	const { create } = rule;
	// `create` runs once per file, so a file with no changed lines can skip the rule entirely.
	const wrappedCreate =
		create === undefined ? undefined : (context: Context) => (isUnchanged(context) ? {} : create(modeContext(context)));
	if ("createOnce" in rule) {
		const { createOnce } = rule;
		return {
			...rule,
			meta,
			createOnce: (context: Context): VisitorWithHooks => createOnce(modeContext(context)),
			...(wrappedCreate === undefined ? {} : { create: wrappedCreate }),
		};
	}
	return { ...rule, meta, create: (context: Context) => (isUnchanged(context) ? {} : rule.create(modeContext(context))) };
}

/**
 * The same plugin with every rule accepting `mode` (and `base`) in its options, next to its own:
 * `"rule": ["error", { mode: "changed" }]`. The wrapped rule never sees them. A rule whose first
 * option is not an object, or already has a `mode` or `base` option, is left as it is.
 */
export function withModes(plugin: Plugin): Plugin {
	return {
		...plugin,
		rules: Object.fromEntries(Object.entries(plugin.rules).map(([name, rule]) => [name, wrapRule(rule)])),
	};
}
