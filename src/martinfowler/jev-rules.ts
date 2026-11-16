/**
 * Plain-English smell rules for the jev fork's `createJevPlugin`, one per code smell from Martin
 * Fowler's *Refactoring* (2nd ed., chapter 3) that needs judgement rather than syntax.
 * `./jev-plugin.ts` turns each entry into its own oxlint rule, `anti-slop-martinfowler-jev/<id>`,
 * meant to run at `warn`. "Yes" means
 * "this is the smell". Each question states its carve-outs first and ends with the yes/no
 * question. `message` is the diagnostic text the coding agent reads: it names the smell, says why
 * it matters, and names the refactoring (with its Effect form) to apply.
 *
 * Smells that the AST plugin in `../index.ts` detects precisely (Long Function, Long Parameter
 * List, Global Data, Mutable Data, Loops, Message Chains) have no entry here. Mysterious Name and
 * Repeated Switches have both: the AST rules catch the syntactic cases, these catch the ones that
 * need the body or the types read.
 *
 * `"function"` rules send one match per function per rule, and the plugin's `maxMatchesPerFile`
 * caps matches across all of its rules in source order, so raise it (see
 * `martinFowlerJevOptions`) or turn rules off when files hold many functions.
 */
import type { JevRule } from "oxlint-plugin-jev";

/** A jev rule whose `message` names the smell and the refactoring, so it is required here. */
export type MartinFowlerJevRule = JevRule & { readonly message: string };

/** The oxlint plugin name `./jev-plugin.ts` registers; each rule is configured as `<name>/<id>`. */
export const martinFowlerJevPluginName = "anti-slop-martinfowler-jev";

/** Plugin-level options sized for these rules: whole-file rules and several function rules. */
export const martinFowlerJevOptions = {
	maxMatchesPerFile: 60,
	maxSnippetChars: 24_000,
	timeoutMs: 60_000,
} as const;

