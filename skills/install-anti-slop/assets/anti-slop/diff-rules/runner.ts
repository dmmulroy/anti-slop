// oxlint-disable effecttsgo/async-function, effecttsgo/prefer-schema-over-json -- a standalone CLI outside any Effect runtime, so Effect's platform services do not apply

import { chooseBackend, errorMessage, type Backend, type RuleAnswer } from "./backends.ts";
import { defaultCacheDir, cacheKey, readCachedAnswer, writeCachedAnswer } from "./cache.ts";
import { loadConfig, type BackendName, type ResolvedConfig } from "./config.ts";
import { collectChanges, historySummary, type ChangeMode, type ChangeSet } from "./git.ts";
import { buildInputs, type JudgeInput } from "./input.ts";
import type { DiffRule, Severity } from "./rules.ts";

type Env = Readonly<Record<string, string | undefined>>;

export interface RunOptions {
  readonly cwd: string;
  readonly env: Env;
  readonly mode: ChangeMode;
  readonly base?: string;
  /** Fail when any rule fires, and when the backend is unavailable or fails. */
  readonly fail: boolean;
  readonly json: boolean;
  readonly configPath?: string;
  readonly backend?: BackendName;
  readonly model?: string;
  readonly command?: string;
  readonly purpose?: string;
  readonly cacheDir?: string;
}

export interface Finding {
  readonly id: string;
  readonly severity: Severity;
  readonly fired: boolean;
  readonly probability: number;
  readonly cutoff: number;
  readonly message: string;
  readonly evidence?: string;
  readonly files?: ReadonlyArray<string>;
}

export interface Report {
  readonly base: string;
  readonly baseCommit?: string;
  readonly mode: ChangeMode;
  readonly backend?: BackendName;
  readonly requestedModel?: string;
  /** Models that answered, as the backends reported them. */
  readonly models: ReadonlyArray<string>;
  readonly files: number;
  readonly chunks: number;
  readonly cachedAnswers: number;
  readonly requests: number;
  readonly notes: ReadonlyArray<string>;
  readonly skipped?: string;
  readonly errors: ReadonlyArray<string>;
  readonly findings: ReadonlyArray<Finding>;
}

export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly report?: Report;
}

const PREFIX = "diff-rules:";

const isCI = (env: Env): boolean => {
  const value = env.CI?.trim().toLowerCase();
  return value !== undefined && value.length > 0 && value !== "false" && value !== "0";
};

interface ChunkOutcome {
  readonly answers: ReadonlyArray<RuleAnswer>;
  readonly cached: number;
  readonly requested: boolean;
  readonly error?: string;
}

async function judgeChunk(
  backend: Backend,
  rules: ReadonlyArray<DiffRule>,
  input: JudgeInput,
  cacheDir: string,
  warn: (message: string) => void,
): Promise<ChunkOutcome> {
  const answers: RuleAnswer[] = [];
  const pending: DiffRule[] = [];
  for (const rule of rules) {
    const cached = readCachedAnswer(cacheDir, cacheKey(backend, rule, input), rule.id);
    if (cached === undefined) pending.push(rule);
    else answers.push(cached);
  }
  const cached = answers.length;
  if (pending.length === 0) return { answers, cached, requested: false };
  try {
    const fresh = await backend.ask(pending, input);
    for (const [index, answer] of fresh.entries()) {
      const rule = pending[index];
      if (rule === undefined) continue;
      try {
        writeCachedAnswer(cacheDir, cacheKey(backend, rule, input), answer);
      } catch (error) {
        warn(`could not write cache in ${cacheDir}: ${errorMessage(error)}`);
      }
    }
    return { answers: [...answers, ...fresh], cached, requested: true };
  } catch (error) {
    const where = input.total === 1 ? "" : ` (part ${input.index + 1} of ${input.total})`;
    return { answers, cached, requested: true, error: `${backend.name}${where}: ${errorMessage(error)}` };
  }
}

