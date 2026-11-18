// oxlint-disable effecttsgo/global-console -- a plain tsx test script outside any Effect runtime reports its result on the console
import assert from "node:assert/strict";
import type { ChangeSet, FileChange, HistorySummary } from "./git.ts";
import { buildInputs, renderJudgePrompt } from "./input.ts";
import { defaultDiffRules } from "./rules.ts";

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void): void => {
  tests.push([name, run]);
};

function file(path: string, size: number): FileChange {
  const header = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n`;
  return { path, status: "modified", added: 1, deleted: 1, patch: `${header}+${"x".repeat(Math.max(0, size - header.length - 2))}\n` };
}

function changeOf(files: FileChange[]): ChangeSet {
  return {
    root: "/repo",
    mode: "full",
    baseLabel: "origin/main",
    baseCommit: "0123456789abcdef",
    branch: "feature/add-field",
    commits: [{ hash: "abc", subject: "Add a field to the order record" }],
    files,
    skipped: [],
    notes: [],
  };
}

const history: HistorySummary = {
  window: 200,
  files: { "src/api/order.ts": { subjects: ["Fix order totals"], recentCommits: 4 } },
  coChanges: [{ left: "src/api/order.ts", right: "src/db/order.ts", commits: 3 }],
};

test("chunks hunks under the budget while every chunk keeps the whole file list and history", () => {
  const files = [file("src/api/order.ts", 400), file("src/db/order.ts", 400), file("src/ui/order.tsx", 400)];
  const inputs = buildInputs(changeOf(files), history, { maxChunkChars: 900, maxSummaryFiles: 100, purpose: "Add a discount field" });
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs.map((input) => input.files), [["src/api/order.ts", "src/db/order.ts"], ["src/ui/order.tsx"]]);
  for (const input of inputs) {
    for (const path of ["src/api/order.ts", "src/db/order.ts", "src/ui/order.tsx"]) {
      assert.match(input.text, new RegExp(`^M ${path} \\+1 -1$`, "m"));
    }
    assert.match(input.text, /^Purpose: Add a discount field$/m);
    assert.match(input.text, /^src\/api\/order\.ts <-> src\/db\/order\.ts: 3 commits$/m);
    assert.match(input.text, /^ {2}- Fix order totals$/m);
    assert.match(input.text, /^- Add a field to the order record$/m);
    assert.match(input.text, new RegExp(`# Diff, part ${input.index + 1} of 2`));
  }
  assert.ok(!inputs[1]?.text.includes("+++ b/src/api/order.ts"), "hunks are not repeated across chunks");
  assert.notEqual(inputs[0]?.hash, inputs[1]?.hash);
});

test("a single chunk has a plain diff header and identical input hashes identical text", () => {
  const files = [file("a.ts", 100)];
  const [first] = buildInputs(changeOf(files), history, { maxChunkChars: 1000, maxSummaryFiles: 100 });
  const [again] = buildInputs(changeOf(files), history, { maxChunkChars: 1000, maxSummaryFiles: 100 });
  assert.match(first?.text ?? "", /^# Diff$/m);
  assert.match(first?.text ?? "", /^Purpose: \(not stated\)$/m);
  assert.equal(first?.hash, again?.hash);
});

test("truncates a file larger than the budget and caps the summary list", () => {
  const files = [file("big.ts", 5000), ...Array.from({ length: 5 }, (_, index) => file(`f${index}.ts`, 50))];
  const inputs = buildInputs(changeOf(files), history, { maxChunkChars: 1000, maxSummaryFiles: 3 });
  const big = inputs.find((input) => input.files.includes("big.ts"));
  assert.match(big?.text ?? "", /\[diff truncated: \d+ more characters\]/);
  assert.match(inputs[0]?.text ?? "", /^\.\.\. and 3 more files$/m);
});

test("the judge prompt lists every rule and the JSON contract", () => {
  const [input] = buildInputs(changeOf([file("a.ts", 100)]), history, { maxChunkChars: 1000, maxSummaryFiles: 10 });
  if (input === undefined) throw new Error("no input");
  const prompt = renderJudgePrompt(defaultDiffRules, input);
  for (const rule of defaultDiffRules) assert.ok(prompt.includes(`- ${rule.id}: ${rule.question}`));
  assert.match(prompt, /"violation":true,"confidence"/);
  assert.ok(prompt.endsWith(input.text));
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}
if (failed > 0) process.exit(1);
