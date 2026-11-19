import {
  DEFAULT_VIEWPORTS,
  DEFAULT_WEIGHTS,
  reportDataSchema,
  type CaptureOutcome,
  type CategoryWeights,
  type Finding,
  type FindingState,
  type Run,
} from "@flawdot/core-model";
import { findingId, fingerprint, makeFinding, makeRun, rejectionOf } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import { buildReport, summarize } from "../src/report.js";

const URL_A = "https://example.com/";
const URL_B = "https://example.com/about";

const done = (
  url = URL_A,
  viewport: "desktop" | "mobile" = "desktop",
  overrides: Partial<Extract<CaptureOutcome, { status: "done" }>> = {},
): CaptureOutcome => ({
  url,
  viewport,
  status: "done",
  screenshot: { path: "shots/s.png", width: 1440, height: 900 },
  annotatedPath: "shots/s.annotated.png",
  analyzed: ["accessibility"],
  needsReview: 0,
  analysisFailures: 0,
  ...overrides,
});

const failed = (url = URL_A, viewport: "desktop" | "mobile" = "desktop"): CaptureOutcome => ({
  url,
  viewport,
  status: "failed",
  error: { code: "UNREACHABLE", message: "The page cannot be reached.", retryable: true },
});

const page = (url: string) => ({ url, templateKey: new URL(url).pathname, templateSize: 1 });

const runWith = (captures: CaptureOutcome[], overrides: Partial<Run> = {}): Run =>
  makeRun({
    pages: [page(URL_A)],
    viewports: [DEFAULT_VIEWPORTS.desktop],
    captures,
    ...overrides,
  });

const critical = (n: number, overrides: Partial<Finding> = {}): Finding =>
  makeFinding({ id: findingId(n), number: n, fingerprint: fingerprint(String(n)), ...overrides });

const input = (
  run: Run,
  findings: Finding[] = [],
  states: Record<string, FindingState> = {},
  weights: CategoryWeights = DEFAULT_WEIGHTS,
) => ({ run, findings, states: new Map(Object.entries(states)), weights });

const IGNORED: FindingState = {
  kind: "ignored",
  reason: "not_a_problem",
  at: "2026-01-02T00:00:00.000Z",
};

describe("buildReport: the score of a page", () => {
  it("gives the category that was analyzed a score, and no score to the ones that were not", () => {
    const report = buildReport(input(runWith([done()]), [critical(1)]));

    expect(report.pages[0]?.categories).toEqual({
      ui: null,
      ux: null,
      accessibility: 78,
      conversion: null,
    });
    expect(report.pages[0]?.score).toBe(78); // the total is made of the categories that were analyzed
    expect(report.pages[0]?.band).toBe("good");
  });

  it("gives 100 to a category that was analyzed and has nothing wrong", () => {
    const report = buildReport(input(runWith([done()])));

    expect(report.pages[0]?.categories.accessibility).toBe(100);
    expect(report.pages[0]?.band).toBe("excellent");
  });

  it("gives no score at all when no category was analyzed (every analyzer failed)", () => {
    const report = buildReport(input(runWith([done(URL_A, "desktop", { analyzed: [] })])));

    expect(report.pages[0]?.categories).toEqual({
      ui: null,
      ux: null,
      accessibility: null,
      conversion: null,
    });
    expect(report.pages[0]?.score).toBeNull();
    expect(report.pages[0]?.band).toBeNull();
  });

  it("makes the total from the weights, and the weights of the missing categories do not count", () => {
    const run = runWith([done(URL_A, "desktop", { analyzed: ["accessibility", "ux"] })]);
    const findings = [critical(1)]; // accessibility 78, ux 100
    const weights = { ui: 0, ux: 0.2, accessibility: 0.8, conversion: 0 };

    expect(buildReport(input(run, findings, {}, weights)).pages[0]?.score).toBe(82); // 78 * 0.8 + 100 * 0.2
    expect(buildReport(input(run, findings)).pages[0]?.score).toBe(89); // the default weights, equal
  });

  it("scores again with other weights, with the same findings: nothing needs to be analyzed again", () => {
    const run = runWith([done(URL_A, "desktop", { analyzed: ["accessibility", "ux"] })]);
    const heavy = { ui: 0, ux: 0.9, accessibility: 0.1, conversion: 0 };

    expect(buildReport(input(run, [critical(1)], {}, heavy)).pages[0]?.score).toBe(98);
    expect(buildReport(input(run, [critical(1)])).pages[0]?.score).toBe(89);
    expect(buildReport(input(run, [critical(1)], {}, heavy)).weights).toEqual(heavy);
  });

  it("leaves an ignored finding out of the score and keeps it in the list, marked", () => {
    const report = buildReport(
      input(runWith([done()]), [critical(1)], { [fingerprint("1")]: IGNORED }),
    );

    expect(report.pages[0]?.categories.accessibility).toBe(100);
    expect(report.pages[0]?.findings).toHaveLength(1);
    expect(report.pages[0]?.findings[0]?.ignored).toBe(true);
  });

  it("counts a problem of the whole page in the score, though it has no circle", () => {
    const wholePage = critical(1, { location: { kind: "page" }, number: null });

    expect(
      buildReport(input(runWith([done()]), [wholePage])).pages[0]?.categories.accessibility,
    ).toBe(78);
  });
});

