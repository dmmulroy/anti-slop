#!/usr/bin/env node
// Runs oxlint on the JS/TS files changed in the working tree: staged, unstaged, and untracked
// files that are not ignored. `--all` lints the whole project instead.
//
// It also sets `JEV_CHANGED_ONLY` for oxlint-plugin-jev, unless the caller already set it: `1` by
// default, so jev only asks about functions, calls, and file rules on changed lines, and `0` with
// `--all`, so a full run asks about everything.
//
// Usage: node lint-changed.ts [--all] [--ext=.ts,.tsx] [--oxlint=<bin>] [oxlint args...]
//
// Every argument the runner does not recognize is passed to oxlint unchanged, so
// `node lint-changed.ts -c oxlint.jev.config.ts --format=github` works as expected. Paths are
// relative to, and limited to, the current directory, so running it from a workspace package
// only lints that package's changes.
//
// It uses only Node built-ins and erasable type syntax, so Node runs it directly with the same
// type stripping oxlint already needs to load this TypeScript plugin.

// This is a standalone CLI outside any Effect runtime, so Effect's platform services and logger do
// not apply.
// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { statSync } from "node:fs";
import { extname } from "node:path";

const DEFAULT_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"];

let lintAll = false;
let extensions = DEFAULT_EXTENSIONS;
let oxlintBin = "oxlint";
const oxlintArgs: string[] = [];

for (const arg of process.argv.slice(2)) {
  if (arg === "--all") lintAll = true;
  else if (arg.startsWith("--ext=")) {
    extensions = arg
      .slice("--ext=".length)
      .split(",")
      .map((extension) => extension.trim())
      .filter((extension) => extension.length > 0)
      .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));
  } else if (arg.startsWith("--oxlint=")) oxlintBin = arg.slice("--oxlint=".length);
  else oxlintArgs.push(arg);
}

function git(args: ReadonlyArray<string>): SpawnSyncReturns<string> {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) throw result.error;
  return result;
}

function gitPaths(args: ReadonlyArray<string>): string[] {
  const result = git(args);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`git ${args.join(" ")} exited with ${String(result.status)}`);
  }

  return result.stdout.split("\0").filter((path) => path.length > 0);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function changedFiles(): string[] {
  if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
    throw new Error("not inside a git work tree; pass --all to lint without git");
  }

  // Before the first commit there is no HEAD to diff against, and every tracked file is a
  // staged addition.
  const hasHead = git(["rev-parse", "--verify", "--quiet", "HEAD"]).status === 0;
  const sets = hasHead
    ? [
        ["diff", "--name-only", "-z", "--relative", "--diff-filter=d", "HEAD"],
        ["diff", "--name-only", "-z", "--relative", "--diff-filter=d", "--cached"],
      ]
    : [["ls-files", "-z", "--cached"]];
  sets.push(["ls-files", "-z", "--others", "--exclude-standard"]);

  const lintable = new Set(extensions);
  const files = new Set(sets.flatMap(gitPaths));
  return [...files]
    .filter((path) => lintable.has(extname(path)) && isFile(path))
    .sort((left, right) => left.localeCompare(right));
}

function runOxlint(paths: ReadonlyArray<string>): number {
  const result = spawnSync(oxlintBin, [...oxlintArgs, ...paths], {
    stdio: "inherit",
    env: { ...process.env, JEV_CHANGED_ONLY: process.env.JEV_CHANGED_ONLY ?? (lintAll ? "0" : "1") },
    // npm and pnpm install `.cmd` shims on Windows, which spawn can only start through a shell.
    shell: process.platform === "win32",
  });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
}

try {
  if (lintAll) process.exit(runOxlint([]));

  const files = changedFiles();
  if (files.length === 0) {
    console.log("lint-changed: no changed lintable files.");
    process.exit(0);
  }

  console.log(`lint-changed: linting ${files.length} changed file(s).`);
  process.exit(runOxlint(files));
} catch (error) {
  console.error(`lint-changed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