export const martinFowlerJevRules: ReadonlyArray<MartinFowlerJevRule> = [
	{
		id: "mysterious-name",
		target: "function",
		question:
			"Ignore inline callbacks, local helpers of about five lines or fewer, names required by an interface, framework, or library key (such as fetch, make, layer, of, handler, or a service method fixed by its interface), genuinely generic module-private primitives, test helpers, and domain verbs with a documented specific meaning. Does this function's name hide or misstate what callers can observe, because either (a) its main verb is generic (resolve, process, handle, run, execute, manage, do, perform, apply, ensure, prepare, update, sync) while a more specific verb or verb pair, such as getCachedOrAcquire or loadMutateAndSave, would describe the body, or (b) the body has a caller-visible effect that the name omits or contradicts (a network call, a persistent write or delete, spawning a process or fiber, sending a message, swallowing errors, or reading or writing a cache) while the name implies the function is pure or read-only, or names only one of several steps it performs?",
		cutoff: 0.7,
		message:
			"Possibly Mysterious Name: the name does not tell callers which steps this function performs or which effects (network, writes, retries, swallowed errors, cache) it has. Consider Rename Function: name every caller-visible step, for example `resolve` → `getCachedOrAcquireCredential`, `runLogged` → `logAndSuppressFailures`, `applyDeliveryMutation` → `loadMutateAndSaveDeliverySlot`.",
	},
	{
		id: "feature-envy",
		target: "function",
		question:
			"Ignore mapping and serialization functions at a boundary whose job is to translate between two shapes, pure functions over plain data records or schemas, functions that read a few fields from their own parameters, and Effect programs that only orchestrate calls to several services in sequence. Does this function spend most of its body reading fields of, or calling methods on, one other module's object or service (not its own module's state or its own parameters' plain data), so that the logic would be shorter and clearer if it lived in that other module?",
		cutoff: 0.75,
		message:
			"Possibly Feature Envy: this function mostly reads and works on another module's data instead of its own, so changes to that data's rules have to be made here too. Consider Move Function into the module or service that owns the data (in Effect, an operation on that service, so callers yield the service and call it instead of reaching into its fields).",
	},
	{
		id: "data-clumps",
		target: "file",
		question:
			"Ignore groups that are already a named type, schema, or object passed as one value; pairs of values that are only ever used together once; and standard positional pairs such as (x, y) coordinates or (start, end) where a library API requires them separately. Does this file pass, store, or declare the same group of three or more related values (for example organizationId, projectId, and userId, or host, port, and protocol) as separate parameters, fields, or variables in two or more places, so that the group behaves like one concept without a name?",
		cutoff: 0.7,
		location: {
			question: "Select the first parameter list or declaration where the repeated group of values appears.",
			cutoff: 0.7,
		},
		message:
			"Possibly Data Clumps: the same group of values travels together through several signatures or declarations here, so it is one concept without a name and every new use repeats the group. Consider Introduce Parameter Object or Extract Class (in Effect, one shared `Schema.Struct` for the group, passed and decoded as a single value).",
	},
	{
		id: "primitive-obsession",
		target: "function",
		question:
			"Ignore values that are already branded or wrapped in a domain type, local loop counters and indexes, strings shown only to humans (labels, log messages), parameters of thin adapters that must match an external API's primitive signature, and generic utilities that are deliberately type-agnostic. Does this function accept, return, or compare raw strings, numbers, or booleans that stand for a domain concept with rules or a fixed set of values, such as identifiers that could be confused with each other, money, durations, email addresses, status or kind strings compared against literals, or boolean flags that select behavior, where a dedicated type would prevent mix-ups or invalid values?",
		cutoff: 0.75,
		message:
			"Possibly Primitive Obsession: raw strings, numbers, or flags here stand for domain concepts, so an ID can be swapped for another ID or an invalid status can flow through unchecked. Consider Replace Primitive with Object (in Effect, a `Schema.brand` type for each identifier or quantity and a `Schema.Literal` union for each fixed set of values, decoded once at the boundary).",
	},
	{
		id: "middle-man",
		target: "file",
		question:
			"Ignore adapters that translate a third-party API into domain types, facades that narrow a large dependency to the few operations callers need, and operations that add validation, authorization, decoding, error mapping, caching, retries, or orchestration of several calls; adding only a span or a log does not count. Does this file define a class, service, or module where most public operations only forward their arguments to one method of one dependency and return its result unchanged?",
		cutoff: 0.75,
		location: {
			question: "Select the first public operation that only forwards to a dependency.",
			cutoff: 0.7,
		},
		message:
			"Possibly Middle Man: most operations here only forward to one dependency, so this layer adds a name and an indirection without adding behavior. Consider Remove Middle Man or Inline Function: let callers use the dependency directly, or move real behavior (validation, mapping, retries) into this layer so it earns its place.",
	},
	{
		id: "lazy-element",
		target: "file",
		question:
			"Ignore exported public API, declarations that give a domain concept its name and are used as a type in several places, functions whose name explains a non-obvious expression, and seams required for testing or dependency injection. Does this file declare a function, class, type, or module-level constant that does so little (for example it wraps a single call or expression, or has one trivial method) and is used in so few places that inlining it at its call sites would be at least as clear?",
		cutoff: 0.75,
		location: {
			question: "Select the declaration that should be inlined at its call sites.",
			cutoff: 0.7,
		},
		message:
			"Possibly Lazy Element: this declaration does almost nothing and has few users, so readers jump to it only to find one call or expression. Consider Inline Function or Inline Class: write its body at the call sites and delete it.",
	},
	{
		id: "speculative-generality",
		target: "file",
		question:
			"Ignore exported library API meant for external callers, parameters required by an interface or callback signature, abstractions with two or more implementations in the codebase (including test implementations that exercise real behavior), and options documented as public configuration. Does this file contain generality that no current caller uses, such as a parameter or option that every caller omits or passes the same value for, an interface, abstract class, or generic type parameter with exactly one implementation or instantiation, a hook or extension point nothing registers, or a branch for a case that cannot occur?",
		cutoff: 0.75,
		location: {
			question: "Select the unused parameter, option, abstraction, or branch.",
			cutoff: 0.7,
		},
		message:
			"Possibly Speculative Generality: this file carries options, parameters, or abstractions that no current caller needs, so readers maintain flexibility nothing uses. Consider Collapse Hierarchy, Inline Function, Change Function Declaration to drop the unused parameter, or Remove Dead Code.",
	},
	{
		id: "temporary-field",
		target: "file",
		question:
			"Ignore fields that are optional because the data is genuinely optional in the domain, lazily initialized caches with a clear owner, and fields set in a constructor or factory before the object is used. Does this file define a class, record type, or state object with fields that are only set and read during one operation or in one state, and are undefined, null, or meaningless the rest of the time, so readers must know which state the object is in to know which fields are valid?",
		cutoff: 0.75,
		location: {
			question: "Select the declaration of the field that is only valid in one operation or state.",
			cutoff: 0.7,
		},
		message:
			"Possibly Temporary Field: some fields here are only meaningful in one operation or state and empty otherwise, so every reader must know the current state to trust them. Consider Extract Class for the fields and the code that uses them, or split the type into tagged variants (in Effect, a `Data.TaggedEnum` or `Schema.TaggedUnion` where each variant carries only its own fields).",
	},
	{
		id: "insider-trading",
		target: "file",
		question:
			"Ignore imports of a module's public entry point or exported API, test files that inspect internals on purpose, and modules in the same package whose sharing is documented. Does this file reach into another module's internals, for example by importing from its internal or private paths, reading or writing its private or underscore-prefixed fields, depending on its internal data layout, or mutating state that module owns, instead of going through that module's public interface?",
		cutoff: 0.75,
		message:
			"Possibly Insider Trading: this module depends on another module's internals, so neither can change its private structure without breaking the other. Consider Move Function so the logic lives with the data it needs, or Hide Delegate so the other module exposes one public operation for what this code uses (in Effect, a service operation instead of reaching into its implementation).",
	},
	{
		id: "data-class",
		target: "file",
		question:
			"Ignore schema and record types that are plain data by design (Schema.Struct, Schema.Class or Data.Class used as values, DTOs, wire or database row types, configuration records, and tagged-union variants), and types whose rules are enforced by a schema. Does this file define a class that has getters and setters or public mutable fields but little or no behavior of its own, while code elsewhere in this file reads and changes its fields to apply rules that belong to that data?",
		cutoff: 0.75,
		location: {
			question: "Select the declaration of the class whose behavior lives elsewhere.",
			cutoff: 0.7,
		},
		message:
			"Possibly Data Class: this class only holds fields and accessors while the rules for its data live in other code, so those rules are scattered and easy to bypass. Consider Move Function to put that behavior on the class, and Encapsulate Record to stop exposing mutable fields; if the type is meant to be plain data, model it as an immutable `Schema.Struct` instead.",
	},
	{
		id: "comments",
		target: "function",
		question:
			"Ignore comments that explain why (a reason, constraint, trade-off, or link to an issue), SAFETY: and similar invariant comments, doc comments on exported or public APIs, license headers, lint directives, and TODO comments. Does this function contain comments that narrate what the next lines do, label steps of a long body (such as '// step 1: load', '// validate input'), or explain what a confusing expression means, where extracting a well-named function, renaming a variable, or adding an assertion would make the comment unnecessary?",
		cutoff: 0.7,
		message:
			"Possibly Comments: these comments narrate what the code does, which means the code is not saying it itself. Consider Extract Function named after each commented step, Rename Variable or Rename Function so the name carries the explanation, or Introduce Assertion for a commented assumption; keep only comments that explain why.",
	},
	{
		id: "repeated-switches",
		target: "file",
		question:
			"Ignore a single switch or match, switches over values from an external protocol that this code does not own when they appear only at one decoding boundary, and exhaustive Match.tags or Match.type handlers over a tagged union defined in one place. Does this file switch on, or chain if/else or ternaries over, the same kind or type tag of the same union in two or more places, even through differently named variables, so that adding a new case would require editing each of those places?",
		cutoff: 0.7,
		location: {
			question: "Select the second switch or conditional chain over the same union.",
			cutoff: 0.7,
		},
		message:
			"Possibly Repeated Switches: this file dispatches on the same union's cases in several places, so adding a case means finding and editing each one. Consider Replace Conditional with Polymorphism (in Effect, define the cases once as a `Data.TaggedEnum` or `Schema.TaggedUnion` and handle them in one exhaustive `Match` per behavior, or move each case's behavior onto its variant).",
	},
];
