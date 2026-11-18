import type { ReportLanguage } from "@flawdot/core-model";

/** The texts of a finding that FlawDot writes for a rule: what it is, why it matters, how to fix it. */
export interface RuleText {
  title: string;
  explanation: string;
  fix: string;
}

/**
 * The texts FlawDot wrote for the rules it knows (the catalog of Task 13). A rule it does not know has no entry, and
 * the finding then uses the English text of axe.
 */
export interface RuleCatalog {
  lookup(ruleId: string, language: ReportLanguage): RuleText | undefined;
}

/** A catalog with no rule in it: every finding uses the text of axe. */
export const emptyCatalog: RuleCatalog = { lookup: () => undefined };
