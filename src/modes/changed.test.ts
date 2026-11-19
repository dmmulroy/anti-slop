// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env, effecttsgo/async-function, effecttsgo/new-promise -- drives the real oxlint CLI against scratch git repositories and a local decision-model server, outside any Effect runtime
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultBase } from "./changed.ts";

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, run: () => void | Promise<void>): void => {
	tests.push([name, run]);
};

const repository = fileURLToPath(new URL("../..", import.meta.url));
const oxlint = join(repository, "node_modules", ".bin", "oxlint");
const source = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** The `jsPlugins` entries a user writes: anti-slop, and the checked-in wrappers for third-party plugins. */
const JS_PLUGINS = [
	{ name: "anti-slop", specifier: source("index.ts") },
	{ name: "landmines", specifier: source("plugins/landmines.ts") },
	{ name: "effect", specifier: source("plugins/effect.ts") },
	{ name: "anti-slop-effect-jev", specifier: source("jev/plugin.ts") },
];

const GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const scratch: string[] = [];

function sh(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...GIT_ENV },
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

function directory(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "anti-slop-modes-")));
	scratch.push(root);
	return root;
}

/** A plain Oxlint config: native rule entries, no wrapper, no settings. */
function configure(root: string, rules: Readonly<Record<string, unknown>>): void {
	write(root, { ".oxlintrc.json": JSON.stringify({ jsPlugins: JS_PLUGINS, rules }, null, 2) });
}

interface LintResult {
	readonly findings: ReadonlyArray<string>;
	readonly stdout: string;
	readonly stderr: string;
	readonly status: number | null;
}

/**
 * Runs oxlint asynchronously, so a decision-model server on this process can answer the Jev
 * plugin's requests while oxlint waits on them. Findings read `old.test.ts:4 anti-slop(no-reflect-get)`.
 */
function lint(root: string, files: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}): Promise<LintResult> {
	const clean = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) =>
				key !== "CI" &&
				!key.startsWith("ANTI_SLOP_") &&
				!key.startsWith("JEV_") &&
				!key.startsWith("TYPESAFE") &&
				!["FACTORY_API_KEY", "FACTORY_API_BASE_URL", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"].includes(key),
		),
	);
	const child = spawn(oxlint, ["--format", "unix", "-c", ".oxlintrc.json", ...files], {
		cwd: root,
		env: { ...clean, ...GIT_ENV, ...env },
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (status) => {
			if (status !== 0 && status !== 1) {
				reject(new Error(`oxlint exited ${String(status)}:\n${stdout}\n${stderr}`));
				return;
			}
			const findings = stdout
				.split("\n")
				.flatMap((line) => {
					const match = /^([^:]+):(\d+):\d+: .*\[\w+\/(.+)\]$/.exec(line);
					return match === null ? [] : [`${match[1]}:${match[2]} ${match[3]}`];
				})
				.sort();
			resolve({ findings, stdout, stderr, status });
		});
	});
}

const OLD = 'Reflect.get(a, "old");\nReflect.apply(f, null, []);\nit("old", { retry: 3 }, () => {});\n';

/**
 * `main` (or `defaultBranch`) holds the old violations on lines 1-3 of `old.test.ts`. The `feature`
 * branch commits line 4, leaves line 5 unstaged, and adds the untracked `new.test.ts`.
 */
