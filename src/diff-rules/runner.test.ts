// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/process-env, effecttsgo/async-function, effecttsgo/prefer-schema-over-json -- tests a standalone CLI outside any Effect runtime against real git repositories
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDiffRules, type RunOptions } from "./runner.ts";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, run: () => Promise<void>): void => {
  tests.push([name, run]);
};

const scratch: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
};

function sh(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

interface Fixture {
  readonly root: string;
  readonly cacheDir: string;
  readonly calls: string;
  readonly reply: string;
  readonly command: string;
  setReply(rules: ReadonlyArray<{ id: string; violation: boolean; confidence: number }>): void;
  config(value: unknown): void;
  callCount(): number;
}

/** A repo on a feature branch with one change, and a stub judge CLI that counts its calls. */
function fixture(): Fixture {
  const root = tempDir("diff-rules-run-");
  const tools = tempDir("diff-rules-stub-");
  sh(root, "init", "-q", "-b", "main");
  write(root, "src/a.ts", "export const a = 1;\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "initial");
  sh(root, "checkout", "-q", "-b", "feature");
  write(root, "src/a.ts", "export const a = 2;\n");
  const calls = join(tools, "calls.log");
  const reply = join(tools, "reply.json");
  const stub = join(tools, "judge.mjs");
  writeFileSync(
    stub,
    `import { appendFileSync, readFileSync } from "node:fs";
readFileSync(0, "utf8");
appendFileSync(${JSON.stringify(calls)}, "call\\n");
process.stdout.write(readFileSync(${JSON.stringify(reply)}, "utf8"));
`,
  );
  writeFileSync(calls, "");
  const configPath = join(tools, "config.json");
  const result: Fixture = {
    root,
    cacheDir: join(tools, "cache"),
    calls,
    reply,
    command: `"${process.execPath}" "${stub}"`,
    setReply: (rules) => writeFileSync(reply, JSON.stringify({ rules: rules.map((rule) => ({ ...rule, evidence: `${rule.id} evidence`, files: ["src/a.ts"] })) })),
    config: (value) => writeFileSync(configPath, JSON.stringify(value)),
    callCount: () => readFileSync(calls, "utf8").split("\n").filter((line) => line.length > 0).length,
  };
  result.config({});
  return result;
}

const customRules = (overrides: Record<string, unknown> = {}) => ({
  disable: ["shotgun-surgery", "divergent-change", "duplicated-code", "scope-creep"],
  rules: [
    { id: "smell-a", question: "Is smell A present?", message: "Possibly A.", cutoff: 0.7, severity: "warn", ...overrides },
    { id: "smell-b", question: "Is smell B present?", message: "Possibly B.", cutoff: 0.7, severity: "error" },
  ],
});

function options(fx: Fixture, extra: Partial<RunOptions> = {}): RunOptions {
  return {
    cwd: fx.root,
    env: {},
    mode: "full",
    fail: false,
    json: false,
    backend: "command",
    command: fx.command,
    configPath: join(dirname(fx.calls), "config.json"),
    cacheDir: fx.cacheDir,
    ...extra,
  };
}

test("a firing warn rule reports and exits 0; an error rule or --fail exits 1", async () => {
  const fx = fixture();
  fx.config(customRules());
  fx.setReply([
    { id: "smell-a", violation: true, confidence: 0.9 },
    { id: "smell-b", violation: false, confidence: 0.9 },
  ]);
  const warnOnly = await runDiffRules(options(fx));
  assert.equal(warnOnly.exitCode, 0);
  assert.match(warnOnly.stdout, /^warn {2}smell-a {2}0\.90 >= 0\.70$/m);
  assert.match(warnOnly.stdout, /^ {2}Possibly A\.$/m);
  assert.match(warnOnly.stdout, /^ {2}evidence: smell-a evidence$/m);
  assert.match(warnOnly.stdout, /^ {2}files: src\/a\.ts$/m);
  assert.doesNotMatch(warnOnly.stdout, /smell-b {2}/);
  assert.match(warnOnly.stdout, /1 warning\(s\), 0 error\(s\)/);

  assert.equal((await runDiffRules(options(fx, { fail: true }))).exitCode, 1);

  fx.setReply([
    { id: "smell-a", violation: false, confidence: 0.9 },
    { id: "smell-b", violation: true, confidence: 0.75 },
  ]);
  fx.config(customRules({ question: "Is smell A present, really?" }));
  rmSync(fx.cacheDir, { recursive: true, force: true });
  const error = await runDiffRules(options(fx));
  assert.equal(error.exitCode, 1);
  assert.match(error.stdout, /^error {2}smell-b {2}0\.75 >= 0\.70$/m);
});

test("nothing firing exits 0 even with --fail, and --json reports every rule", async () => {
  const fx = fixture();
  fx.config(customRules());
  fx.setReply([
    { id: "smell-a", violation: false, confidence: 0.6 },
    { id: "smell-b", violation: true, confidence: 0.5 },
  ]);
  const result = await runDiffRules(options(fx, { fail: true, json: true }));
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.stdout) as { findings: Array<{ id: string; fired: boolean; probability: number }>; backend: string; base: string };
  assert.equal(report.backend, "command");
  assert.equal(report.base, "main");
  assert.deepEqual(report.findings.map((finding) => [finding.id, finding.fired]), [["smell-a", false], ["smell-b", false]]);
  assert.ok(Math.abs((report.findings[0]?.probability ?? 0) - 0.4) < 1e-9);
});

test("a re-run on the same diff is answered from the cache; message, severity, and cutoff edits keep it", async () => {
  const fx = fixture();
  fx.config(customRules());
  fx.setReply([
    { id: "smell-a", violation: true, confidence: 0.9 },
    { id: "smell-b", violation: false, confidence: 0.9 },
  ]);
  const first = await runDiffRules(options(fx));
  assert.equal(first.report?.requests, 1);
  assert.equal(fx.callCount(), 1);

  const second = await runDiffRules(options(fx));
  assert.equal(fx.callCount(), 1);
  assert.equal(second.report?.requests, 0);
  assert.equal(second.report?.cachedAnswers, 2);
  assert.equal(second.stdout.replace(/; \d+ cached/, ""), first.stdout.replace(/; \d+ cached/, ""));

  fx.config(customRules({ message: "Possibly A, reworded.", severity: "error", cutoff: 0.95 }));
  const retuned = await runDiffRules(options(fx));
  assert.equal(fx.callCount(), 1);
  assert.equal(retuned.report?.findings[0]?.fired, false);

  fx.config(customRules({ question: "Is smell A present in a new way?" }));
  const reworded = await runDiffRules(options(fx));
  assert.equal(fx.callCount(), 2);
  assert.equal(reworded.report?.cachedAnswers, 1, "the unchanged rule is still cached");

  write(fx.root, "src/a.ts", "export const a = 3;\n");
  await runDiffRules(options(fx));
  assert.equal(fx.callCount(), 3, "a different diff is a different input");
});

test("an empty diff exits 0 without asking the backend", async () => {
  const fx = fixture();
  sh(fx.root, "checkout", "-q", "--", ".");
  fx.setReply([]);
  const result = await runDiffRules(options(fx, { fail: true }));
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /no changes to judge against main/);
  assert.equal(fx.callCount(), 0);
});

