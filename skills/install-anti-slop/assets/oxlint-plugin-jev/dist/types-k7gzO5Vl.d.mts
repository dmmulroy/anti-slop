//#region src/types.d.ts
type Target = 'function' | 'call' | 'jsx' | 'file';
type CiBehavior = 'skip' | 'fail';
interface JevRule {
  /** Unique within the rule list. Shown in the lint message. */
  id: string;
  target: Target;
  /** One English yes/no question. "Yes" means "report an error". */
  question: string;
  /** Report when the yes-probability is >= this. Between 0 and 1. */
  cutoff: number;
  /** File rules may select a source line, keeping a file-level finding below this probability. */
  location?: {
    question: string;
    cutoff: number;
  };
  /** Shown instead of the question when the rule fires. Not sent to the model. */
  message?: string;
}
interface JudgeOptions {
  /** An AI SDK language model id: an AI Gateway id such as `openai/gpt-5-mini`, or an id the `provider` module knows. */
  model: string;
  /** Path, relative to the working directory, of an ES module whose default export is an AI SDK provider or registry. */
  provider?: string;
}
interface SharedOptions {
  ci?: CiBehavior;
  timeoutMs?: number;
  maxMatchesPerFile?: number;
  maxSnippetChars?: number;
  /** A TypeSafe model id such as `jev-latest`, or an AI Gateway decision model id such as `typesafe-ai/jev`. */
  model?: string;
  /** Send TypeSafe's long-context header, raising its token limits. */
  longContext?: boolean;
  /** Answer the questions with an LLM judge instead of Jev. */
  judge?: JudgeOptions;
  /** Only check matches that overlap lines changed against `changedBase`. */
  changedOnly?: boolean;
  /** The git ref `changedOnly` diffs against. */
  changedBase?: string;
}
interface JevOptions extends SharedOptions {
  rules: JevRule[];
}
interface JevPluginOptions extends SharedOptions {
  /** The oxlint plugin name. Each rule is configured as `<name>/<id>`. */
  name: string;
  rules: JevRule[];
}
interface BooleanQuestion {
  type: 'boolean';
  instructions: string;
}
interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
}
type Question = BooleanQuestion | ChoiceQuestion;
interface DecisionRequest {
  state: {
    snippets: Record<string, string>;
  };
  questions: Record<string, Question>;
}
type Backend = {
  kind: 'typesafe';
  model: string;
  apiKey: string;
  baseURL: string;
  longContext: boolean;
} | {
  kind: 'gateway';
  model: string;
  longContext: boolean;
} | {
  kind: 'judge';
  model: string;
  provider?: string;
};
interface AskInput {
  backend: Backend;
  request: DecisionRequest;
  timeoutMs: number;
}
/** `answers` are AI SDK decision answers, such as `{ type: 'boolean', probability }`. */
type AskResult = {
  ok: true;
  model: string;
  answers: Record<string, unknown>;
} | {
  ok: false;
  reason: string;
};
/** The public shape of the default export. Consumers load the plugin by name, so the rule
 * internals are deliberately not part of the published type. */
interface JevPlugin {
  meta: {
    name: string;
  };
  rules: {
    ask: object;
    suggest: object;
  };
}
/** The public shape of a `createJevPlugin` plugin: one oxlint rule per question id. */
interface JevRulesPlugin {
  meta: {
    name: string;
  };
  rules: Record<string, object>;
}
//#endregion
export { JevPlugin as a, JevRulesPlugin as c, JevOptions as i, JudgeOptions as l, AskResult as n, JevPluginOptions as o, CiBehavior as r, JevRule as s, AskInput as t, Target as u };