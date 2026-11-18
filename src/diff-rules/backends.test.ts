// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/global-console, effecttsgo/async-function, effecttsgo/prefer-schema-over-json, effecttsgo/new-promise -- tests a standalone CLI outside any Effect runtime with Node built-ins, a local HTTP server and child processes
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FACTORY_SYSTEM_PROMPT,
  NO_JUDGE_CREDENTIALS,
  chooseBackend,
  commandBackend,
  decisionModelBackend,
  factoryDecisionURL,
  judgeReplySchema,
  llmJudgeBackend,
} from "./backends.ts";
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
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
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

async function withServer(replies: Reply[], run: (server: Awaited<ReturnType<typeof mockServer>>) => Promise<void>): Promise<void> {
  const server = await mockServer(replies);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

const rules: DiffRule[] = [
  { id: "shotgun-surgery", question: "Is it shotgun surgery?", message: "m", cutoff: 0.7, severity: "warn" },
  { id: "scope-creep", question: "Is it scope creep?", message: "m", cutoff: 0.7, severity: "warn" },
];

const input = (text: string): JudgeInput => ({ text, hash: "h", index: 0, total: 1, files: ["a.ts"] });

// --- Decision model, direct: what @ai-sdk/typesafe-ai sends to POST {baseURL}/systemone ---

const typesafe = (url: string, extra: { longContext?: boolean } = {}) =>
  decisionModelBackend({ target: { kind: "typesafe", apiKey: "sk-test", baseURL: `${url}/v1/` }, model: "jev-latest", timeoutMs: 10_000, ...extra });

const systemOneReply = (r0: unknown, r1: unknown, model: string | null = "jev-1.14.0"): Reply => ({
  body: { ...(model === null ? {} : { model }), answers: { r0, r1 }, usage: { input_tokens: 10, output_tokens: 1 } },
});

test("decision model: sends TypeSafe's systemOne request through experimental_decide and reads noul probabilities", async () => {
  await withServer([systemOneReply({ type: "noul", noul: 0.91 }, { type: "noul", noul: 0.05 })], async (server) => {
    const answers = await typesafe(server.url).ask(rules, input("small diff"));
    assert.deepEqual(answers, [
      { id: "shotgun-surgery", probability: 0.91, model: "jev-1.14.0" },
      { id: "scope-creep", probability: 0.05, model: "jev-1.14.0" },
    ]);
    const [request] = server.requests;
    assert.equal(server.requests.length, 1);
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, "/v1/systemone");
    assert.equal(request?.headers.authorization, "Bearer sk-test");
    assert.equal(request?.headers["content-type"], "application/json");
    assert.equal(request?.headers["typesafe-danger-zone-long-context"], undefined);
    assert.match(String(request?.headers["user-agent"]), /\bai\/7\.0\.173\b/);
    assert.deepEqual(request?.body, {
      model: "jev-latest",
      state: "small diff",
      questions: {
        r0: { type: "noul", instructions: "Is it shotgun surgery?" },
        r1: { type: "noul", instructions: "Is it scope creep?" },
      },
    });
  });
});

test("decision model: longContext sends TypeSafe's long-context header", async () => {
  await withServer([systemOneReply({ type: "noul", noul: 0.2 }, { type: "noul", noul: 0.3 })], async (server) => {
    await typesafe(server.url, { longContext: true }).ask(rules, input("d"));
    assert.equal(server.requests[0]?.headers["typesafe-danger-zone-long-context"], "true");
  });
});

test("decision model: reports the requested model when the response names none", async () => {
  await withServer([systemOneReply({ type: "noul", noul: 0.2 }, { type: "noul", noul: 0.3 }, null)], async (server) => {
    const answers = await typesafe(server.url).ask(rules, input("d"));
    assert.equal(answers[0]?.model, "jev-latest");
  });
});

