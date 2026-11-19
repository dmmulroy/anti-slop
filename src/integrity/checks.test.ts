// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env -- tests a standalone CLI outside any Effect runtime against real git repositories
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkIntegrity, type IntegrityFinding } from "./checks.ts";

// Keep the developer's git configuration out of the scratch repositories.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void): void => {
	tests.push([name, run]);
};

function sh(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

function write(root: string, path: string, lines: ReadonlyArray<string>): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), `${lines.join("\n")}\n`);
}

const scratch: string[] = [];

/** A repository whose main branch holds `files`, checked out on a new `feature` branch. */
function repo(files: Readonly<Record<string, ReadonlyArray<string>>>): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "anti-slop-integrity-")));
	scratch.push(root);
	sh(root, "init", "-q", "-b", "main");
	for (const [path, lines] of Object.entries(files)) write(root, path, lines);
	sh(root, "add", "-A");
	sh(root, "commit", "-q", "--allow-empty", "-m", "initial");
	sh(root, "checkout", "-q", "-b", "feature");
	return root;
}

const summary = (findings: ReadonlyArray<IntegrityFinding>): string[] =>
	findings.map((finding) => `${finding.file}:${finding.line ?? "-"} ${finding.check}`);

const oxlintrc = (rules: string, extra = ""): string[] => [
	"{",
	'  "jsPlugins": [{ "name": "landmines", "specifier": "@interfere/landmines/testing" }, "eslint-plugin-ai-guard"],',
	`  "ignorePatterns": ["src/vendor/**"],${extra}`,
	`  "rules": { ${rules} }`,
	"}",
];

test("reports disable comments added without a reason, and only those", () => {
	const root = repo({ "src/a.ts": ["export const a = 1;"] });
	write(root, "src/a.ts", [
		"// oxlint-disable-next-line no-console",
		"console.log(1);",
		"/* eslint-disable no-alert */",
		"// oxlint-disable-next-line no-debugger -- generated fixture keeps the statement",
		"// eslint-disable-line eqeqeq -- comparing with a loose sentinel on purpose",
		'const hint = "// oxlint-disable-next-line no-console";',
		"export const a = 1;",
	]);
	write(root, "README.md", ["// oxlint-disable-next-line no-console"]);
	assert.deepEqual(summary(checkIntegrity({ cwd: root }).findings), [
		"src/a.ts:1 suppression-without-reason",
		"src/a.ts:3 suppression-without-reason",
	]);
});

test("reports a file-wide disable in an untracked file", () => {
	const root = repo({ "src/a.ts": ["export const a = 1;"] });
	write(root, "src/new.ts", ["/* oxlint-disable */", "export const b = 2;"]);
	const [finding] = checkIntegrity({ cwd: root }).findings;
	assert.equal(finding?.check, "suppression-without-reason");
	assert.match(finding?.message ?? "", /oxlint-disable/);
});

test("moving an existing disable comment within a file is not a new suppression", () => {
	const root = repo({ "src/a.ts": ["// oxlint-disable-next-line no-console", "console.log(1);", "export const a = 1;"] });
	write(root, "src/a.ts", ["export const a = 1;", "// oxlint-disable-next-line no-console", "console.log(1);"]);
	assert.deepEqual(checkIntegrity({ cwd: root }).findings, []);
});

test("reports a rule lowered from error to warn in .oxlintrc.json", () => {
	const root = repo({ ".oxlintrc.json": oxlintrc('"eqeqeq": "error", "no-debugger": "warn"') });
	write(root, ".oxlintrc.json", oxlintrc('"eqeqeq": "warn", "no-debugger": ["error", { "allow": [] }]'));
	const findings = checkIntegrity({ cwd: root }).findings;
	assert.deepEqual(summary(findings), [".oxlintrc.json:4 rule-weakened"]);
	assert.match(findings[0]?.message ?? "", /Lowered `eqeqeq` from error to warn/);
});

test("reports a rule turned off in an override of oxlint.config.ts, and a removed rule", () => {
	const config = (overrideRules: string, rules: string): string[] => [
		'import { defineConfig } from "oxlint";',
		"export default defineConfig({",
		`  rules: { ${rules} },`,
		`  overrides: [{ files: ["**/*.test.ts"], rules: { ${overrideRules} } }],`,
		"});",
	];
	const root = repo({ "oxlint.config.ts": config("", '"landmines/no-fixed-sleep": "error", "typescript/no-explicit-any": 2') });
	write(root, "oxlint.config.ts", config('"landmines/no-fixed-sleep": "off"', '"landmines/no-fixed-sleep": "error"'));
	const findings = checkIntegrity({ cwd: root }).findings;
	assert.deepEqual(summary(findings), ["oxlint.config.ts:4 rule-weakened", "oxlint.config.ts:- rule-weakened"]);
	assert.match(findings[0]?.message ?? "", /Turned off `landmines\/no-fixed-sleep` \(was error\)/);
	assert.match(findings[1]?.message ?? "", /Removed `typescript\/no-explicit-any` \(error\)/);
});

