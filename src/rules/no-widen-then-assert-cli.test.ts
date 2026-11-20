/// <reference types="node" />

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const probeRoot = mkdtempSync(join(tmpdir(), "anti-slop-widen-"));
const config = join(probeRoot, "oxlint.json");
const first = join(probeRoot, "first.ts");
const second = join(probeRoot, "second.ts");
const violation =
  "const source = { id: 'a' }; const widened: unknown = source; export const parsed = widened as { readonly id: string };\n";

try {
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [
        { name: "anti-slop", specifier: fileURLToPath(new URL("../index.ts", import.meta.url)) },
      ],
      rules: { "anti-slop/no-widen-then-assert": "error" },
    }),
  );
  // Scopes are read lazily and cached per file; offsets differ so a stale cache cannot resolve.
  writeFileSync(first, violation);
  writeFileSync(second, `export const padding = 0;\n${violation}`);

  const result = spawnSync(
    "pnpm",
    ["exec", "oxlint", "--config", config, "--threads", "1", "--format", "json", first, second],
    { encoding: "utf8" },
  );
  const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: { filename: string }[] };
  assert.deepEqual(diagnostics.map(({ filename }) => basename(filename)).sort(), [
    "first.ts",
    "second.ts",
  ]);
} finally {
  rmSync(probeRoot, { recursive: true, force: true });
}
