#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
const targetArgument = arguments_.find((argument) => !argument.startsWith("--"));
const target = resolve(process.cwd(), targetArgument ?? "tools/oxlint/anti-slop");
const force = arguments_.includes("--force");
const jevArgument = arguments_.find((argument) => argument === "--jev" || argument.startsWith("--jev="));
// The built oxlint-plugin-jev fork goes beside the plugin by default, e.g. tools/oxlint/oxlint-plugin-jev.
const jevTarget =
  jevArgument === undefined
    ? undefined
    : resolve(process.cwd(), jevArgument.startsWith("--jev=") ? jevArgument.slice("--jev=".length) : resolve(dirname(target), "oxlint-plugin-jev"));

const copies = [{ source: resolve(skillRoot, "assets/anti-slop"), target }];
if (jevTarget !== undefined) copies.push({ source: resolve(skillRoot, "assets/oxlint-plugin-jev"), target: jevTarget });

for (const copy of copies) {
  if (existsSync(copy.target) && !force) {
    console.error(`Refusing to overwrite ${copy.target}. Re-run with --force only after reviewing the existing files.`);
    process.exit(1);
  }
}

for (const copy of copies) {
  mkdirSync(dirname(copy.target), { recursive: true });
  cpSync(copy.source, copy.target, { recursive: true, force });
}

console.log(`Copied the anti-slop plugin to ${target}`);
console.log(`Configure Oxlint with: ${target}/index.ts`);
if (jevTarget !== undefined) {
  console.log(`Copied the built oxlint-plugin-jev fork to ${jevTarget}`);
  console.log(`Add it as a dev dependency: "oxlint-plugin-jev": "file:./${relative(process.cwd(), jevTarget)}"`);
}