describe("buildReport: the list of findings of a page", () => {
  it("is in the order of the circle numbers, the ones with no number last, and by id when they tie", () => {
    const findings = [
      critical(5, { number: null, location: { kind: "page" } }),
      critical(3, { number: 2 }),
      critical(4, { number: 1 }),
      critical(2, { number: null, location: { kind: "page" } }),
    ];

    const ids = buildReport(input(runWith([done()]), findings)).pages[0]?.findings.map(
      (f) => f.finding.id,
    );

    expect(ids).toEqual([findingId(4), findingId(3), findingId(2), findingId(5)]);
  });

  it("has only the findings of its own page and viewport", () => {
    const run = runWith([done(URL_A), done(URL_A, "mobile"), done(URL_B)], {
      pages: [page(URL_A), page(URL_B)],
      viewports: [DEFAULT_VIEWPORTS.desktop, DEFAULT_VIEWPORTS.mobile],
    });
    const findings = [
      critical(1),
      critical(2, { viewport: "mobile" }),
      critical(3, { pageUrl: URL_B }),
    ];

    const pages = buildReport(input(run, findings)).pages;

    expect(pages.map((p) => [p.url, p.viewport, p.findings.map((f) => f.finding.id)])).toEqual([
      [URL_A, "desktop", [findingId(1)]],
      [URL_A, "mobile", [findingId(2)]],
      [URL_B, "desktop", [findingId(3)]],
      [URL_B, "mobile", []],
    ]);
  });
});

describe("buildReport: pages that did not work", () => {
  it("shows a page that failed with its error, no score and no findings: it is never a perfect page", () => {
    const report = buildReport(input(runWith([failed()]), [critical(1)]));

    expect(report.pages[0]).toMatchObject({
      status: "failed",
      error: { code: "UNREACHABLE", retryable: true },
      screenshot: null,
      annotatedPath: null,
      score: null,
      band: null,
      findings: [],
    });
    expect(report.pages[0]?.categories).toEqual({
      ui: null,
      ux: null,
      accessibility: null,
      conversion: null,
    });
  });

  it("shows a page that was never reached as not run", () => {
    const run = runWith([done(URL_A)], {
      pages: [page(URL_A), page(URL_B)],
      status: "cancelled",
    });

    const second = buildReport(input(run)).pages[1];

    expect(second).toMatchObject({
      url: URL_B,
      status: "not_run",
      error: null,
      score: null,
      findings: [],
    });
  });

  it("makes the score of the site from the pages that were analyzed, and says how many were", () => {
    const run = runWith([done(URL_A, "desktop"), failed(URL_A, "mobile")], {
      viewports: [DEFAULT_VIEWPORTS.desktop, DEFAULT_VIEWPORTS.mobile],
      status: "partial",
    });

    const report = buildReport(input(run, [critical(1)]));

    expect(report.site).toEqual({ score: 78, band: "good", pagesAnalyzed: 1, pagesTotal: 2 });
  });

  it("gives the site no score when no page was analyzed", () => {
    const report = buildReport(input(runWith([failed()], { status: "partial" })));

    expect(report.site).toEqual({ score: null, band: null, pagesAnalyzed: 0, pagesTotal: 1 });
  });

  it("reads a run that has none of the new fields (an older one) as a run where nothing was reached", () => {
    const report = buildReport(input(makeRun()));

    expect(report.pages[0]?.status).toBe("not_run");
    expect(report.appendix).toMatchObject({ needsReview: 0, analyzedCategories: [] });
  });
});