function featureBranch(defaultBranch = "main", unchanged: Readonly<Record<string, string>> = {}): string {
	const root = directory();
	write(root, { ".gitignore": "node_modules\n.oxlintrc.json\n", "old.test.ts": OLD, ...unchanged });
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

const FILES = ["old.test.ts", "new.test.ts"];

const EVERY_FINDING = [
	"new.test.ts:1 anti-slop(no-reflect-get)",
	"old.test.ts:1 anti-slop(no-reflect-get)",
	"old.test.ts:2 anti-slop(no-reflect-apply)",
	"old.test.ts:3 landmines(no-flake-masking)",
	"old.test.ts:4 anti-slop(no-reflect-get)",
	"old.test.ts:5 landmines(no-flake-masking)",
];

const BRANCH_FINDINGS = [
	"new.test.ts:1 anti-slop(no-reflect-get)",
	"old.test.ts:2 anti-slop(no-reflect-apply)",
	"old.test.ts:4 anti-slop(no-reflect-get)",
	"old.test.ts:5 landmines(no-flake-masking)",
];

const CHANGED_RULES = {
	"anti-slop/no-reflect-get": ["error", { mode: "changed" }],
	"anti-slop/no-reflect-apply": "error",
	"landmines/no-flake-masking": ["error", { mode: "changed" }],
};

test("every rule checks the whole file when its entry is only a severity", async () => {
	const root = featureBranch();
	configure(root, { "anti-slop/no-reflect-get": "error", "anti-slop/no-reflect-apply": "error", "landmines/no-flake-masking": "error" });
	const { findings, stderr } = await lint(root, FILES);
	assert.deepEqual(findings, EVERY_FINDING, stderr);
});

test('["error", { mode: "changed" }] ignores old violations and reports commits on the branch, staged, unstaged, and untracked lines', async () => {
	const root = featureBranch();
	configure(root, CHANGED_RULES);
	const { findings, stderr } = await lint(root, FILES);
	// Lines 1 and 3 of old.test.ts predate the branch, so their "changed" findings are dropped; the
	// whole-file rule still reports line 2.
	assert.deepEqual(findings, BRANCH_FINDINGS, stderr);
	assert.doesNotMatch(stderr, /checking every line/);
});

test("ANTI_SLOP_MODE=all checks every line even for rules set to changed", async () => {
	const root = featureBranch();
	configure(root, CHANGED_RULES);
	assert.deepEqual((await lint(root, FILES, { ANTI_SLOP_MODE: "all" })).findings, EVERY_FINDING);
});

test("a repository whose default branch is master diffs against master", async () => {
	const root = featureBranch("master");
	configure(root, CHANGED_RULES);
	assert.deepEqual((await lint(root, FILES)).findings, BRANCH_FINDINGS);
});

test("the base option and ANTI_SLOP_BASE pick another base", async () => {
	const root = featureBranch();
	// Against HEAD the commit on the branch no longer counts.
	const againstHead = [
		"new.test.ts:1 anti-slop(no-reflect-get)",
		"old.test.ts:2 anti-slop(no-reflect-apply)",
		"old.test.ts:5 landmines(no-flake-masking)",
	];
	configure(root, CHANGED_RULES);
	assert.deepEqual((await lint(root, FILES, { ANTI_SLOP_BASE: "HEAD" })).findings, againstHead);
	configure(root, {
		...CHANGED_RULES,
		"anti-slop/no-reflect-get": ["error", { mode: "changed", base: "HEAD" }],
		"landmines/no-flake-masking": ["error", { mode: "changed", base: "HEAD" }],
	});
	assert.deepEqual((await lint(root, FILES)).findings, againstHead);
});

test("when git cannot diff, every line is checked and a warning says why", async () => {
	const outside = directory();
	write(outside, { "old.test.ts": OLD });
	configure(outside, CHANGED_RULES);
	const notRepository = await lint(outside, ["old.test.ts"]);
	assert.deepEqual(notRepository.findings, [
		"old.test.ts:1 anti-slop(no-reflect-get)",
		"old.test.ts:2 anti-slop(no-reflect-apply)",
		"old.test.ts:3 landmines(no-flake-masking)",
	]);
	assert.match(notRepository.stderr, /anti-slop: changed-lines mode could not diff .*checking every line/);

	const trunk = featureBranch("trunk");
	configure(trunk, CHANGED_RULES);
	const noDefaultBranch = await lint(trunk, FILES);
	assert.deepEqual(noDefaultBranch.findings, EVERY_FINDING);
	assert.match(noDefaultBranch.stderr, /no default branch found/);
});

test("the default branch is origin/HEAD, then origin/main, origin/master, main, master", () => {
	const root = directory();
	sh(root, "init", "-q", "-b", "master");
	sh(root, "commit", "-qm", "base", "--allow-empty");
	assert.equal(defaultBase(root), "master");
	sh(root, "branch", "main");
	assert.equal(defaultBase(root), "main", "main is tried before master");
	sh(root, "update-ref", "refs/remotes/origin/master", "HEAD");
	assert.equal(defaultBase(root), "origin/master", "remote branches come before local ones");
	sh(root, "update-ref", "refs/remotes/origin/main", "HEAD");
	assert.equal(defaultBase(root), "origin/main");
	sh(root, "update-ref", "refs/remotes/origin/trunk", "HEAD");
	sh(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
	assert.equal(defaultBase(root), "origin/trunk", "origin/HEAD names the remote default branch");

	const none = directory();
	sh(none, "init", "-q", "-b", "trunk");
	sh(none, "commit", "-qm", "base", "--allow-empty");
	assert.equal(defaultBase(none), null);
});

test("a wrapped third-party rule gets its own options without mode, and mode still filters its reports", async () => {
	const root = directory();
	const branchy = (name: string): string => `export function ${name}(flag: boolean) {\n\tif (flag) return 1;\n\treturn 2;\n}\n`;
	write(root, { ".gitignore": ".oxlintrc.json\n", "code.ts": branchy("old") });
	sh(root, "init", "-q", "-b", "main");
	sh(root, "add", ".");
	sh(root, "commit", "-qm", "base");
	write(root, { "code.ts": `${branchy("old")}\n${branchy("added")}` });
	// The default `max` of 21 reports neither function, so findings prove `max: 0` reached the rule.
	configure(root, { "effect/maxCognitiveComplexity": ["error", { max: 0 }] });
	assert.deepEqual((await lint(root, ["code.ts"])).findings, ["code.ts:1 effect(maxCognitiveComplexity)", "code.ts:6 effect(maxCognitiveComplexity)"]);
	configure(root, { "effect/maxCognitiveComplexity": ["error", { mode: "changed", max: 0 }] });
	const changed = await lint(root, ["code.ts"]);
	assert.deepEqual(changed.findings, ["code.ts:6 effect(maxCognitiveComplexity)"], changed.stderr);
	configure(root, { "effect/maxCognitiveComplexity": ["error", { mode: "changed" }] });
	assert.deepEqual((await lint(root, ["code.ts"])).findings, [], "with only mode, the rule keeps its default options");
	configure(root, { "effect/maxCognitiveComplexity": ["error", { mode: "sometimes" }] });
	const invalid = await lint(root, ["code.ts"]);
	assert.equal(invalid.status, 1);
	assert.match(invalid.stdout + invalid.stderr, /Options validation failed for rule 'effect\/maxCognitiveComplexity'/);
});

/**
 * A decision-model server speaking TypeSafe's `/v1/systemone` wire format. It answers yes to every
 * question, "unknown" to every location question, and records the snippets it was sent.
 */
async function decisionServer(): Promise<{ readonly url: string; readonly snippets: string[]; readonly close: () => void }> {
	const snippets: string[] = [];
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			const body: {
				readonly questions: Record<string, { readonly type: string; readonly criteria?: Record<string, unknown> }>;
				readonly state: { readonly snippets: Record<string, string> };
			} = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			snippets.push(...Object.values(body.state.snippets));
			const answers = Object.fromEntries(
				Object.entries(body.questions).map(([id, question]) => [
					id,
					question.type === "choice"
						? {
								type: "choice",
								choice: "unknown",
								probabilities: Object.fromEntries(Object.keys(question.criteria ?? {}).map((key) => [key, key === "unknown" ? 1 : 0])),
							}
						: { type: "noul", noul: 0.95 },
				]),
			);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 0, output_tokens: 0 } }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("the decision server did not bind a port");
	return { url: `http://127.0.0.1:${address.port}`, snippets, close: () => server.close() };
}

