import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const consumer = mkdtempSync(join(tmpdir(), "anti-slop-package-"));

function run(command, args, cwd = consumer, status = 0) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", consumer], root));
  const files = packed[0].files.map((file) => file.path);
  for (const required of [
    "dist/index.js", "dist/index.d.ts", "dist/effect/index.js", "dist/effect/index.d.ts",
    "LICENSE", "dist/vendor/eslint-stylistic/LICENSE", "dist/vendor/eslint-stylistic/UPSTREAM.md",
  ]) {
    assert.ok(files.includes(required), `Package is missing ${required}`);
  }
  assert.equal(files.some((file) => file.endsWith(".test.ts")), false);

  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--no-audit", "--no-fund", join(consumer, packed[0].filename), `oxlint@${manifest.devDependencies.oxlint}`]);
  writeFileSync(join(consumer, "verify.mjs"), `
import assert from "node:assert/strict";
import generic from "${manifest.name}";
import effect from "${manifest.name}/effect";
assert.equal(Object.keys(generic.rules).length, 18);
assert.equal(Object.keys(effect.rules).length, 5);
assert.equal(generic.meta.name, "anti-slop");
assert.equal(effect.meta.name, "anti-slop-effect");
`);
  run(process.execPath, ["verify.mjs"]);

  writeFileSync(join(consumer, "oxlint.config.ts"), `
import { defineConfig } from "oxlint";
export default defineConfig({
  jsPlugins: [
    { name: "anti-slop", specifier: "${manifest.name}" },
    { name: "anti-slop-effect", specifier: "${manifest.name}/effect" },
  ],
  rules: {
    "anti-slop/no-reflect-get": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
  },
});
`);
  writeFileSync(join(consumer, "invalid.ts"), 'export const value = Reflect.get({}, "key");\n');
  writeFileSync(join(consumer, "effect.ts"), 'export const tagged = value._tag === "Ready";\n');
  writeFileSync(join(consumer, "spacing.ts"), 'export const first = 1;\n/** Attached. */\nexport const second = 2;\n');
  writeFileSync(join(consumer, "valid.ts"), 'export const value = 1;\n');
  const oxlint = join(consumer, "node_modules/.bin/oxlint");
  const lint = (...args) => run(oxlint, ["--config", "oxlint.config.ts", ...args]);
  const rejected = run(oxlint, ["--config", "oxlint.config.ts", "--format", "json", "invalid.ts", "effect.ts"], consumer, 1);
  const diagnostics = JSON.parse(rejected).diagnostics;
  assert.equal(diagnostics.length, 2);
  assert.match(rejected, /no-reflect-get/);
  assert.match(rejected, /no-manual-tag-comparison/);
  lint("valid.ts");
  lint("--fix", "spacing.ts");
  const fixed = readFileSync(join(consumer, "spacing.ts"), "utf8");
  assert.equal(fixed, 'export const first = 1;\n\n/** Attached. */\nexport const second = 2;\n');
  lint("--fix", "spacing.ts");
  assert.equal(readFileSync(join(consumer, "spacing.ts"), "utf8"), fixed);

  writeFileSync(join(consumer, "types.ts"), `
import generic from "${manifest.name}";
import effect from "${manifest.name}/effect";
const genericRules: object = generic.rules;
const effectRules: object = effect.rules;
export { genericRules, effectRules };
`);
  run(join(root, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--module", "NodeNext", "--target", "ES2024", "types.ts"]);
  console.log("Packed npm package: installation, both exports, declarations, diagnostics, and autofix passed.");
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