async function mapLimited<T, R>(items: ReadonlyArray<T>, limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A rule's answer for the whole change: its strongest answer across chunks. */
function findingFor(rule: DiffRule, answers: ReadonlyArray<RuleAnswer>): Finding | undefined {
  const mine = answers.filter((answer) => answer.id === rule.id);
  if (mine.length === 0) return undefined;
  const strongest = mine.reduce((best, answer) => (answer.probability > best.probability ? answer : best));
  const firing = mine.filter((answer) => answer.probability >= rule.cutoff);
  const files = [...new Set(firing.flatMap((answer) => answer.files ?? []))];
  return {
    id: rule.id,
    severity: rule.severity,
    fired: strongest.probability >= rule.cutoff,
    probability: strongest.probability,
    cutoff: rule.cutoff,
    message: rule.message,
    ...(strongest.evidence === undefined ? {} : { evidence: strongest.evidence }),
    ...(files.length === 0 ? {} : { files }),
  };
}

function describeBase(change: ChangeSet): string {
  const commit = change.baseCommit === undefined ? "" : ` (${change.baseCommit.slice(0, 7)})`;
  if (change.mode === "staged") return "staged changes";
  if (change.mode === "working") return "uncommitted changes";
  return `${change.baseLabel}${commit}`;
}

function formatHuman(report: Report, change: ChangeSet): string {
  const lines: string[] = [];
  const shown = report.models.length > 0 ? report.models.join(", ") : (report.requestedModel ?? "");
  const models = shown.length > 80 ? `${shown.slice(0, 77)}...` : shown;
  lines.push(
    `${PREFIX} judged ${report.files} changed file(s) in ${report.chunks} request(s) against ${describeBase(change)} with ${report.backend ?? "?"}${models.length > 0 ? ` (${models})` : ""}; ${report.cachedAnswers} cached answer(s).`,
  );
  for (const finding of report.findings.filter((item) => item.fired)) {
    lines.push("");
    lines.push(`${finding.severity}  ${finding.id}  ${finding.probability.toFixed(2)} >= ${finding.cutoff.toFixed(2)}`);
    lines.push(`  ${finding.message}`);
    if (finding.evidence !== undefined) lines.push(`  evidence: ${finding.evidence}`);
    if (finding.files !== undefined) lines.push(`  files: ${finding.files.join(", ")}`);
  }
  const fired = report.findings.filter((item) => item.fired);
  const errors = fired.filter((item) => item.severity === "error").length;
  lines.push("");
  lines.push(`${PREFIX} ${fired.length - errors} warning(s), ${errors} error(s).`);
  return `${lines.join("\n")}\n`;
}

export async function runDiffRules(options: RunOptions): Promise<RunResult> {
  let stderr = "";
  const warned = new Set<string>();
  const warn = (message: string): void => {
    if (warned.has(message)) return;
    warned.add(message);
    stderr += `${PREFIX} ${message}\n`;
  };
  const finish = (exitCode: number, report: Report | undefined, human: string): RunResult => ({
    exitCode,
    stdout: options.json && report !== undefined ? `${JSON.stringify(report, null, 2)}\n` : human,
    stderr,
    ...(report === undefined ? {} : { report }),
  });

  let config: ResolvedConfig;
  let change: ChangeSet;
  try {
    config = await loadConfig(options.cwd, options.configPath);
    change = collectChanges({
      cwd: options.cwd,
      mode: options.mode,
      exclude: config.exclude,
      ...(options.base === undefined ? {} : { base: options.base }),
    });
  } catch (error) {
    warn(errorMessage(error));
    return finish(2, undefined, "");
  }
  for (const note of change.notes) warn(note);
  const failOnBackend = options.fail || (isCI(options.env) && config.ci === "fail");
  const baseReport = {
    base: change.baseLabel,
    ...(change.baseCommit === undefined ? {} : { baseCommit: change.baseCommit }),
    mode: change.mode,
    files: change.files.length,
    notes: change.notes,
  };

  if (change.files.length === 0 || config.rules.length === 0) {
    const reason = change.files.length === 0 ? "no changes to judge" : "no rules enabled";
    const report: Report = { ...baseReport, models: [], chunks: 0, cachedAnswers: 0, requests: 0, skipped: reason, errors: [], findings: [] };
    return finish(0, report, `${PREFIX} ${reason} against ${describeBase(change)}.\n`);
  }

  const choice = chooseBackend(options.backend, config, options.env, {
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.command === undefined ? {} : { command: options.command }),
  });
  if (!choice.ok) {
    const skipped = `${choice.reason}; skipping diff rules`;
    warn(skipped);
    const report: Report = { ...baseReport, backend: choice.name, models: [], chunks: 0, cachedAnswers: 0, requests: 0, skipped, errors: [], findings: [] };
    return finish(failOnBackend ? 2 : 0, report, "");
  }
  const { backend } = choice;

  const purpose = options.purpose ?? options.env.ANTI_SLOP_DIFF_RULES_PURPOSE?.trim() ?? config.purpose;
  const history = historySummary(
    change.root,
    change.baseCommit,
    change.files.filter((file) => file.status !== "added").map((file) => file.path),
    { commitsPerFile: config.historyCommits, coChangeCommits: config.coChangeCommits, maxFiles: 60, maxPairs: 40 },
  );
  const inputs = buildInputs(change, history, {
    maxChunkChars: config.maxChunkChars,
    maxSummaryFiles: 300,
    ...(purpose === undefined || purpose.length === 0 ? {} : { purpose }),
  });
  const cacheDir = options.cacheDir ?? defaultCacheDir(options.cwd);
  const outcomes = await mapLimited(inputs, config.concurrency, (input) =>
    judgeChunk(backend, config.rules, input, cacheDir, warn),
  );

  const answers = outcomes.flatMap((outcome) => outcome.answers);
  const errors = outcomes.flatMap((outcome) => (outcome.error === undefined ? [] : [outcome.error]));
  for (const error of errors) warn(error);
  const findings = config.rules.flatMap((rule) => {
    const finding = findingFor(rule, answers);
    return finding === undefined ? [] : [finding];
  });
  const report: Report = {
    ...baseReport,
    backend: backend.name,
    requestedModel: backend.model,
    models: [...new Set(answers.map((answer) => answer.model))].sort(),
    chunks: inputs.length,
    cachedAnswers: outcomes.reduce((sum, outcome) => sum + outcome.cached, 0),
    requests: outcomes.filter((outcome) => outcome.requested).length,
    errors,
    findings,
  };
  const fired = findings.filter((finding) => finding.fired);
  const failing = fired.some((finding) => finding.severity === "error") || (options.fail && fired.length > 0);
  const exitCode = failing ? 1 : errors.length > 0 && failOnBackend ? 2 : 0;
  return finish(exitCode, report, formatHuman(report, change));
}
