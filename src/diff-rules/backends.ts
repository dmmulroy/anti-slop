// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/prefer-schema-over-json, effecttsgo/async-function, effecttsgo/global-timers, effecttsgo/new-promise -- a standalone CLI outside any Effect runtime, so Effect's platform services do not apply

import { spawn } from "node:child_process";
import type { JSONSchema7 } from "ai";
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

// diff-rules must run when copied on its own, so it keeps its own copy of shared/error-message.ts.
const hasMessage = (cause: unknown): cause is { readonly message: string; readonly [key: string]: unknown } =>
  isRecord(cause) && typeof cause.message === "string";

/** The message of a thrown value, or its string form when it has none. */
export const errorMessage = (cause: unknown): string => (hasMessage(cause) ? cause.message : String(cause));

// --- Shared: the Vercel AI SDK, loaded only by the backends that use it ---

/** Load an optional package so the `command` backend works without the AI SDK installed. */
async function importOptional<T>(load: () => Promise<T>, backend: BackendName, packages: string): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new Error(`the ${backend} backend needs ${packages}; install them with \`npm install --save-dev ${packages}\``, {
        cause: error,
      });
    }
    throw error;
  }
}

const AI_PACKAGES = "ai zod";

/** One line per failure: the status code and provider message, without the SDK's request dump. */
function describeAiError(error: unknown): string {
  if (!hasMessage(error)) return String(error);
  // RetryError keeps every attempt's error; the last one has the status and provider message.
  const errors: ReadonlyArray<unknown> | undefined = isRecord(error) && Array.isArray(error.errors) ? error.errors : undefined;
  const last = errors?.at(-1);
  const source = hasMessage(last) ? last : error;
  const status = isRecord(source) && typeof source.statusCode === "number" ? source.statusCode : undefined;
  const attempts = errors === undefined || errors.length < 2 ? "" : ` (after ${errors.length} attempts)`;
  return `${status === undefined ? "" : `http ${status}: `}${source.message}${attempts}`;
}

/** The AI SDK retries 408, 409, 429, 5xx, and connection errors, honoring `retry-after-ms` and `Retry-After`. */
const MAX_RETRIES = 2;

// --- Decision model: TypeSafe Jev through `experimental_decide` ---

export const TYPESAFE_DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";
export const GATEWAY_DEFAULT_DECISION_MODEL = "typesafe-ai/jev";

export const FACTORY_DEFAULT_BASE_URL = "https://api.factory.ai";

/** Factory's decision route speaks TypeSafe's wire format, so the TypeSafe provider talks to it. */
export const factoryDecisionURL = (factoryURL: string): string => `${stripSlashes(factoryURL)}/api/llm/decision/v1`;

/** Where the decision model runs: TypeSafe directly, Factory's TypeSafe-compatible route, or AI Gateway. */
export type DecisionTarget =
  | { readonly kind: "typesafe" | "factory"; readonly apiKey: string; readonly baseURL: string }
  | { readonly kind: "gateway"; readonly apiKey?: string; readonly baseURL?: string };

const questionRef = (index: number): string => `r${index}`;

