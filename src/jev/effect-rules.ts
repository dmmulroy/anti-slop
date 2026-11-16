/**
 * Plain-English rules for `oxlint-plugin-jev`'s `createJevPlugin`, encoding the Effect review
 * policy in `skills/effect-program-design`. `./plugin.ts` turns each entry into its own oxlint
 * rule, `anti-slop-effect-jev/<id>`. "Yes" means "report". Each question states its carve-outs
 * first and ends with the yes/no question.
 *
 * Every rule targets `"file"`. The plugin sends one match per rule per matching node, and
 * `maxMatchesPerFile` caps matches across all of a plugin's rules in source order, so `"call"`
 * and `"function"` rules exhaust the cap on the first few calls or callbacks of an Effect file and
 * leave the rest unchecked. A file rule is one match per file, and `location` still points the
 * diagnostic at the offending line.
 */
import type { JevRule } from "oxlint-plugin-jev";

/** The oxlint plugin name `./plugin.ts` registers; each rule is configured as `<name>/<id>`. */
export const effectJevPluginName = "anti-slop-effect-jev";

/**
 * Plugin-level options sized for whole-file rules. A file longer than `maxSnippetChars` is
 * truncated and loses its location, so raise it for repositories with long modules. The file is
 * sent once per request however many file rules read it, so request size is about the file plus
 * one question per enabled rule.
 */
export const effectJevOptions = {
  maxMatchesPerFile: 25,
  maxSnippetChars: 24_000,
  timeoutMs: 60_000,
} as const;

