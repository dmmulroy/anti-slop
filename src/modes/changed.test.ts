// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env -- drives the real oxlint CLI against scratch git repositories, outside any Effect runtime
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void): void => {
	tests.push([name, run]);
};

const repository = fileURLToPath(new URL("../..", import.meta.url));
const oxlint = join(repository, "node_modules", ".bin", "oxlint");
const configModule = new URL("./config.ts", import.meta.url).href;
const antiSlopPlugin = fileURLToPath(new URL("../index.ts", import.meta.url));

const scratch: string[] = [];

function sh(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
	});
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

function write(root: string, files: Readonly<Record<string, string>>): void {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}

const OLD = 'Reflect.get(a, "old");\nReflect.apply(f, null, []);\nit("old", { retry: 3 }, () => {});\n';

/**
 * A project whose config runs `no-reflect-get` and landmines' `no-flake-masking` in "changed" mode
 * and `no-reflect-apply` in "all" mode. Its `node_modules` links only `@interfere`, so the
 * landmines plugin is loaded by its bare package specifier.
 */
function project(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "anti-slop-changed-")));
	scratch.push(root);
	mkdirSync(join(root, "node_modules"));
	symlinkSync(join(repository, "node_modules", "@interfere"), join(root, "node_modules", "@interfere"));
	write(root, {
		".gitignore": "node_modules\n",
		"oxlint.config.ts": [
			`import { defineAntiSlopConfig } from ${JSON.stringify(configModule)};`,
			"",
			"export default defineAntiSlopConfig({",
			"\tjsPlugins: [",
			`\t\t{ name: "anti-slop", specifier: ${JSON.stringify(antiSlopPlugin)} },`,
			'\t\t{ name: "landmines", specifier: "@interfere/landmines/testing" },',
			"\t],",
			"\trules: {",
			'\t\t"anti-slop/no-reflect-get": { level: "error", mode: "changed" },',
			'\t\t"anti-slop/no-reflect-apply": "error",',
			'\t\t"landmines/no-flake-masking": { level: "error", mode: "changed" },',
			"\t},",
			"});",
			"",
		].join("\n"),
		"old.test.ts": OLD,
	});
	return root;
}

function lint(root: string, files: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}): { findings: string[]; stderr: string } {
	const clean = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => key !== "CI" && !key.startsWith("ANTI_SLOP_") && !key.startsWith("JEV_")),
	);
	const result = spawnSync(oxlint, ["--format", "unix", "-c", "oxlint.config.ts", ...files], {
		cwd: root,
		encoding: "utf8",
		env: { ...clean, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...env },
	});
	if (result.status !== 0 && result.status !== 1) throw new Error(`oxlint exited ${String(result.status)}:\n${result.stdout}\n${result.stderr}`);
	// `old.test.ts:4:1: <message> [Error/anti-slop(no-reflect-get)]` becomes `old.test.ts:4 anti-slop(no-reflect-get)`.
	const findings = result.stdout
		.split("\n")
		.flatMap((line) => {
			const match = /^([^:]+):(\d+):\d+: .*\[\w+\/(.+)\]$/.exec(line);
			return match === null ? [] : [`${match[1]}:${match[2]} ${match[3]}`];
		})
		.sort();
	return { findings, stderr: result.stderr };
}

/** `main` holds the old violations; `feature` commits one new line and leaves more in the working tree. */
function featureBranch(defaultBranch: string): string {
	const root = project();
	sh(root, "init", "-q", "-b", defaultBranch);
	sh(root, "add", ".");
	sh(root, "commit", "-qm", "base");
	sh(root, "checkout", "-q", "-b", "feature");
	write(root, { "old.test.ts": `${OLD}Reflect.get(b, "committed");\n` });
	sh(root, "commit", "-qam", "on the branch");
	write(root, {
		"old.test.ts": `${OLD}Reflect.get(b, "committed");\nit("unstaged", { retry: 2 }, () => {});\n`,
		"new.test.ts": 'Reflect.get(c, "untracked");\n',
	});
	return root;
}

const BRANCH_FINDINGS = [
	"new.test.ts:1 anti-slop(no-reflect-get)",
	"old.test.ts:2 anti-slop(no-reflect-apply)",
	"old.test.ts:4 anti-slop(no-reflect-get)",
	"old.test.ts:5 landmines(no-flake-masking)",
];

test('"changed" rules report only lines changed since the merge base, including commits on the branch', () => {
	const root = featureBranch("main");
	const { findings, stderr } = lint(root, ["old.test.ts", "new.test.ts"]);
	// Lines 1 and 3 of old.test.ts predate the branch, so their no-reflect-get and no-flake-masking
	// findings are dropped; the "all" rule still reports line 2.
	assert.deepEqual(findings, BRANCH_FINDINGS, stderr);
	assert.doesNotMatch(stderr, /checking every line/);
});

test('"all" rules, and every rule under ANTI_SLOP_MODE=all, report pre-existing violations too', () => {
	const root = featureBranch("main");
	const { findings } = lint(root, ["old.test.ts", "new.test.ts"], { ANTI_SLOP_MODE: "all" });
	assert.deepEqual(findings, [
		"new.test.ts:1 anti-slop(no-reflect-get)",
		"old.test.ts:1 anti-slop(no-reflect-get)",
		"old.test.ts:2 anti-slop(no-reflect-apply)",
		"old.test.ts:3 landmines(no-flake-masking)",
		"old.test.ts:4 anti-slop(no-reflect-get)",
		"old.test.ts:5 landmines(no-flake-masking)",
	]);
});

test("a repository whose default branch is master diffs against master", () => {
	const root = featureBranch("master");
	assert.deepEqual(lint(root, ["old.test.ts", "new.test.ts"]).findings, BRANCH_FINDINGS);
});

test("ANTI_SLOP_BASE picks another base", () => {
	const root = featureBranch("main");
	// Against HEAD the commit on the branch no longer counts.
	assert.deepEqual(lint(root, ["old.test.ts", "new.test.ts"], { ANTI_SLOP_BASE: "HEAD" }).findings, [
		"new.test.ts:1 anti-slop(no-reflect-get)",
		"old.test.ts:2 anti-slop(no-reflect-apply)",
		"old.test.ts:5 landmines(no-flake-masking)",
	]);
});

test("when git cannot diff, every line is checked and a warning says why", () => {
	const root = project();
	const { findings, stderr } = lint(root, ["old.test.ts"]);
	assert.deepEqual(findings, [
		"old.test.ts:1 anti-slop(no-reflect-get)",
		"old.test.ts:2 anti-slop(no-reflect-apply)",
		"old.test.ts:3 landmines(no-flake-masking)",
	]);
	assert.match(stderr, /anti-slop: changed-lines mode could not diff .*checking every line/);
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
