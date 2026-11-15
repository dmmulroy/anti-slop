# Testing Effect Programs

Tests should be deterministic where possible and realistic at the seam where behavior depends on an external system.
Verify test APIs against the project's installed Effect version and test integration.

## Standard harness

- When the project uses Vitest, `@effect/vitest` provides Effect-aware `describe` and `it`; use the host project's
  assertion and lifecycle APIs.
- Prefer `it.effect` and return the Effect. Do not manually call `Effect.runPromise` or maintain a `ManagedRuntime` in
  new tests.
- Provide dependencies with layers through `Effect.provide`.
- For per-identity layers executed through a shared `ManagedRuntime`, test at least two overlapping runtime calls with
  distinct identity markers. Local or sequential `Effect.runPromise` tests do not detect cross-call layer memoization.
- `it.effect` installs deterministic test services, including the test clock. Use `it.live` only when the behavior
  intentionally requires live services (real wall-clock scheduling is the common example). `it.live` is not an escape
  hatch for a hanging test and does not mean “integration test”. Real DB tests can normally remain `it.effect`.
- All test code, test layers, fakes, fixtures and helpers live in the package's `test/` directory outside `src/`
  (shared ones in `test/support/`). `src/` never exports test or fake layers. Build test layers from the production
  class: `Service.layer.pipe(Layer.provide(fakes))`, `yield* Service.make` with dependencies provided, or
  `Layer.succeed(Service, Service.of({...}))` for a faked edge.

```ts
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

it.effect("returns the domain result and persists state", () =>
  Effect.gen(function* () {
    const service = yield* WidgetService;
    const result = yield* service.create({ organizationId, name: "one" });

    expect(result.name).toBe("one");
    const rows = yield* Effect.promise(() => db.select().from(widgets));
    expect(rows).toMatchObject([{ id: result.id, name: "one" }]);
  }).pipe(Effect.provide(makeLayer())),
);
```

## `@effect/vitest` patterns

Check these against the installed `@effect/vitest` version. Import test APIs from `@effect/vitest`, not `vitest`.

- **Layout and naming.** Tests are `test/**/*.test.ts` in each package, and its `vite.config.ts` sets
  `test.include: ['test/**/*.test.ts']`. Shared layers, fakes, seeds and harnesses go in `test/support/`. Use a
  separate suffix such as `*.vi.test.ts` only when a package mixes test runners.
- **`it.effect` with `Effect.provide`** is the default when each test needs its own controls. A harness in the test
  file or `test/support/` (`makeHarness(options)`) returns `{ layer, ...recorders }`. The test yields it, runs the
  subject with `Effect.provide(h.layer)`, and asserts on the recorders.
- **`layer(L)(name, (it) => ...)`** shares one layer across a block. It is built once before the block and released
  after it, and it keeps `TestClock` unless you pass `excludeTestServices: true`. Use it for expensive shared setup
  (servers, containers, migrations) and pass `timeout` for slow builds. Pass `buildPerTest: true` for a fresh layer per
  test when tests mutate state. `it.layer(L2)(...)` nests a further layer inside a block.
- **Contract suites.** A function in `test/` that registers tests for any implementation lets the memory fake and every
  real backend run the same contract, for example
  `export const storeContract = (name, makeEmptyStore: () => Layer<Store, E>) => ...`. Each test runs inside
  `layer(makeEmptyStore())`, so it starts empty.
- **Real dependencies.** Start containers in a `test/support/` effect that uses `Effect.acquireRelease` (`docker run`,
  then `docker rm -f` on release), poll readiness with a bounded `Effect.retry`, and return the connection config as a
  `ConfigProvider`. Then provide `ConfigProvider.layer(...)` under the shared `layer(...)`, so the containers live
  exactly as long as the block. For example,
  run the suite under `layer(TestLive, { timeout: '180 seconds', excludeTestServices: true })`. Alternatively, keep
  slow backend suites in a separate `test-backends/` directory with their own vite config, run by a script that owns
  the containers. If building the store empties its tables, make those suites refuse to run unless an env var confirms
  the database is disposable. Use that split when a suite is
  too slow or too heavy for `pnpm test`.
