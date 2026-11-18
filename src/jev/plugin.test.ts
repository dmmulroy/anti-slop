/// <reference types="node" />

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import martinFowlerJevPlugin from "../martinfowler/jev-plugin.ts";
import { martinFowlerJevPluginName, martinFowlerJevRules } from "../martinfowler/jev-rules.ts";
import { effectJevPluginName, effectSourceJevRules, effectTestJevRules } from "./effect-rules.ts";
import effectJevPlugin from "./plugin.ts";

const entries = [
  {
    plugin: effectJevPlugin,
    name: effectJevPluginName,
    specifier: fileURLToPath(new URL("./plugin.ts", import.meta.url)),
    ids: [...effectSourceJevRules, ...effectTestJevRules].map((rule) => rule.id),
  },
  {
    plugin: martinFowlerJevPlugin,
    name: martinFowlerJevPluginName,
    specifier: fileURLToPath(new URL("../martinfowler/jev-plugin.ts", import.meta.url)),
    ids: martinFowlerJevRules.map((rule) => rule.id),
  },
];

for (const { plugin, name, ids } of entries) {
  assert.equal(plugin.meta.name, name);
  assert.deepEqual(Object.keys(plugin.rules), ids, `${name} must have exactly one rule per preset id`);
}

// The presets are meant to be combinable into one plugin, which needs ids that never collide.
const allIds = entries.flatMap((entry) => entry.ids);
assert.equal(new Set(allIds).size, allIds.length, "preset ids must be unique across both presets");

const probeRoot = mkdtempSync(join(tmpdir(), "anti-slop-jev-plugins-"));
const config = join(probeRoot, "oxlint.json");
const source = join(probeRoot, "source.ts");

function lintWith(ruleNames: ReadonlyArray<string>) {
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: entries.map(({ name, specifier }) => ({ name, specifier })),
      rules: Object.fromEntries(ruleNames.map((rule) => [rule, "warn"])),
    }),
  );
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "CI" || key.startsWith("TYPESAFE") || key.startsWith("JEV_") || key.startsWith("ANTI_SLOP_") || key === "AI_GATEWAY_API_KEY") {
      delete env[key];
    }
  }
  const result = spawnSync("pnpm", ["exec", "oxlint", "--config", config, source], {
    encoding: "utf8",
    env,
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

try {
  writeFileSync(source, "export const answer = 42;\n");
  const ruleNames = entries.flatMap(({ name, ids }) => ids.map((id) => `${name}/${id}`));

  // Without an API key the plugin skips every question, so the run only proves oxlint knows each
  // `<plugin>/<id>` rule name.
  const known = lintWith(ruleNames);
  assert.equal(known.status, 0, known.output);
  assert.match(known.output, /no Jev credentials/);

  const unknown = lintWith([`${effectJevPluginName}/not-a-preset-id`]);
  assert.notEqual(unknown.status, 0, "oxlint must reject a rule name the plugin does not define");
  assert.match(unknown.output, /not found in plugin 'anti-slop-effect-jev'/);
} finally {
  rmSync(probeRoot, { recursive: true, force: true });
}
