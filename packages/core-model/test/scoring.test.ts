import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  FlawDotError,
  PENALTY,
  REPEAT_CAP,
  REPEAT_STEP,
  SCORE_K,
  band,
  categoryPenalty,
  categoryScore,
  categoryWeightsSchema,
  findingIdSchema,
  findingWeight,
  markIdSchema,
  pageScore,
  siteScore,
  toFinding,
  type Finding,
  type FindingDraft,
  type FindingState,
  type Severity,
} from "../src/index.js";
import { OTHER_ULID, pageTarget, runId } from "./fixtures.js";

const rule = { kind: "rule", engine: "axe-core", ruleId: "r" } as const;
const ai = (confidence: number) => ({ kind: "ai", confidence, model: "claude-code" }) as const;

let counter = 0;

/** A finding of the given severity and rule. Each one points at a different element unless told otherwise. */
function finding(
  severity: Severity,
  ruleKey = "rule-a",
  source: FindingDraft["source"] = rule,
  selector = `#el-${String(counter++)}`,
): Finding {
  const draft: FindingDraft = {
    category: "ui",
    severity,
    ruleKey,
    title: "t",
    explanation: "e",
    fix: "f",
    evidence: null,
    principle: { code: null, label: "p" },
    source,
    location: {
      kind: "element",
      mark: markIdSchema.parse(1),
      selector,
      box: { x: 0, y: 0, width: 1, height: 1 },
      count: 1,
    },
  };
  return toFinding(draft, {
    id: findingIdSchema.parse(OTHER_ULID),
    runId,
    pageUrl: pageTarget.url,
    templateKey: pageTarget.templateKey,
    viewport: "desktop",
    language: "en",
  });
}

const noStates = new Map<string, FindingState>();

describe("constants (to be tuned on real sites)", () => {
  it("has the values of the formula: 100 x e^(-penalty/40), 10/4/1, +10% per repeat up to x2", () => {
    expect(SCORE_K).toBe(40);
    expect(PENALTY).toEqual({ critical: 10, medium: 4, low: 1 });
    expect(REPEAT_STEP).toBe(0.1);
    expect(REPEAT_CAP).toBe(2);
    expect(DEFAULT_WEIGHTS).toEqual({ ui: 0.25, ux: 0.25, accessibility: 0.25, conversion: 0.25 });
  });
});

describe("findingWeight", () => {
  it("is the penalty of the severity for a verified finding", () => {
    expect(findingWeight(finding("critical"))).toBe(10);
    expect(findingWeight(finding("medium"))).toBe(4);
    expect(findingWeight(finding("low"))).toBe(1);
  });

  it("is multiplied by the confidence for an AI suggestion", () => {
    expect(findingWeight(finding("critical", "r", ai(0.5)))).toBe(5);
    expect(findingWeight(finding("medium", "r", ai(1)))).toBe(4);
    expect(findingWeight(finding("critical", "r", ai(0)))).toBe(0);
  });
});

describe("categoryScore: hand-computed cases", () => {
  it.each([
    ["no findings", [], 100],
    ["1 critical, verified", [finding("critical")], 78],
    ["1 medium, verified", [finding("medium")], 90],
    ["1 low, verified", [finding("low")], 98],
    ["1 critical from the AI with confidence 0.5", [finding("critical", "r", ai(0.5))], 88],
    ["1 critical from the AI with confidence 1", [finding("critical", "r", ai(1))], 78],
    ["1 critical from the AI with confidence 0", [finding("critical", "r", ai(0))], 100],
    [
      "2 criticals of two different rules",
      [finding("critical", "a"), finding("critical", "b")],
      61,
    ],
  ])("%s → %i", (_name, findings, expected) => {
    expect(categoryScore(findings, noStates)).toBe(expected);
  });

  it.each([
    [1, 10, 78],
    [2, 11, 76], // x1.1
    [3, 12, 74], // x1.2
    [5, 14, 70], // x1.4
    [13, 20, 61], // x2.2 is capped at x2
    [15, 20, 61], // the cap holds
  ])("%i occurrences of the same rule weigh %f → %i", (n, penalty, expected) => {
    const same = Array.from({ length: n }, () => finding("critical", "same"));
    expect(categoryPenalty(same, noStates)).toBeCloseTo(penalty, 10);
    expect(categoryScore(same, noStates)).toBe(expected);
  });

  it("a group weighs as its heaviest finding times the repeat factor", () => {
    const group = [finding("medium", "same"), finding("critical", "same")];
    expect(categoryPenalty(group, noStates)).toBeCloseTo(11, 10); // 10 x 1.1, not 14 x 1.1
    const confidences = [finding("critical", "x", ai(0.5)), finding("critical", "x", ai(0.9))];
    expect(categoryPenalty(confidences, noStates)).toBeCloseTo(9.9, 10);
    expect(categoryScore(confidences, noStates)).toBe(78);
  });

  it("adds the penalties of different rules", () => {
    const mixed = [finding("critical", "a"), finding("medium", "b"), finding("low", "c")];
    expect(categoryPenalty(mixed, noStates)).toBe(15);
  });

  it("is the same whatever the order of the findings", () => {
    const list = [finding("critical", "a"), finding("low", "a"), finding("medium", "b")];
    expect(categoryScore([...list].reverse(), noStates)).toBe(categoryScore(list, noStates));
  });
});

