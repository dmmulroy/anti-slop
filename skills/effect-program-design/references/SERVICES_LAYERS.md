# Services and Layers

Services declare capabilities; layers construct implementations. The environment is the dependency graph.

## Service shape

- Make operations domain-shaped and Effect-returning.
- Keep success, typed error, and requirements visible in each operation type.
- Use named input objects and narrow per-operation errors.
- Yield dependencies from the environment rather than accepting service instances as parameters.
- Load configuration with `Config` in the implementing layer. Keep secrets `Redacted` until the adapter edge.

Small modules may collocate tag, shape, errors, and live layer. Larger services and external adapters should split the
public tag, live wiring, errors, schemas, persistence, and transport concerns. Collocation is a complexity decision,
not permission to tangle public contracts with implementation details.

## Live implementation: `make` and `static layer`

Give each service its constructor as a `make` effect on the class, and build its layer from that `make` as
`static readonly layer`. `make` yields every dependency from the environment. No function takes a service instance as
a parameter, and there are no separate `WidgetServiceLive` constants or `makeWidgetServiceWith(provider)` variants.

```ts
export class WidgetService extends Context.Service<
  WidgetService,
  {
    readonly list: (input: ListWidgetsInput) => Effect.Effect<ReadonlyArray<Widget>, WidgetError>;
  }
>()("@app/widgets/WidgetService", {
  make: Effect.gen(function* () {
    const provider = yield* WidgetProvider; // dependencies come from yield*, never from parameters

    return {
      list: Effect.fn("widget_service.list")(function* (input: ListWidgetsInput) {
        const widgets = yield* provider.fetch({ organizationId: input.organizationId });
        return widgets.filter((widget) => !widget.archived);
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

// Runtime composition provides it once:
const AppLayer = WidgetService.layer.pipe(Layer.provide(WidgetProvider.layer));
```

- `make` yields each dependency once and the operations use the yielded value directly. Never capture
  `Effect.context` to re-provide it later, and never re-provide a yielded service with `Effect.provide` or
  `Effect.provideService`; yield each service with `yield*` instead.
- `WidgetService.make` is the constructor. Hosts that build the service themselves `yield*` it. An example is a
  Durable Object that constructs per-instance services. Tests can do the same, providing the dependencies.
- `WidgetService.layer` is what runtime composition provides. Effect v4 has no `Layer.scoped`: `Layer.effect` runs
  `make` in the layer's scope, so resources acquired with `Effect.acquireRelease` in `make` release with the layer.
- A variant layer is derived from `layer`, not from a second constructor. For example,
  `static readonly layerSelfBinding = WidgetService.layer.pipe(Layer.provide(selfBindingHttpClient))`.

When construction needs plain configuration, such as a batch size or concurrency limit, make both static functions of
that configuration. Their arguments are only plain values, never services, layers, contexts, or handler functions with
their own requirements. Behavior that differs per host is a service the host provides:

```ts
// The handlers are their own service. Its dependencies are yielded in its own make.
export class MailboxProcessors extends Context.Service<
  MailboxProcessors,
  {
    readonly deliver: (input: { readonly message: MailboxMessage }) => Effect.Effect<void, DeliveryError>;
  }
>()("@app/delivery/MailboxProcessors", {
  make: Effect.gen(function* () {
    const webhooks = yield* WebhookClient;
    return {
      deliver: ({ message }) =>
        webhooks.post({ message }).pipe(Effect.withSpan("mailbox_processors.deliver")),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

export class MailboxProcessing extends Context.Service<
  MailboxProcessing,
  { readonly processReady: Effect.Effect<void, MailboxUnavailable | DeliveryError> }
>()("@app/delivery/MailboxProcessing") {
  static readonly make = (options: MailboxProcessingOptions) =>
    Effect.gen(function* () {
      const backend = yield* MailboxProcessingBackend;
      const processors = yield* MailboxProcessors;

      const processReady = Effect.gen(function* () {
        const ready = yield* backend.claimReady({ limit: options.batchSize });
        yield* Effect.forEach(
          ready,
          (message) =>
            processors
              .deliver({ message })
              .pipe(Effect.andThen(backend.markDelivered({ messageId: message.id }))),
          { concurrency: options.concurrency, discard: true },
        );
      }).pipe(Effect.withSpan("mailbox_processing.process_ready"));

      return MailboxProcessing.of({ processReady });
    });

  static readonly layer = (options: MailboxProcessingOptions) =>
    Layer.effect(MailboxProcessing, MailboxProcessing.make(options));
}

// Runtime composition:
// MailboxProcessing.layer(options).pipe(Layer.provide(MailboxProcessors.layer), Layer.provide(...))
```

