/**
 * Diff rules judge a whole change set rather than one function or file: smells that only show up
 * across files or against git history. Each question is answered YES when the change violates
 * the rule. The smells come from Martin Fowler, "Refactoring", 2nd ed., chapter 3 ("Bad Smells
 * in Code"), except `scope-creep`, which is a review-process smell.
 */
export type Severity = "warn" | "error";

export interface DiffRule {
  readonly id: string;
  readonly question: string;
  /** Shown when the rule fires, in the form "Possibly <Smell>: <why>. Consider <Refactoring>." */
  readonly message: string;
  /** Minimum probability (decision model) or confidence (LLM judge) of YES that reports. */
  readonly cutoff: number;
  readonly severity: Severity;
}

export const defaultDiffRules: ReadonlyArray<DiffRule> = [
  {
    id: "shotgun-surgery",
    question:
      "Consider the whole change set: the list of changed files with their change sizes, and the diff hunks shown. Ignore edits produced mechanically by one tool or rename (a renamed identifier, moved import paths, a formatting pass, a dependency bump), generated files, and tests that mirror a single source change. Does this change deliver one logical change by making small, similar edits in three or more separate modules, such that the next change of the same kind would need the same scattered edits again because the knowledge involved (a field, a list of cases, a format, a flag, a protocol detail) is not owned by one module?",
    message:
      "Possibly Shotgun Surgery: one logical change spreads small, similar edits across many modules, and the next change of this kind will need the same edits again. Consider Move Function, Move Field, Combine Functions into Class, or Inline Function to gather the behavior in one place.",
    cutoff: 0.75,
    severity: "warn",
  },
  {
    id: "divergent-change",
    question:
      "Use both the diff and the history summary of recent commit subjects for each touched file. Ignore files whose changes all serve one responsibility, index or registration files that only list other modules, configuration files, and test files. Is a single module (one file) in this change edited for two or more unrelated reasons, either within this diff or across its recent commit subjects, so that the module mixes responsibilities that change independently (for example storage and presentation, or a wire protocol and the business rules that use it)?",
    message:
      "Possibly Divergent Change: one module is edited for several unrelated reasons, so it mixes responsibilities that change independently. Consider Split Phase, Move Function, or Extract Class so that each reason to change has its own module.",
    cutoff: 0.75,
    severity: "warn",
  },
  {
    id: "duplicated-code",
    question:
      "Ignore boilerplate the language or framework requires (imports, test setup, declarations that mirror a schema), data tables, and code that is moved rather than copied (removed in one place and added in another). Does the code added in this diff repeat logic of more than a few lines, meaning the same sequence of statements, the same conditional structure, or the same computation with only names or literals changed, that also appears elsewhere in the added lines or in the context lines shown, so that one function could serve every place?",
    message:
      "Possibly Duplicated Code: the added code repeats logic that already appears elsewhere in this change. Consider Extract Function, Slide Statements to line up the shared part first, or Pull Up Method when the copies live in sibling classes.",
    cutoff: 0.8,
    severity: "warn",
  },
  {
    id: "scope-creep",
    question:
      "The stated purpose of this change is the Purpose line when present, otherwise the branch name and commit subjects. Ignore edits the stated purpose requires, including its tests, documentation, types, and small fixes needed to make the change work or pass checks. Does the diff also contain a substantial change unrelated to the stated purpose, such as a refactor, a feature, a dependency or tooling change, or a behavior change in an unrelated area, that could be reviewed and merged as a separate change?",
    message:
      "Possibly scope creep: the change contains work unrelated to its stated purpose, which makes it harder to review and to revert. Consider splitting the unrelated work into a separate change.",
    cutoff: 0.75,
    severity: "warn",
  },
];
