import { z } from "zod";
import { EVIDENCE_MAX, type ReportLanguage } from "@flawdot/core-model";
import type { ParsedNode } from "./axe-results.js";
import { sanitizeText } from "./text.js";

// The fact behind a violation, in a few words: for a person it is the quickest way to see why the finding is there.
// Everything read from the check data is checked first, because the page wrote part of it; what cannot be trusted
// gives `null`, never a guess. A rule that has no extractor has no evidence: the explanation says it all. A value
// that the page wrote reaches the text only as a short token that matched a strict pattern.

/** The words around the facts, in each language. A language that is added fails to compile until it has all of them. */
interface Words {
  on: string;
  needs: string;
  noName: string;
  noNameOn: string;
  invalidLang: string;
  unknownRole: string;
  unknownAttribute: string;
  notAllowed: string;
}

const WORDS: Readonly<Record<ReportLanguage, Words>> = {
  en: {
    on: "on",
    needs: "needs",
    noName: "No accessible name",
    noNameOn: "No accessible name on",
    invalidLang: "Invalid language code:",
    unknownRole: "Unknown role:",
    unknownAttribute: "Unknown attribute:",
    notAllowed: "Not allowed on this element:",
  },
  it: {
    on: "su",
    needs: "richiesto",
    noName: "Nessun nome accessibile",
    noNameOn: "Nessun nome accessibile su",
    invalidLang: "Codice lingua non valido:",
    unknownRole: "Ruolo sconosciuto:",
    unknownAttribute: "Attributo sconosciuto:",
    notAllowed: "Non consentito su questo elemento:",
  },
};

/** A number as people write it in the language: Italian has a comma where English has a point. */
const decimal = (value: string, language: ReportLanguage): string =>
  language === "it" ? value.replaceAll(".", ",") : value;

/** The data of the first check of the node that has this id. */
const dataOf = (node: ParsedNode, checkId: string): unknown =>
  node.checks.find((entry) => entry.id === checkId)?.data;

const MAX_NAMED = 3;

/** "foo, bar, baz, +2": the first names, and how many more there are. */
function nameList(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMED).join(", ");
  return names.length > MAX_NAMED ? `${shown}, +${String(names.length - MAX_NAMED)}` : shown;
}