- **Property tests.** `it.effect.prop(name, [SchemaOrArbitrary, ...], ([a, ...]) => effect)` generates inputs from
  Schemas, and `it.prop` is the synchronous form. A failure or failed `expect` shrinks the input. Inputs can
  combine `TestClock.setTime` with `Schema.Int.check(Schema.isBetween(...))` ranges.
- **Concurrent tests** should use the context's `expect` (`it.effect("...", ({ expect }) => ...)`), not the imported
  one.

```ts
// test/app-registry.test.ts
import { describe, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AppRegistry } from "../src/AppRegistry";
import { AppRegistryTest } from "./support/layers"; // AppRegistry.layer over an in-memory AppStore

const Slug = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,30}$/));

describe("AppRegistry", () => {
  layer(AppRegistryTest, { buildPerTest: true })((it) => {
    it.effect("finds an app it registered", () =>
      Effect.gen(function* () {
        const registry = yield* AppRegistry;
        yield* registry.register({ slug: "hello", name: "Hello" });
        expect(yield* registry.find({ slug: "hello" })).toEqual({ slug: "hello", name: "Hello" });
      }),
    );

    it.effect("fails with AppNotFound for an unknown slug", () =>
      Effect.gen(function* () {
        const error = yield* (yield* AppRegistry).find({ slug: "missing" }).pipe(Effect.flip);
        expect(error._tag).toBe("AppNotFound");
      }),
    );
  });

  it.effect.prop("finds any registered slug", [Slug], ([slug]) =>
    Effect.gen(function* () {
      const registry = yield* AppRegistry;
      yield* registry.register({ slug, name: slug });
      expect((yield* registry.find({ slug })).slug).toBe(slug);
    }).pipe(Effect.provide(AppRegistryTest)),
  );
});
```

## Synchronize; never hope

Tests must establish causal ordering with Effect primitives rather than sleeps, polling loops, repeated yields, or
“eventually” assertions:

- **`Deferred<A, E>`**: a one-shot result or handshake. Use it to signal “the worker has started”, provide one result,
  or await one terminal event.
- **`Queue<A>`**: an ordered, repeatable interaction log or scripted input channel. A recording fake can `offer` each
  request while the test `take`s exactly the expected interactions.
- **`Latch`**: a gate for one or many fibers. Have the fake announce that it reached a point, then wait on
  `latch.await`; the test inspects intermediate state and calls `latch.open`.
- **`Ref<A>`**: atomic in-memory state for attempt counts, captured calls, and state-machine fakes. Read it only after a
  `Deferred`, `Queue`, `Latch`, or joined fiber proves the relevant write has happened.

A `Ref` records state; it is not by itself a completion signal. A `Queue` is preferable to `Ref<Array<A>>` when order,
backpressure, or waiting for the next event is part of the behavior.

## Virtual time with `TestClock`

Import `TestClock` from `effect/testing`. Use it for sleeps, timeouts, schedules, retries, cache expiry, and periodic
work. The critical ordering rule is **fork first, prove the fiber reached the timed wait when necessary, then adjust the
clock**. Running a sleeping/retrying effect inline before adjusting deadlocks; adjusting before its timer is registered
can miss the deadline under test.

```ts
import { Deferred, Effect, Fiber, Ref, Schedule } from "effect";
import { TestClock } from "effect/testing";

it.effect("retries after the configured delay", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const attempted = yield* Deferred.make<void>();

    const operation = Ref.updateAndGet(attempts, (n) => n + 1).pipe(
      Effect.tap(() => Deferred.succeed(attempted, undefined)),
      Effect.flatMap(() => Effect.fail("unavailable" as const)),
      Effect.retry({ times: 1, schedule: Schedule.spaced("1 second") }),
    );

    const fiber = yield* operation.pipe(Effect.forkChild);
    yield* Deferred.await(attempted);
    yield* TestClock.adjust("1 second");
    yield* Fiber.await(fiber);

    expect(yield* Ref.get(attempts)).toBe(2);
  }),
);
```

For a test that only needs a timer to be registered, forking before `TestClock.adjust` is sufficient. For richer
background workflows, add a handshake at the exact stage whose timer or queue wait matters. Advance only the duration
needed for the assertion, and assert attempt counts and idempotent end state—not elapsed real milliseconds.