describe("categoryScore: ignored findings", () => {
  const ignored = {
    kind: "ignored",
    reason: "false_positive",
    at: "2026-11-17T10:00:00.000Z",
  } as const;

  it("leaves out a finding whose fingerprint is ignored", () => {
    const one = finding("critical", "a");
    const states = new Map<string, FindingState>([[one.fingerprint, ignored]]);
    expect(categoryScore([one], states)).toBe(100);
  });

  it("keeps a finding that is explicitly open or has no state", () => {
    const one = finding("critical", "a");
    const open = new Map<string, FindingState>([[one.fingerprint, { kind: "open" }]]);
    expect(categoryScore([one], open)).toBe(78);
    expect(categoryScore([one], noStates)).toBe(78);
  });

  it("ignoring one of two occurrences lowers the repeat factor too", () => {
    const first = finding("critical", "same", rule, "#a");
    const second = finding("critical", "same", rule, "#b");
    const states = new Map<string, FindingState>([[first.fingerprint, ignored]]);
    expect(categoryPenalty([first, second], states)).toBe(10); // one left: no repeat factor
  });
});

describe("pageScore", () => {
  it("is the plain mean with the default weights", () => {
    expect(pageScore({ ui: 70, ux: 90, accessibility: 80, conversion: 80 }, DEFAULT_WEIGHTS)).toBe(
      80,
    );
  });

  it("uses the weights: the same scores give another result with other weights", () => {
    const scores = { ui: 100, ux: 100, accessibility: 40, conversion: 100 };
    expect(pageScore(scores, DEFAULT_WEIGHTS)).toBe(85);
    const accessibilityMatters = { ui: 0.1, ux: 0.1, accessibility: 0.7, conversion: 0.1 };
    expect(pageScore(scores, accessibilityMatters)).toBe(58);
  });

  it("leaves out a category that was not analyzed and re-normalizes the weights", () => {
    // AI off: only accessibility has a score, so it alone makes the total.
    expect(pageScore({ accessibility: 62 }, DEFAULT_WEIGHTS)).toBe(62);
    expect(
      pageScore({ ui: null, ux: null, accessibility: 62, conversion: null }, DEFAULT_WEIGHTS),
    ).toBe(62);
    // Two of four analyzed: weights 0.25 and 0.25 become 0.5 and 0.5.
    expect(pageScore({ ui: 70, accessibility: 90 }, DEFAULT_WEIGHTS)).toBe(80);
  });

  it("re-normalizes unequal weights too", () => {
    const weights = { ui: 0.5, ux: 0.1, accessibility: 0.3, conversion: 0.1 };
    expect(pageScore({ ui: 100, ux: 60 }, weights)).toBe(93); // (50 + 6) / 0.6 = 93.33
  });

  it("is null when nothing was analyzed or the analyzed categories weigh nothing", () => {
    expect(pageScore({}, DEFAULT_WEIGHTS)).toBeNull();
    expect(pageScore({ ui: null }, DEFAULT_WEIGHTS)).toBeNull();
    const onlyUi = { ui: 1, ux: 0, accessibility: 0, conversion: 0 };
    expect(pageScore({ accessibility: 50 }, onlyUi)).toBeNull();
  });

  it("keeps a score of 0 (a category can be at 0, that is not 'not analyzed')", () => {
    expect(pageScore({ ui: 0, ux: 0 }, DEFAULT_WEIGHTS)).toBe(0);
  });
});

