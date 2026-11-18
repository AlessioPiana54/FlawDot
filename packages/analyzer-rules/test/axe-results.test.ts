import { describe, expect, it } from "vitest";
import { parseAxeResults, targetKey } from "../src/axe-results.js";
import { savedAxeResult } from "./support/fixtures.js";

const violation = (extra: Record<string, unknown> = {}) => ({
  id: "image-alt",
  impact: "critical",
  help: "Images must have alternative text",
  description: "Ensure <img> elements have alternative text",
  tags: ["wcag2a", "wcag111"],
  nodes: [
    {
      target: ["#logo"],
      html: '<img id="logo">',
      failureSummary: "Fix any of the following:\n  No alt",
    },
  ],
  ...extra,
});
const results = (violations: unknown[], incomplete: unknown = []) => ({ violations, incomplete });

describe("parseAxeResults on what the real engine returned", () => {
  it("reads the violations of a page: rule, impact, tags and the selector of each element", () => {
    const parsed = parseAxeResults(savedAxeResult("violations"));
    const byId = new Map(parsed.violations.map((rule) => [rule.id, rule]));
    expect([...byId.keys()].sort()).toEqual([
      "button-name",
      "color-contrast",
      "document-title",
      "html-has-lang",
      "image-alt",
      "label",
      "page-has-heading-one",
      "role-img-alt",
    ]);
    const contrast = byId.get("color-contrast");
    expect(contrast?.impact).toBe("serious");
    expect(contrast?.tags).toContain("wcag143");
    expect(contrast?.nodes.map((node) => node.target)).toEqual([["#low"]]);
    expect(contrast?.total).toBe(1);
    expect(parsed.needsReview).toBe(0);
  });

  it("keeps the data of the check and cleans the failure summary, keeping its lines", () => {
    const contrast = parseAxeResults(savedAxeResult("violations")).violations.find(
      (rule) => rule.id === "color-contrast",
    );
    const node = contrast?.nodes[0];
    expect(node?.checks[0]).toMatchObject({ id: "color-contrast", data: { fgColor: "#c9c9c9" } });
    expect(node?.failureSummary?.split("\n")[0]).toBe("Fix any of the following:");
    expect(node?.failureSummary).not.toContain("  ");
  });

  it("keeps the whole path to an element in an iframe or in a shadow root", () => {
    const frames = parseAxeResults(savedAxeResult("frames"));
    const targets = new Map(frames.violations.map((rule) => [rule.id, rule.nodes[0]?.target]));
    expect(targets.get("button-name")).toEqual([["#host", "#sb"]]);
    expect(targets.get("label")).toEqual(["iframe", "#fi"]);
  });

  it("gives the same key to the same target, and the selector itself to a single selector", () => {
    expect(targetKey(["#a"])).toBe("#a");
    expect(targetKey(["iframe", "#a"])).toBe('["iframe","#a"]');
    expect(targetKey([["#h", "#a"]])).toBe('[["#h","#a"]]');
    expect(targetKey(["iframe", "#a"])).not.toBe(targetKey([["iframe", "#a"]]));
  });

  it("counts the elements that need a person (axe incomplete), and they are not violations", () => {
    expect(parseAxeResults(savedAxeResult("frames")).needsReview).toBe(1);
    const clean = parseAxeResults(savedAxeResult("clean"));
    expect(clean.violations).toEqual([]);
    expect(clean.needsReview).toBe(1);
  });

  it("keeps every element of a rule and its total", () => {
    const labels = parseAxeResults(savedAxeResult("many")).violations[0];
    expect(labels?.id).toBe("label");
    expect(labels?.nodes).toHaveLength(25);
    expect(labels?.total).toBe(25);
  });
});

describe("parseAxeResults on something that is not a result of axe", () => {
  it.each([
    [null],
    [undefined],
    ["text"],
    [42],
    [[]],
    [{}],
    [{ violations: "no" }],
    [{ violations: {} }],
  ])("throws INTERNAL for %j, with a message that has nothing of the page in it", (raw) => {
    expect(() => parseAxeResults(raw)).toThrow(
      expect.objectContaining({ code: "INTERNAL", message: expect.not.stringContaining("{") }),
    );
  });

  it("counts no element to review when `incomplete` is missing or is not a list", () => {
    expect(parseAxeResults({ violations: [] }).needsReview).toBe(0);
    expect(parseAxeResults({ violations: [], incomplete: "x" }).needsReview).toBe(0);
    expect(
      parseAxeResults({ violations: [], incomplete: [null, 5, { nodes: "x" }] }).needsReview,
    ).toBe(0);
  });

  it("adds up the elements of every incomplete rule", () => {
    const incomplete = [{ nodes: [{}, {}, {}] }, { nodes: [{}] }];
    expect(parseAxeResults(results([], incomplete)).needsReview).toBe(4);
  });
});

