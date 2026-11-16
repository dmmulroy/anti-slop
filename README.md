# anti-slop

[![skills.sh](https://skills.sh/b/dmmulroy/anti-slop)](https://skills.sh/dmmulroy/anti-slop)

Opinionated Oxlint rules that reject low-evidence and low-signal TypeScript and JavaScript patterns.

Anti-slop is first and foremost the ruleset I use with my work, projects, and team. It reflects my preferences and taste rather than attempting to be a universal coding standard.

**This project is meant to be vendored**, not treated as a fixed npm dependency. There is no official npm package. Copy the rules into your repository, read them, and change them to match your team's standards. The bundled agent skill handles the initial copy and configuration; after that, the vendored files are yours to maintain and make your own. Community-maintained forks and packages are welcome, but their compatibility and release lifecycle belong to their maintainers.

## Install with an agent skill

```bash
npx skills add dmmulroy/anti-slop --skill install-anti-slop
```

Then ask your coding agent to install or configure anti-slop in the current repository. The skill copies the plugin, installs compatible Oxlint dependencies—matching an existing Oxlint version when present—merges the plugin into the existing lint configuration, enables every generic rule, and validates the result. In repositories that depend directly on Effect, it also enables the opt-in Effect rule group.

### Update an existing installation

Ask your agent to **update anti-slop while preserving local customizations**, optionally naming an upstream revision or selected fixes. The same skill stages incoming source separately, uses a three-way merge when the original upstream snapshot is recoverable, and otherwise ports reviewed changes conservatively. It preserves local rules and configuration, asks about conflicting policy and enabling new rules, and records provenance for future updates. It does not force-replace the vendored directory.

For latest upstream, ask the agent to retrieve and identify that revision; an already-installed skill bundle may be older. The copy script itself does not fetch or merge updates.

To inspect available skills first:

```bash
npx skills add dmmulroy/anti-slop --list
```

## Manual local installation

Copy `src/` into the target repository, for example at `tools/oxlint/anti-slop/`. If the repository already uses `oxlint`, install `@oxlint/plugins` at exactly the resolved Oxlint version. Otherwise, install the same current version of both packages. Keep both versions exact so upgrades move them together.

Register the copied entry point in `oxlint.config.ts`:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  rules: {
    "anti-slop/max-ternary-depth": ["error", { "maxDepth": 2 }],
    "oxc/no-accumulating-spread": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-spread": "error",
    "anti-slop/no-disabled-type-assertion-rules": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-reprovide-ambient-service": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error"
  }
});
```

The same `ignorePatterns`, `jsPlugins`, and rules work under `lint` in a Vite+ config. Merge the ignore patterns into Vite+'s `fmt.ignorePatterns` as well so `vp check` does not reformat installed agent assets or the vendored plugin. Preserve existing ignores and add any other project-local agent tooling directories detected in the repository; do not broadly ignore every dot-directory.

### Optional Effect rules

Effect-specific rules live in a separate plugin so projects that do not use Effect do not inherit Effect architecture policy. Register the Effect entry point only in repositories that use Effect:

```ts
export default defineConfig({
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts"
    }
  ],
  rules: {
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-manual-tagged-type": "error",
    "anti-slop-effect/no-ordie-in-service-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/no-service-parameters": "error",
    "anti-slop-effect/no-test-code-in-src": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "anti-slop-effect/prefer-tagged-error-handling": "error",
    "anti-slop-effect/prefer-yield-service": "error",
    "anti-slop-effect/require-cause-when-narrowing": "error",
    "anti-slop-effect/require-operation-span": "error",
    "anti-slop-effect/require-service-make-layer": "error"
  }
});
```

### Effect language service

Effect repositories should also run every `@effect/tsgo` diagnostic as an Oxlint error. Install `@effect/tsgo` and `oxlint-tsgolint` at versions that support your `oxlint` and `typescript`, add `"prepare": "effect-tsgo patch --oxlint"`, and add `{ "name": "@effect/language-service", "diagnostics": false }` to `compilerOptions.plugins`. Then extend every preset and promote each rule except `missing-pipeable-signature`, which demands Effect-style data-last overloads on every exported multi-argument function:

```ts
import { presets } from "@effect/tsgo/oxlint-presets";