export function decisionModelBackend(options: {
  readonly target: DecisionTarget;
  readonly model: string;
  readonly timeoutMs: number;
  /** Raise Jev's 64k-token request limit to 262k; TypeSafe calls it slower and less accurate. */
  readonly longContext?: boolean;
}): Backend {
  const { target } = options;
  const where = target.kind === "gateway" ? `gateway ${target.baseURL ?? "default"}` : `${target.kind} ${stripSlashes(target.baseURL)}`;
  return {
    name: "decision-model",
    identity: `decision-model ${where}${options.longContext === true ? " long-context" : ""}`,
    model: options.model,
    async ask(rules, input) {
      const ai = await importOptional(() => import("ai"), "decision-model", AI_PACKAGES);
      const model =
        target.kind !== "gateway"
          ? (await importOptional(() => import("@ai-sdk/typesafe-ai"), "decision-model", `${AI_PACKAGES} @ai-sdk/typesafe-ai`))
              .createTypeSafeAi({ apiKey: target.apiKey, baseURL: stripSlashes(target.baseURL) })
              .decisionModel(options.model)
          : ai
              .createGateway({
                ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
                ...(target.baseURL === undefined ? {} : { baseURL: target.baseURL }),
              })
              .decisionModel(options.model);
      let result;
      try {
        result = await ai.experimental_decide({
          model,
          state: input.text,
          questions: Object.fromEntries(
            rules.map((rule, index) => [questionRef(index), { type: "boolean" as const, instructions: rule.question }]),
          ),
          maxRetries: MAX_RETRIES,
          abortSignal: AbortSignal.timeout(options.timeoutMs),
          ...(options.longContext === true ? { providerOptions: { typesafe: { longContext: true } } } : {}),
        });
      } catch (error) {
        throw new Error(describeAiError(error), { cause: error });
      }
      const answered = result.response.modelId;
      return rules.map((rule, index) => {
        const answer = result.answers[questionRef(index)];
        const probability = answer?.type === "boolean" ? answer.probability : undefined;
        if (probability === undefined || !(probability >= 0 && probability <= 1)) {
          throw new Error(`decision model response has no probability in [0, 1] for "${rule.id}"`);
        }
        return { id: rule.id, probability, model: answered };
      });
    },
  };
}

// --- LLM judge: a chat model through `generateText` with structured output ---
// --- Parsing judge replies, shared with the `command` backend ---

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

/** Where the chat model runs: AI Gateway, Factory's Anthropic proxy, or any OpenAI-compatible chat completions server. */
export type JudgeTarget =
  | { readonly kind: "gateway"; readonly apiKey?: string; readonly baseURL?: string }
  | {
      readonly kind: "factory";
      readonly apiKey: string;
      /** The Factory API host, such as `https://api.factory.ai`. */
      readonly baseURL: string;
      /** Sent as `X-Client-Version`; Factory's inference proxy rejects requests without one. */
      readonly clientVersion: string;
    }
  | {
      readonly kind: "openai-compatible";
      readonly baseURL: string;
      readonly apiKey?: string;
      /** Send a JSON schema (`response_format: json_schema`); otherwise only `json_object`. */
      readonly structuredOutputs: boolean;
    };