test("decision model: rejects malformed responses", async () => {
  const cases: Array<[Reply, RegExp]> = [
    [{ body: { model: "m" } }, /Invalid JSON response/],
    [systemOneReply({ type: "noul", noul: 0.1 }, undefined), /exactly one answer for every question/],
    [systemOneReply({ type: "noul", noul: 1.5 }, { type: "noul", noul: 0.1 }), /Question "r0" must return P\(true\) as a finite probability in \[0, 1\]/],
    [systemOneReply({ type: "noul", noul: "high" }, { type: "noul", noul: 0.1 }), /Invalid JSON response/],
    [{ body: "<html>oops</html>" }, /Invalid JSON response/],
    [{ status: 401, body: { error: { message: "invalid api key" } } }, /^Error: http 401: invalid api key$/],
  ];
  for (const [reply, expected] of cases) {
    await withServer([reply], async (server) => {
      await assert.rejects(typesafe(server.url).ask(rules, input("d")), expected);
      assert.equal(server.requests.length, 1, `no retry for ${JSON.stringify(reply.body)}`);
    });
  }
});

test("decision model: the AI SDK retries 5xx and 429, honoring retry-after-ms", async () => {
  await withServer(
    [
      { status: 503, headers: { "retry-after-ms": "0" }, body: { error: "busy" } },
      { status: 429, headers: { "retry-after-ms": "0" }, body: { error: "slow down" } },
      systemOneReply({ type: "noul", noul: 0.8 }, { type: "noul", noul: 0.1 }),
    ],
    async (server) => {
      const answers = await typesafe(server.url).ask(rules, input("d"));
      assert.equal(answers[0]?.probability, 0.8);
      assert.equal(server.requests.length, 3);
    },
  );
  await withServer([{ status: 503, headers: { "retry-after-ms": "0" }, body: { error: "busy" } }], async (server) => {
    await assert.rejects(typesafe(server.url).ask(rules, input("d")), /^Error: http 503: busy \(after 3 attempts\)$/);
    assert.equal(server.requests.length, 3);
  });
});

test("decision model: the Factory target posts TypeSafe's request to Factory's decision route with the Factory key", async () => {
  await withServer([systemOneReply({ type: "noul", noul: 0.4 }, { type: "noul", noul: 0.6 })], async (server) => {
    const backend = decisionModelBackend({
      target: { kind: "factory", apiKey: "fk-test", baseURL: factoryDecisionURL(`${server.url}/`) },
      model: "jev-latest",
      timeoutMs: 10_000,
    });
    assert.equal(backend.identity, `decision-model factory ${server.url}/api/llm/decision/v1`);
    const answers = await backend.ask(rules, input("factory diff"));
    assert.deepEqual(answers.map((answer) => answer.probability), [0.4, 0.6]);
    const [request] = server.requests;
    assert.equal(request?.url, "/api/llm/decision/v1/systemone");
    assert.equal(request?.headers.authorization, "Bearer fk-test");
    assert.deepEqual((request?.body as { state: unknown }).state, "factory diff");
  });
});

// --- Decision model through AI Gateway: what @ai-sdk/gateway sends to POST {baseURL}/decision-model ---

test("decision model: the gateway target posts the SDK's neutral questions with the gateway model id", async () => {
  const reply: Reply = {
    body: {
      model: "typesafe-ai/jev-1.14.0",
      answers: { r0: { type: "boolean", probability: 0.66 }, r1: { type: "boolean", probability: 0.1 } },
    },
  };
  await withServer([reply], async (server) => {
    const backend = decisionModelBackend({ target: { kind: "gateway", apiKey: "gw-key", baseURL: server.url }, model: "typesafe-ai/jev", timeoutMs: 10_000 });
    const answers = await backend.ask(rules, input("gateway diff"));
    assert.deepEqual(answers.map((answer) => [answer.probability, answer.model]), [
      [0.66, "typesafe-ai/jev-1.14.0"],
      [0.1, "typesafe-ai/jev-1.14.0"],
    ]);
    const [request] = server.requests;
    assert.equal(request?.url, "/decision-model");
    assert.equal(request?.headers.authorization, "Bearer gw-key");
    assert.equal(request?.headers["ai-model-id"], "typesafe-ai/jev");
    assert.deepEqual(request?.body, {
      providerOptions: {},
      stateParts: [{ type: "text", text: "gateway diff" }],
      questions: {
        r0: { type: "boolean", instructions: "Is it shotgun surgery?" },
        r1: { type: "boolean", instructions: "Is it scope creep?" },
      },
    });
  });
});

