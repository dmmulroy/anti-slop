#!/usr/bin/env node
// Runs the lint for a git hook or CI with the matching anti-slop environment.
//
// Usage: node lint.ts <commit|push|full> [command...]
//
// - commit: lints the staged JS and TS files with Jev rules off (ANTI_SLOP_JEV=0). For pre-commit.
// - push: lints the whole project with Jev rules on (ANTI_SLOP_JEV=1), every rule in its configured
//   mode, so "changed" rules check only lines changed on the branch. For pre-push and CI.
// - full: like push with ANTI_SLOP_MODE=all, so every rule checks every line.
//
// The command defaults to `oxlint`; pass another after the mode, such as
// `node lint.ts push effect-tsgo --tsrs-lint oxlint --type-check`. `commit` appends the staged
// paths to it and exits 0 without running it when none are staged.
//
// It uses only Node built-ins and erasable type syntax, so Node runs it directly with the same
// type stripping oxlint already needs to load these TypeScript plugins.

// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env -- a standalone CLI outside any Effect runtime, so Effect's platform services and logger do not apply

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { extname } from "node:path";

const LINTABLE = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const STAGES = {
	commit: { ANTI_SLOP_JEV: "0" },
	push: { ANTI_SLOP_JEV: "1" },
	full: { ANTI_SLOP_JEV: "1", ANTI_SLOP_MODE: "all" },
} as const;
const USAGE = "usage: node lint.ts <commit|push|full> [command...]";

type Stage = keyof typeof STAGES;

const isStage = (value: string | undefined): value is Stage => value !== undefined && Object.hasOwn(STAGES, value);

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

function run(stage: Stage, command: ReadonlyArray<string>): number {
	const [bin = "oxlint", ...args] = command;
	const paths = stage === "commit" ? stagedFiles() : [];
	if (stage === "commit" && paths.length === 0) {
		console.log("anti-slop lint: no staged lintable files.");
		return 0;
	}
	const result = spawnSync(bin, [...args, ...paths], {
		stdio: "inherit",
		env: { ...process.env, ...STAGES[stage] },
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
	console.error(`anti-slop lint: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(2);
}
