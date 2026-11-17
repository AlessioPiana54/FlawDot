import { describe, expect, it } from "vitest";
import {
  COMPARISONS,
  EVIDENCE_MAX,
  EXPLANATION_MAX,
  FIX_MAX,
  FlawDotError,
  TITLE_MAX,
  comparisonSchema,
  findingDraftSchema,
  findingIdSchema,
  findingSchema,
  findingStateSchema,
  fingerprint,
  locationSchema,
  normalizeSelector,
  principleSchema,
  sourceSchema,
  toFinding,
  type FindingContext,
  type FindingDraft,
  type FingerprintInput,
} from "../src/index.js";
import { OTHER_ULID, element, pageTarget, runId } from "./fixtures.js";

const elementLocation = {
  kind: "element",
  mark: element.mark,
  selector: "main > section:nth-child(2) > button.css-1a2b3c.cta",
  box: element.box,
  count: 1,
} as const;

const draft: FindingDraft = {
  category: "accessibility",
  severity: "critical",
  ruleKey: "color-contrast",
  title: "Text has too little contrast",
  explanation: "Low contrast makes text hard to read for many people.",
  fix: "Darken the text or lighten the background until the ratio is at least 4.5:1.",
  evidence: "#c9c9c9 on #f7f5ff, 1.5:1",
  principle: { code: "WCAG 1.4.3", label: "Contrast (Minimum)" },
  source: { kind: "rule", engine: "axe-core", ruleId: "color-contrast" },
  location: elementLocation,
};

const context: FindingContext = {
  id: findingIdSchema.parse(OTHER_ULID),
  runId,
  pageUrl: pageTarget.url,
  templateKey: pageTarget.templateKey,
  viewport: "desktop",
  language: "en",
};

const base: FingerprintInput = {
  templateKey: "/blog/:slug",
  viewport: "desktop",
  category: "accessibility",
  ruleKey: "color-contrast",
  location: elementLocation,
};

describe("normalizeSelector", () => {
  it.each([
    ["div > a:nth-child(3)", "div > a"],
    ["ul > li:nth-of-type(2n+1) > a", "ul > li > a"],
    ["li:nth-last-child(1)", "li"],
    ["li:nth-last-of-type(odd)", "li"],
    ["button.css-1a2b3c", "button"],
    ["button.sc-bdfBwQ", "button"],
    ["div.jsx-123456 > p", "div > p"],
    ["div.Button_root__x1y2z", "div"],
    ["a.link-3fa9c1d", "a"],
    ["button.cta.css-1a2b3c", "button.cta"],
  ])("removes what changes between deploys: %s", (input, expected) => {
    expect(normalizeSelector(input)).toBe(expected);
  });

  it.each([
    "button.cta",
    "nav.main-nav > a.btn-primary",
    "div.col-md-6",
    "div.md\\:flex",
    "#__next > main",
    "a[href='/pricing']",
    "p.css-x", // too short to be a hash
    "a.btn-decade", // looks like hex but has no digit: a real class name
    "a.bg-cafebabe",
  ])("keeps a selector that is stable: %s", (selector) => {
    expect(normalizeSelector(selector)).toBe(selector);
  });

  it("collapses the spaces that a removal leaves behind", () => {
    expect(normalizeSelector("  div   >   a:nth-child(2)   ")).toBe("div > a");
  });
});

describe("fingerprint", () => {
  it("is a SHA-256 in hexadecimal", () => {
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same on two pages of the same template (the URL is not part of it)", () => {
    const one = toFinding(draft, { ...context, pageUrl: "http://localhost:3000/blog/one" });
    const two = toFinding(draft, { ...context, pageUrl: "http://localhost:3000/blog/two" });
    expect(one.fingerprint).toBe(two.fingerprint);
  });

  it("does not change with :nth-child positions or generated class names", () => {
    const withNth = { ...elementLocation, selector: "main > section:nth-child(7) > button.cta" };
    const withHash = { ...elementLocation, selector: "main > section > button.css-zzzz99.cta" };
    expect(fingerprint({ ...base, location: withNth })).toBe(
      fingerprint({ ...base, location: withHash }),
    );
  });

  it("does not depend on the mark, the box or the count (they change with the page)", () => {
    const moved = {
      ...elementLocation,
      mark: 99 as typeof elementLocation.mark,
      box: { x: 5, y: 5, width: 5, height: 5 },
      count: 8,
    };
    expect(fingerprint({ ...base, location: moved })).toBe(fingerprint(base));
  });

  it.each([
    ["the template", { templateKey: "/shop/:id" }],
    ["the viewport", { viewport: "mobile" }],
    ["the category", { category: "ui" }],
    ["the rule", { ruleKey: "image-alt" }],
    ["the element", { location: { ...elementLocation, selector: "footer > a" } }],
  ] as const)("changes with %s", (_what, patch) => {
    expect(fingerprint({ ...base, ...patch })).not.toBe(fingerprint(base));
  });

  it("has no selector part for a problem of the whole page", () => {
    const page = fingerprint({ ...base, location: { kind: "page" } });
    expect(page).toMatch(/^[0-9a-f]{64}$/);
    expect(page).not.toBe(fingerprint(base));
    expect(page).toBe(fingerprint({ ...base, location: { kind: "page" } }));
  });

  it("does not mix up neighbouring parts (the separator is not part of the text)", () => {
    // The rule key and the selector are neighbours in the hashed text: "a"+"bc" must differ from "ab"+"c".
    const a = fingerprint({
      ...base,
      ruleKey: "a",
      location: { ...elementLocation, selector: "bc" },
    });
    const b = fingerprint({
      ...base,
      ruleKey: "ab",
      location: { ...elementLocation, selector: "c" },
    });
    expect(a).not.toBe(b);
  });
});