test("raising a severity, adding a rule, or reformatting an entry weakens nothing", () => {
	const root = repo({ ".oxlintrc.json": oxlintrc('"eqeqeq": "warn", "no-debugger": "error"') });
	write(root, ".oxlintrc.json", oxlintrc('"eqeqeq": "error", "no-debugger": ["error"], "no-alert": "error"'));
	assert.deepEqual(checkIntegrity({ cwd: root }).findings, []);
});

test("reports an added ignore pattern", () => {
	const root = repo({ ".oxlintrc.json": oxlintrc('"eqeqeq": "error"') });
	write(root, ".oxlintrc.json", oxlintrc('"eqeqeq": "error"').map((line) => line.replace('["src/vendor/**"]', '["src/vendor/**", "src/legacy/**/*.ts"]')));
	const findings = checkIntegrity({ cwd: root }).findings;
	assert.deepEqual(summary(findings), [".oxlintrc.json:3 ignore-pattern-added"]);
	assert.match(findings[0]?.message ?? "", /src\/legacy\/\*\*\/\*\.ts/);
});

test("reports a removed jsPlugins entry, but not one pointed at a new module", () => {
	const root = repo({ ".oxlintrc.json": oxlintrc('"eqeqeq": "error"') });
	write(
		root,
		".oxlintrc.json",
		oxlintrc('"eqeqeq": "error"').map((line) =>
			line.startsWith('  "jsPlugins"') ? '  "jsPlugins": [{ "name": "landmines", "specifier": "./tools/landmines.ts" }],' : line,
		),
	);
	const findings = checkIntegrity({ cwd: root }).findings;
	assert.deepEqual(summary(findings), [".oxlintrc.json:- js-plugin-removed"]);
	assert.match(findings[0]?.message ?? "", /eslint-plugin-ai-guard/);
});

test("a deleted oxlint config removes its rules and plugins", () => {
	const root = repo({ "packages/app/.oxlintrc.json": oxlintrc('"eqeqeq": "error"') });
	sh(root, "rm", "-q", "packages/app/.oxlintrc.json");
	assert.deepEqual(summary(checkIntegrity({ cwd: root }).findings), [
		"packages/app/.oxlintrc.json:- rule-weakened",
		"packages/app/.oxlintrc.json:- js-plugin-removed",
		"packages/app/.oxlintrc.json:- js-plugin-removed",
	]);
});

test("compares with the merge base, so changes already on main are not reported", () => {
	const root = repo({ "src/a.ts": ["export const a = 1;"] });
	sh(root, "checkout", "-q", "main");
	write(root, "src/main-only.ts", ["// oxlint-disable-next-line no-console", "console.log(1);"]);
	sh(root, "add", "-A");
	sh(root, "commit", "-q", "-m", "main moves on");
	sh(root, "checkout", "-q", "feature");
	write(root, "src/b.ts", ["export const b = 2;"]);
	assert.deepEqual(checkIntegrity({ cwd: root }).findings, []);
	assert.equal(checkIntegrity({ cwd: root }).baseLabel, "main");
});

test("run.ts runs ai-guard and the anti-slop checks and fails when either finds a weakening", () => {
	const root = repo({
		"package.json": ['{ "name": "scratch", "private": true }'],
		"src/math.test.ts": [
			'import { expect, it } from "vitest";',
			'it("adds", () => {',
			"  expect(1 + 1).toBe(2);",
			"});",
		],
	});
	write(root, "src/math.test.ts", [
		'import { expect, it } from "vitest";',
		'it.skip("adds", () => {',
		"  expect(1 + 1).toBe(2);",
		"});",
	]);
	write(root, "src/b.ts", ["// oxlint-disable-next-line no-console", "console.log(1);"]);
	const result = spawnSync(process.execPath, [join(import.meta.dirname, "run.ts")], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, FORCE_COLOR: "0", CI: "", GITHUB_ACTIONS: "" },
	});
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stdout, /integrity-test-skipped/);
	assert.match(result.stdout, /src\/b\.ts:1 {2}suppression-without-reason/);

	const clean = repo({ "src/a.ts": ["export const a = 1;"] });
	const ok = spawnSync(process.execPath, [join(import.meta.dirname, "run.ts")], { cwd: clean, encoding: "utf8" });
	assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

let failed = 0;
for (const [name, run] of tests) {
	try {
		run();
		console.log(`ok - ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`not ok - ${name}`);
		console.error(error);
	}
}
for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
if (failed > 0) process.exit(1);
