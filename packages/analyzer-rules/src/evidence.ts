import { z } from "zod";
import { EVIDENCE_MAX } from "@flawdot/core-model";
import type { ParsedNode } from "./axe-results.js";
import { sanitizeText } from "./text.js";

// The fact behind a violation, in a few words: for a person it is the quickest way to see why the finding is there.
// Everything read from the check data is checked first, because the page wrote part of it; what cannot be trusted
// gives `null`, never a guess. A rule that is in neither family has no evidence: the explanation says it all.

const hexColor = z.string().regex(/^#[0-9a-f]{3,8}$/i);
const contrastData = z.object({
  fgColor: hexColor,
  bgColor: hexColor,
  contrastRatio: z.number().finite().positive(),
  expectedContrastRatio: z.string().regex(/^\d+(\.\d+)?:1$/),
});

/** "#c9c9c9 on #f7f5ff, 1.53:1 (needs 4.5:1)" */
function contrast(node: ParsedNode): string | null {
  const check = node.checks.find((entry) => entry.id.startsWith("color-contrast"));
  const data = contrastData.safeParse(check?.data);
  if (!data.success) return null;
  const { fgColor, bgColor, contrastRatio, expectedContrastRatio } = data.data;
  return `${fgColor} on ${bgColor}, ${String(contrastRatio)}:1 (needs ${expectedContrastRatio})`;
}

/** "No accessible name on <button>": only the name of the tag, never the attributes the page wrote. */
function missingName(node: ParsedNode): string | null {
  const tag = /^<([a-z][a-z0-9-]*)/i.exec(node.html)?.[1];
  return tag === undefined ? "No accessible name" : `No accessible name on <${tag.toLowerCase()}>`;
}

const CONTRAST_RULES: ReadonlySet<string> = new Set(["color-contrast", "color-contrast-enhanced"]);

const MISSING_NAME_RULES: ReadonlySet<string> = new Set([
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
]);

/** The evidence of one element of a violation, or null when the rule has none (the explanation says it all). */
export function evidenceFor(ruleId: string, node: ParsedNode): string | null {
  let text: string | null = null;
  if (CONTRAST_RULES.has(ruleId)) text = contrast(node);
  else if (MISSING_NAME_RULES.has(ruleId)) text = missingName(node);
  if (text === null) return null;
  const clean = sanitizeText(text, EVIDENCE_MAX);
  return clean === "" ? null : clean;
}
