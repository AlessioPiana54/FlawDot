import * as z from "zod";
import {
  boxSchema,
  categorySchema,
  reportLanguageSchema,
  severitySchema,
  viewportNameSchema,
  type Category,
  type ReportLanguage,
  type ViewportName,
} from "./domain.js";
import { findingIdSchema, markIdSchema, runIdSchema, type FindingId, type RunId } from "./ids.js";
import { parseOrThrow } from "./parse.js";
import { sha256Hex } from "./sha256.js";

// Limits on the text of a finding. The text can come from an AI answer, which is untrusted input.
export const TITLE_MAX = 200;
export const EXPLANATION_MAX = 2000;
export const FIX_MAX = 2000;
export const EVIDENCE_MAX = 500;

const nonEmpty = z.string().min(1);

/** Where a finding comes from: a rule ("Verified") or the AI ("AI suggestion"). */
export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rule"), engine: z.literal("axe-core"), ruleId: nonEmpty }),
  z.object({
    kind: z.literal("ai"),
    confidence: z.number().min(0).max(1),
    model: nonEmpty, // "claude-sonnet-5-5", or "claude-code" in MCP mode
  }),
]);
export type Source = z.infer<typeof sourceSchema>;

/** The element a finding points at, or the page as a whole (no circle is drawn for those). */
export const locationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("element"),
    mark: markIdSchema,
    selector: nonEmpty,
    box: boxSchema,
    count: z.int().positive(), // how many equal elements are affected (5 images without alt)
  }),
  z.object({ kind: z.literal("page") }),
]);
export type Location = z.infer<typeof locationSchema>;

/** The principle that is violated: `{ code: "WCAG 1.4.3", label: "Contrast (Minimum)" }`. */
export const principleSchema = z.object({
  code: nonEmpty.nullable(),
  label: nonEmpty,
});
export type Principle = z.infer<typeof principleSchema>;

/** What an analyzer produces. The kernel turns it into a `Finding`. */
export const findingDraftSchema = z.object({
  category: categorySchema,
  severity: severitySchema,
  ruleKey: nonEmpty, // grouping key: the axe rule id, or the normalized key the AI used
  title: nonEmpty.max(TITLE_MAX),
  explanation: nonEmpty.max(EXPLANATION_MAX), // "Why it matters"
  fix: nonEmpty.max(FIX_MAX), // "How to fix"
  evidence: nonEmpty.max(EVIDENCE_MAX).nullable(), // the observed data, e.g. "#c9c9c9 on #f7f5ff, 1.5:1"
  principle: principleSchema,
  source: sourceSchema,
  location: locationSchema,
});
export type FindingDraft = z.infer<typeof findingDraftSchema>;

export const findingSchema = findingDraftSchema.extend({
  id: findingIdSchema,
  runId: runIdSchema,
  pageUrl: z.url({ protocol: /^https?$/ }),
  templateKey: nonEmpty,
  viewport: viewportNameSchema,
  // The circle number. `toFinding` leaves it null: numbering needs every finding of the page and viewport.
  number: z.int().positive().nullable(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  language: reportLanguageSchema,
});
export type Finding = z.infer<typeof findingSchema>;

/** Whether the user has marked a problem as not worth fixing. Tied to the fingerprint, not to one finding. */
export const findingStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open") }),
  z.object({
    kind: z.literal("ignored"),
    reason: z.enum(["not_a_problem", "false_positive"]),
    at: z.iso.datetime(),
  }),
]);
export type FindingState = z.infer<typeof findingStateSchema>;

/** Against the previous completed run of the same project. */
export const COMPARISONS = ["new", "still_open", "fixed"] as const;
export const comparisonSchema = z.enum(COMPARISONS);
export type Comparison = z.infer<typeof comparisonSchema>;

// Classes that a build tool generates and that change on every deploy: CSS-in-JS ("css-1a2b3c",
// "sc-bdfBwQ", "jsx-123456"), CSS Modules ("Button_root__x1y2z") and "name-<hex>" hashes.
const GENERATED_CLASS = [
  /^(?:css|sc|jsx|emotion|styled|svelte|astro)-[A-Za-z0-9]{4,}$/,
  /__[A-Za-z0-9_-]{5,}$/,
  /^[A-Za-z]+-[0-9a-f]{6,}$/,
];
const NTH_PSEUDO = /:nth-(?:last-)?(?:child|of-type)\([^)]*\)/g;
const CLASS_TOKEN = /\.((?:\\.|[A-Za-z0-9_-])+)/g;

/**
 * The selector without what changes between two pages of the same template or between two deploys:
 * `:nth-child` style positions and generated class names. What is left is what identifies the element.
 */
export function normalizeSelector(selector: string): string {
  return selector
    .replace(NTH_PSEUDO, "")
    .replace(CLASS_TOKEN, (token, name: string) =>
      GENERATED_CLASS.some((pattern) => pattern.test(name)) ? "" : token,
    )
    .replace(/\s+/g, " ")
    .trim();
}

export interface FingerprintInput {
  templateKey: string;
  viewport: ViewportName;
  category: Category;
  ruleKey: string;
  location: Location;
}

/**
 * Stable identity of a problem across runs: the same problem on the same template gives the same value,
 * whatever the page URL. It drives "new / still open / fixed" and "ignore". Changing how it is computed
 * changes every comparison with the stored history, so that needs the user's approval.
 */
export function fingerprint(input: FingerprintInput): string {
  const selector =
    input.location.kind === "element" ? normalizeSelector(input.location.selector) : "";
  const parts = [input.templateKey, input.viewport, input.category, input.ruleKey, selector];
  return sha256Hex(parts.join("\u001f")); // unit separator: no ambiguity between neighbouring parts
}

export interface FindingContext {
  id: FindingId;
  runId: RunId;
  pageUrl: string;
  templateKey: string;
  viewport: ViewportName;
  language: ReportLanguage;
}

/**
 * Validates a draft and turns it into a finding with its fingerprint. A malformed draft throws
 * `INVALID_INPUT`; it is never converted into something that looks right.
 */
export function toFinding(draft: FindingDraft, context: FindingContext): Finding {
  const valid = parseOrThrow(findingDraftSchema, draft, { what: "finding draft" });
  return {
    ...valid,
    ...context,
    number: null,
    fingerprint: fingerprint({
      templateKey: context.templateKey,
      viewport: context.viewport,
      category: valid.category,
      ruleKey: valid.ruleKey,
      location: valid.location,
    }),
  };
}
