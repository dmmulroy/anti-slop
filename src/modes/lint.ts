#!/usr/bin/env node
// Runs the lint for a git hook or CI.
//
// Usage: node lint.ts <commit|push|full> [command...]
//
// - commit: lints the staged JS and TS files with the decision-model credentials removed from the
//   environment, so the Jev rules skip (with their usual "no Jev credentials" warning) and only the
//   free rules run. For pre-commit.
// - push: lints the whole project as configured: every rule in the mode its options set, and the Jev
//   rules when a credential is set. For pre-push and CI.
// - full: like push with ANTI_SLOP_MODE=all and JEV_MODE=all, so rules set to mode "changed" check
//   every line too.
//
// In every stage, ANTI_SLOP_BASE also sets JEV_CHANGED_BASE when that is unset, so one variable
// picks the base for anti-slop's rules, the wrapped plugins, and the Jev rules.
//
// The command defaults to `oxlint`; pass another after the stage, such as
// `node lint.ts push effect-tsgo --tsrs-lint oxlint --type-check`. `commit` appends the staged
// paths to it and exits 0 without running it when none are staged.
//
// It uses only Node built-ins and erasable type syntax, so Node runs it directly with the same
// type stripping oxlint already needs to load these TypeScript plugins.

// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env -- a standalone CLI outside any Effect runtime, so Effect's platform services and logger do not apply

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { extname } from "node:path";

import { errorMessage } from "../shared/error-message.ts";

const LINTABLE = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
// What oxlint-plugin-jev reads to pick a backend. Without them it skips every Jev rule. `CI` goes
// too, because the Jev plugins fail a CI run that has no credential.
const JEV_CREDENTIALS = ["TYPESAFE_API_KEY", "TYPESAFE_AI_API_KEY", "FACTORY_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "CI"];
const STAGES = ["commit", "push", "full"] as const;
const USAGE = "usage: node lint.ts <commit|push|full> [command...]";

type Stage = (typeof STAGES)[number];

const isStage = (value: string | undefined): value is Stage => STAGES.some((stage) => stage === value);

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/** Staged paths relative to the current directory, without deletions. Works before the first commit too. */
function stagedFiles(): string[] {
	const result = spawnSync("git", ["diff", "--cached", "--name-only", "-z", "--relative", "--diff-filter=d"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) throw new Error(`git diff --cached failed: ${result.stderr.trim()}`);
	return result.stdout
		.split("\0")
		.filter((path) => LINTABLE.has(extname(path)) && isFile(path))
		.sort((left, right) => left.localeCompare(right));
}

function stageEnv(stage: Stage): NodeJS.ProcessEnv {
	const env = { ...process.env };
	const base = env.ANTI_SLOP_BASE?.trim() ?? "";
	if (base !== "" && (env.JEV_CHANGED_BASE?.trim() ?? "") === "") env.JEV_CHANGED_BASE = base;
	if (stage === "commit") for (const name of JEV_CREDENTIALS) delete env[name];
	if (stage === "full") {
		env.ANTI_SLOP_MODE = "all";
		env.JEV_MODE = "all";
	}
	return env;
}

function run(stage: Stage, command: ReadonlyArray<string>): number {
	const [bin = "oxlint", ...args] = command;
	const paths = stage === "commit" ? stagedFiles() : [];
	if (stage === "commit" && paths.length === 0) {
		console.log("anti-slop lint: no staged lintable files.");
		return 0;
	}
	const result = spawnSync(bin, [...args, ...paths], {
		stdio: "inherit",
		env: stageEnv(stage),
		// npm and pnpm install `.cmd` shims on Windows, which spawn can only start through a shell.
		shell: process.platform === "win32",
	});
	if (result.error !== undefined) throw result.error;
	return result.status ?? 1;
}

const [stage, ...command] = process.argv.slice(2);
if (!isStage(stage)) {
	console.error(USAGE);
	process.exit(2);
}
try {
	process.exit(run(stage, command));
} catch (error) {
	console.error(`anti-slop lint: ${errorMessage(error)}`);
	process.exit(2);
}
