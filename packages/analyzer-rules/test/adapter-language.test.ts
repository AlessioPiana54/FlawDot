import { describe, expect, it } from "vitest";
import { findingDraftSchema, type FindingDraft, type ReportLanguage } from "@flawdot/core-model";
import { axeResultsToDrafts } from "../src/adapter.js";
import { parseAxeResults, type ParsedAxeResults } from "../src/axe-results.js";
import { defaultCatalog } from "../src/default-catalog.js";
import { WCAG_CRITERIA } from "../src/wcag-criteria.js";
import { node, rule } from "./support/builders.js";
import { savedAxeResult } from "./support/fixtures.js";

const deps = { catalog: defaultCatalog, wcag: WCAG_CRITERIA };
const convert = (parsed: ParsedAxeResults, language: ReportLanguage): FindingDraft[] =>
  axeResultsToDrafts(parsed, { elements: [] }, deps, language, new Map());

const saved = parseAxeResults(savedAxeResult("violations"));
const draftOf = (drafts: FindingDraft[], ruleKey: string): FindingDraft => {
  const found = drafts.find((draft) => draft.ruleKey === ruleKey);
  if (found === undefined) throw new Error(`no draft for ${ruleKey}`);
  return found;
};

describe("the findings of a page recorded from the real engine, with the catalog that FlawDot ships", () => {
  it("are written in English by FlawDot, not by axe, for the rules of the catalog", () => {
    const drafts = convert(saved, "en");
    const contrast = draftOf(drafts, "color-contrast");
    expect(contrast.title).toBe("Text does not stand out enough from its background");
    expect(contrast.fix).toContain("4.5:1");
    expect(contrast.evidence).toBe("#c9c9c9 on #f7f5ff, 1.53:1 (needs 4.5:1)");
    expect(contrast.principle).toEqual({ code: "WCAG 1.4.3", label: "Contrast (Minimum)" });
  });

  it("are written in Italian in every part: the text, the evidence and the principle", () => {
    const drafts = convert(saved, "it");
    const contrast = draftOf(drafts, "color-contrast");
    expect(contrast.title).toBe("Il testo si distingue poco dallo sfondo");
    expect(contrast.explanation).toContain("4,5:1");
    expect(contrast.evidence).toBe("#c9c9c9 su #f7f5ff, 1,53:1 (richiesto 4,5:1)");
    expect(contrast.principle.code).toBe("WCAG 1.4.3");
    expect(contrast.principle.label).not.toBe("Contrast (Minimum)");
    expect(draftOf(drafts, "button-name").evidence).toBe("Nessun nome accessibile su <button>");
  });

  it("are all valid findings, in both languages", () => {
    for (const language of ["en", "it"] as const) {
      for (const draft of convert(saved, language)) {
        expect(findingDraftSchema.safeParse(draft).success, `${draft.ruleKey} ${language}`).toBe(
          true,
        );
      }
    }
  });
});

describe("a rule that is not in the catalog", () => {
  const outside = (): ParsedAxeResults => ({
    violations: [rule("accesskeys", [node("#a")], { help: "English help of axe" })],
    needsReview: 0,
  });

  it("keeps the English text of axe in English", () => {
    const [draft] = convert(outside(), "en");
    expect(draft?.title).toBe("English help of axe");
    expect(draft?.explanation).toBe("Description of accesskeys");
  });

  it("uses the Italian text of axe in Italian, with the title as the fix", () => {
    const [draft] = convert(outside(), "it");
    expect(draft?.title).not.toBe("English help of axe");
    expect(draft?.fix).toBe(draft?.title);
    expect(draft?.explanation).not.toBe("Description of accesskeys");
  });

  it("keeps the English text of axe in Italian when axe has no Italian text for the rule", () => {
    const missing: ParsedAxeResults = {
      violations: [rule("aria-tab-name", [node("#a")], { help: "English help of axe" })],
      needsReview: 0,
    };
    expect(convert(missing, "it")[0]?.title).toBe("English help of axe");
  });
});