const JEV_RULE = "anti-slop-effect-jev/error-as-value";
const JEV_FINDING = "anti-slop-effect-jev(error-as-value)";

test("Jev rules run whenever a key is set, check whole files by default, and honor mode changed", async () => {
	const server = await decisionServer();
	try {
		const unchanged = { "untouched.test.ts": "export const untouched = 1;\n" };
		const files = [...FILES, "untouched.test.ts"];
		const key = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: server.url };
		const root = featureBranch("main", unchanged);
		configure(root, { [JEV_RULE]: "error" });
		const whole = await lint(root, files, key);
		assert.deepEqual(
			whole.findings,
			[`new.test.ts:1 ${JEV_FINDING}`, `old.test.ts:1 ${JEV_FINDING}`, `untouched.test.ts:1 ${JEV_FINDING}`],
			whole.stderr,
		);

		const fresh = featureBranch("main", unchanged);
		server.snippets.length = 0;
		configure(fresh, { [JEV_RULE]: ["error", { mode: "changed" }] });
		const changed = await lint(fresh, files, key);
		assert.deepEqual(changed.findings, [`new.test.ts:1 ${JEV_FINDING}`, `old.test.ts:1 ${JEV_FINDING}`], changed.stderr);
		assert.ok(
			!server.snippets.some((snippet) => snippet.includes("untouched")),
			"a file with no changed lines sends nothing in changed mode",
		);
	} finally {
		server.close();
	}
});

test("Jev rules skip with a warning when no key is set, with no other switch involved", async () => {
	const root = featureBranch();
	configure(root, { [JEV_RULE]: "error" });
	const { findings, stderr, status } = await lint(root, FILES);
	assert.deepEqual(findings, []);
	assert.equal(status, 0, stderr);
	assert.match(stderr, /no Jev credentials.*skipping Jev checks/);
});

let failed = 0;
for (const [name, run] of tests) {
	try {
		await run();
		console.log(`ok - ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`not ok - ${name}`);
		console.error(error);
	}
}
for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
if (failed > 0) process.exit(1);