const hexColor = z.string().regex(/^#[0-9a-f]{3,8}$/i);
const contrastData = z.object({
  fgColor: hexColor,
  bgColor: hexColor,
  contrastRatio: z.number().finite().positive(),
  expectedContrastRatio: z.string().regex(/^\d+(\.\d+)?:1$/),
});

/** "#c9c9c9 on #f7f5ff, 1.53:1 (needs 4.5:1)" */
function contrast(node: ParsedNode, language: ReportLanguage): string | null {
  const check = node.checks.find((entry) => entry.id.startsWith("color-contrast"));
  const data = contrastData.safeParse(check?.data);
  if (!data.success) return null;
  const { fgColor, bgColor, contrastRatio, expectedContrastRatio } = data.data;
  const words = WORDS[language];
  const ratio = decimal(String(contrastRatio), language);
  const needed = decimal(expectedContrastRatio, language);
  return `${fgColor} ${words.on} ${bgColor}, ${ratio}:1 (${words.needs} ${needed})`;
}

/** "No accessible name on <button>": only the name of the tag, never the attributes the page wrote. */
function missingName(node: ParsedNode, language: ReportLanguage): string | null {
  const tag = /^<([a-z][a-z0-9-]*)/i.exec(node.html)?.[1];
  const words = WORDS[language];
  return tag === undefined ? words.noName : `${words.noNameOn} <${tag.toLowerCase()}>`;
}

const size = z.number().finite().positive();
const targetSizeData = z.object({ minSize: size, width: size, height: size });

/** "18x20.5 px (needs 24x24 px)": a target that is smaller than the minimum. */
function targetSize(node: ParsedNode, language: ReportLanguage): string | null {
  const data = targetSizeData.safeParse(dataOf(node, "target-size"));
  if (!data.success) return null;
  const { minSize, width, height } = data.data;
  const measured = decimal(`${String(width)}x${String(height)}`, language);
  const needed = decimal(`${String(minSize)}x${String(minSize)}`, language);
  return `${measured} px (${WORDS[language].needs} ${needed} px)`;
}

/** The entries of a list that are text and match the pattern; the others are skipped. */
function tokens(data: unknown, pattern: RegExp): string[] {
  const list = z.array(z.unknown()).safeParse(data);
  if (!list.success) return [];
  return list.data.filter(
    (entry): entry is string => typeof entry === "string" && pattern.test(entry),
  );
}

/** An attribute that names a language: `lang="xx"` or `xml:lang="xx"`. */
const LANG_ATTRIBUTE = /^(?:xml:)?lang="[A-Za-z0-9_-]{1,35}"$/;

function invalidLang(node: ParsedNode, language: ReportLanguage): string | null {
  const [found] = tokens(dataOf(node, "valid-lang"), LANG_ATTRIBUTE);
  return found === undefined ? null : `${WORDS[language].invalidLang} ${found}`;
}

const ROLE_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const ARIA_NAME = /^aria-[a-z0-9-]{1,40}$/;

function unknownRole(node: ParsedNode, language: ReportLanguage): string | null {
  const roles = tokens(dataOf(node, "invalidrole"), ROLE_TOKEN);
  return roles.length === 0 ? null : `${WORDS[language].unknownRole} ${nameList(roles)}`;
}

function unknownAttribute(node: ParsedNode, language: ReportLanguage): string | null {
  const names = tokens(dataOf(node, "aria-valid-attr"), ARIA_NAME);
  return names.length === 0 ? null : `${WORDS[language].unknownAttribute} ${nameList(names)}`;
}

const allowedAttrData = z.object({ messageKey: z.string().optional(), values: z.unknown() });
const ATTRIBUTE_WITH_VALUE = /^aria-[a-z0-9-]{1,40}=/;

/** The values of an attribute are written by the page: only the names (the text before the `=`) are used. */
function attributeNotAllowed(node: ParsedNode, language: ReportLanguage): string | null {
  const data = allowedAttrData.safeParse(dataOf(node, "aria-allowed-attr"));
  // A value in the wrong case is a different problem, with another explanation.
  if (!data.success || data.data.messageKey === "caseSensitive") return null;
  const names = tokens(data.data.values, ATTRIBUTE_WITH_VALUE).map((entry) =>
    entry.slice(0, entry.indexOf("=")),
  );
  return names.length === 0 ? null : `${WORDS[language].notAllowed} ${nameList(names)}`;
}

type Extractor = (node: ParsedNode, language: ReportLanguage) => string | null;

const MISSING_NAME_RULES = [
  "button-name",
  "link-name",
  "image-alt",
  "input-image-alt",
  "input-button-name",
  "label",
  "select-name",
  "role-img-alt",
  "svg-img-alt",
  "frame-title",
  "summary-name",
  "area-alt",
  "aria-input-field-name",
  "aria-toggle-field-name",
  "aria-command-name",
  "aria-meter-name",
  "aria-progressbar-name",
  "aria-tooltip-name",
  "aria-treeitem-name",
  "aria-dialog-name",
];

/** One extractor for each rule that has evidence. */
const EXTRACTORS: ReadonlyMap<string, Extractor> = new Map<string, Extractor>([
  ...["color-contrast", "color-contrast-enhanced"].map((id): [string, Extractor] => [id, contrast]),
  ...MISSING_NAME_RULES.map((id): [string, Extractor] => [id, missingName]),
  ["target-size", targetSize],
  ["html-lang-valid", invalidLang],
  ["valid-lang", invalidLang],
  ["aria-roles", unknownRole],
  ["aria-valid-attr", unknownAttribute],
  ["aria-allowed-attr", attributeNotAllowed],
]);

/** The evidence of one element of a violation, or null when the rule has none (the explanation says it all). */
export function evidenceFor(
  ruleId: string,
  node: ParsedNode,
  // English is the default for a caller that has no language; the adapter always passes one.
  language: ReportLanguage = "en",
): string | null {
  const text = EXTRACTORS.get(ruleId)?.(node, language) ?? null;
  if (text === null) return null;
  const clean = sanitizeText(text, EVIDENCE_MAX);
  return clean === "" ? null : clean;
}
