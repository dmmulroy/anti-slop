#!/usr/bin/env node
// Fails a branch that weakens its own checks. Runs `ai-guard integrity --enforce` (eslint-plugin-ai-guard: skipped,
// focused, or deleted tests, suppressions, downgraded ESLint, TypeScript, coverage, and CI settings) and anti-slop's
// checks for what ai-guard does not read: oxlint and eslint disable comments without a reason, and oxlint config
// changes that lower or remove rules, add ignore patterns, or drop JS plugins. Both compare the working tree,
// untracked files included, with the merge base of HEAD and the default branch. Neither uses the network.
//
// Usage: node integrity/run.ts [--base <ref>]   (or ANTI_SLOP_BASE=<ref>)
//
// Exit codes: 0 nothing weakened, 1 a check was weakened, 2 the comparison could not run.

// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env -- a standalone CLI outside any Effect runtime, so Effect's platform services and logger do not apply

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { errorMessage } from "../shared/error-message.ts";
import { checkIntegrity, type IntegrityFinding } from "./checks.ts";

const USAGE = "usage: node integrity/run.ts [--base <ref>]";

/** The ai-guard CLI from the repository's dependencies, else from the ones next to this script. */
function aiGuardCli(root: string): string {
	for (const from of [join(root, "package.json"), import.meta.filename]) {
		try {
			return join(dirname(createRequire(from).resolve("eslint-plugin-ai-guard")), "cli", "index.js");
		} catch {
			continue;
		}
	}
	throw new Error("eslint-plugin-ai-guard is not installed; add it as a development dependency.");
}

function format(finding: IntegrityFinding): string {
	const location = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
	return `  ${location}  ${finding.check}\n      ${finding.message}`;
}

function parseBase(args: ReadonlyArray<string>): string | undefined {
	if (args.length === 0) return process.env.ANTI_SLOP_BASE || undefined;
	if (args.length === 2 && args[0] === "--base" && args[1] !== undefined) return args[1];
	throw new Error(USAGE);
}

function run(args: ReadonlyArray<string>): number {
	const base = parseBase(args);
	const result = checkIntegrity({ cwd: process.cwd(), ...(base === undefined ? {} : { base }) });
	const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();

	// Without a base branch, ai-guard's own default (HEAD) matches what the anti-slop checks compare against.
	const baseArgs = result.baseCommit === undefined || result.baseLabel === "HEAD" ? [] : ["--base", result.baseCommit];
	const aiGuard = spawnSync(process.execPath, [aiGuardCli(root), "integrity", "--enforce", ...baseArgs], {
		cwd: root,
		stdio: "inherit",
	});
	if (aiGuard.error !== undefined) throw aiGuard.error;

	const commit = result.baseCommit === undefined ? "" : ` (${result.baseCommit.slice(0, 12)})`;
	console.log(`anti-slop integrity: compared with ${result.baseLabel}${commit}`);
	if (result.findings.length === 0) console.log("  No weakened lint settings found.");
	else console.log([`  ${result.findings.length} finding(s):`, ...result.findings.map(format)].join("\n"));

	const aiGuardStatus = aiGuard.status ?? 2;
	if (aiGuardStatus >= 2) return 2;
	return aiGuardStatus === 1 || result.findings.length > 0 ? 1 : 0;
}

try {
	process.exit(run(process.argv.slice(2)));
} catch (error) {
	console.error(`anti-slop integrity: ${errorMessage(error)}`);
	process.exit(2);
}
