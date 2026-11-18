// Ported from cevr/effect-oxlint's `no-unbounded-retry` (https://github.com/cevr/effect-oxlint, MIT,
// oxlint-plugin-effect 0.32.4). This version also accepts the bounds Effect 4.1 offers: `Schedule.upTo`,
// `Schedule.max` with a bounded schedule, bounded schedule constructors, and a later `Effect.timeout`.
import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
	collectEffectModuleNames,
	keyName,
	moduleCallName,
	moduleMemberName,
	resolveIdentifier,
	unwrapExpression,
	unwrapNode,
	type EffectModuleNames,
} from "../shared/effect-modules.ts";

/** What the rule can tell about whether a schedule stops on its own. */
type Bound = "bounded" | "unbounded" | "unknown";

/** Constructors whose schedules recur forever. */
const unboundedConstructors: ReadonlySet<string> = new Set(["cron", "exponential", "fibonacci", "fixed", "spaced", "windowed"]);

/** Constructors whose schedules stop after a count or a duration. */
const boundedConstructors: ReadonlySet<string> = new Set(["duration", "during", "recurs"]);

/** Combinators that keep recurring only while every schedule recurs, so one bounded schedule bounds them all. */
const intersections: ReadonlySet<string> = new Set(["max"]);

/** Combinators that keep recurring while any schedule recurs, so every schedule must be bounded. */
const unions: ReadonlySet<string> = new Set(["concat", "min"]);

/** Combinators that bound the schedule they are applied to. `take` is the Effect 3 name. */
const limits: ReadonlySet<string> = new Set(["take", "upTo"]);

/** Effect operators that bound the elapsed time of everything before them in a pipeline. */
const timeouts: ReadonlySet<string> = new Set(["timeout", "timeoutOption", "timeoutOrElse"]);

const MAX_RESOLUTION_DEPTH = 16;

/** The initializer of a single `const` binding, or null. */
function constInitializer(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): ESTree.Expression | null {
	const variable = resolveIdentifier(sourceCode, identifier);
	if (variable === null || variable.defs.length !== 1) return null;
	const [definition] = variable.defs;
	if (definition?.type !== "Variable" || definition.node.type !== "VariableDeclarator") return null;
	if (definition.parent?.type !== "VariableDeclaration" || definition.parent.kind !== "const") return null;
	return definition.node.init ?? null;
}

/** Follow `const` bindings and strip wrappers until the expression is not an identifier. */
function resolveConst(sourceCode: SourceCode, expression: ESTree.Expression): ESTree.Expression {
	let current = unwrapExpression(expression);
	for (let depth = 0; depth < MAX_RESOLUTION_DEPTH && current.type === "Identifier"; depth++) {
		const initializer = constInitializer(sourceCode, current);
		if (initializer === null) return current;
		current = unwrapExpression(initializer);
	}
	return current;
}

/** The expression arguments of a call, or null when one is a spread. */
function expressionArguments(call: ESTree.CallExpression): readonly ESTree.Expression[] | null {
	const expressions: ESTree.Expression[] = [];
	for (const argument of call.arguments) {
		if (argument.type === "SpreadElement") return null;
		expressions.push(argument);
	}
	return expressions;
}

/** The value of a non-computed property of an object literal, or null. */
function propertyValue(object: ESTree.ObjectExpression, name: string): ESTree.Expression | null {
	for (const property of object.properties) {
		if (property.type === "Property" && !property.computed && keyName(property.key) === name) return property.value;
	}
	return null;
}

const both = (bounds: readonly Bound[]): Bound => {
	if (bounds.includes("bounded")) return "bounded";
	return bounds.includes("unknown") ? "unknown" : "unbounded";
};

const every = (bounds: readonly Bound[]): Bound => {
	if (bounds.includes("unbounded")) return "unbounded";
	return bounds.includes("unknown") ? "unknown" : "bounded";
};

interface ScheduleReader {
	readonly sourceCode: SourceCode;
	readonly names: EffectModuleNames;
}

