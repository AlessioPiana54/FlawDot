import { z } from "zod";
import {
  EXPLANATION_MAX,
  FIX_MAX,
  TITLE_MAX,
  parseOrThrow,
  type ReportLanguage,
} from "@flawdot/core-model";

/** The texts of a finding that FlawDot writes for a rule: what it is, why it matters, how to fix it. */
export interface RuleText {
  title: string;
  explanation: string;
  fix: string;
}

/**
 * The texts for the rules that FlawDot knows. A rule it has no text for gives `undefined`, and the finding then
 * uses the English text that axe gave (the adapter does that, so a catalog never has to).
 */
export interface RuleCatalog {
  lookup(ruleId: string, language: ReportLanguage): RuleText | undefined;
}

/** A catalog with no rule in it: every finding uses the text of axe. */
export const emptyCatalog: RuleCatalog = { lookup: () => undefined };

/** What a catalog is built from: the files that FlawDot wrote, one for each language, and the Italian file of axe. */
export interface CatalogSources {
  /** `catalog/<language>.json`: parsed, not yet checked. */
  own: Readonly<Record<ReportLanguage, unknown>>;
  /** `axe-core/locales/it.json`: parsed, not yet checked. */
  axeItalian: unknown;
}

const LANGUAGES: readonly ReportLanguage[] = ["en", "it"];

const ruleId = z.string().regex(/^[a-z0-9-]{1,100}$/);
const nonBlank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim() !== "", "must not be blank");

const ownFileSchema = z.record(
  ruleId,
  z.strictObject({
    title: nonBlank(TITLE_MAX),
    explanation: nonBlank(EXPLANATION_MAX),
    fix: nonBlank(FIX_MAX),
  }),
);

const axeEntrySchema = z.object({ help: nonBlank(Infinity), description: nonBlank(Infinity) });

/**
 * The Italian that axe wrote for the rules that FlawDot has no text for. It is the data of a dependency, so what is
 * not usable is skipped: the finding then keeps the English text of axe. axe gives a title and a description but no
 * fix, so the title (its `help` says what to do) is also the fix.
 */
function axeItalianTexts(file: unknown): Map<string, RuleText> {
  const texts = new Map<string, RuleText>();
  const parsed = z.object({ rules: z.record(z.string(), z.unknown()) }).safeParse(file);
  if (!parsed.success) return texts;
  for (const [id, entry] of Object.entries(parsed.data.rules)) {
    const found = axeEntrySchema.safeParse(entry);
    if (found.success && ruleId.safeParse(id).success) {
      texts.set(id, {
        title: found.data.help,
        explanation: found.data.description,
        fix: found.data.help,
      });
    }
  }
  return texts;
}

/**
 * The catalog of FlawDot. For a rule it gives, in this order: the text that FlawDot wrote in the language asked for;
 * for Italian, the Italian text of axe; else nothing. The files of FlawDot are checked strictly, because a wrong one
 * is a bug that must show at once (the error says which language, never the text). Nothing here reads a file: the
 * caller gives the data, so this is pure.
 */
export function createRuleCatalog(sources: CatalogSources): RuleCatalog {
  const own = new Map<ReportLanguage, Map<string, RuleText>>();
  for (const language of LANGUAGES) {
    const file = parseOrThrow(ownFileSchema, sources.own[language], {
      code: "INTERNAL",
      what: `rule catalog (${language})`,
    });
    own.set(language, new Map(Object.entries(file)));
  }
  const axeItalian = axeItalianTexts(sources.axeItalian);

  return {
    lookup(id, language) {
      const written = own.get(language)?.get(id);
      if (written !== undefined) return written;
      return language === "it" ? axeItalian.get(id) : undefined;
    },
  };
}
