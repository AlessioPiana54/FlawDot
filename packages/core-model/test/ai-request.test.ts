import { describe, expect, it } from "vitest";
import {
  MAX_AI_FINDINGS,
  MIN_AI_CONFIDENCE,
  elementSchema,
  findingDraftSchema,
  toDrafts,
  type AiAnalysisResponse,
  type ToDraftsOptions,
} from "../src/index.js";
import { capture as baseCapture, element } from "./fixtures.js";

const elements = [1, 2, 3].map((mark) =>
  elementSchema.parse({
    ...element,
    mark,
    selector: `#element-${String(mark)}`,
    box: { x: mark * 10, y: mark * 100, width: 50, height: 20 },
  }),
);
const capture = { ...baseCapture, elements };

const options: ToDraftsOptions = {
  model: "claude-code",
  category: "conversion",
  allowedRuleKeys: new Set(["cta-competition", "weak-headline"]),
};

type AnswerFinding = AiAnalysisResponse["findings"][number];

/** One finding in the AI answer, valid by default. */
const found = (overrides: Record<string, unknown> = {}): AnswerFinding =>
  ({
    mark: 1,
    severity: "medium",
    ruleKey: "cta-competition",
    title: "Two buttons compete",
    explanation: "Visitors do not know which one to press.",
    fix: "Keep one primary action.",
    evidence: null,
    principle: { code: null, label: "One primary action per screen" },
    confidence: 0.8,
    ...overrides,
  }) as AnswerFinding;

const answer = (...findings: AnswerFinding[]): AiAnalysisResponse => ({ findings });

describe("the limits of an AI answer", () => {
  it("has the numbers of the spec: at most 20 findings, at least 0.3 sure", () => {
    expect(MAX_AI_FINDINGS).toBe(20);
    expect(MIN_AI_CONFIDENCE).toBe(0.3);
  });
});

