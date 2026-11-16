---
name: effect-program-design
description: >-
  Design, write, review, and test production Effect v4 programs: deep services and layers, schemas,
  tagged errors, observability, Config, persistence, resources, concurrency, schedules, workers,
  streams, caches, HTTP clients, Effect platform services (Node filesystem/path/crypto/process/socket),
  and Effect Atom integrations. Use for any Effect application or adapter work.
---

# Effect Program Design

Build production Effect v4 programs with small domain-shaped interfaces, typed success and error channels,
declared dependencies, observable operation boundaries, and tests that substitute layers at real seams. This skill
combines broad Effect mechanics with deep-module, capture-before-narrow, and real-seam design standards.

## The service pattern (always)

Every application capability is a `Context.Service` class. Its constructor is the `make` effect, which `yield*`s
each dependency from the environment. Its layer is `static readonly layer = Layer.effect(this, this.make)`. Effect v4
has no `Layer.scoped`: `Layer.effect` runs `make` in the layer's scope, so `Effect.acquireRelease` inside `make`
releases when that scope closes. No function takes a service as an argument, and there is no separate `*Live`
constant or `makeXWith(dep)` variant. Operations use the yielded services directly: never capture `Effect.context` to
re-provide it later; yield each service.

```ts
// src/AppRegistry.ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export class AppRegistry extends Context.Service<
  AppRegistry,
  {
    readonly find: (input: { readonly slug: string }) => Effect.Effect<AppRecord, AppNotFound>;
  }
>()("@app/registry/AppRegistry", {
  make: Effect.gen(function* () {
    const store = yield* AppStore; // dependencies come from yield*, never from parameters

    return {
      find: ({ slug }) =>
        store.findBySlug({ slug }).pipe(
          Effect.flatMap(
            Option.match({ onNone: () => Effect.fail(new AppNotFound({ slug })), onSome: Effect.succeed }),
          ),
          Effect.withSpan("app_registry.find", { attributes: { slug } }),
        ),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

// Runtime composition provides each layer once:
// AppRegistry.layer.pipe(Layer.provide(AppStore.layer))
```

- A variant layer derives from `layer`: `static readonly layerSelfBinding = X.layer.pipe(Layer.provide(...))`.
- When construction needs plain options, `make` and `layer` become static functions of those options (plain values
  only, never services or layers): `static readonly layer = (options: Options) => Layer.effect(this, this.make(options))`.
- Hosts that build services themselves (a Durable Object, a per-request scope) `yield* X.make` with its dependencies
  provided.

## Tests live in `test/`, outside `src/` (hard rule)

All test code lives in the package's `test/` directory next to `src/`: test files, test layers, fakes, fixtures, recording services and helpers. Shared ones go in `test/support/`.
Production code in `src/` never exports `layerTest`, `layerFake`, `layerMock`, or any fake or test helper, and never
imports from `test/`.

The one exception is a fixtures layer standing in for a feature that is not built yet. It may live in `src/` only with
a doc comment saying what it replaces and when it goes away. Test layers, fakes and test helpers still never go in
`src/`.

Tests build their layers in `test/` from the production class:

```ts
// test/support/layers.ts
export const AppStoreTest = Layer.succeed(
  AppStore,
  AppStore.of({ findBySlug: ({ slug }) => Effect.succeed(Option.some({ slug, name: "Hello" })) }),
);

// The real AppRegistry over a fake dependency:
export const AppRegistryTest = AppRegistry.layer.pipe(Layer.provide(AppStoreTest));

// Or construct it directly from make inside a test:
const registry = yield* AppRegistry.make.pipe(Effect.provide(AppStoreTest));
```

Fake the edges (external systems, platform bindings) with `Layer.succeed(Service, Service.of({...}))` or
`Layer.mock`, and run the real service under test through `Service.layer` or `Service.make`. Make unexpected fake
methods `Effect.die` loudly.

## Source rule

Check these before guessing:

1. the nearest `CLAUDE.md` / `AGENTS.md` and project-local conventions;
2. the installed `effect`, `@effect/*`, and related package versions and declarations;
3. the Effect v4 docs at <https://effect.website/docs/v4>;
4. the installed package source and declarations, plus an upstream source checkout when available, when docs do not settle an API.