// --- LLM judge: generateText with Output.object ---

const chatReply = (content: string, model = "gpt-test-2025"): Reply => ({
  body: {
    id: "c",
    object: "chat.completion",
    created: 1,
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  },
});

const verdicts = JSON.stringify({
  rules: [
    { id: "shotgun-surgery", violation: true, confidence: 0.9, evidence: "Same flag added in 4 modules", files: ["a.ts", "b.ts"] },
    { id: "scope-creep", violation: false, confidence: 0.8, evidence: "", files: [] },
  ],
});

const compatible = (url: string, extra: { apiKey?: string; structuredOutputs?: boolean } = {}) =>
  llmJudgeBackend({
    target: { kind: "openai-compatible", baseURL: `${url}/v1`, structuredOutputs: extra.structuredOutputs ?? true, ...(extra.apiKey === undefined ? {} : { apiKey: extra.apiKey }) },
    model: "judge-model",
    timeoutMs: 10_000,
  });

test("llm judge: posts a chat completion with the reply's JSON schema and converts confidence", async () => {
  await withServer([chatReply(verdicts)], async (server) => {
    const answers = await compatible(server.url, { apiKey: "sk-judge" }).ask(rules, input("the diff text"));
    assert.equal(answers[0]?.probability, 0.9);
    assert.equal(answers[0]?.evidence, "Same flag added in 4 modules");
    assert.deepEqual(answers[0]?.files, ["a.ts", "b.ts"]);
    assert.equal(answers[0]?.model, "gpt-test-2025");
    assert.ok(Math.abs((answers[1]?.probability ?? 0) - 0.2) < 1e-9);
    assert.equal(answers[1]?.evidence, undefined);
    const [request] = server.requests;
    assert.equal(request?.url, "/v1/chat/completions");
    assert.equal(request?.headers.authorization, "Bearer sk-judge");
    const body = request?.body as {
      model: string;
      temperature: number;
      response_format: unknown;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.model, "judge-model");
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, {
      type: "json_schema",
      json_schema: { schema: judgeReplySchema(rules), strict: true, name: "diff_rules" },
    });
    assert.deepEqual(body.messages.map((message) => message.role), ["system", "user"]);
    const prompt = body.messages.at(-1)?.content ?? "";
    assert.ok(prompt.includes("- shotgun-surgery: Is it shotgun surgery?"));
    assert.ok(prompt.endsWith("the diff text"));
  });
});

test("llm judge: structuredOutputs false asks for a json_object only", async () => {
  await withServer([chatReply(verdicts)], async (server) => {
    await compatible(server.url, { structuredOutputs: false }).ask(rules, input("d"));
    const body = server.requests[0]?.body as { response_format: unknown };
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(server.requests[0]?.headers.authorization, undefined);
  });
});