describe("buildReport: the rest of the report", () => {
  it("takes the appendix from the run and from the findings", () => {
    const aiFinding = critical(2, {
      source: { kind: "ai", confidence: 0.9, model: "claude-sonnet-5-5" },
    });
    const another = critical(3, {
      source: { kind: "ai", confidence: 0.8, model: "claude-haiku-5-5" },
    });
    const run = runWith([done()], { needsReview: 4, analyzedCategories: ["accessibility"] });

    const { appendix } = buildReport(input(run, [critical(1), aiFinding, another, aiFinding]));

    expect(appendix.needsReview).toBe(4);
    expect(appendix.analyzedCategories).toEqual(["accessibility"]);
    expect(appendix.models).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(appendix.formula).toEqual({
      scoreK: 40,
      penalty: { critical: 10, medium: 4, low: 1 },
      repeatStep: 0.1,
      repeatCap: 2,
    });
  });

  it("carries what the user needs from the run", () => {
    const report = buildReport(input(runWith([done()], { entry: "mcp", language: "it" })));

    expect(report.run).toMatchObject({ entry: "mcp", language: "it", status: "completed" });
    expect(report.pages[0]).toMatchObject({ templateKey: "/", templateSize: 1, url: URL_A });
    expect(report.pages[0]?.screenshot).toEqual({ path: "shots/s.png", width: 1440, height: 900 });
    expect(report.pages[0]?.annotatedPath).toBe("shots/s.annotated.png");
  });

  it("is a report that follows the schema, in every case above", () => {
    const run = runWith([done(), failed(URL_A, "mobile")], {
      viewports: [DEFAULT_VIEWPORTS.desktop, DEFAULT_VIEWPORTS.mobile],
      status: "partial",
    });

    expect(reportDataSchema.safeParse(buildReport(input(run, [critical(1)]))).success).toBe(true);
  });
});

describe("summarize", () => {
  it("counts the captures and the findings that count, and takes the score of the site", () => {
    const run = runWith([done(), failed(URL_A, "mobile")], {
      viewports: [DEFAULT_VIEWPORTS.desktop, DEFAULT_VIEWPORTS.mobile],
      pages: [page(URL_A), page(URL_B)],
      status: "partial",
      needsReview: 3,
    });
    const findings = [critical(1), critical(2, { number: 2, fingerprint: fingerprint("9") })];

    const summary = summarize(buildReport(input(run, findings, { [fingerprint("9")]: IGNORED })));

    expect(summary).toMatchObject({
      status: "partial",
      captures: { total: 4, done: 1, failed: 1, notRun: 2 },
      findings: 1, // the ignored one does not count
      score: 78,
      band: "good",
      needsReview: 3,
    });
  });

  it("refuses to summarize a run that is still running", async () => {
    const running = makeRun({ status: "running", finishedAt: null });

    const error = await rejectionOf(async () => summarize(buildReport(input(running))));

    expect(error.code).toBe("INVALID_INPUT");
  });
});