describe("toFinding", () => {
  it("keeps the draft, adds the context and a fingerprint, and leaves the number to numbering", () => {
    const finding = toFinding(draft, context);
    expect(finding).toMatchObject({ ...draft, ...context, number: null });
    expect(finding.fingerprint).toBe(fingerprint({ ...base, templateKey: pageTarget.templateKey }));
    expect(findingSchema.safeParse(finding).success).toBe(true);
  });

  it("works for an AI suggestion and for a problem of the page", () => {
    const aiDraft: FindingDraft = {
      ...draft,
      category: "conversion",
      severity: "medium",
      ruleKey: "cta-competition",
      evidence: null,
      principle: { code: null, label: "One primary action per screen" },
      source: { kind: "ai", confidence: 0.7, model: "claude-code" },
      location: { kind: "page" },
    };
    const finding = toFinding(aiDraft, context);
    expect(finding.source).toEqual({ kind: "ai", confidence: 0.7, model: "claude-code" });
    expect(finding.number).toBeNull();
    expect(findingSchema.safeParse(finding).success).toBe(true);
  });

  it("drops fields the draft should not have", () => {
    const finding = toFinding({ ...draft, extra: "x" } as FindingDraft, context);
    expect(finding).not.toHaveProperty("extra");
  });

  it.each([
    ["a confidence above 1", { source: { kind: "ai", confidence: 1.7, model: "m" } }],
    ["a negative confidence", { source: { kind: "ai", confidence: -0.1, model: "m" } }],
    ["an AI source without a model", { source: { kind: "ai", confidence: 0.5, model: "" } }],
    ["an unknown severity", { severity: "blocker" }],
    ["an unknown category", { category: "performance" }],
    ["an empty rule key", { ruleKey: "" }],
    ["an empty title", { title: "" }],
    ["a title that is too long", { title: "t".repeat(TITLE_MAX + 1) }],
    ["an explanation that is too long", { explanation: "e".repeat(EXPLANATION_MAX + 1) }],
    ["a fix that is too long", { fix: "f".repeat(FIX_MAX + 1) }],
    ["evidence that is too long", { evidence: "v".repeat(EVIDENCE_MAX + 1) }],
    ["a principle without a label", { principle: { code: null, label: "" } }],
    ["an element with mark 0", { location: { ...elementLocation, mark: 0 } }],
    ["an element that stands for 0 elements", { location: { ...elementLocation, count: 0 } }],
    ["an element without a selector", { location: { ...elementLocation, selector: "" } }],
    ["an unknown location kind", { location: { kind: "region" } }],
  ])("rejects %s with INVALID_INPUT", (_why, patch) => {
    const bad = { ...draft, ...patch } as unknown as FindingDraft;
    expect(() => toFinding(bad, context)).toThrow(FlawDotError);
    expect(() => toFinding(bad, context)).toThrow(/^Invalid finding draft: /);
  });

  it("rejects a draft with a missing field", () => {
    const { fix: _fix, ...withoutFix } = draft;
    expect(() => toFinding(withoutFix as FindingDraft, context)).toThrow(/fix/);
  });

  it("accepts the largest allowed texts", () => {
    const big = {
      ...draft,
      title: "t".repeat(TITLE_MAX),
      explanation: "e".repeat(EXPLANATION_MAX),
      fix: "f".repeat(FIX_MAX),
      evidence: "v".repeat(EVIDENCE_MAX),
    };
    expect(findingDraftSchema.safeParse(big).success).toBe(true);
  });
});

describe("schemas", () => {
  it("accepts both sources and rejects an unknown rule engine", () => {
    expect(sourceSchema.safeParse({ kind: "rule", engine: "axe-core", ruleId: "x" }).success).toBe(
      true,
    );
    expect(
      sourceSchema.safeParse({ kind: "rule", engine: "lighthouse", ruleId: "x" }).success,
    ).toBe(false);
  });

  it("accepts the confidence limits 0 and 1", () => {
    for (const confidence of [0, 1]) {
      expect(sourceSchema.safeParse({ kind: "ai", confidence, model: "m" }).success).toBe(true);
    }
  });

  it("accepts a page location and a principle without a code", () => {
    expect(locationSchema.safeParse({ kind: "page" }).success).toBe(true);
    expect(
      principleSchema.safeParse({ code: null, label: "Nielsen: visibility of status" }).success,
    ).toBe(true);
  });

  it("rejects a finding whose number is 0 or whose fingerprint is not a SHA-256", () => {
    const finding = toFinding(draft, context);
    expect(findingSchema.safeParse({ ...finding, number: 0 }).success).toBe(false);
    expect(findingSchema.safeParse({ ...finding, number: 3 }).success).toBe(true);
    expect(findingSchema.safeParse({ ...finding, fingerprint: "abc" }).success).toBe(false);
  });

  it("accepts the two finding states and rejects an ignore without a reason", () => {
    expect(findingStateSchema.safeParse({ kind: "open" }).success).toBe(true);
    const ignored = { kind: "ignored", reason: "false_positive", at: "2026-11-17T10:00:00.000Z" };
    expect(findingStateSchema.safeParse(ignored).success).toBe(true);
    expect(findingStateSchema.safeParse({ kind: "ignored", at: ignored.at }).success).toBe(false);
  });

  it("knows the three comparison results", () => {
    expect(COMPARISONS).toEqual(["new", "still_open", "fixed"]);
    expect(comparisonSchema.safeParse("fixed").success).toBe(true);
    expect(comparisonSchema.safeParse("changed").success).toBe(false);
  });
});
