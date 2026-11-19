import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { EXPLANATION_MAX, FIX_MAX, TITLE_MAX, type ReportLanguage } from "@flawdot/core-model";
import { defaultCatalog } from "../src/default-catalog.js";
import en from "../src/catalog/en.json" with { type: "json" };
import it_ from "../src/catalog/it.json" with { type: "json" };

// The rules that the catalog must have a text for: the contract of Task 13. It is written here, and not read from the
// files, so that a rule that is dropped from the files fails a test.
const CATALOG_RULES = [
  "color-contrast",
  "image-alt",
  "link-name",
  "button-name",
  "label",
  "html-has-lang",
  "document-title",
  "heading-order",
  "empty-heading",
  "page-has-heading-one",
  "landmark-one-main",
  "region",
  "select-name",
  "input-button-name",
  "input-image-alt",
  "frame-title",
  "aria-hidden-focus",
  "aria-roles",
  "aria-valid-attr-value",
  "aria-required-attr",
  "aria-allowed-attr",
  "aria-input-field-name",
  "aria-command-name",
  "aria-required-children",
  "role-img-alt",
  "svg-img-alt",
  "list",
  "listitem",
  "target-size",
  "meta-viewport",
];

const LANGUAGES: readonly ReportLanguage[] = ["en", "it"];
const FILES: Readonly<Record<ReportLanguage, Record<string, unknown>>> = { en, it: it_ };

const requireFrom = createRequire(import.meta.url);

describe("the catalog that FlawDot ships", () => {
  it("has the same 30 rules in English and in Italian, and no other", () => {
    expect(CATALOG_RULES).toHaveLength(30);
    expect(Object.keys(en).sort()).toEqual([...CATALOG_RULES].sort());
    expect(Object.keys(it_).sort()).toEqual([...CATALOG_RULES].sort());
  });

  it.each(LANGUAGES)(
    "gives a text for every rule in %s, inside the limits of a finding",
    (language) => {
      for (const rule of CATALOG_RULES) {
        const text = defaultCatalog.lookup(rule, language);
        expect(text, `${rule} in ${language}`).toBeDefined();
        expect(text?.title.trim()).not.toBe("");
        expect(text?.title.length).toBeLessThanOrEqual(TITLE_MAX);
        expect(text?.explanation.length).toBeLessThanOrEqual(EXPLANATION_MAX);
        expect(text?.fix.length).toBeLessThanOrEqual(FIX_MAX);
        expect(text?.explanation).not.toBe(text?.fix);
      }
    },
  );

  it.each(LANGUAGES)("has a different title in %s for every rule", (language) => {
    const titles = CATALOG_RULES.map((rule) => defaultCatalog.lookup(rule, language)?.title);
    expect(new Set(titles).size).toBe(CATALOG_RULES.length);
  });

  it("has Italian that is not a copy of the English", () => {
    for (const rule of CATALOG_RULES) {
      const english = defaultCatalog.lookup(rule, "en");
      const italian = defaultCatalog.lookup(rule, "it");
      expect(italian?.title, rule).not.toBe(english?.title);
      expect(italian?.explanation, rule).not.toBe(english?.explanation);
      expect(italian?.fix, rule).not.toBe(english?.fix);
    }
  });

  it.each(LANGUAGES)(
    "has no work marker, no template placeholder and no control character in %s",
    (language) => {
      for (const [rule, text] of Object.entries(FILES[language])) {
        const all = JSON.stringify(text);
        // The words of an unfinished text are put together here, so that this file does not carry them itself.
        for (const marker of ["TO" + "DO", "FIX" + "ME"]) expect(all, rule).not.toContain(marker);
        expect(all, rule).not.toMatch(/\$\{|\{\{|\p{Cc}/u);
      }
    },
  );

  it("is made of rules that axe really runs: a text for a rule that never runs would be dead", () => {
    const axe = requireFrom("axe-core") as {
      getRules: (tags: string[]) => { ruleId: string }[];
    };
    const running = new Set(
      axe
        .getRules(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .map((rule) => rule.ruleId),
    );
    for (const rule of CATALOG_RULES) expect(running.has(rule), rule).toBe(true);
  });

  it("uses the same axe as the one that runs on the page, so the Italian of axe matches the rules", () => {
    const direct = (requireFrom("axe-core/package.json") as { version: string }).version;
    const playwrightRequire = createRequire(requireFrom.resolve("@axe-core/playwright"));
    const used = (playwrightRequire("axe-core/package.json") as { version: string }).version;
    expect(used).toBe(direct);
  });
});

describe("the rules that are not in the catalog", () => {
  it("use the Italian of axe in Italian, and the title of axe as the fix", () => {
    const text = defaultCatalog.lookup("accesskeys", "it");
    expect(text?.title).toBeTruthy();
    expect(text?.explanation).toBeTruthy();
    expect(text?.fix).toBe(text?.title);
  });

  it("keep the English of axe in English", () => {
    expect(defaultCatalog.lookup("accesskeys", "en")).toBeUndefined();
  });

  it("keep the English of axe in Italian too when axe has no Italian text for the rule", () => {
    expect(defaultCatalog.lookup("aria-tab-name", "it")).toBeUndefined();
    expect(defaultCatalog.lookup("summary-name", "it")).toBeUndefined();
  });
});