const effectTsgoRules = Object.values(presets).flatMap((preset) =>
  Object.keys(preset.rules ?? {}),
);

export default defineConfig({
  extends: Object.values(presets),
  rules: {
    ...Object.fromEntries(effectTsgoRules.map((rule) => [rule, "error"])),
    "effecttsgo/missing-pipeable-signature": "off",
  },
});
```

This repository lints itself the same way in `oxlint.config.ts`.

### Optional LLM-judged Effect rules (Jev)

`src/jev/` ships plain-English Effect review questions (`effectSourceJevRules`, `effectTestJevRules`) and `jev/plugin.ts`, an oxlint plugin named `anti-slop-effect-jev` with one rule per question, built with `createJevPlugin` from [Kyle Mistele's fork of `oxlint-plugin-jev`](https://github.com/K-Mistele/oxlint-plugin-jev). Each question's severity is set in the oxlint config, and all of a plugin's enabled rules share one request per file to [TypeSafe Jev](https://typesafe.ai) or, in judge mode, any AI SDK model. The fork is not on npm: this repository includes it as the `vendor/oxlint-plugin-jev` submodule, and the install skill vendors its built package to `tools/oxlint/oxlint-plugin-jev/` for a `file:` dependency:

```sh
node <skill-directory>/scripts/install.mjs --jev   # also copies the built fork
npm install --save-dev ./tools/oxlint/oxlint-plugin-jev   # installs ai, @ai-sdk/typesafe-ai, zod, synckit
export TYPESAFE_API_KEY="..."   # or AI_GATEWAY_API_KEY
```

Register the plugin in the base config without enabling its rules, and enable them in an overlay that `check:fast` and `check:full` run, never in the editor config:

```ts
// oxlint.config.ts
jsPlugins: [{ name: "anti-slop-effect-jev", specifier: "./tools/oxlint/anti-slop/jev/plugin.ts" }],

