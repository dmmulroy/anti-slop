# anti-slop

[![skills.sh](https://skills.sh/b/dmmulroy/anti-slop)](https://skills.sh/dmmulroy/anti-slop)

Opinionated Oxlint rules that reject low-evidence and low-signal TypeScript and JavaScript patterns.

The plugin is source-distributed for now. An npm release is planned; until then, use the bundled agent skill to copy and configure it in another repository.

## Install with an agent skill

```bash
npx skills add dmmulroy/anti-slop --skill install-anti-slop
```

Then ask your coding agent to install or configure anti-slop in the current repository. The skill copies the plugin, installs current Oxlint dependencies, merges the plugin into the existing lint configuration, enables every rule, and validates the result.

To inspect available skills first:

```bash
npx skills add dmmulroy/anti-slop --list
```

## Manual local installation

Copy `src/` into the target repository, for example at `tools/oxlint/anti-slop/`, and install matching current versions of `oxlint` and `@oxlint/plugins`.

Register the copied entry point in `oxlint.config.ts`:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-fraud": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-self-licking": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error"
  }
});
```

The same `jsPlugins` entry and rules work under `lint` in a Vite+ config.

## Rules

- `no-chained-type-assertions` — rejects nested type assertions that fabricate evidence.
- `no-conditional-empty-object-spread` — rejects conditional spreads that use `{}` to omit fields.
- `no-fraud` — rejects implementations that claim work they never do: ignored inputs behind a hardcoded success, catch clauses that discard the error and report success, and placeholder data in production source. Test, mock, and fixture files are exempt, because fakes are honest there.
- `no-known-value-widening` — rejects explicit broad target types that discard known value evidence.
- `no-object-parameters` — rejects the broad `object` type on function inputs.
- `no-runtime-typeof` — requires boundary parsing instead of ad hoc `typeof` narrowing.
- `no-self-licking` — rejects constructs that only prove themselves: assertions that compare a value to itself, tests that assert only on their own doubles, and functions that forward their parameters unchanged.
- `no-shape-in-symbol-names` — rejects `shape` in symbol names.
- `no-unknown-parameters` — rejects `unknown` inputs except the explicit `cause` convention.
- `no-unknown-type-aliases` — rejects aliases that merely conceal `unknown`.
- `no-unsafe-dictionary-type` — rejects dictionary value contracts based on `unknown`, `any`, `object`, `{}`, and semantic equivalents.
- `no-widen-then-assert` — rejects local flows that widen known values and later assert them back.

## Development

```bash
pnpm install
pnpm check
```

`src/` is canonical. After changing production source, run `pnpm sync:skill-assets`; CI checks that the skill's bundled copy remains identical.

## License

MIT