`make` yields the backend and the processors and uses them directly, so no requirement is left open to capture. A host
that builds the service itself, such as a Durable Object whose alarm handlers depend on the instance, runs
`MailboxProcessing.make(options)` with its own handlers provided as a value:
`Effect.provideService(MailboxProcessors, MailboxProcessors.of({ deliver: ... }))`. That provides a newly built
implementation, which is different from re-providing a service it already yielded.

Prefer leaving dependencies in a substantial operation's `R` channel and satisfying them at runtime composition.
Capturing a yielded dependency is reasonable when an acquired resource or configured client is genuinely layer-local
(e.g. an effect needs a runtime-constructed httpClient with credentials provided for a given organization that were looked up at runtime).
Do not manufacture production `Base` layers solely to make testing possible; keep the real dependency seam visible.

Layers that depend on other services should yield those services. Business services should not construct dependency
layers. Runtime composition owns assembly. A justified exception is a dynamically credentialed client whose lifetime
or configuration can only be known during an operation; isolate that adapter behavior and keep it typed.

## Independently testable operation effects

Substantial effects remain first-class even when a service is small. Define them outside a large layer constructor so
their `Effect<A, E, R>` type documents requirements and tests can provide only the needed layers. They may remain in
the same file or be extracted by concern. Do not extract trivial wrappers merely to satisfy a file convention.

Both forms below are valid stable operation boundaries:

```ts
const getStatus = Effect.fn("widget.get_status")(function* (input: GetStatusInput) {
  // ...
});

// PREFERRED
const getStatusAlternative = (input: GetStatusInput) =>
  Effect.gen(function* () {
    // ...
  }).pipe(
    Effect.withSpan("widget.get_status", { attributes: { organization_id: input.organizationId } }),
  );
```

Use safe span attributes. Never annotate credentials, tokens, request bodies containing secrets, or unrestricted raw
provider responses.

## Test-only implementations

All test code lives in the package's `test/` directory, outside `src/`: test files, test layers, fakes, fixtures,
recording services and helpers (shared ones in `test/support/`). Production modules never export `layerTest`,
`layerFake`, `layerMock`, or any fake, and never import from `test/`. The only exception is a fixtures layer in `src/`
that stands in for a feature not built yet, with a doc comment saying what it replaces and when it goes away.

Tests build layers from the production class: the real service through `Service.layer` (or `yield* Service.make`)
with its dependencies provided by `Layer.succeed(Dep, Dep.of({...}))`, `Layer.mock`, or a real test resource.

```ts
// test/support/layers.ts
const WidgetProviderTest = Layer.succeed(
  WidgetProvider,
  WidgetProvider.of({ fetch: () => Effect.succeed([]), remove: () => Effect.die("unexpected remove") }),
);
export const WidgetServiceTest = WidgetService.layer.pipe(Layer.provide(WidgetProviderTest));
```

Do not use module mocks or method spies. If a dependency cannot be replaced by providing a layer, repair the module's
dependency boundary.

## Composition rules

- Assemble complete runtimes at application entry points.
- Provide each service's implementing Layer once when constructing the application's Effect runtime. The implemented
  service is then available through the Effect environment; do not re-provide its Layer inside operations, handlers,
  callbacks, or unrelated implementing Layers.
- Exception: provide an implementing Layer later only when it cannot be constructed during application runtime
  creation because required configuration or resources do not exist yet. Examples include credentials selected for
  the current tenant, request-derived client configuration, or a transport created for a new connection. Provide it
  at the narrowest scope that owns both the required values and its lifetime.
- Keep dependency wiring inside the module that owns it. Never require callers to pass `Context`, `Layer`,
  `ManagedRuntime`, or service instances as ordinary arguments.
- Use `Layer.provide`/`provideMerge` deliberately; avoid invisible global dependencies.
- Acquire resources in `make` with `Effect.acquireRelease`; `Layer.effect` scopes them to the layer.
- Do not call `Effect.runPromise` inside services.
- Do not pass a `Layer` into an operation.
- Do not hide initialization failures with `orDie`; classify, capture, and expose or handle them intentionally.
- A shared `ManagedRuntime` memoizes layers by reference across runtime calls. When a reused layer captures per-request,
  per-session, per-task, or per-tenant configuration or mutable state, wrap the complete dynamic layer subtree in
  `Layer.fresh`.
- Do not freshen intentional application singletons such as database pools and generic HTTP clients. Freshness must
  match the service's intended lifetime.