describe("toDrafts: what becomes a draft", () => {
  it("gives nothing for an empty answer", () => {
    expect(toDrafts(answer(), capture, options)).toEqual({ drafts: [], dropped: [] });
  });

  it("turns a finding on an element into a draft whose position comes from the capture, not from the AI", () => {
    const { drafts, dropped } = toDrafts(
      answer(found({ mark: 2, severity: "critical", evidence: "two primary buttons" })),
      capture,
      options,
    );
    expect(dropped).toEqual([]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toEqual({
      category: "conversion",
      severity: "critical",
      ruleKey: "cta-competition",
      title: "Two buttons compete",
      explanation: "Visitors do not know which one to press.",
      fix: "Keep one primary action.",
      evidence: "two primary buttons",
      principle: { code: null, label: "One primary action per screen" },
      source: { kind: "ai", confidence: 0.8, model: "claude-code" },
      location: {
        kind: "element",
        mark: 2,
        selector: "#element-2",
        box: { x: 20, y: 200, width: 50, height: 20 },
        count: 1,
      },
    });
  });

  it("turns a finding without a mark into a problem of the whole page", () => {
    const { drafts } = toDrafts(answer(found({ mark: null })), capture, options);
    expect(drafts[0]?.location).toEqual({ kind: "page" });
  });

  it("records which model answered", () => {
    const { drafts } = toDrafts(answer(found()), capture, {
      ...options,
      model: "claude-sonnet-5-5",
    });
    expect(drafts[0]?.source).toEqual({ kind: "ai", confidence: 0.8, model: "claude-sonnet-5-5" });
  });

  it("gives drafts that the finding draft schema accepts", () => {
    const list = answer(
      found({ mark: 1 }),
      found({ mark: 3, ruleKey: "Strange Rule!" }),
      found({ mark: null }),
    );
    for (const draft of toDrafts(list, capture, options).drafts) {
      expect(findingDraftSchema.safeParse(draft).success).toBe(true);
    }
  });

  it("keeps the drafts in the order of the answer", () => {
    const list = answer(found({ title: "a" }), found({ title: "b" }), found({ title: "c" }));
    expect(toDrafts(list, capture, options).drafts.map((draft) => draft.title)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("toDrafts: what is dropped, and why", () => {
  it("drops a finding whose mark is not in the capture and still builds the others", () => {
    const list = answer(found({ title: "ok" }), found({ mark: 999, title: "lost" }));
    const { drafts, dropped } = toDrafts(list, capture, options);
    expect(drafts.map((draft) => draft.title)).toEqual(["ok"]);
    expect(dropped).toEqual([{ index: 1, mark: 999, reason: "unknown_mark" }]);
  });

  it("drops a finding that is less than 0.3 sure, and keeps one that is exactly 0.3 sure", () => {
    const list = answer(
      found({ confidence: 0.29, title: "unsure" }),
      found({ confidence: 0.3, title: "borderline" }),
      found({ confidence: 0, title: "zero", mark: null }),
    );
    const { drafts, dropped } = toDrafts(list, capture, options);
    expect(drafts.map((draft) => draft.title)).toEqual(["borderline"]);
    expect(dropped).toEqual([
      { index: 0, mark: 1, reason: "low_confidence" },
      { index: 2, mark: null, reason: "low_confidence" },
    ]);
  });

  it("says unknown_mark, not low_confidence, when a finding is both (the wrong mark is the useful news)", () => {
    const { dropped } = toDrafts(answer(found({ mark: 999, confidence: 0.1 })), capture, options);
    expect(dropped).toEqual([{ index: 0, mark: 999, reason: "unknown_mark" }]);
  });
});

describe("toDrafts: no more than 20 findings per answer", () => {
  const many = (count: number, make: (index: number) => AnswerFinding) =>
    answer(...Array.from({ length: count }, (_, index) => make(index)));

  it("keeps all 20 when there are exactly 20", () => {
    const { drafts, dropped } = toDrafts(
      many(20, (i) => found({ title: `f${String(i)}` })),
      capture,
      options,
    );
    expect(drafts).toHaveLength(20);
    expect(dropped).toEqual([]);
  });

  it("keeps the first 20 of equal findings and drops the rest, with the position in the answer", () => {
    const { drafts, dropped } = toDrafts(
      many(22, (i) => found({ title: `f${String(i)}` })),
      capture,
      options,
    );
    expect(drafts.map((draft) => draft.title)).toEqual(
      Array.from({ length: 20 }, (_, i) => `f${String(i)}`),
    );
    expect(dropped).toEqual([
      { index: 20, mark: 1, reason: "over_limit" },
      { index: 21, mark: 1, reason: "over_limit" },
    ]);
  });

  it("drops the less severe first, even when it is more certain", () => {
    const list = many(21, (i) =>
      i === 0
        ? found({ severity: "low", confidence: 1, title: "low" })
        : found({ confidence: 0.5, title: `m${String(i)}` }),
    );
    const { drafts, dropped } = toDrafts(list, capture, options);
    expect(drafts.some((draft) => draft.title === "low")).toBe(false);
    expect(dropped).toEqual([{ index: 0, mark: 1, reason: "over_limit" }]);
  });

  it("drops the least certain of equal severity, wherever it is in the answer", () => {
    const list = many(21, (i) =>
      found({ confidence: i === 3 ? 0.31 : 0.9, title: `f${String(i)}` }),
    );
    const { drafts, dropped } = toDrafts(list, capture, options);
    expect(drafts.some((draft) => draft.title === "f3")).toBe(false);
    expect(dropped).toEqual([{ index: 3, mark: 1, reason: "over_limit" }]);
  });

  it("keeps a critical finding that was last in the answer", () => {
    const list = many(21, (i) =>
      found({ severity: i === 20 ? "critical" : "medium", title: `f${String(i)}` }),
    );
    const { drafts, dropped } = toDrafts(list, capture, options);
    expect(drafts.at(-1)?.title).toBe("f20");
    expect(dropped).toEqual([{ index: 19, mark: 1, reason: "over_limit" }]);
  });

  it("counts only the findings that are valid, and lists every drop in order of position", () => {
    const list = many(25, (i) =>
      i % 8 === 7 ? found({ mark: 999 }) : found({ title: `f${String(i)}` }),
    );
    const { drafts, dropped } = toDrafts(list, capture, options);
    // 25 findings: positions 7, 15 and 23 have an unknown mark, so 22 are valid and 2 are over the limit.
    expect(drafts).toHaveLength(20);
    expect(dropped.map((entry) => entry.reason).sort()).toEqual([
      "over_limit",
      "over_limit",
      "unknown_mark",
      "unknown_mark",
      "unknown_mark",
    ]);
    expect(dropped.map((entry) => entry.index)).toEqual(
      [...dropped.map((entry) => entry.index)].sort((a, b) => a - b),
    );
  });
});

describe("toDrafts: repeated findings", () => {
  it("keeps one of several findings with the same mark, rule and title, and drops the others as duplicates", () => {
    const { drafts, dropped } = toDrafts(
      answer(found(), found({ ruleKey: "CTA-Competition" }), found({ title: "Another" })),
      capture,
      options,
    );
    expect(drafts.map((draft) => draft.title)).toEqual(["Two buttons compete", "Another"]);
    expect(dropped).toEqual([{ index: 1, mark: 1, reason: "duplicate" }]);
  });

  it("keeps the most certain of the duplicates", () => {
    const { drafts, dropped } = toDrafts(
      answer(found({ confidence: 0.4 }), found({ confidence: 0.9 })),
      capture,
      options,
    );
    expect(drafts.map((draft) => draft.source)).toEqual([
      { kind: "ai", confidence: 0.9, model: "claude-code" },
    ]);
    expect(dropped).toEqual([{ index: 0, mark: 1, reason: "duplicate" }]);
  });

  it("does not let a flood of duplicates push a different finding out of the 20 places", () => {
    const flood = Array.from({ length: 25 }, () => found());
    const { drafts, dropped } = toDrafts(
      answer(...flood, found({ title: "The real one", confidence: 0.5 })),
      capture,
      options,
    );
    expect(drafts.map((draft) => draft.title)).toEqual(["Two buttons compete", "The real one"]);
    expect(dropped.filter((entry) => entry.reason === "duplicate")).toHaveLength(24);
    expect(dropped.filter((entry) => entry.reason === "over_limit")).toEqual([]);
  });

  it("treats a finding with another rule, with the same mark and title, as different", () => {
    const { drafts } = toDrafts(
      answer(found(), found({ ruleKey: "weak-headline" })),
      capture,
      options,
    );
    expect(drafts.map((draft) => draft.ruleKey)).toEqual(["cta-competition", "weak-headline"]);
  });

  it("treats a finding on another mark, or on the whole page, as different", () => {
    const { drafts } = toDrafts(
      answer(found({ mark: 1 }), found({ mark: 2 }), found({ mark: null })),
      capture,
      options,
    );
    expect(drafts).toHaveLength(3);
  });
});

describe("toDrafts: the rule key", () => {
  const keyOf = (ruleKey: string): string | undefined =>
    toDrafts(answer(found({ ruleKey })), capture, options).drafts[0]?.ruleKey;

  it("keeps a rule key that is on the list of the analyzer", () => {
    expect(keyOf("cta-competition")).toBe("cta-competition");
    expect(keyOf("weak-headline")).toBe("weak-headline");
  });

  it.each([
    ["Weak CTA!!", "other:weak-cta"],
    ["other:Foo Bar", "other:foo-bar"],
    ["Other:Already Prefixed", "other:already-prefixed"],
    ["too   many___separators", "other:too-many-separators"],
    ["???", "other:unknown"],
    ["", "other:unknown"],
    ["other:", "other:unknown"],
    ["ñandú", "other:and"],
    ["日本語", "other:unknown"],
  ])("turns %j into %j", (input, expected) => {
    expect(keyOf(input)).toBe(expected);
  });

  it("finds a rule key of the list even when the AI changes its case or adds spaces", () => {
    expect(keyOf("CTA-Competition")).toBe("cta-competition");
    expect(keyOf("  weak-headline ")).toBe("weak-headline");
  });

  it("cuts a long name to 40 characters", () => {
    expect(keyOf("a".repeat(60))).toBe(`other:${"a".repeat(40)}`);
  });

  it("does not leave a hyphen at the end of a cut name", () => {
    expect(keyOf(`${"a".repeat(39)} b`)).toBe(`other:${"a".repeat(39)}`);
  });
});