`effect/unstable/*` can change between beta/minor versions. Typecheck examples against the installed version. Local
project conventions take precedence unless the task explicitly changes them.

## References

Read only the references relevant to the task; read all matching branches when work crosses concerns.

- Public module depth and domain-shaped APIs: `references/DEEP_MODULES.md`. Read this when modifying or creating services or layers.
- Service `make`/`layer` details, file placement, `Effect.fn`, or runtime composition:
  `references/SERVICES_LAYERS.md`.
- Tagged errors, capture-before-narrow, spans, logs, or error reporting: `references/ERRORS_OBSERVABILITY.md`.
- Records, schemas, variants, optionality, brands, decoding, or construction:
  `references/SCHEMA_DATA_MODELING.md`.
- Config, env vars, providers, or secrets: `references/CONFIG_SECRETS.md`.
- HTTP, SDK, database boundaries, persistence records, or transactions: `references/BOUNDARIES_PERSISTENCE.md`.
- Scopes, acquisition, concurrency, best-effort work, or workflow transitions:
  `references/RESOURCES_CONCURRENCY.md`.
- Retry, repeat, polling, pacing, backoff, or workers: `references/SCHEDULING_WORKERS.md`.
- Streams, queues, pubsub, pagination, backpressure, or long-lived consumers: `references/STREAMS.md`.
- Memoization, TTL caches, request dedupe, or batching: `references/CACHING_BATCHING.md`.
- Outgoing HTTP, provider adapters, status/decode handling, or HTTP retry: `references/HTTP_CLIENTS.md`.
- Effect tests, test services, clocks, synchronization, fakes, or real seams: `references/TESTING.md`.
- Platform-neutral services and the native-API boundary: `references/PLATFORM.md`.
- Node runtime, filesystem, path, crypto, child processes, sockets/WebSocket, Redis, or workers:
  `references/PLATFORM_NODE.md`.
- Effect Atom or React reactive Effect state: `references/EFFECT_ATOM.md`.
- TypeScript safety, Predicate refinements, Match dispatch, naming, collections, imports, and escape hatches:
  `references/TYPESCRIPT_CONTRACTS.md`.

## The creed

1. **Deep modules.** The interface is the cost and the hidden implementation is the benefit. Public operations use
   domain inputs and outputs; callers do not supply credentials, clients, rows, or other internals.
2. **Everything stays in Effect.** Keep expected failures in `E`, dependencies in `R`, and resources in scopes. Do
   not pass services, layers, effects, or errors as ordinary values when composition expresses the relationship.
3. **Two-tier errors.** Classify rich internal failures, capture them, then narrow to a small caller-actionable union.
   Prefer typed `catchTag`/`catchTags`; never recover with `instanceof`, `Match`, or manual `_tag` comparisons.
   **Respect the error channel!** Errors stay in the error channel and are not passed as values
4. **Observe operations.** Every public operation has a stable `Effect.fn("domain.operation")`, an explicit
   `Effect.withSpan`, or both. Capture raw actionable or unexpected failures before narrowing or swallowing them.
   Use Effect's logging APIs rather than passing loggers through domain interfaces. Report failures through the
   repository's configured observability capability, when one exists, before remapping or transforming them.

   ```typescript
   someEffect.pipe(
     Effect.tapError(Effect.logError),
     Effect.tapError((error) => errorReporter.capture(error)),
   );
   ```

5. **Test at real seams.** Use the repository's Effect-compatible test integration, layers, deterministic test services, and real infrastructure where
   behavior depends on it. Assert both the result/error and externally visible end state.
   **If you are writing tests you MUST read `references/TESTING.md`**
6. **Use Effect platform services.** Application code depends on Effect's FileSystem, Path, Crypto, HTTP, process,
   socket, worker, and related abstractions. Native Node/Bun/browser APIs belong only in runtime adapters when no
   Effect service exists or when constructing the platform layer.
7. **Use clear domain names.** Follow the host repository's naming conventions. Prefer names that communicate the
   domain operation over ambiguous generic names, such as `publishPatchDiffToStream` instead of `publish` when the
   distinction matters.

## Core defaults

- Compose workflows with `Effect.gen` and named `Effect.fn` operations.
- Build every service with the service pattern above. Details: `references/SERVICES_LAYERS.md`.
- Small services may collocate shape, tag, errors, operations, and layer in one file. Split larger services and
  external adapters by transport, persistence, orchestration, and other meaningful concerns.
