import { describe, expect, it } from "vitest";
import {
  findingDraftSchema,
  type Box,
  type FindingDraft,
  type ReportLanguage,
} from "@flawdot/core-model";
import { axeResultsToDrafts, targetsToMeasure } from "../src/adapter.js";
import { parseAxeResults, targetKey, type ParsedAxeResults } from "../src/axe-results.js";
import { emptyCatalog, type RuleCatalog } from "../src/catalog.js";
import { WCAG_CRITERIA } from "../src/wcag-criteria.js";
import { box, element, node, rule } from "./support/builders.js";
import { savedAxeResult } from "./support/fixtures.js";

const deps = { catalog: emptyCatalog, wcag: WCAG_CRITERIA };
const results = (...violations: ParsedAxeResults["violations"]): ParsedAxeResults => ({
  violations,
  needsReview: 0,
});
const convert = (
  parsed: ParsedAxeResults,
  elements: ReturnType<typeof element>[],
  boxes: ReadonlyMap<string, Box> = new Map(),
  language: ReportLanguage = "en",
): FindingDraft[] => axeResultsToDrafts(parsed, { elements }, deps, language, boxes);

const marksOf = (drafts: FindingDraft[]): Array<number | "page"> =>
  drafts.map((draft) => (draft.location.kind === "element" ? draft.location.mark : "page"));

