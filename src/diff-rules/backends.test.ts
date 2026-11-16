// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/async-function, effecttsgo/prefer-schema-over-json, effecttsgo/new-promise
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { chooseBackend, commandBackend, decisionModelBackend, llmJudgeBackend } from "./backends.ts";
import { resolveConfig } from "./config.ts";
import type { JudgeInput } from "./input.ts";
import type { DiffRule } from "./rules.ts";

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, run: () => Promise<void>): void => {
  tests.push([name, run]);
};

interface Captured {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

interface Reply {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body: unknown;
}

/** A local HTTP server that records requests and answers from `replies` in order. */
async function mockServer(replies: Reply[]): Promise<{ url: string; requests: Captured[]; close: () => Promise<void> }> {
  const requests: Captured[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks);
      const text = request.headers["content-encoding"] === "zstd" ? zstdDecompressSync(raw).toString("utf8") : raw.toString("utf8");
      requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: JSON.parse(text) });
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)] ?? { status: 500, body: "no reply" };
      response.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers });
      response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const rules: DiffRule[] = [
  { id: "shotgun-surgery", question: "Is it shotgun surgery?", message: "m", cutoff: 0.7, severity: "warn" },
  { id: "scope-creep", question: "Is it scope creep?", message: "m", cutoff: 0.7, severity: "warn" },
];

const input = (text: string): JudgeInput => ({ text, hash: "h", index: 0, total: 1, files: ["a.ts"] });

const systemOneRequestFor = (state: string): unknown => ({
  state,
  questions: {
    r0: { type: "noul", instructions: "Is it shotgun surgery?" },
    r1: { type: "noul", instructions: "Is it scope creep?" },
  },
  model: "jev-latest",
});

const systemOneReply = (r0: unknown, r1: unknown, model = "jev-2025-06-01"): Reply => ({
  body: { model, answers: { r0, r1 }, usage: { input_tokens: 10, output_tokens: 1 } },
});

test("decision model: sends the SDK's systemOne wire format and reads noul probabilities", async () => {
  const server = await mockServer([systemOneReply({ type: "noul", noul: 0.91 }, { type: "noul", noul: 0.05 })]);
  try {
    const backend = decisionModelBackend({ apiKey: "sk-test", baseURL: `${server.url}/`, model: "jev-latest", timeoutMs: 5000 });
    const answers = await backend.ask(rules, input("small diff"));
    assert.deepEqual(answers, [
      { id: "shotgun-surgery", probability: 0.91, model: "jev-2025-06-01" },
      { id: "scope-creep", probability: 0.05, model: "jev-2025-06-01" },
    ]);
    const [request] = server.requests;
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, "/v1/systemone");
    assert.equal(request?.headers.authorization, "Bearer sk-test");
    assert.equal(request?.headers["content-type"], "application/json");
    assert.equal(request?.headers.accept, "application/json");
    assert.equal(request?.headers["content-encoding"], undefined);
    assert.deepEqual(request?.body, {
      state: "small diff",
      questions: {
        r0: { type: "noul", instructions: "Is it shotgun surgery?" },
        r1: { type: "noul", instructions: "Is it scope creep?" },
      },
      model: "jev-latest",
    });
  } finally {
    await server.close();
  }
});

test("decision model: compresses bodies of 1 KiB or more with zstd, as the SDK does", async () => {
  const server = await mockServer([systemOneReply({ noul: 0.2 }, { noul: 0.3 })]);
  try {
    const backend = decisionModelBackend({ apiKey: "k", baseURL: server.url, model: "jev-latest", timeoutMs: 5000 });
    await backend.ask(rules, input("x".repeat(4000)));
    assert.equal(server.requests[0]?.headers["content-encoding"], "zstd");
    assert.deepEqual(server.requests[0]?.body, systemOneRequestFor("x".repeat(4000)));
  } finally {
    await server.close();
  }
});

