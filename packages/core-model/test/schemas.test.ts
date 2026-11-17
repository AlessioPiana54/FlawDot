import { describe, expect, it } from "vitest";
import {
  AI_ANSWER_MAX_FINDINGS,
  AI_RESPONSE_JSON_SCHEMA,
  FlawDotError,
  TITLE_MAX,
  aiResponseSchema,
  parseAiResponse,
  parseRecordFindings,
  recordFindingsSchema,
} from "../src/index.js";

/** One finding the way the AI sends it: no category, no location, only a mark that is a number or null. */
const answerFinding = (overrides: Record<string, unknown> = {}) => ({
  mark: 3,
  severity: "medium",
  ruleKey: "cta-competition",
  title: "Two buttons compete",
  explanation: "Visitors do not know which one to press.",
  fix: "Keep one primary action.",
  evidence: null,
  principle: { code: null, label: "One primary action per screen" },
  confidence: 0.8,
  ...overrides,
});

function failureOf(run: () => unknown): FlawDotError {
  try {
    run();
  } catch (error) {
    if (error instanceof FlawDotError) return error;
    throw error;
  }
  throw new Error("expected the call to throw a FlawDotError");
}

describe("the AI answer", () => {
  it("accepts an empty answer", () => {
    expect(parseAiResponse({ findings: [] })).toEqual({ findings: [] });
  });

  it("accepts a problem on an element (a mark) and a problem of the whole page (null)", () => {
    const answer = {
      findings: [answerFinding(), answerFinding({ mark: null, evidence: "1.5:1" })],
    };
    expect(parseAiResponse(answer)).toEqual(answer);
  });

  it("accepts the largest sizes: a rule key of 100 characters and 200 findings", () => {
    expect(
      aiResponseSchema.safeParse({ findings: [answerFinding({ ruleKey: "k".repeat(100) })] })
        .success,
    ).toBe(true);
    const many = {
      findings: Array.from({ length: AI_ANSWER_MAX_FINDINGS }, () => answerFinding()),
    };
    expect(aiResponseSchema.safeParse(many).success).toBe(true);
    expect(AI_ANSWER_MAX_FINDINGS).toBe(200);
  });

  it.each([
    ["an answer that is not an object", "text"],
    ["a null answer", null],
    ["an answer that is a list", []],
    ["findings that are not a list", { findings: "none" }],
    ["an extra key at the top", { findings: [], note: "hello" }],
    ["an extra key in a finding", { findings: [answerFinding({ id: 7 })] }],
    [
      "a category (the analyzer decides it, not the AI)",
      { findings: [answerFinding({ category: "ui" })] },
    ],
    [
      "a location (the capture decides it, not the AI)",
      { findings: [answerFinding({ location: { kind: "page" } })] },
    ],
    [
      "an extra key in the principle",
      { findings: [answerFinding({ principle: { code: null, label: "p", url: "x" } })] },
    ],
    ["a missing title", { findings: [answerFinding({ title: undefined })] }],
    [
      "a title of 201 characters",
      { findings: [answerFinding({ title: "t".repeat(TITLE_MAX + 1) })] },
    ],
    ["a title of only spaces", { findings: [answerFinding({ title: "   " })] }],
    ["a rule key of 101 characters", { findings: [answerFinding({ ruleKey: "k".repeat(101) })] }],
    [
      "an empty principle label",
      { findings: [answerFinding({ principle: { code: null, label: "" } })] },
    ],
    ["an unknown severity", { findings: [answerFinding({ severity: "blocker" })] }],
    ["a confidence above 1", { findings: [answerFinding({ confidence: 1.7 })] }],
    ["a negative confidence", { findings: [answerFinding({ confidence: -0.1 })] }],
    ["a confidence that is NaN", { findings: [answerFinding({ confidence: Number.NaN })] }],
    ["a confidence written as text", { findings: [answerFinding({ confidence: "0.5" })] }],
    ["mark 0", { findings: [answerFinding({ mark: 0 })] }],
    ["a mark with decimals", { findings: [answerFinding({ mark: 1.5 })] }],
    ["a mark written as text", { findings: [answerFinding({ mark: "3" })] }],
    [
      "201 findings",
      { findings: Array.from({ length: AI_ANSWER_MAX_FINDINGS + 1 }, () => answerFinding()) },
    ],
  ])("rejects %s with AI_BAD_RESPONSE", (_why, answer) => {
    const error = failureOf(() => parseAiResponse(answer));
    expect(error.code).toBe("AI_BAD_RESPONSE");
    expect(error.message).toMatch(/^Invalid AI answer: /);
  });

  it("refuses a flood of findings before looking at each one", () => {
    // 50 000 empty objects would each make Zod build several issues; the count is checked first.
    const flood = { findings: Array.from({ length: 50_000 }, () => ({})) };
    const error = failureOf(() => parseAiResponse(flood));
    expect(error.code).toBe("AI_BAD_RESPONSE");
    expect(error.message).toBe(
      `Invalid AI answer: findings: too many (at most ${String(AI_ANSWER_MAX_FINDINGS)})`,
    );
    expect(error.cause).toBeUndefined();
  });

  it("does not let the name of a huge unknown key into the error message", () => {
    const hostile = { findings: [], ["k".repeat(100_000)]: 1 };
    const error = failureOf(() => parseAiResponse(hostile));
    expect(error.message.length).toBeLessThan(400);
  });
});

