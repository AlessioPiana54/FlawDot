/// <reference lib="dom" />

import { describe, expect, it } from "vitest";
import { findingDraftSchema, type Box, type FindingDraft } from "@flawdot/core-model";
import type { Page } from "playwright-core";
import { useBrowserHarness, type Analyzed } from "./support/harness.js";

// The real engine on real pages: a page is captured by the capture of FlawDot and analyzed while it is still open.
const harness = useBrowserHarness();

const elementOf = (drafts: FindingDraft[], ruleKey: string) => {
  const draft = drafts.find((entry) => entry.ruleKey === ruleKey);
  if (draft === undefined) throw new Error(`no finding for ${ruleKey}`);
  return draft;
};

const RECT_OF = ["#low", "#logo", "#icon", "#email", "iframe", "#host"];

/** The boxes of some elements of the page, in CSS pixels of the whole page, as the capture measures them. */
const rectsOf = (page: Page) =>
  page.evaluate((selectors) => {
    const rects: Record<string, Box | null> = {};
    for (const selector of selectors) {
      const found = document.querySelector(selector);
      if (found === null) {
        rects[selector] = null;
        continue;
      }
      const { x, y, width, height } = found.getBoundingClientRect();
      rects[selector] = { x: x + window.scrollX, y: y + window.scrollY, width, height };
    }
    return rects;
  }, RECT_OF);

// A page is captured and analyzed once, and the tests that read it share the result: a capture is the slow part.
const analyzed = new Map<string, Promise<Analyzed>>();
const analyze = (path: string): Promise<Analyzed> => {
  const known = analyzed.get(path);
  if (known !== undefined) return known;
  const started = harness.analyze(path, rectsOf);
  analyzed.set(path, started);
  return started;
};

const inside = (inner: Box, outer: Box, slack = 1): boolean =>
  outer.x <= inner.x + slack &&
  outer.y <= inner.y + slack &&
  outer.x + outer.width >= inner.x + inner.width - slack &&
  outer.y + outer.height >= inner.y + inner.height - slack;

describe("a page with the usual violations", () => {
  it("makes a finding for every violation axe finds, and every finding is a valid draft", async () => {
    const { analysis } = await analyze("/violations.html");
    expect(analysis.drafts.map((draft) => draft.ruleKey).sort()).toEqual([
      "button-name",
      "color-contrast",
      "document-title",
      "html-has-lang",
      "image-alt",
      "label",
      "page-has-heading-one",
      "role-img-alt",
    ]);
    for (const draft of analysis.drafts) {
      expect(findingDraftSchema.safeParse(draft).success).toBe(true);
      expect(draft).toMatchObject({
        category: "accessibility",
        source: { kind: "rule", engine: "axe-core", ruleId: draft.ruleKey },
      });
    }
  });

  it.each([
    ["color-contrast", "#low"],
    ["image-alt", "#logo"],
    ["button-name", "#icon"],
    ["label", "#email"],
  ])(
    "puts the finding of %s on a circle that holds the element %s, with the box and the selector of that mark",
    async (ruleKey, selector) => {
      const { analysis, capture, inspected } = await analyze("/violations.html");
      const { location } = elementOf(analysis.drafts, ruleKey);
      expect(location.kind).toBe("element");
      if (location.kind !== "element") return;
      const mark = capture.elements.find((entry) => entry.mark === location.mark);
      expect(mark).toBeDefined();
      expect(location.selector).toBe(mark?.selector);
      expect(location.box).toEqual(mark?.box);
      const rect = (inspected as Record<string, Box | null>)[selector];
      expect(rect).not.toBeNull();
      expect(inside(rect as Box, location.box)).toBe(true);
    },
  );

  it("says what is wrong in the finding: the contrast, the element without a name", async () => {
    const { analysis } = await analyze("/violations.html");
    expect(elementOf(analysis.drafts, "color-contrast")).toMatchObject({
      severity: "critical",
      principle: { code: "WCAG 1.4.3", label: "Contrast (Minimum)" },
      evidence: "#c9c9c9 on #f7f5ff, 1.53:1 (needs 4.5:1)",
    });
    expect(elementOf(analysis.drafts, "button-name").evidence).toBe(
      "No accessible name on <button>",
    );
  });

  it("puts what is wrong with the page itself (no title, no lang) on the page, with no circle", async () => {
    const { analysis } = await analyze("/violations.html");
    for (const ruleKey of ["document-title", "html-has-lang", "page-has-heading-one"]) {
      expect(elementOf(analysis.drafts, ruleKey).location).toEqual({ kind: "page" });
    }
  });

  it("does not change the page: its HTML is the same after axe has run", async () => {
    const { htmlBefore, htmlAfter } = await analyze("/violations.html");
    expect(htmlBefore.length).toBeGreaterThan(100);
    expect(htmlAfter).toBe(htmlBefore);
  });
});

describe("a rule that many elements break", () => {
  it("keeps the first 10 by position, with the total as the count", async () => {
    const { analysis } = await analyze("/many.html");
    const labels = analysis.drafts.filter((draft) => draft.ruleKey === "label");
    expect(labels).toHaveLength(10);
    const boxes = labels.map((draft) =>
      draft.location.kind === "element" ? draft.location.box : null,
    );
    expect(boxes.every((entry) => entry !== null)).toBe(true);
    const tops = boxes.map((entry) => entry?.y ?? -1);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    for (const draft of labels)
      expect(draft.location).toMatchObject({ kind: "element", count: 25 });
  });
});

describe("an element that a selector of the page cannot reach", () => {
  it("puts the finding of one in an iframe, and of one in a shadow root, on a circle that holds it", async () => {
    const { analysis, inspected } = await analyze("/frames.html");
    expect(analysis.drafts.map((draft) => draft.ruleKey)).toEqual(["button-name", "label"]);
    const rects = inspected as Record<string, Box | null>;
    // The field is in the iframe, and the button in the shadow root of #host: each circle holds the whole of it.
    const holders = new Map([
      ["label", rects["iframe"]],
      ["button-name", rects["#host"]],
    ]);
    for (const draft of analysis.drafts) {
      expect(draft.location.kind).toBe("element");
      const holder = holders.get(draft.ruleKey);
      expect(holder).toBeTruthy();
      if (draft.location.kind === "element" && holder) {
        expect(inside(holder, draft.location.box, 1)).toBe(true);
      }
    }
  });
});

describe("a page with nothing to report", () => {
  it("makes no finding", async () => {
    const { analysis } = await analyze("/clean.html");
    expect(analysis.drafts).toEqual([]);
    expect(analysis.needsReview).toBeGreaterThanOrEqual(0);
  });
});
