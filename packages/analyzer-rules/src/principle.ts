import type { Principle, ReportLanguage } from "@flawdot/core-model";
import type { WcagCriteriaTable } from "./wcag-criteria.js";

/** The tags of an axe rule that name a WCAG criterion: `wcag143` is 1.4.3, `wcag1411` is 1.4.11. A level has letters. */
const CRITERION_TAG = /^wcag(\d)(\d)(\d{1,2})$/;

const BEST_PRACTICE_LABEL: Readonly<Record<ReportLanguage, string>> = {
  en: "axe best practice",
  it: "buona pratica axe",
};
const PLAIN_RULE_LABEL = "axe rule";

/** "1.4.3" before "1.4.11": numbers, not text. */
const byNumber = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

/** The WCAG criteria that the tags of a rule name, as "1.4.3", in numeric order and without repeats. */
export function criteriaFromTags(tags: readonly string[]): string[] {
  const found = new Set<string>();
  for (const tag of tags) {
    const match = CRITERION_TAG.exec(tag);
    if (match !== null) found.add(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return [...found].sort(byNumber);
}

/**
 * The principle a finding reports. A rule that names a criterion reports the lowest one (with its name, or the code
 * when the table does not know it). A rule that is only a best practice has no code: it is not a WCAG criterion, and
 * FlawDot reports a WCAG criterion only if the tags of axe name it.
 */
export function principleFor(
  tags: readonly string[],
  wcag: WcagCriteriaTable,
  language: ReportLanguage,
): Principle {
  const [criterion] = criteriaFromTags(tags);
  if (criterion !== undefined) {
    const code = `WCAG ${criterion}`;
    return { code, label: wcag.get(criterion)?.[language] ?? code };
  }
  return {
    code: null,
    label: tags.includes("best-practice") ? BEST_PRACTICE_LABEL[language] : PLAIN_RULE_LABEL,
  };
}
