// A standalone CLI outside any Effect runtime, so Effect's platform services do not apply.
// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/prefer-schema-over-json, effecttsgo/async-function

import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultDiffRules, type DiffRule, type Severity } from "./rules.ts";

export type BackendName = "decision-model" | "llm-judge" | "command";

export const BACKEND_NAMES: ReadonlyArray<BackendName> = ["decision-model", "llm-judge", "command"];

/** A new rule, or a partial override of the rule with the same id. */
export interface RuleEntry {
  readonly id: string;
  readonly question?: string;
  readonly message?: string;
  readonly cutoff?: number;
  readonly severity?: Severity;
}

export interface DiffRulesConfig {
  /** Backend used when `--backend` is absent. Defaults to the first backend with credentials. */
  readonly backend?: BackendName;
  /** With `"fail"`, an unavailable or failing backend fails the run when `CI` is set. */
  readonly ci?: "skip" | "fail";
  /** Model for the selected backend; environment variables and `--model` take precedence. */
  readonly model?: string;
  /** Shell command for the `command` backend; it reads the prompt on stdin. */
  readonly command?: string;
  /** Stated purpose of the change, used by `scope-creep`. */
  readonly purpose?: string;
  /** Extra git glob pathspecs to leave out of the diff. */
  readonly exclude?: ReadonlyArray<string>;
  /** Set to false to drop the built-in lockfile and generated-directory excludes. */
  readonly defaultExcludes?: boolean;
  readonly rules?: ReadonlyArray<RuleEntry>;
  /** Rule ids to turn off. */
  readonly disable?: ReadonlyArray<string>;
  /** Characters of diff hunks per request; the file list and history are sent with every chunk. */
  readonly maxChunkChars?: number;
  /** Commit subjects shown per touched file. */
  readonly historyCommits?: number;
  /** Recent commits scanned for co-change counts between touched files. */
  readonly coChangeCommits?: number;
  /** Milliseconds per request, including the AI SDK's retries. */
  readonly timeoutMs?: number;
  /** Requests in flight at once. */
  readonly concurrency?: number;
  /** Decision model only: raise Jev's 64k-token request limit to 262k (slower, less accurate). */
  readonly longContext?: boolean;
}

export interface ResolvedConfig {
  readonly backend?: BackendName;
  readonly ci: "skip" | "fail";
  readonly model?: string;
  readonly command?: string;
  readonly purpose?: string;
  readonly exclude: ReadonlyArray<string>;
  readonly rules: ReadonlyArray<DiffRule>;
  readonly maxChunkChars: number;
  readonly historyCommits: number;
  readonly coChangeCommits: number;
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly longContext: boolean;
}

/** Git glob pathspecs for files that carry no design signal. */
export const DEFAULT_EXCLUDES: ReadonlyArray<string> = [
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/deno.lock",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/uv.lock",
  "**/Pipfile.lock",
  "**/Gemfile.lock",
  "**/composer.lock",
  "**/go.sum",
  "**/node_modules/**",
  "**/vendor/**",
  "**/third_party/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/coverage/**",
  "**/generated/**",
  "**/__generated__/**",
  "**/*.generated.*",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
];

export const CONFIG_FILE_NAMES: ReadonlyArray<string> = [
  "anti-slop-diff-rules.config.ts",
  "anti-slop-diff-rules.config.mjs",
  "anti-slop-diff-rules.config.js",
  "anti-slop-diff-rules.config.json",
];

