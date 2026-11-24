import {
  reportDataSchema,
  reportFindingSchema,
  reportPageSchema,
  type ReportData,
  type ReportFinding,
  type ReportPage,
} from "@flawdot/core-model";
import { findingId, runId } from "@flawdot/test-support";

// Reports are built through their schemas, so a test can never hold a shape that the kernel would not make.

export const RUN = runId(1);
export const PAGE_URL = "http://localhost:3000/";

let counter = 0;

/** A finding of the rules, on an element. `override` is merged over the finding, not over the pair. */
export function reportFinding(
  override: Record<string, unknown> = {},
  ignored = false,
): ReportFinding {
  counter += 1;
  return reportFindingSchema.parse({
    ignored,
    finding: {
      id: findingId(counter),
      runId: RUN,
      pageUrl: PAGE_URL,
      templateKey: "/",
      viewport: "desktop",
      number: 1,
      fingerprint: "a".repeat(64),
      language: "en",
      category: "accessibility",
      severity: "critical",
      ruleKey: "color-contrast",
      title: "Text has too little contrast",
      explanation: "People with low vision cannot read it.",
      fix: "Make the text darker until the ratio is at least 4.5:1.",
      evidence: "#c9c9c9 on #f7f5ff, 1.5:1",
      principle: { code: "WCAG 1.4.3", label: "Contrast (Minimum)" },
      source: { kind: "rule", engine: "axe-core", ruleId: "color-contrast" },
      location: {
        kind: "element",
        mark: 1,
        selector: "#hero > p.lead",
        box: { x: 10, y: 20, width: 100, height: 30 },
        count: 1,
      },
      ...override,
    },
  });
}

/** A finding of the whole page: no circle, no number. */
export const pageFinding = (override: Record<string, unknown> = {}): ReportFinding =>
  reportFinding({
    number: null,
    severity: "medium",
    ruleKey: "document-title",
    title: "Page has no title",
    fix: "Add a descriptive title.",
    evidence: null,
    principle: { code: "WCAG 2.4.2", label: "Page Titled" },
    source: { kind: "rule", engine: "axe-core", ruleId: "document-title" },
    location: { kind: "page" },
    ...override,
  });

/** A page that was captured and analyzed (accessibility only: the rules ran, the AI did not). */
export function donePage(override: Record<string, unknown> = {}): ReportPage {
  return reportPageSchema.parse({
    url: PAGE_URL,
    templateKey: "/",
    templateSize: 1,
    viewport: "desktop",
    status: "done",
    error: null,
    screenshot: { path: "C:\\home\\runs\\r\\shot.png", width: 1440, height: 900 },
    annotatedPath: "C:\\home\\runs\\r\\shot.annotated.png",
    categories: { ui: null, ux: null, accessibility: 78, conversion: null },
    score: 78,
    band: "good",
    findings: [reportFinding()],
    ...override,
  });
}

export const failedPage = (
  viewport = "mobile",
  message = "Could not reach the page.",
): ReportPage =>
  reportPageSchema.parse({
    url: PAGE_URL,
    templateKey: "/",
    templateSize: 1,
    viewport,
    status: "failed",
    error: { code: "UNREACHABLE", message, retryable: true },
    screenshot: null,
    annotatedPath: null,
    categories: { ui: null, ux: null, accessibility: null, conversion: null },
    score: null,
    band: null,
    findings: [],
  });

export function makeReport(
  pages: readonly ReportPage[] = [donePage()],
  override: Record<string, unknown> = {},
): ReportData {
  const done = pages.filter((page) => page.status === "done");
  return reportDataSchema.parse({
    run: {
      id: RUN,
      projectId: "localhost-3000",
      status: done.length === pages.length ? "completed" : "partial",
      entry: "mcp",
      ai: { kind: "none" },
      language: "en",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:05.000Z",
    },
    weights: { ui: 0.25, ux: 0.25, accessibility: 0.25, conversion: 0.25 },
    site: {
      score: done.length === 0 ? null : 78,
      band: done.length === 0 ? null : "good",
      pagesAnalyzed: done.length,
      pagesTotal: pages.length,
    },
    pages,
    appendix: {
      analyzedCategories: ["accessibility"],
      needsReview: 0,
      models: [],
      formula: {
        scoreK: 40,
        penalty: { critical: 10, medium: 4, low: 1 },
        repeatStep: 0.1,
        repeatCap: 2,
      },
    },
    ...override,
  });
}
