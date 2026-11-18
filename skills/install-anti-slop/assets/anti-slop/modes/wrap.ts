// oxlint-disable effecttsgo/global-console -- runs inside oxlint's plugin host, outside any Effect runtime, and warns the way oxlint plugins do

import type { Context, Plugin, Rule } from "@oxlint/plugins";
import { changedLines, overlaps, ruleMode, settingsBase } from "oxlint-plugin-jev/changed";

interface LineSpan {
	readonly start: number;
	readonly end: number;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
	if (warned.has(message)) return;
	warned.add(message);
	console.warn(`anti-slop: ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

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

const spanOfNode = (node: unknown): LineSpan | undefined => (isRecord(node) ? spanOfLoc(node.loc) : undefined);

/**
 * The lines of a `context.report` call: a descriptor with `loc` or `node`, or the legacy positional
 * forms `report(node, message, ...)` and `report(node, loc, message, ...)`.
 */
function reportedSpan(args: ReadonlyArray<unknown>): LineSpan | undefined {
	const [first, second] = args;
	if (!isRecord(first)) return undefined;
	if ("message" in first || "messageId" in first) return spanOfLoc(first.loc) ?? spanOfNode(first.node);
	return spanOfLoc(second) ?? spanOfNode(first);
}

/**
 * A context whose `report` drops findings that touch no changed line when the rule's mode is
 * `"changed"`. The mode and base are read from `settings.changedLines` per file, so `"all"` rules
 * in the same plugin report as usual. A report whose lines cannot be read is kept.
 */
function filteredContext(context: Context): Context {
	const report = (...args: ReadonlyArray<unknown>): void => {
		if (ruleMode(context.settings, context.id, "all") === "changed") {
			const span = reportedSpan(args);
			const lines = span === undefined ? "all" : changedLines(context.filename, settingsBase(context.settings), warnOnce);
			if (span !== undefined && !overlaps(lines, span.start, span.end)) return;
		}
		Reflect.apply(context.report, context, args);
	};
	// Oxlint keeps a rule's per-file state (filename, settings, id) in module scope behind getters,
	// so a context inheriting from the real one reads the current file's values.
	return Object.create(context, { report: { value: report, enumerable: true } });
}

function wrapRule(rule: Rule): Rule {
	if ("createOnce" in rule) {
		const { create: _create, createOnce, ...rest } = rule;
		return { ...rest, createOnce: (context) => createOnce(filteredContext(context)) };
	}
	const { create, ...rest } = rule;
	return { ...rest, create: (context) => create(filteredContext(context)) };
}

/**
 * The same plugin with every rule's reports filtered by its changed-lines mode. Registered in
 * place of the original under the same `jsPlugins` name, so rule names and disable comments do not
 * change.
 */
export function changedLinesPlugin(plugin: Plugin): Plugin {
	return {
		...plugin,
		rules: Object.fromEntries(Object.entries(plugin.rules).map(([name, rule]) => [name, wrapRule(rule)])),
	};
}