/** The JSON schema of the judge reply; strict-mode compatible, so every property is required. */
export function judgeReplySchema(rules: ReadonlyArray<DiffRule>): JSONSchema7 {
  return {
    type: "object",
    additionalProperties: false,
    required: ["rules"],
    properties: {
      rules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "violation", "confidence", "evidence", "files"],
          properties: {
            id: { type: "string", enum: rules.map((rule) => rule.id) },
            violation: { type: "boolean" },
            confidence: { type: "number" },
            evidence: { type: "string" },
            files: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}

const JUDGE_SYSTEM_PROMPT = "You are a careful code reviewer. You reply with a single JSON object.";

/** Factory's inference proxy serves only requests whose system prompt starts with this sentence. */
export const FACTORY_SYSTEM_PROMPT = "You are Droid, an AI software engineering agent built by Factory.";

/** A Droid CLI version Factory's proxy accepts; `FACTORY_CLIENT_VERSION` overrides it when the minimum moves. */
export const FACTORY_DEFAULT_CLIENT_VERSION = "0.233.0";

export function llmJudgeBackend(options: {
  readonly target: JudgeTarget;
  readonly model: string;
  readonly timeoutMs: number;
}): Backend {
  const { target } = options;
  const where =
    target.kind === "gateway"
      ? `gateway ${target.baseURL ?? "default"}`
      : target.kind === "factory"
        ? `factory ${stripSlashes(target.baseURL)}`
        : `openai-compatible ${stripSlashes(target.baseURL)}${target.structuredOutputs ? "" : " json-object"}`;
  return {
    name: "llm-judge",
    identity: `llm-judge ${where}`,
    model: options.model,
    async ask(rules, input) {
      const ai = await importOptional(() => import("ai"), "llm-judge", AI_PACKAGES);
      const model =
        target.kind === "gateway"
          ? ai
              .createGateway({
                ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
                ...(target.baseURL === undefined ? {} : { baseURL: target.baseURL }),
              })
              .languageModel(options.model)
          : target.kind === "factory"
            ? (await importOptional(() => import("@ai-sdk/anthropic"), "llm-judge", `${AI_PACKAGES} @ai-sdk/anthropic`))
                .createAnthropic({
                  baseURL: `${stripSlashes(target.baseURL)}/api/llm/a/v1`,
                  apiKey: target.apiKey,
                  headers: { authorization: `Bearer ${target.apiKey}`, "x-client-version": target.clientVersion },
                })
                .languageModel(options.model)
            : (
              await importOptional(
                () => import("@ai-sdk/openai-compatible"),
                "llm-judge",
                `${AI_PACKAGES} @ai-sdk/openai-compatible`,
              )
            )
              .createOpenAICompatible({
                name: "llm-judge",
                baseURL: stripSlashes(target.baseURL),
                supportsStructuredOutputs: target.structuredOutputs,
                ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
              })
              .chatModel(options.model);
      let result;
      try {
        result = await ai.generateText({
          model,
          output: ai.Output.object({ schema: ai.jsonSchema<unknown>(judgeReplySchema(rules)), name: "diff_rules" }),
          temperature: 0,
          system: `${target.kind === "factory" ? `${FACTORY_SYSTEM_PROMPT} ` : ""}${JUDGE_SYSTEM_PROMPT}`,
          prompt: renderJudgePrompt(rules, input),
          maxRetries: MAX_RETRIES,
          abortSignal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        throw new Error(describeAiError(error), { cause: error });
      }
      // The gateway's language-model endpoint does not report which model answered.
      return parseJudgeAnswers(result.output, rules, result.response.modelId ?? options.model);
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

/** The legacy `TYPESAFE_BASE_URL` is the host; the AI SDK provider's base URL includes `/v1`. */
function withApiVersion(url: string): string {
  const base = stripSlashes(url);
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

const isOff = (value: string | undefined): boolean => value !== undefined && ["0", "false", "no", "off"].includes(value.toLowerCase());

/** The reason given when no backend is requested and no judge of any kind is configured. */
export const NO_JUDGE_CREDENTIALS =
  "no diff-rules judge is configured: set TYPESAFE_API_KEY (or TYPESAFE_AI_API_KEY), FACTORY_API_KEY, AI_GATEWAY_API_KEY, or LLM_JUDGE_BASE_URL with LLM_JUDGE_MODEL, or give a judge command (--command, ANTI_SLOP_DIFF_RULES_COMMAND, or command in the config)";

// Factory serves only model aliases such as `jev-latest`; a versioned id gets a 400.
const isPinnedJevModel = (model: string): boolean => /^jev-\d/.test(model);

/** Build the requested backend, or the first one with credentials when none is requested. */
export function chooseBackend(
  requested: BackendName | undefined,
  config: ResolvedConfig,
  env: Env,
  overrides: { readonly model?: string; readonly command?: string },
): BackendChoice {
  const typesafeKey = envValue(env, "TYPESAFE_API_KEY") ?? envValue(env, "TYPESAFE_AI_API_KEY");
  const factoryKey = envValue(env, "FACTORY_API_KEY");
  const factoryURL = envValue(env, "FACTORY_API_BASE_URL") ?? FACTORY_DEFAULT_BASE_URL;
  const gatewayKey = envValue(env, "AI_GATEWAY_API_KEY");
  // On Vercel, AI Gateway authenticates with the deployment's OIDC token instead of a key.
  const gateway = gatewayKey !== undefined || envValue(env, "VERCEL_OIDC_TOKEN") !== undefined;
  const gatewayURL = envValue(env, "AI_GATEWAY_BASE_URL");
  const gatewayAuth = {
    ...(gatewayKey === undefined ? {} : { apiKey: gatewayKey }),
    ...(gatewayURL === undefined ? {} : { baseURL: gatewayURL }),
  };
  const judgeURL = envValue(env, "LLM_JUDGE_BASE_URL");
  const judgeModel = overrides.model ?? envValue(env, "LLM_JUDGE_MODEL") ?? config.model;
  const command = overrides.command ?? envValue(env, "ANTI_SLOP_DIFF_RULES_COMMAND") ?? config.command;
  const name: BackendName =
    requested ??
    config.backend ??
    (typesafeKey !== undefined
      ? "decision-model"
      : judgeURL !== undefined
        ? "llm-judge"
        : factoryKey !== undefined || gateway
          ? envValue(env, "LLM_JUDGE_MODEL") === undefined
            ? "decision-model"
            : "llm-judge"
          : command !== undefined
            ? "command"
            : "decision-model");

  const nothingConfigured =
    typesafeKey === undefined && factoryKey === undefined && judgeURL === undefined && !gateway && command === undefined;
  if (requested === undefined && config.backend === undefined && nothingConfigured) {
    return { ok: false, name, reason: NO_JUDGE_CREDENTIALS };
  }

  if (name === "decision-model") {
    const model = overrides.model ?? envValue(env, "TYPESAFE_DEFAULT_MODEL") ?? config.model;
    const common = { timeoutMs: config.timeoutMs, ...(config.longContext ? { longContext: true } : {}) };
    if (typesafeKey !== undefined) {
      const baseURL = envValue(env, "TYPESAFE_AI_BASE_URL");
      const legacyURL = envValue(env, "TYPESAFE_BASE_URL");
      return {
        ok: true,
        backend: decisionModelBackend({
          ...common,
          target: {
            kind: "typesafe",
            apiKey: typesafeKey,
            baseURL: baseURL ?? (legacyURL === undefined ? TYPESAFE_DEFAULT_BASE_URL : withApiVersion(legacyURL)),
          },
          model: model ?? TYPESAFE_DEFAULT_MODEL,
        }),
      };
    }
    if (factoryKey !== undefined) {
      const factoryModel = model ?? TYPESAFE_DEFAULT_MODEL;
      if (isPinnedJevModel(factoryModel)) {
        return { ok: false, name, reason: `Factory serves only Jev aliases such as "jev-latest", not the pinned model "${factoryModel}"` };
      }
      return {
        ok: true,
        backend: decisionModelBackend({
          ...common,
          target: { kind: "factory", apiKey: factoryKey, baseURL: factoryDecisionURL(factoryURL) },
          model: factoryModel,
        }),
      };
    }
    if (!gateway) {
      return { ok: false, name, reason: "TYPESAFE_API_KEY (or TYPESAFE_AI_API_KEY, FACTORY_API_KEY, or AI_GATEWAY_API_KEY) is not set" };
    }
    const gatewayModel = model === undefined ? GATEWAY_DEFAULT_DECISION_MODEL : model.includes("/") ? model : `typesafe-ai/${model}`;
    return {
      ok: true,
      backend: decisionModelBackend({ ...common, target: { kind: "gateway", ...gatewayAuth }, model: gatewayModel }),
    };
  }
  if (name === "llm-judge") {
    if (judgeURL === undefined && factoryKey === undefined && !gateway) {
      return { ok: false, name, reason: "LLM_JUDGE_BASE_URL, FACTORY_API_KEY, or AI_GATEWAY_API_KEY is not set" };
    }
    if (judgeModel === undefined) return { ok: false, name, reason: "LLM_JUDGE_MODEL is not set" };
    const apiKey = envValue(env, "LLM_JUDGE_API_KEY");
    const target: JudgeTarget =
      judgeURL !== undefined
        ? {
            kind: "openai-compatible",
            baseURL: judgeURL,
            structuredOutputs: !isOff(envValue(env, "LLM_JUDGE_STRUCTURED_OUTPUTS")),
            ...(apiKey === undefined ? {} : { apiKey }),
          }
        : factoryKey !== undefined
          ? {
              kind: "factory",
              apiKey: factoryKey,
              baseURL: factoryURL,
              clientVersion: envValue(env, "FACTORY_CLIENT_VERSION") ?? FACTORY_DEFAULT_CLIENT_VERSION,
            }
          : { kind: "gateway", ...gatewayAuth };
    return { ok: true, backend: llmJudgeBackend({ target, model: judgeModel, timeoutMs: config.timeoutMs }) };
  }
  if (command === undefined) {
    return { ok: false, name, reason: "no judge command: pass --command, set ANTI_SLOP_DIFF_RULES_COMMAND, or set command in the config" };
  }
  return { ok: true, backend: commandBackend({ command, timeoutMs: config.timeoutMs }) };
}
