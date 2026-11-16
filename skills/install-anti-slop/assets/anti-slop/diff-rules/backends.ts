// A standalone CLI outside any Effect runtime, so Effect's platform services do not apply.
// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/prefer-schema-over-json, effecttsgo/async-function, effecttsgo/global-fetch, effecttsgo/global-timers, effecttsgo/new-promise, effecttsgo/global-date

import { spawn } from "node:child_process";
import * as zlib from "node:zlib";
import type { BackendName, ResolvedConfig } from "./config.ts";
import { renderJudgePrompt, type JudgeInput } from "./input.ts";
import type { DiffRule } from "./rules.ts";

export interface RuleAnswer {
  readonly id: string;
  /** Probability (decision model) or confidence-derived probability (LLM judge) of YES. */
  readonly probability: number;
  readonly evidence?: string;
  readonly files?: ReadonlyArray<string>;
  /** The model that answered, as the backend reports it. */
  readonly model: string;
}

export interface Backend {
  readonly name: BackendName;
  /** Backend identity for the cache key: name plus endpoint or command. */
  readonly identity: string;
  /** The requested model or command; answers report the model that actually answered. */
  readonly model: string;
  ask(rules: ReadonlyArray<DiffRule>, input: JudgeInput): Promise<ReadonlyArray<RuleAnswer>>;
}

export type BackendChoice =
  | { readonly ok: true; readonly backend: Backend }
  | { readonly ok: false; readonly name: BackendName; readonly reason: string };

type Env = Readonly<Record<string, string | undefined>>;

const envValue = (env: Env, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const stripSlashes = (url: string): string => url.replace(/\/+$/, "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const RETRY_STATUSES = new Set([408, 429]);
const MAX_RETRIES = 2;

function retryAfterMs(headers: Headers): number | undefined {
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
  const seconds = Number(headers.get("retry-after"));
  if (headers.has("retry-after") && Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}

function describeError(status: number, body: string): string {
  try {
    const json: unknown = JSON.parse(body);
    if (isRecord(json)) {
      const { error, message, detail } = json;
      if (typeof error === "string") return `http ${status}: ${error}`;
      if (isRecord(error) && typeof error.message === "string") return `http ${status}: ${error.message}`;
      if (typeof message === "string") return `http ${status}: ${message}`;
      if (typeof detail === "string") return `http ${status}: ${detail}`;
    }
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return `http ${status}: ${body.slice(0, 200) || "(no body)"}`;
}

/** POST JSON with the TypeSafe SDK's retry policy: 408, 429, 5xx, and connection errors. */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: string | Uint8Array<ArrayBuffer>,
  timeoutMs: number,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: attempt === 0 ? headers : { ...headers, "X-TypeSafe-Retry-Count": String(attempt) },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt >= MAX_RETRIES) throw new Error(`network: ${messageOf(error)}`, { cause: error });
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`response is not JSON: ${text.slice(0, 200)}`, { cause: error });
      }
    }
    const retryable = RETRY_STATUSES.has(response.status) || response.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) throw new Error(describeError(response.status, text));
    const delay = retryAfterMs(response.headers);
    await sleep(delay !== undefined && delay <= 60_000 ? delay : Math.min(500 * 2 ** attempt, 5000));
  }
}

// --- Decision model: TypeSafe Jev's systemOne endpoint ---

export const TYPESAFE_DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";

const questionRef = (index: number): string => `r${index}`;

/** The `POST /v1/systemone` body the official SDK sends for noul (yes/no) questions. */
export function systemOneRequest(model: string, rules: ReadonlyArray<DiffRule>, input: JudgeInput): unknown {
  return {
    state: input.text,
    questions: Object.fromEntries(
      rules.map((rule, index) => [questionRef(index), { type: "noul", instructions: rule.question }]),
    ),
    model,
  };
}