/** For application and library source. Turn these off for test globs. */
export const effectSourceJevRules: ReadonlyArray<JevRule> = [
  {
    id: "single-use-abstraction",
    target: "file",
    question:
      "Ignore exported declarations, declarations that contain real logic such as branching, validation, decoding, error mapping, or I/O, and names for a domain concept that is also used on its own as a parameter, return, or stored type. Does this file declare a non-exported type, interface, schema fragment, shared-fields object spread into other objects or schemas, or helper function whose only job is to regroup, rename, or forward fields or arguments, so that writing its contents inline where it is used would be at least as clear?",
    cutoff: 0.75,
    location: {
      question: "Select the declaration that should be written inline where it is used.",
      cutoff: 0.7,
    },
  },
  {
    id: "error-as-value",
    target: "file",
    question:
      "Ignore absence that is a normal domain outcome, such as a lookup that found nothing; local branching on Effect.result or Effect.either that then re-fails or handles each case; aggregates that intentionally collect per-item successes and failures as data; and protocol encoders that serialize an error into a wire response. Does any function in this file report a failure as a successful value, for example by returning or succeeding with { ok: false }, an object with an error or errors field, an Either, Result, or Exit, an Error instance, or null, undefined, or Option.none() meaning that an operation failed, instead of failing in the Effect error channel?",
    cutoff: 0.75,
    location: {
      question: "Select the line that returns or succeeds with the failure value.",
      cutoff: 0.7,
    },
  },
  {
    id: "shallow-service",
    target: "file",
    question:
      "Ignore non-exported adapter helpers, and operations that add validation, authorization, decoding, mapping to domain types, error narrowing, caching, retries, or orchestration of several calls; adding only a span or a log does not make an operation deep. Does this file define an Effect service (a Context.Service class, its make effect, or the layer implementing it) with a public operation that only calls one method on one dependency and returns that result unchanged, or a public operation whose input or output types include an HTTP or SDK client, a database row or query-builder type, a connection, a token, or a credential?",
    cutoff: 0.75,
    location: {
      question:
        "Select the service operation that only forwards to a dependency or that exposes a client, row, connection, or credential.",
      cutoff: 0.7,
    },
  },
  {
    id: "swallow-without-capture",
    target: "file",
    question:
      "Ignore recovery from expected domain outcomes such as NotFound, AlreadyExists, or a validation failure, and handlers that fail again with another error. Does this file turn an Effect failure into success, using catchTag, catchTags, catch, catchAll, catchCause, orElse, orElseSucceed, ignore, or a similar recovery, by producing void, a default, or a fallback value, without logging or reporting that error either inside the handler or in an earlier tapError in the same pipeline?",
    cutoff: 0.7,
    location: {
      question: "Select the recovery call that discards the error without capturing it.",
      cutoff: 0.7,
    },
  },
  {
    id: "unbounded-retry",
    target: "file",
    question:
      "Ignore repeat of a successful pass, and retry policies that are bounded by attempts or elapsed time and only see retryable errors. Does this file call Effect.retry, Stream.retry, Effect.retryOrElse, or a similar retry operator with a policy that has no bound on attempts or elapsed time (for example a bare Schedule.exponential or Schedule.spaced with no take, recurs, times, or upTo), or that retries every error with no while or until predicate and no earlier narrowing of the error channel to retryable failures?",
    cutoff: 0.7,
    location: {
      question: "Select the retry call with the unbounded or unfiltered policy.",
      cutoff: 0.7,
    },
  },
  {
    id: "network-call-in-transaction",
    target: "file",
    question:
      "Ignore transaction bodies that only read and write the database, and external calls made before the transaction starts or after it commits. Does this file run a database transaction (withTransaction, db.transaction, sql.withTransaction, or a similar transaction wrapper) whose body makes an HTTP, SDK, or model-provider call, publishes or sends a message, or sleeps or retries with backoff?",
    cutoff: 0.7,
    location: {
      question: "Select the external call or wait inside the transaction body.",
      cutoff: 0.7,
    },
  },
  {
    id: "read-then-write-race",
    target: "file",
    question:
      "Ignore reads used only for a response when the write does not depend on them. Does this file read a database row's state or existence and then, in a separate statement, conditionally insert or update that same row based on what it read, without a conditional update guarded on the expected prior state, an upsert or onConflict clause, a row lock such as SELECT ... FOR UPDATE, or a unique-claim check on the affected-row count?",
    cutoff: 0.7,
    location: { question: "Select the write that depends on the earlier read.", cutoff: 0.7 },
  },
  {
    id: "unbounded-fanout",
    target: "file",
    question:
      "Ignore fixed literal tuples or records of effects, calls with a fixed numeric concurrency, and calls that omit concurrency and therefore run sequentially. Does this file run Effect.forEach, Effect.all, Stream.mapEffect, or a similar operator over a collection whose size is only known at runtime, where each item does I/O, with concurrency set to \"unbounded\" or to a value derived from the collection's length?",
    cutoff: 0.7,
    location: { question: "Select the call with unbounded concurrency.", cutoff: 0.7 },
  },
  {
    id: "decode-after-status",
    target: "file",
    question:
      "Ignore responses already checked with filterStatusOk or a status match, responses from a client piped through filterStatusOk, and decoding of a separate error schema only for non-success statuses. Does this file decode an HTTP response body into a success schema or parse it as JSON without first checking or classifying the response status, or read the same response body more than once?",
    cutoff: 0.7,
    location: {
      question:
        "Select the decode or body read that happens before the status is checked, or the second body read.",
      cutoff: 0.7,
    },
  },
  {
    id: "cache-in-method",
    target: "file",
    question:
      "Ignore caches constructed once while building a layer, a service make, or a module-level value and then shared. Does this file create a cache or memo, such as Cache.make, Cache.makeWith, Effect.cached, Effect.cachedWithTTL, or a Map used as a memo, inside a function or operation that runs on every call, or hand-build a TTL or in-flight cache from a Map plus timestamps, timers, or stored promises?",
    cutoff: 0.7,
    location: {
      question: "Select the line that constructs the per-call cache or the hand-built cache.",
      cutoff: 0.7,
    },
  },
];

/** For test files only. Enable these for test globs and turn the source rules off there. */
export const effectTestJevRules: ReadonlyArray<JevRule> = [
  {
    id: "test-cannot-fail",
    target: "file",
    question:
      "Count a test that has no assertions, that asserts only on values the test itself constructed, that asserts a mock or fake returns what the test configured it to return, that asserts only facts the type system already guarantees, or whose only assertions run inside a loop over a list that may be empty; do not count tests whose assertions observe the output, error, or end state produced by the code under test. Does this file contain a test case (it, test, it.effect, it.live, it.prop, or a similar test registration) that would still pass if the behavior named in its title were broken or removed?",
    cutoff: 0.7,
    location: {
      question: "Select the title line of the test case that cannot fail.",
      cutoff: 0.7,
    },
  },
];