/** Whether a `Schedule.upTo` options argument names a limit. Options the rule cannot read count as one. */
function limitsSchedule(reader: ScheduleReader, options: ESTree.Expression | undefined): boolean {
	if (options === undefined) return false;
	const value = resolveConst(reader.sourceCode, options);
	if (value.type !== "ObjectExpression") return true;
	return propertyValue(value, "times") !== null || propertyValue(value, "duration") !== null;
}

/** Apply `Schedule.<member>(...args)` to a schedule with bound `current`. Other combinators keep the bound. */
function applyCombinator(reader: ScheduleReader, current: Bound, member: string, args: readonly ESTree.Expression[]): Bound {
	if (limits.has(member)) return limitsSchedule(reader, args[0]) ? "bounded" : current;
	const others = args.map((argument) => scheduleBound(reader, argument));
	if (intersections.has(member)) return both([current, ...others]);
	if (unions.has(member)) return every([current, ...others]);
	return current;
}

/** Apply one `.pipe` step to the bound of the schedule before it. A step that is not a Schedule combinator is unknown. */
function applyStep(reader: ScheduleReader, current: Bound, step: ESTree.Expression): Bound {
	const resolved = resolveConst(reader.sourceCode, step);
	// A point-free combinator such as `Schedule.jittered` keeps the bound.
	if (moduleMemberName(resolved, reader.names, "Schedule") !== null) return current;
	const member = moduleCallName(resolved, reader.names, "Schedule");
	if (member === null || resolved.type !== "CallExpression") return "unknown";
	const args = expressionArguments(resolved);
	return args === null ? "unknown" : applyCombinator(reader, current, member, args);
}

/** Whether a schedule expression stops on its own. */
function scheduleBound(reader: ScheduleReader, expression: ESTree.Expression): Bound {
	const node = resolveConst(reader.sourceCode, expression);
	const constant = moduleMemberName(node, reader.names, "Schedule");
	if (constant === "forever") return "unbounded";
	if (constant === "once") return "bounded";
	if (node.type !== "CallExpression") return "unknown";

	const callee = unwrapExpression(node.callee);
	if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "pipe") {
		const args = expressionArguments(node);
		if (args === null || callee.object.type === "Super") return "unknown";
		return args.reduce<Bound>((bound, step) => applyStep(reader, bound, step), scheduleBound(reader, callee.object));
	}

	const member = moduleCallName(node, reader.names, "Schedule");
	if (member === null) return "unknown";
	if (unboundedConstructors.has(member)) return "unbounded";
	if (boundedConstructors.has(member)) return "bounded";
	const args = expressionArguments(node);
	const [self, ...rest] = args ?? [];
	// Data-first combinators take the schedule first: `Schedule.upTo(schedule, { times: 3 })`.
	if (self === undefined || rest.length === 0) return "unknown";
	return applyCombinator(reader, scheduleBound(reader, self), member, rest);
}

/** The retry policy argument of an Effect, Stream, or HttpClient retry call, and whether a timeout may bound it. */
interface RetryCall {
	readonly policy: ESTree.Expression;
	readonly timeoutApplies: boolean;
}

function retryCall(call: ESTree.CallExpression, names: EffectModuleNames): RetryCall | null {
	const effectMember = moduleCallName(call, names, "Effect");
	let arity: number | null = null;
	if (effectMember === "retry") arity = 1;
	else if (effectMember === "retryOrElse") arity = 2;
	else if (moduleCallName(call, names, "Stream") === "retry" || moduleCallName(call, names, "HttpClient") === "retryTransient") arity = 1;
	if (arity === null) return null;
	const args = expressionArguments(call);
	if (args === null || args.length < arity) return null;
	// The data-first form takes the effect, stream, or client first.
	const policy = args.length === arity ? args[0] : args[1];
	if (policy === undefined) return null;
	return { policy, timeoutApplies: effectMember !== null };
}

