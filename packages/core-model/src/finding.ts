import * as z from "zod";
import {
  boxSchema,
  categorySchema,
  httpUrlSchema,
  reportLanguageSchema,
  SELECTOR_MAX,
  severitySchema,
  viewportNameSchema,
} from "./domain.js";
import { findingIdSchema, markIdSchema, runIdSchema } from "./ids.js";
import { parseOrThrow } from "./parse.js";
import { sha256Hex } from "./sha256.js";

// Limits on the text of a finding. The text can come from an AI answer, which is untrusted input.
export const TITLE_MAX = 200;
export const EXPLANATION_MAX = 2000;
export const FIX_MAX = 2000;
export const EVIDENCE_MAX = 500;
export const RULE_KEY_MAX = 100;
export const PRINCIPLE_CODE_MAX = 50;
export const PRINCIPLE_LABEL_MAX = 200;
export const MODEL_MAX = 200;

const nonEmpty = z.string().min(1);

/** Text that comes from outside: at most `max` characters, and not made only of spaces or line breaks. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim() !== "", { message: "Must not be blank" });

/** Where a finding comes from: a rule ("Verified") or the AI ("AI suggestion"). */
export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rule"), engine: z.literal("axe-core"), ruleId: text(RULE_KEY_MAX) }),
  z.object({
    kind: z.literal("ai"),
    confidence: z.number().min(0).max(1),
    model: text(MODEL_MAX), // "claude-sonnet-5-5", or "claude-code" in MCP mode
  }),
]);
export type Source = z.infer<typeof sourceSchema>;

/** The element a finding points at, or the page as a whole (no circle is drawn for those). */
export const locationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("element"),
    mark: markIdSchema,
    selector: text(SELECTOR_MAX),
    box: boxSchema,
    count: z.int().positive(), // how many equal elements are affected (5 images without alt)
  }),
  z.object({ kind: z.literal("page") }),
]);
export type Location = z.infer<typeof locationSchema>;

/** The principle that is violated: `{ code: "WCAG 1.4.3", label: "Contrast (Minimum)" }`. */
export const principleSchema = z.object({
  code: text(PRINCIPLE_CODE_MAX).nullable(),
  label: text(PRINCIPLE_LABEL_MAX),
});
export type Principle = z.infer<typeof principleSchema>;

/** What an analyzer produces. The kernel turns it into a `Finding`. */
export const findingDraftSchema = z.object({
  category: categorySchema,
  severity: severitySchema,
  ruleKey: text(RULE_KEY_MAX), // grouping key: the axe rule id, or the normalized key the AI used
  title: text(TITLE_MAX),
  explanation: text(EXPLANATION_MAX), // "Why it matters"
  fix: text(FIX_MAX), // "How to fix"
  evidence: text(EVIDENCE_MAX).nullable(), // the observed data, e.g. "#c9c9c9 on #f7f5ff, 1.5:1"
  principle: principleSchema,
  source: sourceSchema,
  location: locationSchema,
});
export type FindingDraft = z.infer<typeof findingDraftSchema>;

