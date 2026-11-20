import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "anti-slop-package-"));

try {
  const [packed] = Object.values(JSON.parse(execFileSync("npm", [
    "pack", "--json", "--ignore-scripts", "--pack-destination", temporary,
  ], { cwd: root, encoding: "utf8" })));
  const files = packed.files.map(({ path }) => path);
  assert.ok(files.includes("dist/index.js"), "Package must contain compiled JavaScript");
  assert.ok(files.includes("dist/effect/index.js"));
  assert.ok(files.includes("dist/index.d.ts"));
  assert.ok(files.includes("dist/effect/index.d.ts"));
  assert.ok(files.includes("LICENSE"));
  assert.ok(files.includes("dist/vendor/eslint-stylistic/LICENSE"));
  assert.ok(files.includes("dist/vendor/eslint-stylistic/UPSTREAM.md"));
  assert.ok(!files.some((path) => path.startsWith("src/") || path.includes(".test.")));

  execFileSync("tar", ["-xzf", join(temporary, packed.filename), "-C", temporary]);
  const modules = join(temporary, "node_modules");
  mkdirSync(join(modules, "@oxlint"), { recursive: true });
  mkdirSync(dirname(join(modules, packed.name)), { recursive: true });
  symlinkSync(join(temporary, "package"), join(modules, packed.name), "dir");
  symlinkSync(realpathSync(join(root, "node_modules/@oxlint/plugins")), join(modules, "@oxlint/plugins"), "dir");

  writeFileSync(join(temporary, "oxlint.json"), JSON.stringify({
    jsPlugins: [
      { name: "anti-slop", specifier: packed.name },
      { name: "anti-slop-effect", specifier: `${packed.name}/effect` },
    ],
    rules: {
      "anti-slop/no-module-mocking": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop-effect/no-manual-tag-comparison": "error",
    },
  }));
  const fixture = join(temporary, "fixture.ts");
  writeFileSync(fixture, 'jest.mock("dependency");\nvalue._tag === "Ready";\nexport const a = 1;\nexport const b = 2;\n');
  const result = spawnSync(join(root, "node_modules/.bin/oxlint"), [
    "--config", join(temporary, "oxlint.json"), fixture,
  ], { cwd: temporary, encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.equal(result.status, 1, output);
  for (const rule of ["no-module-mocking", "require-readable-spacing", "no-manual-tag-comparison"]) {
    assert.ok(output.includes(rule), output);
  }
  writeFileSync(fixture, "export const answer = 42;\n");
  execFileSync(join(root, "node_modules/.bin/oxlint"), [
    "--config", join(temporary, "oxlint.json"), fixture,
  ], { cwd: temporary, encoding: "utf8" });
  const types = join(temporary, "consumer.mts");
  writeFileSync(types, `import generic from "${packed.name}";\nimport effect from "${packed.name}/effect";\ngeneric.rules;\neffect.rules;\n`);
  execFileSync(join(root, "node_modules/.bin/tsc"), [
    "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--target", "ES2024", types,
  ], { cwd: temporary, encoding: "utf8" });
  console.log(`Package smoke test passed: ${packed.name}@${packed.version}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
