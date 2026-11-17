import { describe, expect, it } from "vitest";
import {
  findingIdSchema,
  findingSchema,
  markIdSchema,
  numberFindings,
  toFinding,
  type Category,
  type Finding,
  type FindingDraft,
  type Severity,
  type ViewportName,
} from "../src/index.js";
import { pageTarget, runId } from "./fixtures.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A valid ULID for each `n` from 0 to 1023, and ids sort in the order of `n`. */
const ulid = (n: number): string =>
  `01J9ZQ3V8K5M2N7P4R6T0W1X${ALPHABET.charAt(n >> 5)}${ALPHABET.charAt(n & 31)}`;

interface Spec {
  id?: number;
  severity?: Severity;
  category?: Category;
  ruleKey?: string;
  x?: number;
  y?: number;
  mark?: number;
  pageUrl?: string;
  viewport?: ViewportName;
  fingerprint?: string;
  /** An old circle number the finding already carries. */
  number?: number;
  /** A problem of the whole page, with no element. */
  page?: true;
  source?: FindingDraft["source"];
}

let nextId = 1;

/** A finding that is valid, with only the fields a test cares about spelled out. */
function make(spec: Spec = {}): Finding {
  const draft: FindingDraft = {
    category: spec.category ?? "ui",
    severity: spec.severity ?? "medium",
    ruleKey: spec.ruleKey ?? "rule",
    title: "A problem",
    explanation: "Why it matters.",
    fix: "How to fix it.",
    evidence: null,
    principle: { code: null, label: "A principle" },
    source: spec.source ?? { kind: "rule", engine: "axe-core", ruleId: "rule" },
    location:
      spec.page === true
        ? { kind: "page" }
        : {
            kind: "element",
            mark: markIdSchema.parse(spec.mark ?? 1),
            selector: "#element",
            box: { x: spec.x ?? 0, y: spec.y ?? 0, width: 10, height: 10 },
            count: 1,
          },
  };
  const finding = toFinding(draft, {
    id: findingIdSchema.parse(ulid(spec.id ?? nextId++)),
    runId,
    pageUrl: spec.pageUrl ?? pageTarget.url,
    templateKey: pageTarget.templateKey,
    viewport: spec.viewport ?? "desktop",
    language: "en",
  });
  // These two are set after the conversion on purpose: toFinding makes its own fingerprint and
  // leaves the number empty, and some tests need other values.
  return {
    ...finding,
    fingerprint: spec.fingerprint ?? finding.fingerprint,
    number: spec.number ?? null,
  };
}

const numbersOf = (findings: readonly Finding[]): (number | null)[] =>
  numberFindings(findings).map((finding) => finding.number);

const PAGE_A = "http://localhost:3000/a";
const PAGE_B = "http://localhost:3000/b";

describe("numberFindings: the basics", () => {
  it("gives back an empty list when there is nothing to number", () => {
    expect(numberFindings([])).toEqual([]);
  });

  it("numbers one element finding 1 and leaves a problem of the whole page without a number", () => {
    expect(numbersOf([make(), make({ page: true })])).toEqual([1, null]);
  });

  it("puts the worst severity first, wherever it is on the page", () => {
    const low = make({ severity: "low", y: 0 });
    const critical = make({ severity: "critical", y: 500 });
    const medium = make({ severity: "medium", y: 100 });
    expect(numbersOf([low, critical, medium])).toEqual([3, 1, 2]);
  });

  it("orders one severity from top to bottom, then from left to right, with negative and fractional positions", () => {
    const list = [
      make({ y: 0.25 }),
      make({ y: -5 }),
      make({ y: -0.5, x: 9 }),
      make({ y: -0.5, x: 1.25 }),
    ];
    expect(numbersOf(list)).toEqual([4, 1, 3, 2]);
  });

  it("starts again at 1 for every page and every viewport, and gives the numbers back in the input order", () => {
    const list = [
      make({ pageUrl: PAGE_A, viewport: "desktop", y: 10 }),
      make({ pageUrl: PAGE_B, viewport: "desktop", y: 10 }),
      make({ pageUrl: PAGE_A, viewport: "mobile", y: 10 }),
      make({ pageUrl: PAGE_A, viewport: "desktop", y: 5 }),
      make({ pageUrl: PAGE_B, viewport: "desktop", y: 20 }),
    ];
    expect(numbersOf(list)).toEqual([2, 1, 1, 1, 2]);
  });

  it("does not spend a number on a problem of the whole page", () => {
    expect(numbersOf([make({ y: 1 }), make({ page: true }), make({ y: 2 })])).toEqual([1, null, 2]);
  });

  it("replaces an old number on an element and removes one from a problem of the whole page", () => {
    const list = [make({ page: true, number: 7 }), make({ number: 9 })];
    expect(numbersOf(list)).toEqual([null, 1]);
  });

  it("returns new findings in the input order and does not touch the input", () => {
    const input = [make({ y: 30 }), make({ y: 10 }), make({ y: 20 })];
    for (const finding of input) Object.freeze(finding);
    Object.freeze(input);

    const result = numberFindings(input);

    expect(result.map((finding) => finding.id)).toEqual(input.map((finding) => finding.id));
    expect(result).not.toBe(input);
    for (const [index, finding] of result.entries()) expect(finding).not.toBe(input[index]);
    expect(input.map((finding) => finding.number)).toEqual([null, null, null]);
  });

  it("gives back findings that the finding schema accepts", () => {
    const result = numberFindings([make({ y: 2 }), make({ page: true }), make({ y: 1 })]);
    for (const finding of result) expect(findingSchema.safeParse(finding).success).toBe(true);
  });
});