describe("the record_findings tool call", () => {
  it("accepts a request id with the same findings as an AI answer", () => {
    const call = { requestId: "req-1", findings: [answerFinding()] };
    expect(parseRecordFindings(call)).toEqual(call);
  });

  it.each([
    ["no request id", { findings: [] }],
    ["an empty request id", { requestId: "", findings: [] }],
    ["a request id of 101 characters", { requestId: "r".repeat(101), findings: [] }],
    ["a request id that is a number", { requestId: 7, findings: [] }],
    ["an extra key", { requestId: "r", findings: [], extra: true }],
    [
      "a malformed finding inside",
      { requestId: "r", findings: [answerFinding({ confidence: 2 })] },
    ],
  ])("rejects %s with INVALID_INPUT", (_why, call) => {
    const error = failureOf(() => parseRecordFindings(call));
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toMatch(/^Invalid record_findings: /);
  });

  it("refuses a flood of findings with INVALID_INPUT before looking at each one", () => {
    const flood = {
      requestId: "r",
      findings: Array.from({ length: AI_ANSWER_MAX_FINDINGS + 1 }, () => ({})),
    };
    const error = failureOf(() => parseRecordFindings(flood));
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toMatch(/^Invalid record_findings: findings: too many/);
    expect(error.cause).toBeUndefined();
  });

  it("accepts a request id of exactly 100 characters", () => {
    expect(
      recordFindingsSchema.safeParse({ requestId: "r".repeat(100), findings: [] }).success,
    ).toBe(true);
  });
});

/** Reads a nested value from the JSON Schema without trusting its shape. */
function at(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

describe("the JSON Schema handed to the AI", () => {
  const item = at(AI_RESPONSE_JSON_SCHEMA, "properties", "findings", "items");

  it("is derived from the same schema Zod validates with", () => {
    expect(at(AI_RESPONSE_JSON_SCHEMA, "type")).toBe("object");
    expect(at(AI_RESPONSE_JSON_SCHEMA, "required")).toEqual(["findings"]);
    expect(at(item, "required")).toEqual([
      "mark",
      "severity",
      "ruleKey",
      "title",
      "explanation",
      "fix",
      "evidence",
      "principle",
      "confidence",
    ]);
  });

  it("forbids extra keys at every level, like the Zod schema does", () => {
    expect(at(AI_RESPONSE_JSON_SCHEMA, "additionalProperties")).toBe(false);
    expect(at(item, "additionalProperties")).toBe(false);
    expect(at(item, "properties", "principle", "additionalProperties")).toBe(false);
  });

  it("carries the length limits and the possible values", () => {
    expect(at(item, "properties", "title", "maxLength")).toBe(TITLE_MAX);
    expect(at(item, "properties", "severity", "enum")).toEqual(["critical", "medium", "low"]);
    expect(at(item, "properties", "confidence", "type")).toBe("number");
    expect(at(item, "properties", "confidence", "minimum")).toBe(0);
    expect(at(item, "properties", "confidence", "maximum")).toBe(1);
  });

  it("allows null for a mark and for the evidence, and has no category or location", () => {
    expect(JSON.stringify(at(item, "properties", "mark"))).toContain('"type":"null"');
    expect(JSON.stringify(at(item, "properties", "evidence"))).toContain('"type":"null"');
    expect(at(item, "properties", "category")).toBeUndefined();
    expect(at(item, "properties", "location")).toBeUndefined();
  });

  it("uses a plain list of findings and no union, which structured-output endpoints may refuse", () => {
    expect(JSON.stringify(AI_RESPONSE_JSON_SCHEMA)).not.toContain("oneOf");
  });

  it("survives being sent as JSON", () => {
    expect(JSON.parse(JSON.stringify(AI_RESPONSE_JSON_SCHEMA))).toEqual(AI_RESPONSE_JSON_SCHEMA);
  });

  it("is frozen all the way down, so that no provider can change it for every request", () => {
    expect(Object.isFrozen(AI_RESPONSE_JSON_SCHEMA)).toBe(true);
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(at(item, "properties", "principle"))).toBe(true);
  });
});