- Keep substantial operation effects independently testable. They may remain beside a small service or move to a
  concern file; avoid burying business workflows in a large layer-construction closure.
- Dependencies normally remain ambient in `R`. Capturing a yielded dependency is reasonable for genuinely
  layer-local acquired state or configured clients.
- Model ordinary records with `Schema.Struct` plus a same-name inferred interface. Use `Data.TaggedEnum` for trusted
  internal control flow and Schema tagged variants/unions for encoded boundaries.
- Prefer `Schema.TaggedError` for network, RPC, queue, workflow, or other boundary-facing errors.
  `Data.TaggedError` is fine for internal-only failures that do not need a codec.
- Branding remains optional/aspirational. Named input objects are mandatory even when IDs remain raw strings.
- Decode unknown input at the adapter edge with Schema; do not cast JSON or leak SDK/row types through a service.
- Prefer `Predicate` refinements over ad hoc `typeof`, `instanceof`, nullish, and property-presence checks. Predicate is
  for trusted values or intentional shallow refinement, not a replacement for Schema decoding at an unknown boundary.
- Prefer exhaustive `Match` dispatch for trusted discriminated unions and multi-branch value handling. Never compare
  `_tag` manually: use `catchTag`/`catchTags` for Effect errors and `Match` for non-error values.
- Read runtime config through `Config`; keep secrets `Redacted` until the adapter call.
- Use `Schedule` for retry/repeat/polling and `Stream` for many-valued, backpressured sources.
- Use bounded concurrency, bounded/idempotent retries, scoped background fibers, and explicit finalizers.
- Keep external network calls outside authoritative database transactions.
- Keep TypeScript contracts precise: no `any`, non-null assertions, `as`-casts, excepting `as const`, vague helper files, or
  truthiness shortcuts that erase meaningful domain distinctions.
- **PARSE, DON'T VALIDATE**. Parse at trust boundaries (non-effect-to-effect code bridges, databases, networks) to ensure type safety
  without bad validation code.

## Testing defaults

- When using `@effect/vitest`, prefer `it.effect`; use `it.live` only when live runtime behavior is itself under test.
- Use `layer(L)(name, (it) => ...)` to share one layer, such as a server or containers, across a block (`buildPerTest: true`
  for fresh state), `Effect.provide(harness.layer)` for per-test controls, contract suites in `test/` to run fakes and
  real backends through the same tests, and `it.effect.prop` for Schema-driven property tests. See
  `references/TESTING.md` (`@effect/vitest` patterns).
- Use `TestClock`, `Deferred`, `Queue`, `Latch`, and `Ref` instead of sleeps and timing races.
- Test services, recording fakes, fixtures, and `Layer.mock` live only in the package's `test/` directory, never in
  `src/` (see the hard rule above).
- Use an isolated real database when behavior depends on database semantics, constraints, transactions, conflicts, or state transitions.
- Use fake Effect services or clients for true external systems and make unexpected methods fail loudly.
- Prefer dependency substitution through layers over module patching or method spies.

## Review checklist

- [ ] The public surface is small, domain-shaped, and hides implementation knowledge.
- [ ] Each method exposes a narrow caller-actionable error union.
- [ ] Rich failures are captured before narrowing or best-effort swallowing.
- [ ] Every public operation has a safe, stable trace boundary.
- [ ] Dependencies are declared in `R`; resources and background work have clear scoped owners.
- [ ] Unknown boundaries are decoded; secrets stay `Redacted`; raw rows/SDK values do not cross public seams.
- [ ] Runtime refinements use `Predicate`; trusted union dispatch uses exhaustive `Match`; no code manually compares `_tag`.
- [ ] Native platform APIs are isolated behind Effect services and runtime layers.
- [ ] Each service's implementing Layer is provided once during application runtime construction unless its required
      configuration or resources do not exist until a later operation scope.
- [ ] Retries are bounded and idempotent; concurrency and buffering are bounded.
- [ ] Each service is a `Context.Service` with `make` and `static readonly layer = Layer.effect(this, this.make)`.
- [ ] Tests, test layers, and fakes live in `test/`; `src/` exports no test or fake layers.
- [ ] Tests use real seams, deterministic synchronization, and assert external end state.