describe("numberFindings: only the findings it is given are numbered", () => {
  it("leaves no gap when the caller leaves a finding out, for example one the user ignored", () => {
    const first = make({ y: 1 });
    const ignored = make({ y: 2 });
    const third = make({ y: 3 });
    const fourth = make({ y: 4 });
    expect(numbersOf([first, ignored, third, fourth])).toEqual([1, 2, 3, 4]);
    expect(numbersOf([first, third, fourth])).toEqual([1, 2, 3]);
  });

  it("numbers a suggestion from the AI like any other finding, whatever its confidence", () => {
    const suggestion = make({
      y: 1,
      source: { kind: "ai", confidence: 0.3, model: "claude-code" },
    });
    expect(numbersOf([suggestion, make({ y: 2 })])).toEqual([1, 2]);
  });
});

describe("numberFindings: when severity and position tie", () => {
  const LOW_HEX = "0".repeat(64);
  const HIGH_HEX = "f".repeat(64);

  // In each row the first finding must win on the key named in the title, and every key after it points the
  // other way. That proves the named key is the one that decides, not a later one.
  it.each([
    [
      "the mark",
      { mark: 1, category: "conversion", ruleKey: "z", fingerprint: HIGH_HEX, id: 9 },
      { mark: 2, category: "ui", ruleKey: "a", fingerprint: LOW_HEX, id: 1 },
    ],
    [
      "the category (ui comes before ux)",
      { category: "ui", ruleKey: "z", fingerprint: HIGH_HEX, id: 9 },
      { category: "ux", ruleKey: "a", fingerprint: LOW_HEX, id: 1 },
    ],
    [
      "the rule key",
      { ruleKey: "a", fingerprint: HIGH_HEX, id: 9 },
      { ruleKey: "b", fingerprint: LOW_HEX, id: 1 },
    ],
    [
      "the rule key in plain character order, so a capital letter comes first",
      { ruleKey: "B", fingerprint: HIGH_HEX, id: 9 },
      { ruleKey: "a", fingerprint: LOW_HEX, id: 1 },
    ],
    ["the fingerprint", { fingerprint: LOW_HEX, id: 9 }, { fingerprint: HIGH_HEX, id: 1 }],
    ["the id", { id: 1 }, { id: 2 }],
  ] as const satisfies readonly (readonly [string, Spec, Spec])[])(
    "decides by %s",
    (_key, winner, loser) => {
      const first = make(winner);
      const second = make(loser);
      expect(numbersOf([first, second])).toEqual([1, 2]);
      expect(numbersOf([second, first])).toEqual([2, 1]);
    },
  );

  it("treats -0 and 0 as the same position and lets the next key decide", () => {
    expect(numbersOf([make({ y: -0, mark: 2 }), make({ y: 0, mark: 1 })])).toEqual([2, 1]);
    expect(numbersOf([make({ x: -0, mark: 2 }), make({ x: 0, mark: 1 })])).toEqual([2, 1]);
  });

  it("gives two findings on the same element a number each", () => {
    const list = [make({ mark: 3, ruleKey: "a" }), make({ mark: 3, ruleKey: "b" })];
    expect(numbersOf(list)).toEqual([1, 2]);
  });

  it("numbers two findings that are identical in every way by their place in the input", () => {
    expect(numbersOf([make({ id: 5 }), make({ id: 5 })])).toEqual([1, 2]);
  });
});

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (const [index, item] of items.entries()) {
    const rest = items.filter((_, other) => other !== index);
    for (const tail of permutations(rest)) yield [item, ...tail];
  }
}

describe("numberFindings: the order of the input does not matter", () => {
  // Seven findings with known numbers: ties in severity, position and mark, a problem of the whole page, and one
  // finding on another page that starts again at 1. All 5040 orders of the input must give the same numbers.
  const reference = [
    { spec: { id: 1, severity: "critical", y: 5 }, number: 1 },
    { spec: { id: 2, severity: "critical", y: 5, x: 3 }, number: 2 },
    { spec: { id: 3, severity: "medium", y: 0, mark: 1 }, number: 3 },
    { spec: { id: 4, severity: "medium", y: 0, mark: 2 }, number: 4 },
    { spec: { id: 5, severity: "low", y: -10 }, number: 5 },
    { spec: { id: 6, page: true }, number: null },
    { spec: { id: 7, pageUrl: PAGE_B, severity: "low", y: 99 }, number: 1 },
  ] as const satisfies readonly { spec: Spec; number: number | null }[];

  const pairs = reference.map(({ spec, number }) => ({ finding: make(spec), number }));
  const findings = pairs.map(({ finding }) => finding);
  const expected = Object.fromEntries(pairs.map(({ finding, number }) => [finding.id, number]));

  const numbersById = (list: readonly Finding[]): Record<string, number | null> =>
    Object.fromEntries(numberFindings(list).map((finding) => [finding.id, finding.number]));

  it("gives the numbers written in the reference list", () => {
    expect(numbersById(findings)).toEqual(expected);
  });

  it("gives the same numbers for every order of the input", () => {
    let orders = 0;
    for (const order of permutations(findings)) {
      expect(numbersById(order)).toEqual(expected);
      orders += 1;
    }
    expect(orders).toBe(5040);
  });
});