test("decision model: rejects malformed responses", async () => {
  const cases: Array<[Reply, RegExp]> = [
    [{ body: { answers: { r0: { noul: 0.1 }, r1: { noul: 0.1 } } } }, /no model/],
    [{ body: { model: "m" } }, /no answers object/],
    [systemOneReply({ noul: 0.1 }, undefined), /no probability in \[0, 1\] for "scope-creep"/],
    [systemOneReply({ noul: 1.5 }, { noul: 0.1 }), /no probability in \[0, 1\] for "shotgun-surgery"/],
    [{ body: "<html>oops</html>" }, /not JSON/],
    [{ status: 401, body: { error: { message: "invalid api key" } } }, /http 401: invalid api key/],
  ];
  for (const [reply, expected] of cases) {
    const server = await mockServer([reply]);
    try {
      const backend = decisionModelBackend({ apiKey: "k", baseURL: server.url, model: "jev-latest", timeoutMs: 5000 });
      await assert.rejects(backend.ask(rules, input("d")), expected);
    } finally {
      await server.close();
    }
  }
});

test("decision model: retries 5xx and 429 with the retry count header", async () => {
  const server = await mockServer([
    { status: 503, headers: { "retry-after-ms": "0" }, body: { error: "busy" } },
    { status: 429, headers: { "retry-after-ms": "0" }, body: { error: "slow down" } },
    systemOneReply({ noul: 0.8 }, { noul: 0.1 }),
  ]);
  try {
    const backend = decisionModelBackend({ apiKey: "k", baseURL: server.url, model: "jev-latest", timeoutMs: 5000 });
    const answers = await backend.ask(rules, input("d"));
    assert.equal(answers[0]?.probability, 0.8);
    assert.deepEqual(server.requests.map((request) => request.headers["x-typesafe-retry-count"]), [undefined, "1", "2"]);
  } finally {
    await server.close();
  }
});

const judgeReply = (content: string, model = "gpt-test-2025"): Reply => ({
  body: { id: "c", model, choices: [{ index: 0, message: { role: "assistant", content } }] },
});

const verdicts = JSON.stringify({
  rules: [
    { id: "shotgun-surgery", violation: true, confidence: 0.9, evidence: "Same flag added in 4 modules", files: ["a.ts", "b.ts"] },
    { id: "scope-creep", violation: false, confidence: 0.8, evidence: "", files: [] },
  ],
});

test("llm judge: posts an OpenAI-compatible chat completion and converts confidence", async () => {
  const server = await mockServer([judgeReply(`Here you go:\n\`\`\`json\n${verdicts}\n\`\`\``)]);
  try {
    const backend = llmJudgeBackend({ baseURL: `${server.url}/v1`, apiKey: "sk-judge", model: "judge-model", timeoutMs: 5000 });
    const answers = await backend.ask(rules, input("the diff text"));
    assert.equal(answers[0]?.probability, 0.9);
    assert.equal(answers[0]?.evidence, "Same flag added in 4 modules");
    assert.deepEqual(answers[0]?.files, ["a.ts", "b.ts"]);
    assert.equal(answers[0]?.model, "gpt-test-2025");
    assert.ok(Math.abs((answers[1]?.probability ?? 0) - 0.2) < 1e-9);
    assert.equal(answers[1]?.evidence, undefined);
    const [request] = server.requests;
    assert.equal(request?.url, "/v1/chat/completions");
    assert.equal(request?.headers.authorization, "Bearer sk-judge");
    const body = request?.body as { model: string; temperature: number; messages: Array<{ role: string; content: string }> };
    assert.equal(body.model, "judge-model");
    assert.equal(body.temperature, 0);
    const prompt = body.messages.at(-1)?.content ?? "";
    assert.ok(prompt.includes("- shotgun-surgery: Is it shotgun surgery?"));
    assert.ok(prompt.endsWith("the diff text"));
  } finally {
    await server.close();
  }
});

