import { describe, expect, it } from "vitest";
import { FlawDotError } from "@flawdot/core-model";
import { BANNER_RULES, hidingStyleFor, type BannerRules } from "../src/banner-rules.js";
import { thrownBy } from "./support/fakes.js";

const rules: BannerRules = {
  selectors: ["#a", ".b"],
  consentPhrases: ["we use cookies"],
  buttonWords: ["accept"],
};

describe("the list of consent banners", () => {
  it("has known containers, and phrases and button words in English and Italian", () => {
    expect(BANNER_RULES.selectors).toContain("#onetrust-banner-sdk");
    expect(BANNER_RULES.selectors).toContain("#CybotCookiebotDialog");
    expect(BANNER_RULES.consentPhrases).toContain("we use cookies");
    expect(BANNER_RULES.consentPhrases).toContain("utilizziamo i cookie");
    expect(BANNER_RULES.buttonWords).toContain("accept");
    expect(BANNER_RULES.buttonWords).toContain("accetta");
  });

  it("has no duplicate, and every phrase and word in lower case, which is how the page text is compared", () => {
    for (const list of [
      BANNER_RULES.selectors,
      BANNER_RULES.consentPhrases,
      BANNER_RULES.buttonWords,
    ]) {
      expect(new Set(list).size).toBe(list.length);
      expect(list.length).toBeGreaterThan(0);
    }
    for (const text of [...BANNER_RULES.consentPhrases, ...BANNER_RULES.buttonWords]) {
      expect(text).toBe(text.toLowerCase());
      expect(text.trim()).toBe(text);
    }
  });

  it("has only selectors that name one container of a known tool, not guesses on a class that real content could have", () => {
    for (const selector of BANNER_RULES.selectors) {
      expect(selector).not.toMatch(/\*=|~=|\|=/); // no substring match on an attribute
      expect(selector).not.toMatch(/^\.?(cookie|consent|banner|popup|modal)$/i);
    }
  });
});

describe("hidingStyleFor", () => {
  it("makes one rule that hides all the selectors and wins over the page", () => {
    expect(hidingStyleFor(rules)).toBe("#a,.b{display:none!important}");
  });

  it.each([
    ["an empty selector", { ...rules, selectors: ["#a", ""] }],
    ["a selector with a space only", { ...rules, selectors: ["   "] }],
    ["a selector that closes the rule", { ...rules, selectors: ["#a}body{display:none"] }],
    ["a selector with a semicolon", { ...rules, selectors: ["#a;"] }],
    ["a selector that opens a tag", { ...rules, selectors: ["<style>"] }],
    ["no selector at all", { ...rules, selectors: [] }],
    ["a selector that is repeated", { ...rules, selectors: ["#a", "#a"] }],
  ])("refuses %s, because the list ends up inside a style rule of the page", (_why, bad) => {
    const error = thrownBy(() => hidingStyleFor(bad));
    expect(error).toBeInstanceOf(FlawDotError);
    expect(error).toMatchObject({ code: "INTERNAL" });
  });
});