test("missing credentials warn and exit 0 unless --fail or CI with ci: fail", async () => {
  const fx = fixture();
  const noKey = options(fx, { backend: "decision-model" });
  const skipped = await runDiffRules(noKey);
  assert.equal(skipped.exitCode, 0);
  assert.match(skipped.stderr, /TYPESAFE_API_KEY \(or TYPESAFE_AI_API_KEY, FACTORY_API_KEY, or AI_GATEWAY_API_KEY\) is not set; skipping diff rules/);
  assert.equal((await runDiffRules({ ...noKey, fail: true })).exitCode, 2);
  assert.equal((await runDiffRules({ ...noKey, env: { CI: "true" } })).exitCode, 0);
  fx.config({ ci: "fail" });
  assert.equal((await runDiffRules({ ...noKey, env: { CI: "true" } })).exitCode, 2);
  assert.equal((await runDiffRules({ ...noKey, env: { CI: "false" } })).exitCode, 0);
});

test("a failing backend warns, is not cached, and fails only under --fail", async () => {
  const fx = fixture();
  fx.config(customRules());
  writeFileSync(fx.reply, "not json");
  const result = await runDiffRules(options(fx));
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /command: judge reply has no JSON object/);
  assert.equal((await runDiffRules(options(fx, { fail: true }))).exitCode, 2);
  assert.equal(fx.callCount(), 2);
});

test("bad config is a usage error", async () => {
  const fx = fixture();
  fx.config({ rules: [{ id: "new-rule", question: "q?" }] });
  const result = await runDiffRules(options(fx));
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /rule "new-rule": message must be a non-empty string/);
  fx.config({ disable: ["no-such-rule"] });
  assert.match((await runDiffRules(options(fx))).stderr, /disable lists unknown rule "no-such-rule"/);
});

test("run.ts runs under plain Node with the vendored files only", async () => {
  const fx = fixture();
  fx.config(customRules());
  fx.setReply([
    { id: "smell-a", violation: true, confidence: 0.9 },
    { id: "smell-b", violation: true, confidence: 0.9 },
  ]);
  const run = join(dirname(fileURLToPath(import.meta.url)), "run.ts");
  const cli = spawnSync(
    process.execPath,
    [run, "--backend=command", "--command", fx.command, "--config", join(dirname(fx.calls), "config.json"), "--json", "--purpose", "Bump a"],
    { cwd: fx.root, encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "" } },
  );
  assert.equal(cli.status, 1, cli.stderr);
  const report = JSON.parse(cli.stdout) as { findings: Array<{ fired: boolean }> };
  assert.deepEqual(report.findings.map((finding) => finding.fired), [true, true]);
  const usage = spawnSync(process.execPath, [run, "--bogus"], { cwd: fx.root, encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /unknown argument --bogus/);
});

test("finds a TypeScript config by its default name under plain Node", async () => {
  const fx = fixture();
  write(
    fx.root,
    "anti-slop-diff-rules.config.ts",
    `const severity: "error" = "error";
export default { backend: "command", command: ${JSON.stringify(fx.command)}, ...${JSON.stringify(customRules())}, rules: [{ id: "only", question: "Q?", message: "M.", cutoff: 0.5, severity }] };
`,
  );
  fx.setReply([{ id: "only", violation: true, confidence: 0.6 }]);
  const run = join(dirname(fileURLToPath(import.meta.url)), "run.ts");
  const cli = spawnSync(process.execPath, [run], { cwd: fx.root, encoding: "utf8" });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /^error {2}only {2}0\.60 >= 0\.50$/m);
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