test("llm judge: rejects malformed replies", async () => {
  const cases: Array<[Reply, RegExp]> = [
    [judgeReply("I think it is fine."), /no JSON object/],
    [judgeReply(JSON.stringify({ rules: [{ id: "shotgun-surgery", violation: true, confidence: 0.9 }] })), /no answer for "scope-creep"/],
    [judgeReply(JSON.stringify({ rules: [{ id: "shotgun-surgery", violation: "yes", confidence: 0.9 }, { id: "scope-creep", violation: false, confidence: 1 }] })), /no boolean violation/],
    [judgeReply(JSON.stringify({ rules: [{ id: "shotgun-surgery", violation: true, confidence: 90 }, { id: "scope-creep", violation: false, confidence: 1 }] })), /no confidence in \[0, 1\]/],
    [judgeReply(JSON.stringify({ rules: [{ id: "shotgun-surgery", violation: true, confidence: 0.9, files: "a.ts" }, { id: "scope-creep", violation: false, confidence: 1 }] })), /files that are not a list/],
    [judgeReply(JSON.stringify({ verdicts: [] })), /no rules list/],
    [{ body: { choices: [] } }, /no message content/],
  ];
  for (const [reply, expected] of cases) {
    const server = await mockServer([reply]);
    try {
      const backend = llmJudgeBackend({ baseURL: server.url, model: "m", timeoutMs: 5000 });
      await assert.rejects(backend.ask(rules, input("d")), expected);
      assert.equal(server.requests[0]?.headers.authorization, undefined);
    } finally {
      await server.close();
    }
  }
});

test("command: pipes the prompt to the CLI and parses its stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "diff-rules-cmd-"));
  try {
    const stub = join(dir, "judge.mjs");
    const seen = join(dir, "prompt.txt");
    writeFileSync(
      stub,
      `import { readFileSync, writeFileSync } from "node:fs";
const prompt = readFileSync(0, "utf8");
writeFileSync(${JSON.stringify(seen)}, prompt);
const mode = process.argv[2];
if (mode === "fail") { console.error("judge crashed"); process.exit(3); }
if (mode === "garbage") { console.log("no json here"); process.exit(0); }
if (mode === "wrapped") { console.log(JSON.stringify({ type: "result", result: ${JSON.stringify(verdicts)} })); process.exit(0); }
console.log("Thinking...\\n" + ${JSON.stringify(verdicts)});
`,
    );
    const run = (mode: string) =>
      commandBackend({ command: `"${process.execPath}" "${stub}" ${mode}`, timeoutMs: 10_000 }).ask(rules, input("PROMPT-BODY"));
    const answers = await run("ok");
    assert.equal(answers[0]?.probability, 0.9);
    assert.ok((await import("node:fs")).readFileSync(seen, "utf8").endsWith("PROMPT-BODY"));
    assert.equal((await run("wrapped"))[0]?.probability, 0.9);
    await assert.rejects(run("fail"), /exited with 3: judge crashed/);
    await assert.rejects(run("garbage"), /no JSON object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chooseBackend: picks the first configured backend and explains missing credentials", async () => {
  const config = resolveConfig({});
  const none = chooseBackend(undefined, config, {}, {});
  assert.deepEqual(none, { ok: false, name: "decision-model", reason: "TYPESAFE_API_KEY is not set" });
  const jev = chooseBackend(undefined, config, { TYPESAFE_API_KEY: "k", TYPESAFE_DEFAULT_MODEL: "jev-2025-06-01" }, {});
  assert.ok(jev.ok && jev.backend.name === "decision-model" && jev.backend.model === "jev-2025-06-01");
  const judge = chooseBackend(undefined, config, { LLM_JUDGE_BASE_URL: "http://x", LLM_JUDGE_MODEL: "m" }, {});
  assert.ok(judge.ok && judge.backend.name === "llm-judge");
  const noModel = chooseBackend("llm-judge", config, { LLM_JUDGE_BASE_URL: "http://x" }, {});
  assert.deepEqual(noModel, { ok: false, name: "llm-judge", reason: "LLM_JUDGE_MODEL is not set" });
  const command = chooseBackend(undefined, resolveConfig({ command: "claude -p" }), {}, {});
  assert.ok(command.ok && command.backend.name === "command" && command.backend.model === "claude -p");
  const pinned = chooseBackend("decision-model", resolveConfig({ model: "jev-old" }), { TYPESAFE_API_KEY: "k" }, { model: "jev-cli" });
  assert.ok(pinned.ok && pinned.backend.model === "jev-cli");
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
if (failed > 0) process.exit(1);