describe("axeResultsToDrafts on a page recorded from the real engine", () => {
  // The capture numbered the elements of the page; axe names them with its own selectors, which are not ours.
  const elements = [
    element(1, "main > p:nth-of-type(1)", box(20, 20, 400, 24)),
    element(2, "main > img:nth-of-type(1)", box(20, 60, 100, 40)),
    element(3, "main > button:nth-of-type(1)", box(20, 116, 44, 44)),
    element(4, "main > input:nth-of-type(1)", box(20, 176, 300, 32)),
  ];
  const boxes = new Map<string, Box>([
    ["#low", box(20, 20, 400, 24)],
    ["#logo", box(20, 60, 100, 40)],
    ["#icon", box(20, 116, 44, 44)],
    ["#email", box(20, 176, 300, 32)],
    ["#plain", box(20, 224, 200, 30)], // an element with no mark of its own: nothing holds it
  ]);
  const drafts = convert(parseAxeResults(savedAxeResult("violations")), elements, boxes);
  const byRule = (ruleKey: string): FindingDraft => {
    const found = drafts.find((draft) => draft.ruleKey === ruleKey);
    if (found === undefined) throw new Error(`no draft for ${ruleKey}`);
    return found;
  };

  it("makes a finding for each violation, and every one is a valid draft", () => {
    expect(drafts.map((draft) => draft.ruleKey).sort()).toEqual([
      "button-name",
      "color-contrast",
      "document-title",
      "html-has-lang",
      "image-alt",
      "label",
      "page-has-heading-one",
      "role-img-alt",
    ]);
    for (const draft of drafts) expect(findingDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("puts each finding on the mark of the element that axe named, with the box and the selector of the mark", () => {
    expect(byRule("color-contrast").location).toEqual({
      kind: "element",
      mark: 1,
      selector: "main > p:nth-of-type(1)",
      box: box(20, 20, 400, 24),
      count: 1,
    });
    expect(byRule("image-alt").location).toMatchObject({ kind: "element", mark: 2 });
    expect(byRule("button-name").location).toMatchObject({ kind: "element", mark: 3 });
    expect(byRule("label").location).toMatchObject({ kind: "element", mark: 4 });
  });

  it("puts the findings about the whole page (html, body) on the page, with no circle", () => {
    for (const ruleKey of ["document-title", "html-has-lang", "page-has-heading-one"]) {
      expect(byRule(ruleKey).location).toEqual({ kind: "page" });
    }
  });

  it("puts an element that no mark holds on the page too", () => {
    expect(byRule("role-img-alt").location).toEqual({ kind: "page" });
  });

  it("fills the finding from the rule: severity, principle, source and the facts of the element", () => {
    expect(byRule("color-contrast")).toMatchObject({
      category: "accessibility",
      severity: "critical",
      ruleKey: "color-contrast",
      principle: { code: "WCAG 1.4.3", label: "Contrast (Minimum)" },
      source: { kind: "rule", engine: "axe-core", ruleId: "color-contrast" },
      evidence: "#c9c9c9 on #f7f5ff, 1.53:1 (needs 4.5:1)",
    });
    expect(byRule("page-has-heading-one")).toMatchObject({
      severity: "medium",
      principle: { code: null, label: "axe best practice" },
      evidence: null,
    });
    expect(byRule("image-alt").severity).toBe("critical");
  });

  it("uses the text of axe, in English, when the catalog has none: the help, the description and the fix to apply", () => {
    const contrast = byRule("color-contrast");
    expect(contrast.title).toBe("Elements must meet minimum color contrast ratio thresholds");
    expect(contrast.explanation.length).toBeGreaterThan(10);
    // The fix is the general text of the rule, not the summary of the element: that one holds values of the page.
    expect(contrast.fix).toBe(contrast.title);
    expect(contrast.fix).not.toContain("1.53");
  });

  it("names a principle in the language of the report", () => {
    const italian = convert(parseAxeResults(savedAxeResult("violations")), elements, boxes, "it");
    expect(italian.find((draft) => draft.ruleKey === "color-contrast")?.principle.label).toBe(
      "Contrasto (minimo)",
    );
    expect(italian.find((draft) => draft.ruleKey === "page-has-heading-one")?.principle.label).toBe(
      "buona pratica axe",
    );
  });
});

describe("axeResultsToDrafts: where an element goes", () => {
  const elements = [element(1, "ul > li:nth-of-type(1)", box(0, 100, 200, 20))];

  it("uses the mark whose selector is the same, with no measure", () => {
    const parsed = results(rule("label", [node("ul > li:nth-of-type(1)")]));
    expect(targetsToMeasure(parsed, { elements })).toEqual([]);
    expect(marksOf(convert(parsed, elements))).toEqual([1]);
  });

  it("measures a selector that no mark has, and asks for it once however many times it is named", () => {
    const parsed = results(
      rule("label", [node("#a"), node("#b")]),
      rule("image-alt", [node("#a")]),
    );
    expect(targetsToMeasure(parsed, { elements })).toEqual([["#a"], ["#b"]]);
  });

  it("takes the smallest mark that holds the box when no mark has the same one", () => {
    const wide = [
      element(1, "body > div", box(0, 0, 1000, 1000)),
      element(2, "section", box(0, 90, 300, 100)),
    ];
    const parsed = results(rule("label", [node("#a")]));
    expect(marksOf(convert(parsed, wide, new Map([["#a", box(10, 100, 50, 20)]])))).toEqual([2]);
  });

  it("goes to the page when the selector has no box (not found, invalid, hidden) or no mark holds the box", () => {
    const parsed = results(rule("label", [node("#a")]), rule("image-alt", [node("#b")]));
    expect(marksOf(convert(parsed, elements))).toEqual(["page", "page"]);
    expect(marksOf(convert(parsed, elements, new Map([["#b", box(900, 900, 10, 10)]])))).toEqual([
      "page",
      "page",
    ]);
  });

  it.each([
    ["html", "html"],
    ["body", "body"],
    ["HTML in capitals, with spaces", "  HTML "],
  ])("goes to the page, with no measure, for %s", (_what, selector) => {
    const parsed = results(rule("document-title", [node(selector)]));
    expect(targetsToMeasure(parsed, { elements })).toEqual([]);
    expect(marksOf(convert(parsed, elements))).toEqual(["page"]);
  });

  it("goes to the page, with no measure, for a selector too long to be a selector of FlawDot", () => {
    const parsed = results(rule("label", [node(`#${"a".repeat(2000)}`)]));
    expect(targetsToMeasure(parsed, { elements })).toEqual([]);
    expect(marksOf(convert(parsed, elements))).toEqual(["page"]);
  });

  describe("an element in an iframe or in a shadow root", () => {
    const frame = [element(1, "iframe", box(50, 100, 310, 210))];
    const inFrame = ["iframe", "#field"];
    const inShadow = [["#host", "#button"]];

    it("is measured by its path, once however many times it is named", () => {
      const parsed = results(
        rule("label", [node(inFrame), node(inShadow)]),
        rule("image-alt", [node(inFrame)]),
      );
      expect(targetsToMeasure(parsed, { elements: frame })).toEqual([inFrame, inShadow]);
    });

    it("lands on the smallest mark that holds the box it was measured at: the iframe, the host", () => {
      const host = [element(2, "div.host", box(20, 400, 200, 60))];
      const both = [...frame, ...host];
      const boxes = new Map([
        [targetKey(inFrame), box(95, 135, 80, 24)],
        [targetKey(inShadow), box(28, 404, 50, 20)],
      ]);
      const parsed = results(rule("label", [node(inFrame), node(inShadow)]));
      expect(marksOf(convert(parsed, both, boxes))).toEqual([1, 2]);
    });

    it("goes to the page when it could not be measured, or no mark holds it", () => {
      const parsed = results(rule("label", [node(inFrame)]), rule("image-alt", [node(inShadow)]));
      expect(marksOf(convert(parsed, frame))).toEqual(["page", "page"]);
      const outside = new Map([[targetKey(inFrame), box(900, 900, 10, 10)]]);
      expect(marksOf(convert(results(rule("label", [node(inFrame)])), frame, outside))).toEqual([
        "page",
      ]);
    });

    it("goes to the page, with no measure, when a selector in the path is too long", () => {
      const long = ["iframe", `#${"a".repeat(2000)}`];
      const parsed = results(rule("label", [node(long), node([["#h", `#${"b".repeat(2000)}`]])]));
      expect(targetsToMeasure(parsed, { elements: frame })).toEqual([]);
      expect(marksOf(convert(parsed, frame))).toEqual(["page"]);
    });

    it("is not taken for the selector of a mark, even when its last step looks like one", () => {
      const parsed = results(rule("label", [node(["iframe", "iframe"])]));
      expect(targetsToMeasure(parsed, { elements: frame })).toEqual([["iframe", "iframe"]]);
    });
  });

  it("makes one finding for all the elements of a rule that fall on the page, with the facts of the first", () => {
    const parsed = results(
      rule(
        "document-title",
        [node("html", { html: "<html>" }), node([["#h", "#x"]], { html: "<html lang>" })],
        {
          total: 2,
        },
      ),
    );
    const drafts = convert(parsed, elements);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.location).toEqual({ kind: "page" });
  });

  it("makes one finding for the elements of a rule that land on the same mark: one circle, not two", () => {
    const parsed = results(rule("label", [node("#a"), node("#b")]));
    const boxes = new Map([
      ["#a", box(0, 100, 200, 20)],
      ["#b", box(5, 102, 100, 10)],
    ]);
    const drafts = convert(parsed, elements, boxes);
    expect(marksOf(drafts)).toEqual([1]);
    expect(drafts[0]?.location).toMatchObject({ count: 2 });
  });
});

describe("axeResultsToDrafts: which element speaks for a finding", () => {
  const elements = [element(1, "section", box(0, 0, 100, 100))];

  it("uses the evidence of the first element of a rule for the finding of the page, and of a mark", () => {
    const onPage = rule("button-name", [
      node("html", { html: "<button>" }),
      node([["#h", "#x"]], { html: "<a>" }),
    ]);
    expect(convert(results(onPage), elements)[0]?.evidence).toBe("No accessible name on <button>");

    const onMark = rule("button-name", [
      node("section", { html: "<button>" }),
      node("#inner", { html: "<a>" }),
    ]);
    const drafts = convert(results(onMark), elements, new Map([["#inner", box(10, 10, 20, 20)]]));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.evidence).toBe("No accessible name on <button>");
  });

  it("fixes with the general text of the rule, and with the summary of the element only when the rule has none", () => {
    const summary = "Fix any of the following: the id is secret-123";
    const general = rule("label", [node("section", { failureSummary: summary })]);
    expect(convert(results(general), elements)[0]?.fix).toBe("Help of label");
    const bare = rule("label", [node("section", { failureSummary: summary })], { help: "" });
    expect(convert(results(bare), elements)[0]?.fix).toBe(summary);
  });

  it("uses the first mark that has a selector, if the capture has the same selector twice", () => {
    const twice = [element(1, "li", box(0, 0, 10, 10)), element(2, "li", box(0, 50, 10, 10))];
    expect(marksOf(convert(results(rule("label", [node("li")])), twice))).toEqual([1]);
  });

  it("orders by the top of the box before its left, and by the box before the number of the mark", () => {
    const placed = [
      element(1, "low-left", box(0, 200, 10, 10)),
      element(2, "high-right", box(300, 10, 10, 10)),
      element(3, "high-left", box(100, 10, 10, 10)),
    ];
    const flat = results(rule("label", [node("low-left"), node("high-right"), node("high-left")]));
    expect(marksOf(convert(flat, placed))).toEqual([3, 2, 1]);
  });

  it("explains a finding with the description of the rule when the catalog has no text", () => {
    const [draft] = convert(results(rule("label", [node("section")])), elements);
    expect(draft?.explanation).toBe("Description of label");
  });
});

describe("axeResultsToDrafts: many elements of one rule", () => {
  const manyElements = Array.from({ length: 25 }, (_, index) =>
    element(
      index + 1,
      `input:nth-of-type(${String(index + 1)})`,
      box(20, 100 + index * 40, 300, 28),
    ),
  );
  const manyBoxes = new Map(
    manyElements.map((entry, index) => [`#f${String(index)}`, entry.box] as const),
  );
  const parsed = results(
    rule(
      "label",
      manyElements.map((_entry, index) => node(`#f${String(index)}`)),
    ),
  );

  it("keeps the first 10 by position and gives the total of the rule as the count of each", () => {
    const drafts = convert(parsed, manyElements, manyBoxes);
    expect(marksOf(drafts)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const draft of drafts) expect(draft.location).toMatchObject({ count: 25 });
  });

  it("orders by the box of the mark, top to bottom and left to right, whatever the order axe gave", () => {
    const reversed = results(rule("label", [...parsed.violations[0]!.nodes].reverse()));
    expect(marksOf(convert(reversed, manyElements, manyBoxes))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    const same = [
      element(8, "a", box(50, 10, 5, 5)),
      element(3, "b", box(10, 10, 5, 5)),
      element(5, "c", box(10, 10, 5, 5)),
    ];
    const flat = results(rule("label", [node("a"), node("b"), node("c")]));
    expect(marksOf(convert(flat, same))).toEqual([3, 5, 8]);
  });

  it("keeps the finding of the page next to the 10 of the elements, not instead of one of them", () => {
    const withPage = results(
      rule("label", [...parsed.violations[0]!.nodes, node([["#h", "#x"]])], { total: 26 }),
    );
    const drafts = convert(withPage, manyElements, manyBoxes);
    expect(drafts).toHaveLength(11);
    expect(marksOf(drafts).at(-1)).toBe("page");
  });

  it("measures at most 50 elements of a rule and 400 selectors in all, and makes no finding of the rest", () => {
    const nodes = Array.from({ length: 80 }, (_, index) => node(`#n${String(index)}`));
    const one = results(rule("label", nodes));
    const wanted = targetsToMeasure(one, { elements: [] });
    expect(wanted).toHaveLength(50);
    expect(wanted[0]).toEqual(["#n0"]);
    expect(wanted.at(-1)).toEqual(["#n49"]);

    const rules = Array.from({ length: 10 }, (_, ruleIndex) =>
      rule(
        `rule-${String(ruleIndex)}`,
        Array.from({ length: 50 }, (_, index) => node(`#r${String(ruleIndex)}n${String(index)}`)),
      ),
    );
    expect(targetsToMeasure(results(...rules), { elements: [] })).toHaveLength(400);
  });

  it("gives a finding on the page to a rule that comes after the 400 selectors are spent, so that it is not lost", () => {
    const early = Array.from({ length: 8 }, (_, ruleIndex) =>
      rule(
        `early-${String(ruleIndex)}`,
        Array.from({ length: 50 }, (_, index) => node(`#e${String(ruleIndex)}n${String(index)}`)),
      ),
    );
    const late = rule("late-rule", [node("#late1"), node("#late2")]);
    const parsedAll = results(...early, late);
    expect(targetsToMeasure(parsedAll, { elements: [] })).toHaveLength(400);
    const drafts = convert(parsedAll, []);
    const lateDrafts = drafts.filter((draft) => draft.ruleKey === "late-rule");
    expect(lateDrafts).toHaveLength(1);
    expect(lateDrafts[0]?.location).toEqual({ kind: "page" });
  });

  it("makes a finding on the page for an element beyond the budget only if it is on the page by itself", () => {
    const nodes = Array.from({ length: 60 }, (_, index) => node(`#n${String(index)}`));
    const parsedMany = results(rule("label", nodes));
    const everything = new Map(
      nodes.map((entry, index) => [`#n${String(index)}`, box(0, index * 30, 100, 20)]),
    );
    const els = nodes.map((_entry, index) =>
      element(index + 1, `x${String(index)}`, box(0, index * 30, 100, 20)),
    );
    const drafts = convert(parsedMany, els, everything);
    expect(drafts).toHaveLength(10);
    expect(drafts[0]?.location).toMatchObject({ count: 60 });
  });
});

describe("axeResultsToDrafts: texts", () => {
  const elements = [element(1, "div", box(0, 0, 10, 10))];
  const hostile = rule(
    "label",
    [node("div", { failureSummary: "x".repeat(1000), html: "<input>" })],
    {
      help: "",
      description: "",
    },
  );

  it("uses the text of the catalog first, cut to the limits", () => {
    const catalog: RuleCatalog = {
      lookup: (ruleId, language) => ({
        title: `${ruleId} ${language}`,
        explanation: "why ".repeat(1000),
        fix: "how",
      }),
    };
    const [draft] = axeResultsToDrafts(
      results(rule("label", [node("div")])),
      { elements },
      { catalog, wcag: WCAG_CRITERIA },
      "it",
      new Map(),
    );
    expect(draft?.title).toBe("label it");
    expect(draft?.explanation.length).toBeLessThanOrEqual(2000);
    expect(draft?.fix).toBe("how");
    expect(findingDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("falls back to the rule id when axe gave no help, so that no text is ever blank", () => {
    const [draft] = convert(results(hostile), elements);
    expect(draft?.title).toBe("label");
    expect(draft?.explanation).toBe("label");
    expect(findingDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("uses the help as the fix when the element has no failure summary", () => {
    const [draft] = convert(results(rule("label", [node("div")])), elements);
    expect(draft?.fix).toBe("Help of label");
  });

  it("makes valid drafts from the largest values the parser lets through", () => {
    const wide = rule(
      "label",
      [node("div", { failureSummary: "y".repeat(1000), html: "<x>".repeat(70) })],
      {
        help: "h".repeat(300),
        description: "d".repeat(500),
      },
    );
    for (const draft of convert(results(wide), elements)) {
      expect(findingDraftSchema.safeParse(draft).success).toBe(true);
    }
  });

  it("never makes a finding from what axe could not decide: the saved page with only incomplete results has none", () => {
    const clean = parseAxeResults(savedAxeResult("clean"));
    expect(clean.needsReview).toBe(1);
    expect(convert(clean, elements)).toEqual([]);
  });
});

describe("axeResultsToDrafts on the other saved pages", () => {
  it("makes a draft on the page for an element in an iframe and for one in a shadow root that were not measured", () => {
    const drafts = convert(parseAxeResults(savedAxeResult("frames")), []);
    expect(drafts.map((draft) => [draft.ruleKey, draft.location.kind])).toEqual([
      ["button-name", "page"],
      ["label", "page"],
    ]);
    for (const draft of drafts) expect(findingDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("puts them on the mark that holds them once they are measured", () => {
    const marks = [
      element(1, "iframe", box(0, 0, 300, 80)),
      element(2, "div", box(0, 100, 100, 50)),
    ];
    const boxes = new Map([
      [targetKey(["iframe", "#fi"]), box(10, 10, 100, 20)],
      [targetKey([["#host", "#sb"]]), box(10, 110, 44, 44)],
    ]);
    const drafts = convert(parseAxeResults(savedAxeResult("frames")), marks, boxes);
    expect(drafts.map((draft) => [draft.ruleKey, marksOf([draft])[0]])).toEqual([
      ["button-name", "page"],
      ["label", 1],
    ]);
  });
});