function fail(message: string): never {
  throw new Error(`diff-rules config: ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) fail(`${key} must be a non-empty string`);
  return value;
}

function positiveInteger(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(`${key} must be a positive integer`);
  }
  return value;
}

function stringList(raw: Record<string, unknown>, key: string): ReadonlyArray<string> {
  const value = raw[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    fail(`${key} must be a list of non-empty strings`);
  }
  return value;
}

function checkRule(rule: Record<string, unknown>, label: string): DiffRule {
  const { id, question, message, cutoff, severity } = rule;
  if (typeof id !== "string" || id.length === 0) fail(`${label}: id must be a non-empty string`);
  if (typeof question !== "string" || question.trim().length === 0) {
    fail(`rule "${id}": question must be a non-empty string`);
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    fail(`rule "${id}": message must be a non-empty string`);
  }
  if (typeof cutoff !== "number" || !(cutoff >= 0 && cutoff <= 1)) {
    fail(`rule "${id}": cutoff must be a number from 0 to 1`);
  }
  if (severity !== "warn" && severity !== "error") fail(`rule "${id}": severity must be "warn" or "error"`);
  return { id, question, message, cutoff, severity };
}

/** Merge user rule entries over the defaults: same id overrides fields, a new id adds a rule. */
export function resolveRules(
  defaults: ReadonlyArray<DiffRule>,
  entries: ReadonlyArray<unknown>,
  disable: ReadonlyArray<string>,
): ReadonlyArray<DiffRule> {
  const byId = new Map<string, DiffRule>(defaults.map((rule) => [rule.id, rule]));
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (!isRecord(entry)) fail(`rules[${index}] must be an object`);
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) fail(`rules[${index}].id must be a non-empty string`);
    if (seen.has(id)) fail(`rule id "${id}" is listed more than once`);
    seen.add(id);
    const base = byId.get(id);
    byId.set(id, checkRule({ ...base, ...entry }, `rules[${index}]`));
  });
  for (const id of disable) {
    if (!byId.has(id)) fail(`disable lists unknown rule "${id}"`);
    byId.delete(id);
  }
  return [...byId.values()];
}

export function resolveConfig(raw: unknown): ResolvedConfig {
  if (raw === undefined) raw = {};
  if (!isRecord(raw)) fail("the config must export an object");
  const backend = raw.backend;
  if (backend !== undefined && !BACKEND_NAMES.some((name) => name === backend)) {
    fail(`backend must be one of ${BACKEND_NAMES.join(", ")}`);
  }
  const ci = raw.ci ?? "skip";
  if (ci !== "skip" && ci !== "fail") fail('ci must be "skip" or "fail"');
  const defaultExcludes = raw.defaultExcludes ?? true;
  if (typeof defaultExcludes !== "boolean") fail("defaultExcludes must be a boolean");
  const longContext = raw.longContext ?? false;
  if (typeof longContext !== "boolean") fail("longContext must be a boolean");
  const rules = raw.rules ?? [];
  if (!Array.isArray(rules)) fail("rules must be a list");
  return {
    backend: BACKEND_NAMES.find((name) => name === backend),
    ci,
    model: optionalString(raw, "model"),
    command: optionalString(raw, "command"),
    purpose: optionalString(raw, "purpose"),
    exclude: [...(defaultExcludes ? DEFAULT_EXCLUDES : []), ...stringList(raw, "exclude")],
    rules: resolveRules(defaultDiffRules, rules, stringList(raw, "disable")),
    maxChunkChars: positiveInteger(raw, "maxChunkChars", 60_000),
    historyCommits: positiveInteger(raw, "historyCommits", 5),
    coChangeCommits: positiveInteger(raw, "coChangeCommits", 200),
    timeoutMs: positiveInteger(raw, "timeoutMs", 120_000),
    concurrency: positiveInteger(raw, "concurrency", 4),
    longContext,
  };
}

/** Load `path`, or the first default config file in `cwd`; no file means the defaults. */
export async function loadConfig(cwd: string, path?: string): Promise<ResolvedConfig> {
  const file =
    path === undefined
      ? CONFIG_FILE_NAMES.map((name) => join(cwd, name)).find((candidate) => existsSync(candidate))
      : isAbsolute(path)
        ? path
        : resolve(cwd, path);
  if (file === undefined) return resolveConfig({});
  if (!existsSync(file)) fail(`${file} does not exist`);
  if (extname(file) === ".json") return resolveConfig(JSON.parse(readFileSync(file, "utf8")));
  const module: unknown = await import(pathToFileURL(file).href);
  return resolveConfig(isRecord(module) ? module.default : undefined);
}