test("llm judge: rejects malformed replies", async () => {
  const cases: Array<[Reply, RegExp]> = [
    [chatReply("I think it is fine."), /could not parse the response/],
    [chatReply(JSON.stringify({ rules: [{ id: "shotgun-surgery", violation: true, confidence: 0.9 }] })), /no answer for "scope-creep"/],
    [chatReply(JSON.stringify({ rules: [{ id: "shotgun-surgery", violation: "yes", confidence: 0.9 }, { id: "scope-creep", violation: false, confidence: 1 }] })), /no boolean violation/],
    [chatReply(JSON.stringify({ rules: [{ id: "shotgun-surgery", violation: true, confidence: 90 }, { id: "scope-creep", violation: false, confidence: 1 }] })), /no confidence in \[0, 1\]/],
    [chatReply(JSON.stringify({ rules: [{ id: "shotgun-surgery", violation: true, confidence: 0.9, files: "a.ts" }, { id: "scope-creep", violation: false, confidence: 1 }] })), /files that are not a list/],
    [chatReply(JSON.stringify({ verdicts: [] })), /no rules list/],
    [{ body: { id: "c", model: "m", choices: [] } }, /Response did not contain any choices/],
    [{ status: 400, body: { error: { message: "bad model" } } }, /^Error: http 400: bad model$/],
  ];
  for (const [reply, expected] of cases) {
    await withServer([reply], async (server) => {
      await assert.rejects(compatible(server.url).ask(rules, input("d")), expected);
    });
  }
});

