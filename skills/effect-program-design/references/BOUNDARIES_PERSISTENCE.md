# Boundaries and Persistence

Adapters translate untrusted external representations into the module's typed internal vocabulary. Persistence is an
adapter too: driver errors and storage rows do not belong in the public service contract.

## Boundary responsibilities

- Parse request bodies at HTTP/RPC/webhook entry points before calling a domain service.
- Parse provider responses in the provider adapter before returning domain values.
- Wrap throwing APIs once with `Effect.try`/`tryPromise` and one centralized cause classifier.
- Convert transport, decoding, and driver failures to tagged internal errors at the seam.
- Capture rich internal errors before narrowing them to public caller-actionable outcomes.
- Never leak SDK objects, raw rows, `unknown`, or arbitrary `Error` values across the public interface.

Use `Schema.TaggedError` when an error crosses a network/RPC/encoded boundary. Use `Data.TaggedError` for
internal-only failures. Recover with `catchTag`/`catchTags`, never manual `_tag` comparisons or `instanceof`.

## Persistence effects

Substantial query/update workflows should be independently testable Effect values with the project's database capability in `R`. They may
be collocated for a small service or extracted to `x.persistence.ts` for a larger one. Map driver errors at this seam;
do not let raw SQL/driver failures escape.

Use atomic database operations for lifecycle claims and state transitions. Prefer a conditional update/upsert with an
asserted affected-row result over read-then-write races. When a create may be retried, use a stable idempotency key or
an `onConflictDoNothing` claim.

Do not keep a database transaction open across a network call. Claim work atomically, release the transaction, perform
the call, then persist the final state with an explicit transition guard.

## Capture before narrow

Persistence failures that indicate degraded capability should be logged and sent to the configured error reporter,
when one exists, while they still retain the internal driver classification. Only then map them to a small public
error such as `Unavailable`. Expected domain outcomes generally do not need external error reports.

## Testing the seam

Use an isolated real database when behavior depends on database semantics, constraints, transactions, conflict
handling, or transition guards. Assert the externally visible return/error and the final database state. A hand fake
is appropriate only for pure orchestration over an abstract database capability; it cannot prove database behavior.

Never use module mocks or spies for persistence. Test services and `Layer.mock` belong only in the package's `test/`
directory, never in `src/`.