/** The schedule a policy retries on, or null when the policy bounds attempts with `times` or cannot be read. */
function policySchedule(sourceCode: SourceCode, policy: ESTree.Expression): ESTree.Expression | null {
	const value = resolveConst(sourceCode, policy);
	if (value.type !== "ObjectExpression") return value;
	if (value.properties.some((property) => property.type === "SpreadElement")) return null;
	if (propertyValue(value, "times") !== null) return null;
	return propertyValue(value, "schedule");
}

const isPipeCallee = (callee: ESTree.Node): boolean =>
	(callee.type === "Identifier" && callee.name === "pipe") ||
	(callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "pipe");

/** Whether a call's arguments after the first run as a pipeline: `Effect.fn(body, ...steps)` or `Effect.fn("name")(body, ...steps)`. */
function isEffectFnPipeline(call: ESTree.CallExpression, names: EffectModuleNames): boolean {
	const callee = unwrapExpression(call.callee);
	const fn = callee.type === "CallExpression" ? unwrapExpression(callee.callee) : callee;
	const member = moduleMemberName(fn, names, "Effect");
	return member === "fn" || member === "fnUntraced";
}

/** Whether `node` is a data-first timeout of `inner`: `Effect.timeout(inner, "5 seconds")`. */
function isTimeoutOf(node: ESTree.CallExpression, inner: ESTree.Node, names: EffectModuleNames): boolean {
	const member = moduleCallName(node, names, "Effect");
	return member !== null && timeouts.has(member) && node.arguments.length >= 2 && node.arguments[0] === inner;
}

/** Whether a later step of the pipeline that `call` runs in is an Effect timeout. */
function hasLaterTimeout(call: ESTree.CallExpression, names: EffectModuleNames): boolean {
	const isTimeoutStep = (step: ESTree.Node): boolean => {
		const member = moduleCallName(unwrapNode(step), names, "Effect");
		return member !== null && timeouts.has(member);
	};
	let current: ESTree.Node = call;
	for (;;) {
		let parent: ESTree.Node | null = current.parent;
		while (parent !== null && unwrapNode(parent) !== parent) {
			current = parent;
			parent = parent.parent;
		}
		if (parent === null) return false;
		if (parent.type === "MemberExpression" && parent.object === current && isPipeCallee(parent)) {
			const pipeCall: ESTree.Node | null = parent.parent;
			if (pipeCall?.type !== "CallExpression" || pipeCall.callee !== parent) return false;
			if (pipeCall.arguments.some(isTimeoutStep)) return true;
			current = pipeCall;
			continue;
		}
		if (parent.type !== "CallExpression") return false;
		if (isTimeoutOf(parent, current, names)) return true;
		const index = parent.arguments.findIndex((argument) => argument === current);
		if (index < 0) return false;
		const callee = unwrapExpression(parent.callee);
		if (!isPipeCallee(callee) && !isEffectFnPipeline(parent, names)) return false;
		if (parent.arguments.slice(index + 1).some(isTimeoutStep)) return true;
		current = parent;
	}
}

/** Require retry policies to stop after a number of attempts or an elapsed time. */
export const noUnboundedRetryRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Require Effect retry policies to have an attempt or duration bound.",
		},
		messages: {
			unboundedRetry:
				"This retry never gives up. Bound it with `times`, `Schedule.upTo({ times })` or `Schedule.upTo({ duration })`, `Schedule.max(schedule, Schedule.recurs(n))`, or a later `Effect.timeout`.",
		},
	},
	create(context) {
		const names = collectEffectModuleNames(context.sourceCode.ast);
		const reader: ScheduleReader = { sourceCode: context.sourceCode, names };

		return {
			CallExpression(node) {
				const retry = retryCall(node, names);
				if (retry === null) return;
				const schedule = policySchedule(context.sourceCode, retry.policy);
				if (schedule === null || scheduleBound(reader, schedule) !== "unbounded") return;
				if (retry.timeoutApplies && hasLaterTimeout(node, names)) return;
				context.report({ node, messageId: "unboundedRetry" });
			},
		};
	},
});
