import { describe, expect, it } from "vitest";
import { criteriaFromTags, principleFor } from "../src/principle.js";
import { WCAG_CRITERIA } from "../src/wcag-criteria.js";

describe("criteriaFromTags: the WCAG criteria that the tags of an axe rule name", () => {
  it.each([
    [["wcag2aa", "wcag143"], ["1.4.3"]],
    [["wcag2a", "wcag412"], ["4.1.2"]],
    [["wcag22aa", "wcag258"], ["2.5.8"]],
  ])("reads %j as %j", (tags, expected) => {
    expect(criteriaFromTags(tags)).toEqual(expected);
  });

  it("tells 1.4.1 from 1.4.11, and 2.4.1 from 2.4.11, by the digits after the guideline", () => {
    expect(criteriaFromTags(["wcag141"])).toEqual(["1.4.1"]);
    expect(criteriaFromTags(["wcag1411"])).toEqual(["1.4.11"]);
    expect(criteriaFromTags(["wcag2411"])).toEqual(["2.4.11"]);
    expect(criteriaFromTags(["wcag1410"])).toEqual(["1.4.10"]);
  });

  it("does not take a level for a criterion: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa have letters", () => {
    expect(criteriaFromTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])).toEqual([]);
  });

  it("ignores tags that are not WCAG, and a tag that only looks like one", () => {
    expect(
      criteriaFromTags(["best-practice", "cat.forms", "wcag", "wcag14", "wcag14333", "WCAG143"]),
    ).toEqual([]);
  });

  it("puts the criteria in numeric order, not text order (1.4.3 before 1.4.11), without repeats", () => {
    expect(criteriaFromTags(["wcag1411", "wcag143", "wcag111", "wcag143"])).toEqual([
      "1.1.1",
      "1.4.3",
      "1.4.11",
    ]);
  });
});

describe("principleFor: the principle a finding reports", () => {
  it("is the first criterion, with its name in the language of the report", () => {
    expect(principleFor(["wcag2aa", "wcag143"], WCAG_CRITERIA, "en")).toEqual({
      code: "WCAG 1.4.3",
      label: "Contrast (Minimum)",
    });
    expect(principleFor(["wcag2aa", "wcag143"], WCAG_CRITERIA, "it")).toEqual({
      code: "WCAG 1.4.3",
      label: "Contrasto (minimo)",
    });
  });

  it("takes the lowest criterion when a rule has several", () => {
    expect(principleFor(["wcag412", "wcag111"], WCAG_CRITERIA, "en").code).toBe("WCAG 1.1.1");
  });

  it("uses the code as the name when the table does not know the criterion", () => {
    expect(principleFor(["wcag999"], new Map(), "en")).toEqual({
      code: "WCAG 9.9.9",
      label: "WCAG 9.9.9",
    });
  });

  it("says best practice, with no code, for a rule that is only that: it is not a WCAG criterion", () => {
    expect(principleFor(["cat.semantics", "best-practice"], WCAG_CRITERIA, "en")).toEqual({
      code: null,
      label: "axe best practice",
    });
    expect(principleFor(["best-practice"], WCAG_CRITERIA, "it").label).toBe("buona pratica axe");
  });

  it("reports a WCAG criterion even when the rule is also a best practice: the criterion is the principle", () => {
    expect(principleFor(["best-practice", "wcag412"], WCAG_CRITERIA, "en").code).toBe("WCAG 4.1.2");
  });

  it("falls back to a plain label for a rule with neither a criterion nor best-practice", () => {
    expect(principleFor([], WCAG_CRITERIA, "en")).toEqual({ code: null, label: "axe rule" });
  });
});

describe("the table of WCAG criteria", () => {
  it("has a name in English and in Italian for every criterion", () => {
    for (const [code, name] of WCAG_CRITERIA) {
      expect(code).toMatch(/^[1-4]\.\d\.\d{1,2}$/);
      expect(name.en.trim()).not.toBe("");
      expect(name.it.trim()).not.toBe("");
    }
  });

  it("knows the criteria that the axe tags wcag2a to wcag22aa can name", () => {
    for (const code of [
      "1.1.1",
      "1.4.3",
      "1.4.11",
      "2.4.7",
      "2.5.8",
      "3.1.1",
      "3.3.8",
      "4.1.2",
      "4.1.3",
    ]) {
      expect(WCAG_CRITERIA.has(code)).toBe(true);
    }
  });
});
