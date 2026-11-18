// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/prefer-schema-over-json -- a standalone CLI outside any Effect runtime, so Effect's platform services do not apply

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Backend, RuleAnswer } from "./backends.ts";
import type { JudgeInput } from "./input.ts";
import type { DiffRule } from "./rules.ts";

export const defaultCacheDir = (root: string): string =>
  join(root, "node_modules", ".cache", "anti-slop-diff-rules");

/**
 * Only what changes the answer: the backend, the requested model, the question, and the exact
 * input. A rule's message, severity, and cutoff only change how the answer is reported.
 */
export function cacheKey(backend: Backend, rule: DiffRule, input: JudgeInput): string {
  const payload = JSON.stringify({ v: 1, backend: backend.identity, model: backend.model, question: rule.question, input: input.hash });
  return createHash("sha256").update(payload).digest("hex");
}

export function readCachedAnswer(dir: string, key: string, id: string): RuleAnswer | undefined {
  try {
    const stored: unknown = JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8"));
    if (typeof stored !== "object" || stored === null) return undefined;
    const probability: unknown = "probability" in stored ? stored.probability : undefined;
    const evidence: unknown = "evidence" in stored ? stored.evidence : undefined;
    const files: unknown = "files" in stored ? stored.files : undefined;
    const model: unknown = "model" in stored ? stored.model : undefined;
    if (typeof probability !== "number" || !(probability >= 0 && probability <= 1)) return undefined;
    if (typeof model !== "string") return undefined;
    return {
      id,
      probability,
      model,
      ...(typeof evidence === "string" ? { evidence } : {}),
      ...(Array.isArray(files) && files.every((file) => typeof file === "string") ? { files } : {}),
    };
  } catch {
    return undefined;
  }
}

export function writeCachedAnswer(dir: string, key: string, answer: RuleAnswer): void {
  const target = join(dir, `${key}.json`);
  const temp = `${target}.tmp-${process.pid}`;
  mkdirSync(dir, { recursive: true });
  const { probability, evidence, files, model } = answer;
  writeFileSync(temp, JSON.stringify({ probability, evidence, files, model }));
  renameSync(temp, target);
}