export function parseSystemOneResponse(json: unknown, rules: ReadonlyArray<DiffRule>): RuleAnswer[] {
  if (!isRecord(json)) throw new Error("decision model response is not an object");
  const { model, answers } = json;
  if (typeof model !== "string" || model.length === 0) throw new Error("decision model response has no model");
  if (!isRecord(answers)) throw new Error("decision model response has no answers object");
  return rules.map((rule, index) => {
    const answer = answers[questionRef(index)];
    const noul = isRecord(answer) ? answer.noul : undefined;
    if (typeof noul !== "number" || !(noul >= 0 && noul <= 1)) {
      throw new Error(`decision model response has no probability in [0, 1] for "${rule.id}"`);
    }
    return { id: rule.id, probability: noul, model };
  });
}

// The SDK compresses bodies of 1 KiB or more; smaller ones fit in one TCP segment anyway.
const COMPRESS_FROM_BYTES = 1024;

export function decisionModelBackend(options: {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly model: string;
  readonly timeoutMs: number;
}): Backend {
  const baseURL = stripSlashes(options.baseURL);
  return {
    name: "decision-model",
    identity: `decision-model ${baseURL}`,
    model: options.model,
    async ask(rules, input) {
      const json = JSON.stringify(systemOneRequest(options.model, rules, input));
      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "anti-slop-diff-rules",
      };
      let body: string | Uint8Array<ArrayBuffer> = json;
      if (Buffer.byteLength(json) >= COMPRESS_FROM_BYTES && typeof zlib.zstdCompressSync === "function") {
        body = new Uint8Array(zlib.zstdCompressSync(Buffer.from(json)));
        headers["Content-Encoding"] = "zstd";
      }
      const response = await postJson(`${baseURL}/v1/systemone`, headers, body, options.timeoutMs);
      return parseSystemOneResponse(response, rules);
    },
  };
}

// --- LLM judge: OpenAI-compatible chat completions, and any CLI that prints the same JSON ---

/** Find the JSON object in a model reply that may add prose or code fences around it. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error(`judge reply has no JSON object: ${trimmed.slice(0, 200)}`);
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (error) {
      throw new Error(`judge reply is not valid JSON: ${trimmed.slice(0, 200)}`, { cause: error });
    }
  }
}

/** Validate `{ rules: [{ id, violation, confidence, evidence, files }] }` for every asked rule. */
export function parseJudgeAnswers(json: unknown, rules: ReadonlyArray<DiffRule>, model: string): RuleAnswer[] {
  // `claude -p --output-format json` and similar CLIs wrap the reply text in `{ result }`.
  if (isRecord(json) && !("rules" in json) && typeof json.result === "string") {
    return parseJudgeAnswers(extractJsonObject(json.result), rules, model);
  }
  if (!isRecord(json) || !Array.isArray(json.rules)) throw new Error("judge reply has no rules list");
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of json.rules) {
    if (isRecord(entry) && typeof entry.id === "string") byId.set(entry.id, entry);
  }
  return rules.map((rule) => {
    const entry = byId.get(rule.id);
    if (entry === undefined) throw new Error(`judge reply has no answer for "${rule.id}"`);
    const { violation, confidence, evidence, files } = entry;
    if (typeof violation !== "boolean") throw new Error(`judge answer for "${rule.id}" has no boolean violation`);
    if (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1)) {
      throw new Error(`judge answer for "${rule.id}" has no confidence in [0, 1]`);
    }
    if (evidence !== undefined && typeof evidence !== "string") {
      throw new Error(`judge answer for "${rule.id}" has non-string evidence`);
    }
    if (files !== undefined && !(Array.isArray(files) && files.every((file) => typeof file === "string"))) {
      throw new Error(`judge answer for "${rule.id}" has files that are not a list of paths`);
    }
    return {
      id: rule.id,
      probability: violation ? confidence : 1 - confidence,
      ...(evidence === undefined || evidence.length === 0 ? {} : { evidence }),
      ...(files === undefined ? {} : { files }),
      model,
    };
  });
}

function chatContent(json: unknown): string {
  const choices = isRecord(json) ? json.choices : undefined;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("");
  }
  throw new Error("chat completion has no message content");
}

