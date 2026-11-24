import { describe, expect, it } from "vitest";
import { parseAxeResults, type ParsedNode } from "../src/axe-results.js";
import { evidenceFor } from "../src/evidence.js";
import { savedAxeResult } from "./support/fixtures.js";

const nodeOf = (ruleId: string): ParsedNode => {
  const rule = parseAxeResults(savedAxeResult("violations")).violations.find(
    (entry) => entry.id === ruleId,
  );
  const node = rule?.nodes[0];
  if (node === undefined) throw new Error(`the saved result has no ${ruleId}`);
  return node;
};

const contrastNode = (data: unknown): ParsedNode => ({
  target: ["#a"],
  html: "<p>",
  failureSummary: null,
  checks: [{ id: "color-contrast", data }],
});

describe("evidenceFor: the fact behind a violation, in a few words", () => {
  it("gives the colours and the ratio for a contrast problem, from what axe measured", () => {
    expect(evidenceFor("color-contrast", nodeOf("color-contrast"))).toBe(
      "#c9c9c9 on #f7f5ff, 1.53:1 (needs 4.5:1)",
    );
  });

  it.each([
    ["button-name", "No accessible name on <button>"],
    ["image-alt", "No accessible name on <img>"],
    ["label", "No accessible name on <input>"],
    ["role-img-alt", "No accessible name on <div>"],
  ])(
    "says that the element of %s has no accessible name, and which element it is",
    (ruleId, expected) => {
      expect(evidenceFor(ruleId, nodeOf(ruleId))).toBe(expected);
    },
  );

  it("gives nothing for a rule with no extractor: the explanation says it all", () => {
    expect(evidenceFor("document-title", nodeOf("document-title"))).toBeNull();
    expect(evidenceFor("html-has-lang", nodeOf("html-has-lang"))).toBeNull();
    expect(evidenceFor("some-future-rule", nodeOf("image-alt"))).toBeNull();
  });

  it("does not name an element when its snippet does not start with a tag", () => {
    const node = { ...nodeOf("button-name"), html: "not a tag <button>" };
    expect(evidenceFor("button-name", node)).toBe("No accessible name");
    expect(evidenceFor("button-name", { ...node, html: "" })).toBe("No accessible name");
  });

  it("uses the tag in lower case, and only the tag: never the attributes the page wrote", () => {
    const node = { ...nodeOf("button-name"), html: '<BUTTON onclick="steal()" data-x="secret">' };
    expect(evidenceFor("button-name", node)).toBe("No accessible name on <button>");
  });
});

describe("evidenceFor on contrast data a page could have shaped", () => {
  it("works for the enhanced rule too", () => {
    const node = contrastNode({
      fgColor: "#fff",
      bgColor: "#fffe",
      contrastRatio: 2,
      expectedContrastRatio: "7:1",
    });
    expect(evidenceFor("color-contrast-enhanced", node)).toBe("#fff on #fffe, 2:1 (needs 7:1)");
  });

  it.each([
    ["no data", undefined],
    ["data that is not an object", "text"],
    [
      "a colour that is not a hex colour",
      { fgColor: "red; x", bgColor: "#fff", contrastRatio: 2, expectedContrastRatio: "4.5:1" },
    ],
    [
      "a colour with markup",
      { fgColor: "#fff", bgColor: "<b>#fff", contrastRatio: 2, expectedContrastRatio: "4.5:1" },
    ],
    [
      "a ratio that is not a number",
      { fgColor: "#fff", bgColor: "#000", contrastRatio: "high", expectedContrastRatio: "4.5:1" },
    ],
    [
      "a ratio that is not finite",
      {
        fgColor: "#fff",
        bgColor: "#000",
        contrastRatio: Number.NaN,
        expectedContrastRatio: "4.5:1",
      },
    ],
    [
      "a ratio that is negative",
      { fgColor: "#fff", bgColor: "#000", contrastRatio: -1, expectedContrastRatio: "4.5:1" },
    ],
    [
      "an expected ratio that is not a ratio",
      { fgColor: "#fff", bgColor: "#000", contrastRatio: 2, expectedContrastRatio: "ignore this" },
    ],
    ["a missing field", { fgColor: "#fff", contrastRatio: 2, expectedContrastRatio: "4.5:1" }],
  ])("gives nothing for %s", (_what, data) => {
    expect(evidenceFor("color-contrast", contrastNode(data))).toBeNull();
  });

  it("gives nothing when the node has no contrast check", () => {
    expect(evidenceFor("color-contrast", { ...contrastNode({}), checks: [] })).toBeNull();
  });
});