export const findingSchema = findingDraftSchema
  .extend({
    id: findingIdSchema,
    runId: runIdSchema,
    pageUrl: httpUrlSchema,
    templateKey: nonEmpty,
    viewport: viewportNameSchema,
    // The circle number. `toFinding` leaves it null: numbering needs every finding of the page and viewport.
    // It stays null for a problem of the whole page, which has no circle.
    number: z.int().positive().nullable(),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    language: reportLanguageSchema,
  })
  .refine((finding) => finding.location.kind === "element" || finding.number === null, {
    message: "A problem of the whole page has no circle number",
    path: ["number"],
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

// Classes that a build tool generates and that change on every deploy. Each pattern describes the real
// format, because stripping a stable class makes different elements look the same:
const GENERATED_CLASS = [
  // CSS-in-JS: a known prefix and a random part with a digit, or a lowercase letter followed later by an
  // uppercase one ("css-1a2b3c", "sc-bdfBwQ", "jsx-123456"). "css-grid" and "sc-header" are plain words.
  /^(?:css|sc|jsx|emotion|styled|svelte|astro)-(?=[A-Za-z0-9]*(?:\d|[a-z][A-Za-z0-9]*[A-Z]))[A-Za-z0-9]{4,}$/,
  // CSS Modules, "[name]_[local]__[hash of 5]": "Button_root__x1y2z". BEM "card__title" has no "_local" before
  // the "__", so it is kept. A BEM name such as "card_big__title" would be mistaken for a hash: accepted.
  /^[A-Za-z][A-Za-z0-9-]*_[A-Za-z0-9-]+__[A-Za-z0-9_-]{5}$/,
  // "name-<hex>" with at least one digit: "btn-decade" is a real name, "a-3fa9c1d" is a hash.
  /^(?=.*\d)[A-Za-z]+-[0-9a-f]{6,}$/,
];
// Class names come from the page, so they can be hostile. The patterns above can be slow on a very long
// name, and no build tool generates a class this long: longer names are kept as they are.
const GENERATED_CLASS_MAX_LENGTH = 100;
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
      name.length <= GENERATED_CLASS_MAX_LENGTH &&
      GENERATED_CLASS.some((pattern) => pattern.test(name))
        ? ""
        : token,
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** What the fingerprint is built from. Derived from the schema, so the two cannot drift apart. */
export type FingerprintInput = Pick<
  Finding,
  "templateKey" | "viewport" | "category" | "ruleKey" | "location"
>;

/**
 * Stable identity of a problem across runs: the same problem on the same template gives the same value,
 * whatever the page URL. It drives "new / still open / fixed" and "ignore". Changing how it is computed
 * changes every comparison with the stored history: treat any change as a breaking one.
 *
 * Two different elements can share a fingerprint (same tag path once positions and generated classes are
 * removed). That follows from tying it to the template. So whoever compares runs must count occurrences per
 * fingerprint, and "ignore" hides all of them.
 */
export function fingerprint(input: FingerprintInput): string {
  const isElement = input.location.kind === "element";
  const selector =
    input.location.kind === "element" ? normalizeSelector(input.location.selector) : "";
  // "e" or "p" keeps an element with no useful selector apart from a problem of the whole page.
  const parts = [
    isElement ? "e" : "p",
    input.templateKey,
    input.viewport,
    input.category,
    input.ruleKey,
    selector,
  ];
  // Each part is written as "<length>:<text>", so whatever characters the parts contain (the rule key can come
  // from an AI answer), two different lists of parts can never give the same text.
  return sha256Hex(parts.map((part) => `${String(part.length)}:${part}`).join(""));
}

/** Where a draft was found: the part of a finding that the analyzer does not know. */
export type FindingContext = Pick<
  Finding,
  "id" | "runId" | "pageUrl" | "templateKey" | "viewport" | "language"
>;

/**
 * Validates a draft and its context and turns them into a finding with its fingerprint. A malformed draft
 * or context throws `INVALID_INPUT` instead of becoming a finding that looks right. Keys that are not part
 * of a finding are dropped, not reported.
 */
export function toFinding(draft: FindingDraft, context: FindingContext): Finding {
  const valid = parseOrThrow(findingDraftSchema, draft, { what: "finding draft" });
  const finding = {
    // The draft comes last: a stray key in the context (a caller that is not type-checked) cannot override it.
    ...context,
    ...valid,
    number: null,
    fingerprint: fingerprint({
      templateKey: context.templateKey,
      viewport: context.viewport,
      category: valid.category,
      ruleKey: valid.ruleKey,
      location: valid.location,
    }),
  };
  // The context is checked as well, and keys that are not part of a finding are dropped.
  return parseOrThrow(findingSchema, finding, { what: "finding" });
}