// oxlint.jev.config.ts: { ...base, rules, overrides }
rules: {
  ...base.rules,
  "anti-slop-effect-jev/error-as-value": "error",
  "anti-slop-effect-jev/shallow-service": "error",
  "anti-slop-effect-jev/read-then-write-race": "warn",
  // ...one entry per question; "off" sends nothing
},
overrides: [
  {
    files: ["**/*.test.*", "**/*.spec.*", "test/**", "tests/**"],
    rules: { "anti-slop-effect-jev/error-as-value": "off", /* ... */ "anti-slop-effect-jev/test-cannot-fail": "error" },
  },
],
```

`jev/lint-changed.ts` runs oxlint on staged, unstaged, and untracked files and sets `JEV_CHANGED_ONLY=1`, so jev only asks about changed functions (`--all` lints everything with it off). See [docs/jev.md](docs/jev.md) for the full overlay, judge mode, and combining both jev plugins into one request per file.

### Optional Martin Fowler smell rules

`martinfowler/index.ts` registers `anti-slop-martinfowler`: warn-level rules named after the code smells in *Refactoring* (2nd ed., ch. 3) whose messages name the refactoring to apply (`mysterious-name`, `long-function`, `long-parameter-list`, `global-data`, `mutable-data`, `repeated-switches`, `loops`, and `message-chains`, which is off by default). Some overlap other anti-slop rules on purpose so the bundle stands alone. `martinfowler/jev-rules.ts` is a matching jev preset for 12 smells that need judgement, and `martinfowler/jev-plugin.ts` turns it into the plugin `anti-slop-martinfowler-jev`, one rule per smell, meant for `"warn"` in the jev overlay. Each message reads "Possibly <Smell>: … Consider <Refactoring>." It needs the same jev fork. See [docs/martinfowler.md](docs/martinfowler.md).

```ts
// oxlint.jev.config.ts, next to the Effect jev rules
"anti-slop-martinfowler-jev/feature-envy": "warn",
"anti-slop-martinfowler-jev/mysterious-name": "warn",
"anti-slop-martinfowler-jev/comments": "off",
```

Each jev plugin sends its own request per file, so enabling both costs up to two requests per file.

```ts
jsPlugins: [{ name: "anti-slop-martinfowler", specifier: "./tools/oxlint/anti-slop/martinfowler/index.ts" }],
rules: {
  "anti-slop-martinfowler/global-data": "warn",
  "anti-slop-martinfowler/long-function": "warn",
  "anti-slop-martinfowler/long-parameter-list": "warn",
  "anti-slop-martinfowler/loops": "warn",
  "anti-slop-martinfowler/mutable-data": "warn",
  "anti-slop-martinfowler/mysterious-name": "warn",
  "anti-slop-martinfowler/repeated-switches": "warn",
},
```

### Diff rules

Diff rules judge a whole change set for smells that span files or need git history (shotgun surgery, divergent change, duplicated code, scope creep). The judge is a decision model (TypeSafe Jev, directly or through AI Gateway), a chat model (AI Gateway or any OpenAI-compatible server), or a CLI agent such as `claude -p` or `droid exec`. The model backends use the [Vercel AI SDK](https://ai-sdk.dev), so install it next to the vendored files when you use them; the CLI backend needs only Node:

```sh
npm install --save-dev ai@7.0.173 zod@4.6.7 @ai-sdk/typesafe-ai@3.0.40   # decision model, direct
npm install --save-dev @ai-sdk/openai-compatible@3.0.92                  # chat model at LLM_JUDGE_BASE_URL
```

They run in `check:full`, not `check:fast`:

```sh
node tools/oxlint/anti-slop/diff-rules/run.ts [--base <ref>] [--committed|--staged|--working] [--fail] [--json]
```

See [docs/diff-rules.md](docs/diff-rules.md).

## Rules

### Generic rules

- `max-ternary-depth` — limits ternary expression chains to two levels by default; configure `maxDepth` to change the limit.
- `no-array-filter-map` — rejects adjacent eager array filter/map passes while allowing lazy iterator pipelines.
- `no-reduce-accumulator-copy` — rejects non-spread accumulator copies inside reducers; complements native `oxc/no-accumulating-spread`.
- `no-chained-type-assertions` — rejects nested `as` and angle-bracket assertions that fabricate evidence; chains made only of `as const` remain valid.
- `no-conditional-spread` — rejects ternary and logical expressions in object, array, call, and JSX spreads.
- `no-disabled-type-assertion-rules` — rejects inline `oxlint-disable`/`eslint-disable` comments that turn off a type-assertion rule (`anti-slop/no-chained-type-assertions`, `anti-slop/no-widen-then-assert`, `anti-slop/require-safety-comment-for-type-assertion`, `effecttsgo/unsafe-effect-type-assertion`, `typescript/consistent-type-assertions`, `typescript/no-unsafe-type-assertion`), and disable comments that name no rule at all. Configure `additionalRules` to protect more rules.
- `no-known-value-widening` — rejects known expressions flowing into explicit `unknown`, `object`, anonymous-object, or open-dictionary targets, including known arguments passed to local `unknown` type predicates. Empty dictionary accumulators and finite-key `Record` targets remain valid.
- `no-module-mocking` — rejects Vitest and Jest `mock`, `doMock`, and `unstable_mockModule` calls in favor of real dependency seams.
- `no-object-parameters` — rejects `object`, unions containing it, and scoped or transparent generic aliases that resolve to it on function inputs.
- `no-reflect-apply` — rejects global `Reflect.apply` in favor of typed function calls.
- `no-reflect-get` — rejects global `Reflect.get` in favor of typed property access or boundary parsing.
- `no-reprovide-ambient-service` — rejects yielding an Effect service only to provide that same value back into a nested operation.
- `no-runtime-typeof` — requires boundary parsing instead of ad hoc `typeof` narrowing. Existence probes against the string `"undefined"` are allowed, and type predicates can be enabled explicitly.
- `no-shape-in-symbol-names` — rejects the case-insensitive substring `shape` in locally owned symbol names while allowing static member names such as Zod's `schema.shape` that cannot be renamed locally.
- `no-unknown-parameters` — rejects `unknown` and unions containing it on function inputs except the explicit `cause` convention and the exact subject of a type predicate.
- `no-unknown-returns` — rejects explicit function contracts that resolve to `unknown`, `Promise<unknown>`, or `PromiseLike<unknown>`, including scoped and transparent generic aliases.
- `no-unknown-type-aliases` — rejects scoped and transparent generic aliases whose resolved type is `unknown`.
- `no-unsafe-dictionary-type` — rejects dictionary value contracts based on `unknown`, `any`, `object`, `{}`, and semantic equivalents. Generic constraints such as `T extends Record<string, unknown>` are allowed.
- `no-widen-then-assert` — rejects immutable local flows that widen known evidence to `unknown`, `any`, `object`, or a broad record and later assert it back to a narrower type.
- `require-readable-spacing` — autofixes missing blank lines between top-level declarations, around multiline bindings, before control flow/returns, and after blocks; preserves compact local bindings, imports, and overload groups.
- `require-safety-comment-for-type-assertion` — requires each non-const assertion to have a nearby, non-empty invariant justification. Marker prefixes are configurable and default to `SAFETY`.

### Effect rules

- `no-manual-effect-error-tag` — rejects manual `_tag` comparisons and switches inside broad `Effect.catch`, `Effect.catchAll`, and `Effect.catchIf` handlers in favor of tagged error handlers.
- `no-manual-tag-comparison` — rejects direct `_tag` comparisons and `_tag` switches in favor of `Match`, `Predicate.isTagged`, or tagged-enum matching.
- `no-manual-tagged-construction` — rejects literal `_tag` object construction in favor of Schema, tagged class/error, or `Data.taggedEnum` constructors, including `_tag` object patterns passed to `Match.when` and `Match.not`, and literal `_tag` class fields.
- `no-ordie-in-service-construction` — rejects `Effect.orDie`/`Effect.orDieWith` while a service is constructed: in its options or static `make`, its static `layer*` members, and `Layer.effect`/`Layer.scoped`/`Layer.unwrap*` arguments. Construction stops at operation boundaries (functions other than `Effect.gen` generators and `Effect.suspend`/`Effect.sync` thunks, `Effect.fn` definitions, object-literal properties, and effects a generator defines without yielding). `Layer.orDie` is rejected anywhere. Test and spec files are skipped.
- `no-service-parameters` — rejects function, method, and function-type parameters typed `Context.Context`, `ManagedRuntime.ManagedRuntime`, `Layer.Layer`, or a `Context.Service` class declared in the same file. Layer combinators (functions with a `Layer.Layer` return type or an expression body that is a `Layer.*` call or pipe) may take layers, and callbacks passed directly to an Effect API such as `Effect.contextWith` are skipped. Test and spec files are skipped.
- `no-test-code-in-src` — in files under a source directory (default `src`), rejects test and spec files and files inside a test directory (default `test`, `tests`, `__tests__`), relative imports and re-exports that pass through a test directory, and exported declarations, export specifiers, and static class members whose names match a test-double pattern such as `layerTest`, `FakeClock`, `WidgetsMock`, or `makeStubStore`. `layerFixtures` stand-ins and domain names such as `TestConnection` or `hitTest` are allowed by default. Configure `sourceDirectories`, `testDirectories`, and `testNamePatterns` (regular-expression strings).
- `no-manual-tagged-type` — rejects `_tag` properties written by hand in `type` and `interface` declarations. Define the value with a Schema or Data tagged constructor and infer the type from it, e.g. `export type X = typeof X.Type`. Also rejects `_tag` in inline type literals, including generic constraints such as `<A extends { readonly _tag: string }>`.
- `no-service-constructor-imports` — rejects named `make<CapabilityName>` imports from relative project modules outside `*.test.*` and `*.spec.*` files. Runtime callers should import the owning Layer and yield the contextual service instead. Package and path-alias imports, default imports, and static constructors such as `WorkspaceName.make` are outside the rule.
- `prefer-effect-match` — rejects chained literal ternaries over the same value in favor of Effect's `Match` API.
- `prefer-tagged-error-handling` — rejects `Predicate.isTagged` checks on the error inside broad `Effect.catch`, `Effect.catchAll`, and `Effect.catchIf` handlers in favor of `Effect.catchTag`/`Effect.catchTags`, or `Effect.catchReason`/`Effect.catchReasons` when the check is on `error.reason`. Direct `_tag` comparisons stay with `no-manual-effect-error-tag`.
- `prefer-yield-service` — rejects `const ctx = yield* Effect.context<...>()` when `ctx` is later passed to `Effect.provide`, `Effect.provideContext`, `Layer.provide`, or `Layer.succeedContext`. Yield each service instead and let requirements flow through R. Capturing the context for a runtime bridge such as `Effect.runForkWith(ctx)` stays valid.
- `require-cause-when-narrowing` — rejects `Effect.mapError`, `Effect.catch`, `Effect.catchAll`, `Effect.catchCause`, and `Effect.orElse` handlers that ignore their error and construct a new one (`new X(...)` or `X.make(...)`, returned, yielded, or passed to `Effect.fail`) without a `cause` property, unless an earlier step of the same pipe is `Effect.tapError`, `tapErrorCause`, `tapCause`, or `tapErrorTag`. `catchTag`/`catchTags` are outside the rule.
- `require-operation-span` — requires each operation in the object a `Context.Service` make returns (directly or through `X.of({...})`) to contain `Effect.fn("name")` or `Effect.withSpan(...)`, or to call a same-file function that does. Operations are functions that return an `Effect.*` expression and `Effect`-valued properties; plain helpers, delegations to another service, streams, and values are skipped. Test and spec files are skipped.
- `require-service-make-layer` — requires each `Context.Service` class to define `make` (options or static) and `static readonly layer = Layer.effect(this, this.make)` (optionally piped, or `(options) => Layer.effect(this, this.make(options))`). Other static `layer*` members that build this service must derive from its `layer` or `make`. Outside the class, `Layer.effect(X, ...)` must pass `X.make` or `X.make(...)`; tags imported from `effect`/`@effect/*` are exempt. Tag-only services with no make and no layers (request-scoped values, host bindings) are allowed; set `allowTagOnly: false` to require a make for them too. Test and spec files are skipped.

### Analysis boundaries

The rules use Oxlint's ESTree and lexical-scope APIs rather than a TypeScript type checker. They resolve same-file aliases—including block-scoped aliases, forward references, and transparent generic aliases—but do not infer imported type definitions or cross-file call signatures. Rules that inspect calls therefore document when enforcement is intentionally local.

## Violation examples

Each snippet below is rejected by the named rule.

### `max-ternary-depth`

```ts
const value = first ? one : second ? two : third ? three : fallback;
```

### `no-array-filter-map`

```ts
const users: User[] = loadUsers();
const emails = users.filter(user => user.active).map(user => user.email);
const found = users.map(lookup).filter(value => value !== undefined);
```

Prefer lazy iterator helpers where the target runtime supports them:

```ts
const emails = users.values()
  .filter(user => user.active)
  .map(user => user.email)
  .toArray();
```

A single `flatMap(user => user.active ? [user.email] : [])` or a reducer that pushes into a fresh local array is also allowed. Iterator helpers avoid intermediate arrays and per-item wrapper arrays, but are not guaranteed to be faster. Check runtime support; TypeScript library declarations do not polyfill them.

This AST/scope rule recognizes array literals, direct array/tuple annotations, immutable local aliases, and supported array-preserving method chains. Unknown receivers (including imported factory results and unannotated parameters), type aliases, and property-based array types are not inferred. Iterator pipelines are not flagged. Both `filter().map()` and `map().filter()` are covered, regardless of predicate. There is no autofix: callback ordering, indexes, `thisArg`, sparse arrays, and truthiness filtering must be reviewed before changing APIs.

### `no-reduce-accumulator-copy`

```ts
items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});
items.reduce((acc, item) => acc.concat([item]), []);
items.reduce((acc, item) => {
  const next = acc.slice();
  next.push(item);
  return next;
}, []);
```

Instead, mutate a fresh, locally owned accumulator and return it:

```ts
items.reduce((acc, item) => {
  acc.push(item);
  return acc;
}, []);
```

`Object.assign(acc, item)` is also allowed. Copying individual input items is not copying accumulated state.

The rule covers inline `reduce`/`reduceRight` callbacks, including index parameters, and immutable local accumulator aliases. It detects global `Object.assign` with an object-literal target and the accumulator as a source, global `Array.from(acc)`, and array accumulator calls to `concat`, `slice`, `toSpliced`, `toSorted`, `toReversed`, and `with`. Array copy methods require local array evidence for the initial value so string concatenation and unknown custom collections are not flagged. Like the native rule, reducer method names are syntactic evidence, not proof of the receiver's runtime type. Named callbacks, nested functions, indirect copy helpers, nested accumulator properties, and reassigned aliases are outside its scope. Copying a bounded accumulator is not necessarily quadratic, but these patterns are rejected because growing accumulators can be.

Enable native `oxc/no-accumulating-spread` alongside it for array/object spreads in reducers and supported loops. Neither rule proves that every possible quadratic reduction is absent. No automatic mutation rewrite is provided because accumulator ownership cannot be established syntactically.

### `no-chained-type-assertions`

```ts
const user = input as object as User;
```

### `no-conditional-spread`

```ts
const options = {
  ...(timeout ?? defaults),
};
```

### `no-disabled-type-assertion-rules`

```ts
// oxlint-disable-next-line typescript/consistent-type-assertions
const id = value as UserId;
```

Remove the cast, or add a file-level override with its reason in the lint configuration. A disable comment that names no rule (`// oxlint-disable-next-line`) is rejected too, because it silently turns these rules off. Protect more rules with `additionalRules`:

```json
{
  "anti-slop/no-disabled-type-assertion-rules": [
    "error",
    { "additionalRules": ["local/no-type-assertion"] }
  ]
}
```

### `no-known-value-widening`

```ts
const handlers: Record<string, Handler> = {
  start: startHandler,
};
```

This discards the known `start` key. Preserve inference or use `satisfies Record<string, Handler>` instead.

Known values must not be widened back to `unknown` through a local type predicate:

```ts
function isUser(value: unknown): value is User {
  return UserSchema.safeParse(value).success;
}

declare const user: User;
isUser(user);
```

Call the predicate at the unparsed boundary, while the argument is still `unknown`.

### `no-module-mocking`

```ts
vi.mock("./user-store");
```

### `no-object-parameters`

```ts
function save(value: object) {}
```

### `no-reflect-apply`

```ts
const value = Reflect.apply(operation, owner, args);
```

### `no-reflect-get`

```ts
const value = Reflect.get(owner, key);
```

### `no-runtime-typeof`

```ts
if (typeof input === "string") {
  useName(input);
}
```

Schema-free projects can permit `typeof` checks directly inside type predicate and
assertion functions while continuing to reject ad hoc checks elsewhere:

```json
{
  "anti-slop/no-runtime-typeof": [
    "error",
    { "allowInTypeGuards": true }
  ]
}
```

The option defaults to `false`. Existence probes such as `typeof document === "undefined"` are always allowed because they establish whether a binding exists rather than narrow its representation.

### `no-shape-in-symbol-names`

```ts
interface UserShape {
  id: string;
}
```

Static member reads such as `schema.shape` are allowed because the member name belongs to the value's owner and cannot be renamed locally.

### Effect: `no-service-constructor-imports`

```ts
import { makeIssueService } from "./issue-service.ts";
```

Import the owning Layer and yield `IssueService` instead. Focused `*.test.*` and `*.spec.*` files may import the constructor directly.

### Effect: `require-service-make-layer`

```ts
export class AppRegistry extends Context.Service<AppRegistry, AppRegistryShape>()("@app/AppRegistry") {}

export const AppRegistryLive = Layer.effect(AppRegistry, Effect.gen(function* () {
  const store = yield* AppStore;
  return { find: (id: AppId) => store.find(id) };
}));
```

Move the constructor into the class and derive the layer from it:

```ts
export class AppRegistry extends Context.Service<AppRegistry, AppRegistryShape>()("@app/AppRegistry", {
  make: Effect.gen(function* () {
    const store = yield* AppStore;
    return { find: Effect.fn("AppRegistry.find")(function* (id: AppId) { return yield* store.find(id); }) };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
  static readonly layerSelfBinding = AppRegistry.layer.pipe(Layer.provide(selfBinding));
}
```

### Effect: `no-test-code-in-src`

```ts
// src/widgets.ts
export const layerTest = WidgetService.layer.pipe(Layer.provide(FakeProvider));
```

Move it to `test/support/layers.ts` and build it from the production class there.

### Effect: `no-service-parameters`

```ts
const listWidgets = (input: ListInput, context: Context.Context<WidgetProvider>) =>
  fetchWidgets(input).pipe(Effect.provide(context));
```

`yield* WidgetProvider` inside the operation instead and pass only plain values.

### Effect: `prefer-yield-service`

```ts
const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
return { build: (dir: string) => runBuild(dir).pipe(Effect.provideContext(services)) };
```

Yield `FileSystem.FileSystem` and `Path.Path` where they are used and let `runBuild`'s requirements reach the layer.

### Effect: `require-cause-when-narrowing`

```ts
decode(text).pipe(Effect.mapError(() => BadRequest.make({ reason: "Invalid JSON" })));
```

Keep the original error: `Effect.mapError((cause) => BadRequest.make({ reason: "Invalid JSON", cause }))`, or put `Effect.tapError(Effect.logError)` before the narrowing step.

### Effect: `require-operation-span`

```ts
make: Effect.gen(function* () {
  const store = yield* Store;
  return { find: (id: string) => store.find(id).pipe(Effect.map(toWidget)) };
}),
```

Write `find: Effect.fn("Widgets.find")(function* (id: string) { ... })`, or end the pipe with `Effect.withSpan("Widgets.find", { attributes: { id } })`.

### Effect: `no-ordie-in-service-construction`

```ts
make: Effect.gen(function* () {
  const token = yield* Config.redacted("API_TOKEN").pipe(Effect.orDie);
  return { token };
}),
```

Leave the `ConfigError` (or a Schema.TaggedError that classifies it) in the layer's error channel and handle it where the runtime is built. `Layer.orDie` is rejected for the same reason.

### Effect: tagged values and matching

Direct tag checks are rejected by `no-manual-tag-comparison`:

```ts
if (result._tag === "Ready") useReady(result);
```

Use `Predicate.isTagged` for a predicate or `Match` for branching:

```ts
if (Predicate.isTagged("Ready")(result)) useReady(result);
```

Literal tag objects are rejected by `no-manual-tagged-construction`:

```ts
const result = { _tag: "Ready", value };
```

Use the existing Schema, tagged class/error, or `Data.taggedEnum` constructor instead, such as `Ready.make({ value })`. Object patterns with `_tag` passed to `Match.when` and `Match.not` are rejected too; use `Match.tag`/`Match.tags`.

Manual tag branching in broad catch handlers is rejected by `no-manual-effect-error-tag`:

```ts
program.pipe(
  Effect.catch((error) =>
    error._tag === "NotFound" ? recover : Effect.fail(error)
  )
);
```

Use the selective error operator:

```ts
program.pipe(Effect.catchTag("NotFound", () => recover));
```

For a tagged `error.reason`, use `Effect.catchReason` or `Effect.catchReasons`.

`Predicate.isTagged` checks on the error in broad catch handlers are rejected by `prefer-tagged-error-handling`:

```ts
program.pipe(
  Effect.catch((error) =>
    Predicate.isTagged(error, "NotFound") ? recover : Effect.fail(error)
  )
);
```

Use `Effect.catchTag("NotFound", () => recover)` here as well.

Repeated literal ternaries over the same value are rejected by `prefer-effect-match`:

```ts
const label = kind === "a" ? "A" : kind === "b" ? "B" : "Other";
```

Use `Match`:

```ts
const label = Match.value(kind).pipe(
  Match.when("a", () => "A"),
  Match.when("b", () => "B"),
  Match.orElse(() => "Other")
);
```

These rules are syntactic. They recognize direct `Effect.catch*` and `Match.when`/`Match.not` calls under those exact identifiers and do not resolve import aliases or verify that similarly named objects came from Effect. `prefer-effect-match` compares the source text of the repeatedly tested expression; it does not infer its type or prove exhaustiveness.

### `no-unknown-parameters`

```ts
function handle(input: unknown) {}
```

A type predicate may accept `unknown` for the parameter it narrows; other `unknown`
parameters on the same function remain rejected.

### `no-unknown-returns`

```ts
function loadUser(): unknown {
  return input;
}
```

### `no-unknown-type-aliases`

```ts
type ExternalValue = unknown;
```

### `no-unsafe-dictionary-type`

```ts
type Metadata = Record<string, unknown>;
type OtherMetadata = { [key: string]: object };
```

### `no-widen-then-assert`

```ts
const loaded: User = loadUser();
const stored: unknown = loaded;
const user = stored as User;
```

### `require-readable-spacing`

```ts
export const first = 1;
/** Documentation stays attached to second. */
export const second = 2;
```

Autofix inserts a blank line before the documentation. Inside functions, adjacent short variable declarations stay grouped, while multiline bindings and control-flow boundaries receive spacing. Adjacent function overload signatures and their implementation remain grouped. Existing blank lines are never removed. The rule takes no options; edit the vendored policy if your team's preferences differ.

Run `oxlint --fix` (or `vp lint --fix`), then your formatter, then lint again. The rule inserts whitespace only; it does not add braces, wrap expressions, sort imports, or infer every logical group. Keep indentation and wrapping with the formatter rather than enabling a competing stylistic preset.

The comment-aware engine is [vendored from ESLint Stylistic](src/vendor/eslint-stylistic/UPSTREAM.md) under MIT. Copy its `LICENSE` and provenance along with the code; no third-party plugin dependency is needed.

### `require-safety-comment-for-type-assertion`

```ts
const userId = value as UserId;
```

Add a specific justification immediately before a necessary assertion:

```ts
// SAFETY: parseUserId validated the identifier before branding it.
const userId = value as UserId;
```

`SAFETY` remains the default marker. Comments immediately above exported declarations are recognized. Repositories with an established convention can configure one or more alternatives; every marker must still be followed by a colon and a non-empty justification:

```json
{
  "anti-slop/require-safety-comment-for-type-assertion": [
    "error",
    { "markers": ["INVARIANT", "SAFETY"] }
  ]
}
```

## Development

```bash
git submodule update --init
pnpm install
pnpm build:jev
pnpm check
```

`src/` is canonical. `vendor/oxlint-plugin-jev` is a submodule of the jev fork, pinned to commit `af40809` (fork PR #2); move it to the fork's `main` once its PRs merge, then run `pnpm build:jev` and `pnpm sync:skill-assets`. After changing production source, run `pnpm sync:skill-assets`; CI checks that the skill's bundled copies of `src/` and of the built fork remain identical. `pnpm check` runs Oxlint, every RuleTester suite, TypeScript typechecking, and the skill-asset drift check.

## License

MIT