export function llmJudgeBackend(options: {
  readonly baseURL: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly timeoutMs: number;
}): Backend {
  const baseURL = stripSlashes(options.baseURL);
  return {
    name: "llm-judge",
    identity: `llm-judge ${baseURL}`,
    model: options.model,
    async ask(rules, input) {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "anti-slop-diff-rules",
        ...(options.apiKey === undefined ? {} : { Authorization: `Bearer ${options.apiKey}` }),
      };
      const body = JSON.stringify({
        model: options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a careful code reviewer. You reply with a single JSON object." },
          { role: "user", content: renderJudgePrompt(rules, input) },
        ],
      });
      const response = await postJson(`${baseURL}/chat/completions`, headers, body, options.timeoutMs);
      const model = isRecord(response) && typeof response.model === "string" ? response.model : options.model;
      return parseJudgeAnswers(extractJsonObject(chatContent(response)), rules, model);
    },
  };
}

function runCommand(command: string, stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`judge command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (data: string) => {
      stdout += data;
    });
    child.stderr.setEncoding("utf8").on("data", (data: string) => {
      stderr += data;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`judge command exited with ${String(code)}: ${stderr.trim().slice(-500)}`));
    });
    // A command that never reads stdin closes the pipe; its exit status still decides the result.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

export function commandBackend(options: { readonly command: string; readonly timeoutMs: number }): Backend {
  return {
    name: "command",
    identity: `command ${options.command}`,
    model: options.command,
    async ask(rules, input) {
      const stdout = await runCommand(options.command, renderJudgePrompt(rules, input), options.timeoutMs);
      return parseJudgeAnswers(extractJsonObject(stdout), rules, options.command);
    },
  };
}

/** Build the requested backend, or the first one with credentials when none is requested. */
export function chooseBackend(
  requested: BackendName | undefined,
  config: ResolvedConfig,
  env: Env,
  overrides: { readonly model?: string; readonly command?: string },
): BackendChoice {
  const typesafeKey = envValue(env, "TYPESAFE_API_KEY");
  const judgeURL = envValue(env, "LLM_JUDGE_BASE_URL");
  const command = overrides.command ?? envValue(env, "ANTI_SLOP_DIFF_RULES_COMMAND") ?? config.command;
  const name: BackendName =
    requested ??
    config.backend ??
    (typesafeKey !== undefined
      ? "decision-model"
      : judgeURL !== undefined
        ? "llm-judge"
        : command !== undefined
          ? "command"
          : "decision-model");

  if (name === "decision-model") {
    if (typesafeKey === undefined) return { ok: false, name, reason: "TYPESAFE_API_KEY is not set" };
    return {
      ok: true,
      backend: decisionModelBackend({
        apiKey: typesafeKey,
        baseURL: envValue(env, "TYPESAFE_BASE_URL") ?? TYPESAFE_DEFAULT_BASE_URL,
        model: overrides.model ?? envValue(env, "TYPESAFE_DEFAULT_MODEL") ?? config.model ?? TYPESAFE_DEFAULT_MODEL,
        timeoutMs: config.timeoutMs,
      }),
    };
  }
  if (name === "llm-judge") {
    const model = overrides.model ?? envValue(env, "LLM_JUDGE_MODEL") ?? config.model;
    if (judgeURL === undefined) return { ok: false, name, reason: "LLM_JUDGE_BASE_URL is not set" };
    if (model === undefined) return { ok: false, name, reason: "LLM_JUDGE_MODEL is not set" };
    const apiKey = envValue(env, "LLM_JUDGE_API_KEY");
    return {
      ok: true,
      backend: llmJudgeBackend({
        baseURL: judgeURL,
        model,
        timeoutMs: config.timeoutMs,
        ...(apiKey === undefined ? {} : { apiKey }),
      }),
    };
  }
  if (command === undefined) {
    return { ok: false, name, reason: "no judge command: pass --command, set ANTI_SLOP_DIFF_RULES_COMMAND, or set command in the config" };
  }
  return { ok: true, backend: commandBackend({ command, timeoutMs: config.timeoutMs }) };
}