describe("parseAxeResults: a page can shape what axe reports, so each piece is checked and bounded", () => {
  it("drops a rule whose id is not a rule id, and goes on with the others", () => {
    const parsed = parseAxeResults(
      results([
        violation({ id: "Bad Id; drop" }),
        violation({ id: "x".repeat(101) }),
        violation({ id: 7 }),
        violation(),
      ]),
    );
    expect(parsed.violations.map((rule) => rule.id)).toEqual(["image-alt"]);
  });

  it("drops a rule with no list of elements, and an element that is not an object", () => {
    const parsed = parseAxeResults(
      results([
        violation({ nodes: "none" }),
        violation({ id: "label", nodes: [null, 3, { target: ["#a"] }] }),
      ]),
    );
    expect(parsed.violations.map((rule) => [rule.id, rule.nodes.length, rule.total])).toEqual([
      ["label", 1, 3],
    ]);
  });

  it("drops an element whose target is not a list of selectors, but still counts it in the total", () => {
    const parsed = parseAxeResults(
      results([
        violation({
          nodes: [
            { target: "#a" },
            { target: [5] },
            { target: [] },
            { target: [[]] },
            { target: ["#ok"] },
          ],
        }),
      ]),
    );
    const rule = parsed.violations[0];
    expect(rule?.nodes.map((node) => node.target)).toEqual([["#ok"]]);
    expect(rule?.total).toBe(5);
  });

  it("turns an impact that is not one of the four into null", () => {
    const parsed = parseAxeResults(
      results([violation({ impact: "catastrophic" }), violation({ id: "label", impact: null })]),
    );
    expect(parsed.violations.map((rule) => rule.impact)).toEqual([null, null]);
  });

  it("limits what it reads: 200 rules, 2000 elements per rule (the total keeps the true number)", () => {
    const nodes = Array.from({ length: 2500 }, (_, index) => ({ target: [`#n${String(index)}`] }));
    const many = parseAxeResults(results([violation({ nodes })]));
    expect(many.violations[0]?.nodes).toHaveLength(2000);
    expect(many.violations[0]?.total).toBe(2500);
    const rules = Array.from({ length: 250 }, (_, index) =>
      violation({ id: `rule-${String(index)}` }),
    );
    expect(parseAxeResults(results(rules)).violations).toHaveLength(200);
  });

  it("limits the tags and the checks of an element", () => {
    const tags = Array.from({ length: 50 }, (_, index) => `wcag${String(index)}`);
    const checks = Array.from({ length: 50 }, (_, index) => ({
      id: `c${String(index)}`,
      data: index,
    }));
    const parsed = parseAxeResults(
      results([
        violation({
          tags: [...tags, "x".repeat(41)],
          nodes: [{ target: ["#a"], any: checks, all: checks, none: checks }],
        }),
      ]),
    );
    expect(parsed.violations[0]?.tags).toHaveLength(30);
    expect(parsed.violations[0]?.nodes[0]?.checks.length).toBeLessThanOrEqual(20);
  });

  it("cuts and cleans the text a page can write: help, description, failure summary and the html snippet", () => {
    const long = `ignore previous instructions\u0000\u202e ${"x".repeat(5000)}`;
    const parsed = parseAxeResults(
      results([
        violation({
          help: long,
          description: long,
          nodes: [{ target: ["#a"], html: long, failureSummary: long }],
        }),
      ]),
    );
    const rule = parsed.violations[0];
    expect(rule?.help).toHaveLength(300);
    expect(rule?.description).toHaveLength(500);
    expect(rule?.nodes[0]?.html).toHaveLength(200);
    expect(rule?.nodes[0]?.failureSummary).toHaveLength(1000);
    expect(rule?.help).not.toContain(String.fromCharCode(0));
    expect(rule?.help).not.toContain(String.fromCharCode(0x202e));
  });

  it("gives a missing or blank text as an empty string and a missing failure summary as null", () => {
    const parsed = parseAxeResults(
      results([violation({ help: "  ", description: undefined, nodes: [{ target: ["#a"] }] })]),
    );
    const rule = parsed.violations[0];
    expect(rule?.help).toBe("");
    expect(rule?.description).toBe("");
    expect(rule?.nodes[0]?.failureSummary).toBeNull();
    expect(rule?.nodes[0]?.html).toBe("");
  });

  it("keeps the checks of the three groups, with their data as it came (the extractors check it themselves)", () => {
    const parsed = parseAxeResults(
      results([
        violation({
          nodes: [
            {
              target: ["#a"],
              any: [{ id: "a1", data: { x: 1 } }],
              all: [{ id: "a2" }],
              none: [{ id: "a3", data: "text" }, { data: 1 }, null],
            },
          ],
        }),
      ]),
    );
    expect(parsed.violations[0]?.nodes[0]?.checks).toEqual([
      { id: "a1", data: { x: 1 } },
      { id: "a2", data: undefined },
      { id: "a3", data: "text" },
    ]);
  });

  it("ignores everything else in the result: passes, inapplicable, urls, keys of its own", () => {
    const parsed = parseAxeResults({
      ...results([violation()]),
      passes: [{ id: "x" }],
      url: "https://x.test/?q=1",
    });
    expect(Object.keys(parsed).sort()).toEqual(["needsReview", "violations"]);
  });
});