Use `it.live` when the subject explicitly integrates with the live clock or another live test service and virtual time
would invalidate what is being tested:

```ts
it.live("uses the platform's live clock", () => liveClockIntegrationCheck);
```

Keep such tests rare and use generous semantic bounds rather than exact timing assertions.

## First-class test services

When many tests need programmable behavior plus observable state, model the double as a first-class test service rather
than an ad hoc closure or module mock. The test service should own controls such as `Queue`, `Deferred`, `Latch`, and
`Ref`, and expose a layer implementing the **production dependency interface**. Tests program responses and inspect
recorded interactions through the control service; production code sees only its normal dependency.

Conceptually:

```ts
interface TestMailerControl {
  readonly requests: Queue.Queue<SendMailInput>;
  readonly responses: Queue.Queue<Effect.Effect<void, MailerError>>;
}

// A test-only layer allocates both queues, exposes TestMailerControl, and implements
// Mailer by recording to requests and taking the next scripted response.
```

This pattern makes behavior reusable, concurrent, and deterministic. Keep the service/layer in `test/`, make
unexpected calls fail loudly, and do not mirror every production method when a smaller domain-shaped control API is
enough. A simple one-test recording fake can still use `Layer.succeed`; promote it only when shared coordination earns
the abstraction.

## Streams and background fibers

Running a stream or daemon in the background introduces two separate facts to synchronize:

1. **Started/ready:** the consumer has subscribed, acquired resources, or entered its loop.
2. **Observed/completed:** the expected element or terminal condition has actually been processed.

Represent those facts explicitly with separate `Deferred`s, a `Latch`, or queue events. Fork the scoped/background
effect, await readiness, provide input, await observation, then interrupt or join the fiber and assert finalizers. Do not
sleep to “let the stream start”, adjust the clock before the stream has registered its timed pull, or leave an
unsupervised fiber running after the test.

For infinite streams, use a scoped fork and deterministic stop condition; for finite streams, join the fiber. For
periodic workers, handshake before each relevant `TestClock.adjust`. For backpressure tests, use bounded queues/latches
to prove when producer or consumer is blocked rather than inferring it from timing.

## Substitute at real seams

Choose the dependency by what the behavior relies on. These are examples, not required repository technologies:

- **Isolated real database** for database semantics, constraints, transactions, structured-column parsing, conflict behavior, or state
  transitions.
- **Hand fake database service** only for deterministic orchestration that does not claim to verify SQL semantics.
- **Recording service fake** (`Layer.succeed`, a first-class test service, or `Layer.mock`, all in `test/`) for a true
  external system; make unexpected methods die loudly.
- **Fake `HttpClient` or loopback server** for transport encoding, decoding, and status handling.
- **Test `ConfigProvider`** for configuration.
- **Effect test clock/random services** instead of sleeps or nondeterministic values.

Deterministic service substitution does not replace a real database when database semantics are the thing under test.
Build the test graph at the real seams, for example by providing the live service layer with a real test DB
layer and fake provider layer. Test the live implementing layer; do not create a second production `Base` layer solely
for testing.

## Assert behavior and end state

Assert both sides of the contract:

1. the returned domain value or precisely narrowed tagged error; and
2. the externally visible end state—real database rows, recording-service requests, emitted payloads, or released
   resources.

For retries and concurrent creates, assert attempts plus idempotent persisted state. For resources, assert finalizers on
success, typed failure, interruption, and defects where relevant. For best-effort effects, assert that the caller
succeeds **and** that the failed delivery was captured through an injectable observable seam. Query the real database
after the operation; do not treat a repository fake's call count as proof of SQL or transaction behavior.

## Banned patterns

- module patching and method spies where a layer seam is available;
- mock layers, fake services or test helpers in `src/`;
- real sleeps, polling, timing races, and repeated `Effect.yieldNow` as synchronization;
- advancing `TestClock` before the subject fiber has been forked/registered its timed work;
- background fibers or streams with no readiness/completion handshake and no cleanup;
- tests that only assert a return value while ignoring persisted side effects;
- fake databases for behavior whose correctness depends on actual SQL semantics.

If a dependency cannot be swapped by a layer, fix the service boundary rather than weakening the test.
