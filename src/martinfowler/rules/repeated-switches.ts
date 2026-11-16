import { defineRule, type ESTree } from "@oxlint/plugins";

import { isIgnoredTestFile, isWrapper, numberOption, truncate, unwrap } from "../shared.ts";

const equalityOperators = new Set(["==", "===", "!=", "!=="]);
const defaultMinOccurrences = 2;
const defaultMinSharedCases = 2;

function isCaseValue(node: ESTree.Expression): boolean {
	const value = unwrap(node);
	if (value.type === "Literal") return true;
	if (value.type === "TemplateLiteral") return value.expressions.length === 0;
	// Enum-like members such as `Kind.Ready` or `Status.Done`.
	return (
		value.type === "MemberExpression" &&
		!value.computed &&
		value.object.type === "Identifier" &&
		/^[A-Z]/.test(value.object.name)
	);
}

interface Comparison {
	readonly value: string;
	readonly cases: ReadonlyArray<string>;
}

interface Occurrence {
	readonly node: ESTree.Node;
	readonly cases: ReadonlySet<string>;
}

function sharedCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	let count = 0;
	for (const value of left) if (right.has(value)) count += 1;
	return count;
}

/** Flag the same discriminant switched on or if/ternary-chained over the same cases in several places. */
export const repeatedSwitchesRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Flag a discriminant expression that is switched on, or compared in if/else or ternary chains, over the same cases in several places in one file (Refactoring, Repeated Switches).",
		},
		messages: {
			repeated:
				"Possibly Repeated Switches: this file branches on `{{expression}}` over the same cases in {{count}} places, so adding a case means finding and editing every one of them. Consider Replace Conditional with Polymorphism: model the cases as a `Data.TaggedEnum` (or `Schema.TaggedUnion`) and handle them in one exhaustive `Match.type`/`Match.tags` … `Match.exhaustive`, or move each case's behavior onto its variant.",
		},
		schema: [
			{
				type: "object",
				properties: {
					ignoreTests: { type: "boolean" },
					minOccurrences: { type: "integer", minimum: 2 },
					minSharedCases: { type: "integer", minimum: 1 },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [
			{
				ignoreTests: true,
				minOccurrences: defaultMinOccurrences,
				minSharedCases: defaultMinSharedCases,
			},
		],
	},
	createOnce(context) {
		let occurrences = new Map<string, Array<Occurrence>>();

		const text = (node: ESTree.Node) => context.sourceCode.getText(node).replace(/\s+/g, " ");

		const compare = (node: ESTree.Expression): Comparison | undefined => {
			const test = unwrap(node);
			if (test.type === "LogicalExpression" && test.operator === "||") {
				const left = compare(test.left);
				const right = compare(test.right);
				if (left === undefined || right === undefined || left.value !== right.value) {
					return undefined;
				}
				return { value: left.value, cases: [...left.cases, ...right.cases] };
			}
			if (test.type !== "BinaryExpression" || !equalityOperators.has(test.operator)) {
				return undefined;
			}
			if (test.left.type === "PrivateIdentifier") return undefined;
			if (isCaseValue(test.right) && !isCaseValue(test.left)) {
				return { value: text(test.left), cases: [text(test.right)] };
			}
			if (isCaseValue(test.left) && !isCaseValue(test.right)) {
				return { value: text(test.right), cases: [text(test.left)] };
			}
			return undefined;
		};

		const record = (value: string, node: ESTree.Node, cases: ReadonlyArray<string>) => {
			const entries = occurrences.get(value) ?? [];
			entries.push({ node, cases: new Set(cases) });
			occurrences.set(value, entries);
		};

		/** Record each else-if chain, and each run of adjacent guard `if`s, over one value. */
		const recordIfRuns = (statements: ReadonlyArray<ESTree.Node>) => {
			let run: { value: string; start: ESTree.Node; cases: Array<string> } | undefined;
			let runLength = 0;
			const flush = () => {
				if (run !== undefined && runLength >= 2) record(run.value, run.start, run.cases);
				run = undefined;
				runLength = 0;
			};
			for (const statement of statements) {
				if (statement.type !== "IfStatement") {
					flush();
					continue;
				}
				const first = compare(statement.test);
				if (first === undefined) {
					flush();
					continue;
				}
				const cases = [...first.cases];
				let chainLength = 1;
				let alternate = statement.alternate;
				while (alternate?.type === "IfStatement") {
					const next = compare(alternate.test);
					if (next?.value !== first.value) break;
					cases.push(...next.cases);
					chainLength += 1;
					alternate = alternate.alternate;
				}
				if (chainLength >= 2) {
					flush();
					record(first.value, statement, cases);
					continue;
				}
				if (statement.alternate !== null && statement.alternate !== undefined) {
					flush();
					continue;
				}
				if (run?.value !== first.value) {
					flush();
					run = { value: first.value, start: statement, cases: [] };
				}
				run?.cases.push(...cases);
				runLength += 1;
			}
			flush();
		};

		return {
			before() {
				if (isIgnoredTestFile(context)) return false;
				occurrences = new Map();
				return undefined;
			},
			SwitchStatement(node) {
				const discriminant = unwrap(node.discriminant);
				if (discriminant.type === "Literal") return;
				const cases = node.cases.flatMap((switchCase) =>
					switchCase.test === null || switchCase.test === undefined ? [] : [text(switchCase.test)],
				);
				record(text(discriminant), node, cases);
			},
			ConditionalExpression(node) {
				let parent = node.parent;
				while (isWrapper(parent)) parent = parent.parent;
				if (parent.type === "ConditionalExpression") return;
				const first = compare(node.test);
				if (first === undefined) return;
				const cases = [...first.cases];
				let alternate = unwrap(node.alternate);
				let chainLength = 1;
				while (alternate.type === "ConditionalExpression") {
					const next = compare(alternate.test);
					if (next?.value !== first.value) break;
					cases.push(...next.cases);
					chainLength += 1;
					alternate = unwrap(alternate.alternate);
				}
				if (chainLength >= 2) record(first.value, node, cases);
			},
			Program(node) {
				recordIfRuns(node.body);
			},
			BlockStatement(node) {
				recordIfRuns(node.body);
			},
			SwitchCase(node) {
				recordIfRuns(node.consequent);
			},
			"Program:exit"() {
				const minOccurrences = numberOption(context.options, "minOccurrences", defaultMinOccurrences);
				const minSharedCases = numberOption(context.options, "minSharedCases", defaultMinSharedCases);
				for (const [expression, entries] of occurrences) {
					// Same text can name different unions in different functions; overlapping cases show it is one.
					const repeated = entries.filter((entry) =>
						entries.some(
							(other) => other !== entry && sharedCount(entry.cases, other.cases) >= minSharedCases,
						),
					);
					if (repeated.length < minOccurrences) continue;
					for (const entry of repeated) {
						context.report({
							node: entry.node,
							messageId: "repeated",
							data: { expression: truncate(expression, 60), count: repeated.length },
						});
					}
				}
			},
		};
	},
});