test("llm judge: the gateway target posts to the gateway's language-model endpoint", async () => {
  const reply: Reply = {
    body: {
      content: [{ type: "text", text: verdicts }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    },
  };
  await withServer([reply], async (server) => {
    const backend = llmJudgeBackend({ target: { kind: "gateway", apiKey: "gw-key", baseURL: server.url }, model: "openai/gpt-5-mini", timeoutMs: 10_000 });
    const answers = await backend.ask(rules, input("d"));
    assert.equal(answers[0]?.probability, 0.9);
    assert.equal(answers[0]?.model, "openai/gpt-5-mini");
    const [request] = server.requests;
    assert.equal(request?.url, "/language-model");
    assert.equal(request?.headers.authorization, "Bearer gw-key");
    assert.equal(request?.headers["ai-language-model-id"], "openai/gpt-5-mini");
    const body = request?.body as { responseFormat: unknown; temperature: number };
    assert.deepEqual(body.responseFormat, { type: "json", schema: judgeReplySchema(rules), name: "diff_rules" });
    assert.equal(body.temperature, 0);
  });
});

test("llm judge: the Factory target posts Anthropic messages with the Droid system prompt and a client version", async () => {
  const reply: Reply = {
    body: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-test-1",
      content: [{ type: "text", text: verdicts }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  };
  await withServer([reply], async (server) => {
    const backend = llmJudgeBackend({
      target: { kind: "factory", apiKey: "fk-test", baseURL: `${server.url}/`, clientVersion: "9.9.9" },
      model: "claude-test",
      timeoutMs: 10_000,
    });
    assert.equal(backend.identity, `llm-judge factory ${server.url}`);
    const answers = await backend.ask(rules, input("the diff text"));
    assert.equal(answers[0]?.probability, 0.9);
    assert.equal(answers[0]?.model, "claude-test-1");
    const [request] = server.requests;
    assert.equal(request?.url, "/api/llm/a/v1/messages");
    assert.equal(request?.headers.authorization, "Bearer fk-test");
    assert.equal(request?.headers["x-client-version"], "9.9.9");
    const body = request?.body as { model: string; system: Array<{ type: string; text: string }> };
    assert.equal(body.model, "claude-test");
    // Factory's proxy reads only the first system block and requires it to start with the Droid prompt.
    assert.ok(body.system[0]?.text.startsWith(FACTORY_SYSTEM_PROMPT), JSON.stringify(body.system));
  });
});

// --- Command backend ---

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
    assert.ok(readFileSync(seen, "utf8").endsWith("PROMPT-BODY"));
    assert.equal((await run("wrapped"))[0]?.probability, 0.9);
    await assert.rejects(run("fail"), /exited with 3: judge crashed/);
    await assert.rejects(run("garbage"), /no JSON object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vendored without the AI SDK: the command backend works and the SDK backends name the missing packages", async () => {
  // A copy outside this repository resolves no node_modules, as in a consumer that skipped the AI SDK.
  const dir = mkdtempSync(join(tmpdir(), "diff-rules-vendored-"));
  try {
    cpSync(dirname(fileURLToPath(import.meta.url)), join(dir, "diff-rules"), { recursive: true, filter: (path) => !path.endsWith(".test.ts") });
    const script = join(dir, "probe.mjs");
    const reply = join(dir, "reply.json");
    writeFileSync(reply, verdicts);
    writeFileSync(
      script,
      `import { commandBackend, decisionModelBackend, llmJudgeBackend } from "./diff-rules/backends.ts";
const rules = ${JSON.stringify(rules)};
const input = { text: "d", hash: "h", index: 0, total: 1, files: [] };
const command = await commandBackend({ command: ${JSON.stringify(`cat "${reply}"`)}, timeoutMs: 10000 }).ask(rules, input);
const errors = [];
for (const backend of [
  decisionModelBackend({ target: { kind: "typesafe", apiKey: "k", baseURL: "http://127.0.0.1:9" }, model: "jev-latest", timeoutMs: 1000 }),
  llmJudgeBackend({ target: { kind: "gateway", apiKey: "k" }, model: "openai/x", timeoutMs: 1000 }),
]) {
  try { await backend.ask(rules, input); errors.push("no error"); } catch (error) { errors.push(error.message); }
}
console.log(JSON.stringify({ probability: command[0].probability, errors }));
`,
    );
    const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout) as { probability: number; errors: string[] };
    assert.equal(out.probability, 0.9);
    assert.deepEqual(out.errors, [
      "the decision-model backend needs ai zod; install them with `npm install --save-dev ai zod`",
      "the llm-judge backend needs ai zod; install them with `npm install --save-dev ai zod`",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Choosing a backend ---

test("chooseBackend: picks the first configured backend and explains missing credentials", async () => {
  const config = resolveConfig({});
  const none = chooseBackend(undefined, config, {}, {});
  assert.deepEqual(none, { ok: false, name: "decision-model", reason: NO_JUDGE_CREDENTIALS });
  for (const option of ["TYPESAFE_API_KEY", "FACTORY_API_KEY", "AI_GATEWAY_API_KEY", "LLM_JUDGE_BASE_URL", "ANTI_SLOP_DIFF_RULES_COMMAND"]) {
    assert.ok(NO_JUDGE_CREDENTIALS.includes(option), option);
  }
  const requestedNone = chooseBackend("decision-model", config, {}, {});
  assert.deepEqual(requestedNone, { ok: false, name: "decision-model", reason: "TYPESAFE_API_KEY (or TYPESAFE_AI_API_KEY, FACTORY_API_KEY, or AI_GATEWAY_API_KEY) is not set" });
  const jev = chooseBackend(undefined, config, { TYPESAFE_API_KEY: "k", TYPESAFE_DEFAULT_MODEL: "jev-1.13.0" }, {});
  assert.ok(jev.ok && jev.backend.name === "decision-model" && jev.backend.model === "jev-1.13.0");
  assert.equal(jev.ok && jev.backend.identity, "decision-model typesafe https://api.typesafe.ai/v1");
  const aiKey = chooseBackend(undefined, config, { TYPESAFE_AI_API_KEY: "k", TYPESAFE_AI_BASE_URL: "http://proxy/v1" }, {});
  assert.equal(aiKey.ok && aiKey.backend.identity, "decision-model typesafe http://proxy/v1");
  const legacy = chooseBackend(undefined, config, { TYPESAFE_API_KEY: "k", TYPESAFE_BASE_URL: "http://proxy/" }, {});
  assert.equal(legacy.ok && legacy.backend.identity, "decision-model typesafe http://proxy/v1");
  const long = chooseBackend(undefined, resolveConfig({ longContext: true }), { TYPESAFE_API_KEY: "k" }, {});
  assert.equal(long.ok && long.backend.identity, "decision-model typesafe https://api.typesafe.ai/v1 long-context");

  const viaGateway = chooseBackend(undefined, config, { AI_GATEWAY_API_KEY: "g" }, {});
  assert.ok(viaGateway.ok && viaGateway.backend.name === "decision-model" && viaGateway.backend.model === "typesafe-ai/jev");
  const gatewayPinned = chooseBackend(undefined, config, { AI_GATEWAY_API_KEY: "g" }, { model: "jev-1.13.0" });
  assert.equal(gatewayPinned.ok && gatewayPinned.backend.model, "typesafe-ai/jev-1.13.0");
  const typesafeWins = chooseBackend(undefined, config, { AI_GATEWAY_API_KEY: "g", TYPESAFE_API_KEY: "k" }, {});
  assert.ok(typesafeWins.ok && typesafeWins.backend.identity.startsWith("decision-model typesafe"));

  const factory = chooseBackend(undefined, config, { FACTORY_API_KEY: "fk", AI_GATEWAY_API_KEY: "g" }, {});
  assert.ok(factory.ok && factory.backend.name === "decision-model" && factory.backend.model === "jev-latest");
  assert.equal(factory.ok && factory.backend.identity, "decision-model factory https://api.factory.ai/api/llm/decision/v1");
  const factoryHost = chooseBackend(undefined, config, { FACTORY_API_KEY: "fk", FACTORY_API_BASE_URL: "https://dev.api.factory.ai/" }, {});
  assert.equal(factoryHost.ok && factoryHost.backend.identity, "decision-model factory https://dev.api.factory.ai/api/llm/decision/v1");
  const typesafeOverFactory = chooseBackend(undefined, config, { FACTORY_API_KEY: "fk", TYPESAFE_API_KEY: "k" }, {});
  assert.ok(typesafeOverFactory.ok && typesafeOverFactory.backend.identity.startsWith("decision-model typesafe"));
  const factoryPinned = chooseBackend(undefined, config, { FACTORY_API_KEY: "fk" }, { model: "jev-1.13.0" });
  assert.equal(factoryPinned.ok, false);
  assert.ok(!factoryPinned.ok && factoryPinned.reason.includes("jev-1.13.0"));
  const factoryJudge = chooseBackend(undefined, config, { FACTORY_API_KEY: "fk", AI_GATEWAY_API_KEY: "g", LLM_JUDGE_MODEL: "claude-sonnet-4-5-20250929" }, {});
  assert.ok(factoryJudge.ok && factoryJudge.backend.name === "llm-judge" && factoryJudge.backend.identity === "llm-judge factory https://api.factory.ai");

  const judge = chooseBackend(undefined, config, { LLM_JUDGE_BASE_URL: "http://x", LLM_JUDGE_MODEL: "m" }, {});
  assert.ok(judge.ok && judge.backend.name === "llm-judge" && judge.backend.identity === "llm-judge openai-compatible http://x");
  const jsonObject = chooseBackend("llm-judge", config, { LLM_JUDGE_BASE_URL: "http://x", LLM_JUDGE_MODEL: "m", LLM_JUDGE_STRUCTURED_OUTPUTS: "false" }, {});
  assert.equal(jsonObject.ok && jsonObject.backend.identity, "llm-judge openai-compatible http://x json-object");
  const gatewayJudge = chooseBackend(undefined, config, { AI_GATEWAY_API_KEY: "g", LLM_JUDGE_MODEL: "anthropic/claude-sonnet-4.5" }, {});
  assert.ok(gatewayJudge.ok && gatewayJudge.backend.name === "llm-judge" && gatewayJudge.backend.identity === "llm-judge gateway default");
  const noModel = chooseBackend("llm-judge", config, { LLM_JUDGE_BASE_URL: "http://x" }, {});
  assert.deepEqual(noModel, { ok: false, name: "llm-judge", reason: "LLM_JUDGE_MODEL is not set" });
  const noJudge = chooseBackend("llm-judge", config, { LLM_JUDGE_MODEL: "m" }, {});
  assert.deepEqual(noJudge, { ok: false, name: "llm-judge", reason: "LLM_JUDGE_BASE_URL, FACTORY_API_KEY, or AI_GATEWAY_API_KEY is not set" });

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
