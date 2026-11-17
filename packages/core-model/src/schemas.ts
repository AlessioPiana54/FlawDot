import * as z from "zod";
import { FlawDotError, type FlawDotErrorCode } from "./errors.js";
import { findingDraftSchema, principleSchema } from "./finding.js";
import { markIdSchema } from "./ids.js";
import { parseOrThrow } from "./parse.js";

// Schemas for what an AI (or Claude Code, through the MCP tool `record_findings`) sends back. That text is
// untrusted: every object is STRICT, so a key we did not ask for is an error and not something Zod drops in silence.
// (A plain `z.object` would turn `{ kind: "page", mark: 5 }` into `{ kind: "page" }` and the finding would lose
// its position without anyone noticing.)

/**
 * The most findings one answer may carry. Above it the WHOLE answer is rejected: it is an anti-flood ceiling.
 * Not to be confused with `MAX_AI_FINDINGS` (20), above which `toDrafts` keeps the best ones and drops the rest.
 */
export const AI_ANSWER_MAX_FINDINGS = 200;

// The field schemas (and their length limits) are the ones of a finding draft, so the two cannot disagree.
const draftFields = findingDraftSchema.shape;

const aiFindingSchema = z.strictObject({
  /** The set-of-marks number of the element, or null for a problem of the whole page. */
  mark: markIdSchema.nullable(),
  severity: draftFields.severity,
  ruleKey: draftFields.ruleKey,
  title: draftFields.title,
  explanation: draftFields.explanation,
  fix: draftFields.fix,
  evidence: draftFields.evidence,
  principle: z.strictObject({
    code: principleSchema.shape.code,
    label: principleSchema.shape.label,
  }),
  /** How sure the AI is, from 0 to 1. A value outside that range is a malformed answer, not something to clamp. */
  confidence: z.number().min(0).max(1),
});

/** What the AI answers for one tile of a page. There is no category (the analyzer knows it) and no position. */
export const aiResponseSchema = z.strictObject({
  findings: z.array(aiFindingSchema).max(AI_ANSWER_MAX_FINDINGS),
});
export type AiAnalysisResponse = z.infer<typeof aiResponseSchema>;

/** The arguments of the MCP tool `record_findings`: the request being answered and the answer itself. */
export const recordFindingsSchema = z.strictObject({
  requestId: z.string().min(1).max(100),
  findings: aiResponseSchema.shape.findings,
});
export type RecordFindingsInput = z.infer<typeof recordFindingsSchema>;

/**
 * Zod checks the limit of an array only AFTER it has parsed every element, so a list of 50 000 empty objects
 * would make it build hundreds of thousands of issues before saying "too many". The count is checked first.
 */
function refuseFlood(input: unknown, code: FlawDotErrorCode, what: string): void {
  const findings =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)["findings"]
      : undefined;
  if (Array.isArray(findings) && findings.length > AI_ANSWER_MAX_FINDINGS) {
    throw new FlawDotError(
      code,
      `Invalid ${what}: findings: too many (at most ${String(AI_ANSWER_MAX_FINDINGS)})`,
    );
  }
}

/** Validates an AI answer. Throws `AI_BAD_RESPONSE`: the answer is not what we asked for. */
export function parseAiResponse(input: unknown): AiAnalysisResponse {
  refuseFlood(input, "AI_BAD_RESPONSE", "AI answer");
  return parseOrThrow(aiResponseSchema, input, { code: "AI_BAD_RESPONSE", what: "AI answer" });
}

/** Validates a `record_findings` call. Throws `INVALID_INPUT`: the caller (Claude Code) sent a bad call. */
export function parseRecordFindings(input: unknown): RecordFindingsInput {
  refuseFlood(input, "INVALID_INPUT", "record_findings");
  return parseOrThrow(recordFindingsSchema, input, { what: "record_findings" });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * The JSON Schema of the answer, handed to the AI in every request, made from the same Zod schema and frozen, so
 * that a provider that edits it (to strip `$schema`, say) must copy it first. Three things to know:
 * - the rule that text is not blank is not part of it (Zod keeps checking it on our side, so the prompt must say
 *   "no empty text");
 * - it carries a `$schema` line that the provider may have to strip;
 * - its `maxLength` counts characters (code points), while Zod counts UTF-16 units: a text full of emoji can fit
 *   the schema and still be refused by us. The prompt must ask for texts well under the limits.
 */
export const AI_RESPONSE_JSON_SCHEMA: Readonly<Record<string, unknown>> = deepFreeze(
  z.toJSONSchema(aiResponseSchema, { io: "input" }),
);
