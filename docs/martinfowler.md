# Martin Fowler smells: AST rules and jev preset

`src/martinfowler/` detects the code smells catalogued in chapter 3 ("Bad Smells in Code") of
Martin Fowler's *Refactoring: Improving the Design of Existing Code*, 2nd edition, and tells the
coding agent which refactoring to apply. It has two parts:

- **`anti-slop-martinfowler`**, an Oxlint plugin (`src/martinfowler/index.ts`) with one AST rule per
  smell that syntax can detect precisely. These rules are deterministic and free, so they can run in
  the editor.
- **`martinFowlerJevRules`**, a preset of plain-English questions (`src/martinfowler/jev-rules.ts`)
  for smells that need judgement, answered by [TypeSafe Jev](https://typesafe.ai) (or an LLM judge)
  through the jev fork. `src/martinfowler/jev-plugin.ts` turns it into the oxlint plugin
  `anti-slop-martinfowler-jev`, one rule per smell. These cost a request per file, so they run only
  on changed code.

Every diagnostic, from either part, has the same form, because a coding model reads it:

```text
Possibly <Smell>: <why this finding matters>. Consider <Refactoring> (<Effect form>).
```

Every rule should run at `warn`. A smell is a prompt to look, not proof of a defect.

## Smells, detectors, and refactorings

Smell names and refactoring names are the ones Fowler uses. The detector column names the rule id;
"AST" rules are in `anti-slop-martinfowler`, "jev" rules are entries in `martinFowlerJevRules`, configured as `anti-slop-martinfowler-jev/<id>`.

| Smell (ch. 3) | Detector | Refactoring | Effect form |
| --- | --- | --- | --- |
| Mysterious Name | AST `mysterious-name`, jev `mysterious-name` | Rename Function | A name for each caller-visible step, e.g. `resolveConfiguration` → `loadAndReconcileConfigurationSources` |
| Long Function | AST `long-function` | Extract Function | Named `Effect.fn("domain.operation")` steps |
| Long Parameter List | AST `long-parameter-list` | Introduce Parameter Object, Preserve Whole Object | A `Schema.Struct` input |
| Global Data | AST `global-data` | Encapsulate Variable | A `Ref` inside a service |
| Mutable Data | AST `mutable-data` | Encapsulate Variable, Replace Derived Variable with Query | A `Ref` owned by a service, or a derived value |
| Feature Envy | jev `feature-envy` | Move Function | An operation on the service that owns the data |
| Data Clumps | jev `data-clumps` | Introduce Parameter Object, Extract Class | A shared `Schema.Struct` |
| Primitive Obsession | jev `primitive-obsession` | Replace Primitive with Object | `Schema.brand` IDs, `Schema.Literal` unions |
| Repeated Switches | AST `repeated-switches`, jev `repeated-switches` | Replace Conditional with Polymorphism | `Data.TaggedEnum` / `Schema.TaggedUnion` plus exhaustive `Match` |
| Loops | AST `loops` | Replace Loop with Pipeline | `Arr.map` / `filter` / `groupBy`, `Effect.forEach`, `Stream` |
| Lazy Element | jev `lazy-element` | Inline Function, Inline Class | |
| Speculative Generality | jev `speculative-generality` | Collapse Hierarchy, Inline Function, Change Function Declaration, Remove Dead Code | |
| Temporary Field | jev `temporary-field` | Extract Class | Tagged-union variants that carry only their own fields |
| Message Chains | AST `message-chains` (off by default) | Hide Delegate, Extract Function, Move Function | A service operation that returns the value |
| Middle Man | jev `middle-man` | Remove Middle Man, Inline Function | |
| Insider Trading | jev `insider-trading` | Move Function, Hide Delegate | A public service operation instead of internals |
| Data Class | jev `data-class` | Move Function, Encapsulate Record | Plain data stays an immutable `Schema.Struct` |
| Comments | jev `comments` | Extract Function, Rename Function, Introduce Assertion | |

Not covered: Duplicated Code (use a clone detector), Divergent Change and Shotgun Surgery (need
change history, not one file), Large Class, Alternative Classes with Different Interfaces, and
Refused Bequest (rare in Effect code, which composes services rather than inheriting).

Judgement versions of Long Function and Loops are deliberately absent. Long Function is a size
threshold, which the AST rule measures exactly; asking a model "is this too long" adds cost and
noise but no information the `comments` and `mysterious-name` questions do not already cover. The
`loops` AST rule already finds every accumulation loop; a model would only re-judge the same loops.
Repeated Switches keeps both versions because the AST rule groups switches by source text and
cannot tell that `a.kind` and `b.kind` are the same union, while the jev question can.

### Intentional duplicates

Several of these rules overlap rules elsewhere in anti-slop, the Effect rules, or the Effect jev
preset: `repeated-switches` overlaps `prefer-effect-match` and `no-manual-tag-comparison`,
`middle-man` overlaps the Effect jev rule `shallow-service`, `lazy-element` overlaps
`single-use-abstraction`, and `loops` overlaps `oxc/no-accumulating-spread`. The duplication is on
purpose: this bundle is self-contained, so a repository can enable it alone, and each diagnostic
names the Fowler smell and refactoring instead of a project-specific rule.

## AST rules

All rules skip test files by default (`*.test.*`, `*.spec.*`, and `test/`, `tests/`, `__tests__/`,
`__mocks__/` directories); set `ignoreTests: false` to include them.

| Rule | Reports | Options (defaults) |
| --- | --- | --- |
| `mysterious-name` | Top-level or exported functions (`function`, arrow, or `Effect.fn`/`Effect.fnUntraced`) named with a bare generic verb (`process`, `handle`, `run`, `resolve`, `execute`, `ensure`, `init`, `doWork`, `perform`, `manage`, `apply`, `update`, `sync`, `prepare`, ...) or such a verb plus a vague noun (`processData`, `handleItem`); and any `const` in any scope that only aliases a same-file function (`const executeMutation = refreshAuthentication`). Values named `handle` (non-functions), nested helpers, and names in `allowNames` are not reported. | `verbs`, `vagueNouns`, `allowNames` (`fetch`, `layer`, `lookup`, `make`, `of`), `checkAliases: true` |
| `long-function` | Functions whose own body, excluding nested functions, exceeds either limit. Lines inside nested functions are subtracted, so a layer `make` that returns many small methods is measured by its own code. | `maxStatements: 30`, `maxLines: 80` |
| `long-parameter-list` | Function implementations with more positional parameters than `max`. Rest parameters, `this` parameters, and overload or interface signatures do not count; a destructured object counts once. | `max: 4` |
| `global-data` | Exported `let`/`var`, and exported object, array, `Map`, `Set`, `WeakMap`, or `WeakSet` literals that this file mutates (assignment, `++`, `delete`, `push`/`set`/`add`/..., `Object.assign`). Covers `export { x }` and `export default x`. | |
| `mutable-data` | Non-exported module-level `let`/`var` reassigned inside a function. Reassignment during module initialization is allowed; exported bindings belong to `global-data`. | |
| `repeated-switches` | The same discriminant (by source text) branched on over overlapping cases in several places in one file, counting `switch` statements, else-if chains, runs of adjacent guard `if`s, and ternary chains that compare to literals or enum members. Occurrences must share at least `minSharedCases` case values with another occurrence, because the same text (`part.type`) often names different unions in different functions. | `minOccurrences: 2`, `minSharedCases: 2` |
| `loops` | `for`, `for...of`, and `for...in` loops that build a collection declared outside the loop by `push`/`unshift`/`set`/`add`, computed-key assignment, `x = [...x, y]`, or `x = x.concat(y)`. | `includeWhile: false` |
| `message-chains` | Chains of more than `maxDepth` property reads or zero-argument `getX()` calls. Calls with arguments end a run (they are commands or builder steps), as do dynamic index reads; chains containing `.pipe(...)` and chains rooted at PascalCase namespaces (`Schema`, `Effect`), `import.meta`, or platform globals are skipped. | `maxDepth: 3`, `ignoreRoots`, `ignorePascalCaseRoots: true` |

`loops` does not report a loop when:

- its body has `return` or a `break` that leaves the loop, because that loop is a search, not a
  transformation;
- it also writes to other state declared outside the loop, because that loop is a state machine,
  such as a parser that tracks position or a scanner that keeps a running total;
- it grows the collection it iterates (a worklist);
- the accumulation is an index write inside a counted `for (let i ...)` loop, because those are
  in-place buffer and matrix updates;
- its body only has side effects (for example `await send(x)` or `yield* remove(id)`), because
  nothing is accumulated and there is no pipeline to replace it with.

Loops whose body awaits or yields an effect and accumulates are reported, since `Effect.forEach`
is their pipeline form. `while` and `do...while` loops are off by default because they are almost
always cursors, pagination, or parsers with no collection to pipe; enable them with
`includeWhile: true`. Numeric totals (`total += x`) are not reported.

### Validation on real code

The rules were run with their defaults over `stegosaurus/packages` (846 files) and conjure's
`apps` and `packages` (222 files), with a sample of hits classified by hand.

| Rule | stegosaurus | conjure | Sampled | Sample notes |
| --- | --- | --- | --- | --- |
| `mysterious-name` | 4 | 6 | about 9/10 TP | `resolve`, `run`, `handle`, `runValues`, and the local `executeMutation = refreshAuthentication` alias. `apply(docId, update)` for a Yjs update is borderline. |
| `long-function` | 63 | 15 | 10/10 long; about 9/10 worth splitting | The exception was a 274-line generated client |
| `long-parameter-list` | 12 | 0 | 12/12 TP | All had 5 to 7 positional parameters |
| `global-data` | 0 | 0 | none | RuleTester only |
| `mutable-data` | 2 | 0 | 2/2 TP | A module counter and saved stdout state; before test files were skipped, 25 hits were test fixtures |
| `repeated-switches` | 35 (16 groups) | 4 (1 group) | about 14/17 groups TP | Key handlers over `key.name`, `state._tag`, and `webhook.action` were true positives. HTTP `response.status` checks were the main false positive. Requiring two shared cases removed 5 of 22 groups that had the same text but different unions. |
| `loops` | 76 | 1 | about 18/25 TP | TPs were filter-push, `Map` grouping, and `yield*`-then-push. FPs were pixel and buffer loops (now excluded), output loops that also mark a "printed" `Set`, and binary decoders that read in order. |
| `message-chains` | 9 | 0 | about 2/9 TP | Most hits walk decoded third-party payloads such as `decoded.payload.check_run.pull_requests.length`, where Hide Delegate does not apply |

Because `message-chains` cannot tell a decoded wire payload from a graph of collaborating objects
without type information, it stays out of the recommended configuration below. Enable it only in
code that does not consume external payload shapes.

### Enable the AST plugin

Register the plugin and enable the rules at `warn` in the base config, which the editor reads:

```ts
// oxlint.config.ts
export default defineConfig({
  jsPlugins: [
    {
      name: "anti-slop-martinfowler",
      specifier: "./tools/oxlint/anti-slop/martinfowler/index.ts",
    },
  ],
  rules: {
    "anti-slop-martinfowler/global-data": "warn",
    "anti-slop-martinfowler/long-function": ["warn", { maxStatements: 30, maxLines: 80 }],
    "anti-slop-martinfowler/long-parameter-list": ["warn", { max: 4 }],
    "anti-slop-martinfowler/loops": "warn",
    "anti-slop-martinfowler/mutable-data": "warn",
    "anti-slop-martinfowler/mysterious-name": "warn",
    "anti-slop-martinfowler/repeated-switches": "warn",
    // Off by default: see "Validation on real code".
    // "anti-slop-martinfowler/message-chains": ["warn", { maxDepth: 3 }],
  },
});
```

## Jev preset

Each entry in `martinFowlerJevRules` is a `JevRule` from `oxlint-plugin-jev`, `{ id, target,
question, cutoff, location?, message }`, with `message` required. `question` lists its carve-outs
first and ends with the yes/no question; "yes" means "this is the smell". `message` replaces the
plugin's default diagnostic text so the agent gets the smell and the refactoring:

```text
[feature-envy] Possibly Feature Envy: ... Consider Move Function ... (jev-1.13.0 answered yes, 0.91 >= 0.75)
```

It requires the jev fork (`K-Mistele/oxlint-plugin-jev`) for `createJevPlugin` and the per-rule
`message` field; upstream `oxlint-plugin-jev` has neither. How anti-slop and consumers get the fork
is described in [`docs/jev.md`](./jev.md#the-jev-fork). Each id is configured as
`anti-slop-martinfowler-jev/<id>`.

| Id | Target | Cutoff | Location |
| --- | --- | --- | --- |
| `mysterious-name` | function | 0.7 | |
| `feature-envy` | function | 0.75 | |
| `data-clumps` | file | 0.7 | 0.7 |
| `primitive-obsession` | function | 0.75 | |
| `middle-man` | file | 0.75 | 0.7 |
| `lazy-element` | file | 0.75 | 0.7 |
| `speculative-generality` | file | 0.75 | 0.7 |
| `temporary-field` | file | 0.75 | 0.7 |
| `insider-trading` | file | 0.75 | |
| `data-class` | file | 0.75 | 0.7 |
| `comments` | function | 0.7 | |
| `repeated-switches` | file | 0.7 | 0.7 |

The `mysterious-name` question is built from these cases in stegosaurus:

| Name | What the body does | Better name |
| --- | --- | --- |
| `resolve` | Returns a cached credential or acquires one over the network | `getCachedOrAcquireCredential` |
| `refreshAuthentication` | Runs the procedure, then invalidates the credential and retries once on unauthorized | `runWithCredentialRetryOnUnauthorized` |
| `runLogged` | Logs failures and swallows them | `logAndSuppressFailures` |
| `applyDeliveryMutation` | Loads a slot, mutates it, and persists it with SQL | `loadMutateAndSaveDeliverySlot` |

Names that already say what callers can observe, such as `claimOrDeferReadyMailbox`,
`hasSameConfig`, and `resolveOneNeverFailing`, should not be reported.

`data-class` is carved out for Effect: `Schema.Struct`, `Schema.Class`, and `Data.Class` records
that are plain data by design are not data classes. Only classes with getters, setters, or public
mutable fields whose rules live in other code are reported.

`"function"` rules send one match per function per rule, and the plugin's `maxMatchesPerFile` caps
matches across all of its rules in source order. `martinFowlerJevOptions` raises the cap to 60; in
files with many functions, raise it further in `jev-plugin.ts` or turn function rules you do not
need `"off"`.

### Enable the plugin

Register `anti-slop-martinfowler-jev` and enable every smell at `"warn"` through
`defineAntiSlopConfig` ([docs/modes.md](./modes.md)), which keeps the rules off unless
`ANTI_SLOP_JEV=1` (so the editor never calls Jev) and asks only about changed lines. Turn them off
for test files.

```ts
// oxlint.config.ts
import { martinFowlerJevPluginName, martinFowlerJevRules } from "./tools/oxlint/anti-slop/martinfowler/jev-rules.ts";
import { defineAntiSlopConfig } from "./tools/oxlint/anti-slop/modes/config.ts";

const severities = (severity: "error" | "warn" | "off") =>
  Object.fromEntries(martinFowlerJevRules.map((rule) => [`${martinFowlerJevPluginName}/${rule.id}`, severity]));

export default defineAntiSlopConfig({
  jsPlugins: [
    { name: "anti-slop-martinfowler-jev", specifier: "./tools/oxlint/anti-slop/martinfowler/jev-plugin.ts" },
  ],
  rules: {
    ...severities("warn"),
    // Per-smell severity, for example:
    // "anti-slop-martinfowler-jev/comments": "off",
  },
  overrides: [{ files: ["**/*.test.*", "**/*.spec.*", "test/**", "tests/**"], rules: severities("off") }],
});
```

Run it before pushing and in CI with `node tools/oxlint/anti-slop/modes/lint.ts push`, and on
everything with `modes/lint.ts full`.

If the config also enables the Effect jev plugin, the Effect questions report errors and the smells
report warnings. The two plugins send separate requests, so a file costs up to two requests;
[`docs/jev.md`](./jev.md#two-plugins-or-one) shows how to build one plugin from both presets for one
request per file.
### Editing the preset

Change a question's leading carve-out sentence when a legitimate pattern keeps firing, and keep one
smell per entry. `src/martinfowler/jev-rules.test.ts` checks that ids are unique and kebab-case,
targets are valid, cutoffs are in (0, 1], location cutoffs are in (0.5, 1], questions end with "?",
and every message starts with "Possibly " and contains "Consider ". Run it with
`tsx src/martinfowler/jev-rules.test.ts` after editing. `src/jev/plugin.test.ts` checks that every id
becomes the rule `anti-slop-martinfowler-jev/<id>`.
