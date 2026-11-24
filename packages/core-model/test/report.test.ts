import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  band,
  bandSchema,
  findingSchema,
  reportDataSchema,
  type Band,
} from "../src/index.js";
import { OTHER_ULID, RUN_ULID } from "./fixtures.js";

const finding = findingSchema.parse({
  category: "accessibility",
  severity: "critical",
  ruleKey: "color-contrast",
  title: "Low contrast",
  explanation: "Why",
  fix: "Fix",
  evidence: null,
  principle: { code: "WCAG 1.4.3", label: "Contrast (Minimum)" },
  source: { kind: "rule", engine: "axe-core", ruleId: "color-contrast" },
  location: { kind: "page" },
  id: OTHER_ULID,
  runId: RUN_ULID,
  pageUrl: "http://localhost:3000/",
  templateKey: "/",
  viewport: "desktop",
  number: null,
  fingerprint: "a".repeat(64),
  language: "en",
});

const page = {
  url: "http://localhost:3000/",
  templateKey: "/",
  templateSize: 1,
  viewport: "desktop",
  status: "done",
  error: null,
  screenshot: { path: "shots/home.png", width: 1440, height: 900 },
  annotatedPath: "shots/home.annotated.png",
  categories: { ui: null, ux: null, accessibility: 78, conversion: null },
  score: 78,
  band: "good",
  findings: [{ finding, ignored: false }],
} as const;

const report = {
  run: {
    id: RUN_ULID,
    projectId: "localhost-3000",
    status: "completed",
    entry: "web",
    ai: { kind: "none" },
    language: "en",
    startedAt: "2026-11-19T10:00:00.000Z",
    finishedAt: "2026-11-19T10:00:30.000Z",
  },
  weights: DEFAULT_WEIGHTS,
  site: { score: 78, band: "good", pagesAnalyzed: 1, pagesTotal: 1 },
  pages: [page],
  appendix: {
    analyzedCategories: ["accessibility"],
    needsReview: 2,
    models: [],
    formula: {
      scoreK: 40,
      penalty: { critical: 10, medium: 4, low: 1 },
      repeatStep: 0.1,
      repeatCap: 2,
    },
  },
} as const;

describe("reportData", () => {
  it("accepts a report with a page that was analyzed and categories that were not", () => {
    expect(reportDataSchema.parse(report)).toEqual(report);
  });

  it("accepts a page that failed or was not reached: no screenshot, no score, no findings", () => {
    const empty = {
      ...page,
      status: "failed",
      error: { code: "UNREACHABLE", message: "The page cannot be reached.", retryable: true },
      screenshot: null,
      annotatedPath: null,
      categories: { ui: null, ux: null, accessibility: null, conversion: null },
      score: null,
      band: null,
      findings: [],
    };
    const notReached = { ...empty, status: "not_run", error: null };

    expect(reportDataSchema.safeParse({ ...report, pages: [empty, notReached] }).success).toBe(
      true,
    );
  });

  it("keeps an ignored finding in the list, marked as ignored", () => {
    const ignored = { ...page, findings: [{ finding, ignored: true }] };

    expect(
      reportDataSchema.parse({ ...report, pages: [ignored] }).pages[0]?.findings[0]?.ignored,
    ).toBe(true);
  });

  it.each([
    ["a score over 100", { pages: [{ ...page, score: 101 }] }],
    [
      "a score under 0",
      { pages: [{ ...page, categories: { ...page.categories, accessibility: -1 } }] },
    ],
    ["a score that is not whole", { site: { ...report.site, score: 77.5 } }],
    ["a status that does not exist", { pages: [{ ...page, status: "skipped" }] }],
    [
      "weights that do not add up to 1",
      { weights: { ui: 1, ux: 1, accessibility: 1, conversion: 1 } },
    ],
    ["a negative needsReview", { appendix: { ...report.appendix, needsReview: -1 } }],
    [
      "a finding that breaks its own rules",
      { pages: [{ ...page, findings: [{ finding: { ...finding, number: 0 }, ignored: false }] }] },
    ],
  ])("rejects %s", (_label, change) => {
    expect(reportDataSchema.safeParse({ ...report, ...change }).success).toBe(false);
  });

  it("lets a later task add optional fields: a report with extra keys is still read", () => {
    expect(reportDataSchema.safeParse({ ...report, comparison: null }).success).toBe(true);
  });
});

describe("band", () => {
  it("names the same bands as the function that gives them", () => {
    expectTypeOf<Band>().toEqualTypeOf<(typeof bandSchema)["_output"]>();
    for (const score of [95, 80, 60, 10]) {
      expect(bandSchema.parse(band(score))).toBe(band(score));
    }
  });
});
