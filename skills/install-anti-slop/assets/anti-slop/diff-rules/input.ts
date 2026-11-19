// oxlint-disable effecttsgo/node-builtin-import -- a standalone CLI outside any Effect runtime, so Effect's platform services do not apply

import { createHash } from "node:crypto";
import type { ChangeSet, FileChange, HistorySummary } from "./git.ts";
import type { DiffRule } from "./rules.ts";

/** One request's worth of the change set. */
export interface JudgeInput {
  /** Text sent as the decision model's state and embedded in LLM prompts. */
  readonly text: string;
  /** SHA-256 of `text`, the cache key's input component. */
  readonly hash: string;
  readonly index: number;
  readonly total: number;
  /** Files whose hunks this chunk contains. */
  readonly files: ReadonlyArray<string>;
}

export interface InputOptions {
  readonly purpose?: string;
  readonly maxChunkChars: number;
  /** Files listed in the cross-file summary before it is truncated. */
  readonly maxSummaryFiles: number;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const STATUS_LETTER: Record<FileChange["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

/**
 * The part of every chunk that gives the cross-file view: purpose, commits, every changed file
 * with its size, and history. Cross-file rules such as shotgun surgery need it even when the hunks
 * of most files are in other chunks.
 */
export function renderSummary(change: ChangeSet, history: HistorySummary, options: InputOptions): string {
  const lines: string[] = ["# Change set", ""];
  lines.push(`Purpose: ${options.purpose ?? "(not stated)"}`);
  if (change.branch !== undefined) lines.push(`Branch: ${change.branch}`);
  lines.push(`Base: ${change.baseLabel}${change.baseCommit === undefined ? "" : ` (${change.baseCommit.slice(0, 12)})`}`);
  lines.push(`Scope: ${change.mode === "full" ? "commits since the base plus uncommitted changes" : change.mode}`);
  if (change.commits.length > 0) {
    lines.push("", "Commits in this change, newest first:");
    for (const commit of change.commits) lines.push(`- ${commit.subject}`);
  }

  const added = change.files.reduce((sum, file) => sum + file.added, 0);
  const deleted = change.files.reduce((sum, file) => sum + file.deleted, 0);
  lines.push("", `Changed files (${change.files.length} files, +${added} -${deleted}):`);
  for (const file of change.files.slice(0, options.maxSummaryFiles)) {
    const renamed = file.oldPath === undefined ? "" : ` (from ${file.oldPath})`;
    lines.push(`${STATUS_LETTER[file.status]} ${file.path}${renamed} +${file.added} -${file.deleted}`);
  }
  if (change.files.length > options.maxSummaryFiles) {
    lines.push(`... and ${change.files.length - options.maxSummaryFiles} more files`);
  }
  if (change.skipped.length > 0) {
    lines.push(`Binary or oversized files not shown: ${change.skipped.length}`);
  }

  const histories = Object.entries(history.files).filter(([, file]) => file.subjects.length > 0);
  if (histories.length > 0) {
    lines.push("", `History before this change (recent commit subjects per file; commits among the last ${history.window}):`);
    for (const [path, file] of histories) {
      lines.push(`${path} (${file.recentCommits} of the last ${history.window} commits):`);
      for (const subject of file.subjects) lines.push(`  - ${subject}`);
    }
  }
  if (history.coChanges.length > 0) {
    lines.push("", `Touched files that changed together in the last ${history.window} commits:`);
    for (const pair of history.coChanges) lines.push(`${pair.left} <-> ${pair.right}: ${pair.commits} commits`);
  }
  return lines.join("\n");
}

function truncatePatch(patch: string, maxChars: number): string {
  if (patch.length <= maxChars) return patch;
  return `${patch.slice(0, maxChars)}\n... [diff truncated: ${patch.length - maxChars} more characters]\n`;
}

/**
 * Split the hunks into chunks of at most `maxChunkChars`, keeping files sorted by path so a
 * directory's files tend to share a chunk. Every chunk repeats the summary.
 */
export function buildInputs(change: ChangeSet, history: HistorySummary, options: InputOptions): JudgeInput[] {
  const summary = renderSummary(change, history, options);
  const groups: FileChange[][] = [];
  let current: FileChange[] = [];
  let size = 0;
  for (const file of change.files) {
    const length = Math.min(file.patch.length, options.maxChunkChars);
    if (current.length > 0 && size + length > options.maxChunkChars) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += length;
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group, index) => {
    const header =
      groups.length === 1
        ? "# Diff"
        : `# Diff, part ${index + 1} of ${groups.length} (hunks for the other files are judged separately; the file list above covers the whole change)`;
    const text = [
      summary,
      "",
      header,
      "",
      ...group.map((file) => truncatePatch(file.patch, options.maxChunkChars)),
    ].join("\n");
    return { text, hash: sha256(text), index, total: groups.length, files: group.map((file) => file.path) };
  });
}

/** The prompt for chat-model and CLI judges; the decision model gets `input.text` directly. */
export function renderJudgePrompt(rules: ReadonlyArray<DiffRule>, input: JudgeInput): string {
  return [
    "You are reviewing a code change for design smells (Martin Fowler, Refactoring, 2nd ed., chapter 3) and review-process problems.",
    "Answer each rule's question about the change set below. Answering yes (violation: true) means the change violates the rule.",
    "Respond with only one JSON object and no other text or code fences, in exactly this shape:",
    '{"rules":[{"id":"<rule id>","violation":true,"confidence":0.0,"evidence":"<one or two sentences naming the files and code>","files":["<path>"]}]}',
    "Include every rule id below exactly once. confidence is a number from 0 to 1: how confident you are that your violation answer is correct. files lists the changed files the evidence refers to, or [] when there is no violation.",
    "",
    "# Rules",
    "",
    ...rules.map((rule) => `- ${rule.id}: ${rule.question}`),
    "",
    input.text,
  ].join("\n");
}