describe("siteScore", () => {
  it("is the mean of the page scores, rounded", () => {
    expect(siteScore([78, 61])).toBe(70); // 69.5
    expect(siteScore([100, 100, 100])).toBe(100);
    expect(siteScore([40])).toBe(40);
  });

  it("skips pages without a score", () => {
    expect(siteScore([80, null, 60])).toBe(70);
  });

  it("is null when no page has a score", () => {
    expect(siteScore([])).toBeNull();
    expect(siteScore([null, null])).toBeNull();
  });
});

describe("band", () => {
  it.each([
    [100, "excellent"],
    [90, "excellent"],
    [89, "good"],
    [75, "good"],
    [74, "needs_work"],
    [50, "needs_work"],
    [49, "critical"],
    [0, "critical"],
  ] as const)("%i is %s", (score, expected) => {
    expect(band(score)).toBe(expected);
  });
});

describe("category weights", () => {
  it("accepts weights that add up to 1, with the rounding of a floating point sum", () => {
    expect(categoryWeightsSchema.safeParse(DEFAULT_WEIGHTS).success).toBe(true);
    const sumsToAlmostOne = { ui: 0.1, ux: 0.2, accessibility: 0.3, conversion: 0.4 };
    expect(categoryWeightsSchema.safeParse(sumsToAlmostOne).success).toBe(true);
  });

  it.each([
    ["do not add up to 1", { ui: 0.5, ux: 0.5, accessibility: 0.5, conversion: 0.5 }],
    ["add up to 0.9", { ui: 0.3, ux: 0.3, accessibility: 0.2, conversion: 0.1 }],
    ["add up to 1.1", { ui: 0.3, ux: 0.3, accessibility: 0.3, conversion: 0.2 }],
    ["contain a negative weight", { ui: -0.25, ux: 0.5, accessibility: 0.5, conversion: 0.25 }],
    ["miss a category", { ui: 0.5, ux: 0.5, accessibility: 0 }],
    ["contain a weight above 1", { ui: 2, ux: -1, accessibility: 0, conversion: 0 }],
  ])("rejects weights that %s", (_why, weights) => {
    expect(categoryWeightsSchema.safeParse(weights).success).toBe(false);
  });
});

describe("categoryPenalty: one page, one viewport, one category", () => {
  const one = finding("critical", "same");

  it("accepts an empty list and a list that belongs together", () => {
    expect(categoryPenalty([], noStates)).toBe(0);
    expect(categoryPenalty([one, finding("low", "other")], noStates)).toBe(11);
  });

  it.each([
    ["another category", { category: "ux" }],
    ["another viewport", { viewport: "mobile" }],
    ["another page", { pageUrl: "http://localhost:3000/elsewhere" }],
  ] as const)(
    "refuses findings of %s instead of merging them into a wrong number",
    (_what, patch) => {
      // The same rule on desktop and on mobile would be one group and be counted too little.
      const error = (() => {
        try {
          categoryPenalty([one, { ...finding("critical", "same"), ...patch }], noStates);
        } catch (caught) {
          return caught;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(FlawDotError);
      expect((error as FlawDotError).code).toBe("INTERNAL");
    },
  );
});

describe("edge cases found in review", () => {
  it("gives a category with weight 0 no say when another one has weight", () => {
    const onlyUi = { ui: 1, ux: 0, accessibility: 0, conversion: 0 };
    expect(pageScore({ ui: 70, accessibility: 50 }, onlyUi)).toBe(70);
  });

  it("puts a score between two integers in the lower band", () => {
    expect(band(89.9)).toBe("good");
    expect(band(74.9)).toBe("needs_work");
    expect(band(49.9)).toBe("critical");
  });

  it("accepts all the weight on one category, and rejects a negative one even when the sum is 1", () => {
    expect(
      categoryWeightsSchema.safeParse({ ui: 1, ux: 0, accessibility: 0, conversion: 0 }).success,
    ).toBe(true);
    expect(
      categoryWeightsSchema.safeParse({ ui: 1.5, ux: -0.5, accessibility: 0, conversion: 0 })
        .success,
    ).toBe(false);
  });
});

describe("purity", () => {
  it("does not change its input and gives the same answer twice", () => {
    const list = [finding("critical", "a"), finding("low", "a")];
    const copy = JSON.parse(JSON.stringify(list)) as unknown;
    const states = new Map<string, FindingState>();
    expect(categoryScore(list, states)).toBe(categoryScore(list, states));
    expect(list).toEqual(copy);
    expect(states.size).toBe(0);
  });
});
