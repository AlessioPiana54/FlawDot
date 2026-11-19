import {
  CATEGORIES,
  PENALTY,
  REPEAT_CAP,
  REPEAT_STEP,
  SCORE_K,
  band,
  categoryScore,
  pageScore,
  parseOrThrow,
  reportDataSchema,
  runSummarySchema,
  siteScore,
  type CaptureOutcome,
  type CategoryWeights,
  type Finding,
  type FindingState,
  type ReportData,
  type ReportPage,
  type Run,
  type RunSummary,
} from "@flawdot/core-model";

export interface ReportInput {
  readonly run: Run;
  /** The findings saved for the run. */
  readonly findings: readonly Finding[];
  /** The "ignore" states of the project, by fingerprint. */
  readonly states: ReadonlyMap<string, FindingState>;
  /** The weights in force now. They are not saved with the run, so changing them changes the old reports too. */
  readonly weights: CategoryWeights;
}

const NO_SCORES: ReportPage["categories"] = {
  ui: null,
  ux: null,
  accessibility: null,
  conversion: null,
};

/** The order of the circle numbers; a problem of the whole page has no number and goes last; ids break a tie. */
const byNumberThenId = (a: Finding, b: Finding): number => {
  if (a.number !== b.number) {
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function analyzedPage(
  outcome: Extract<CaptureOutcome, { status: "done" }>,
  found: readonly Finding[],
  { states, weights }: ReportInput,
): Omit<ReportPage, "url" | "templateKey" | "templateSize" | "viewport"> {
  // `categoryScore` wants the findings of one page, one viewport and one category at a time.
  const categories = { ...NO_SCORES };
  for (const category of CATEGORIES) {
    if (outcome.analyzed.includes(category)) {
      categories[category] = categoryScore(
        found.filter((finding) => finding.category === category),
        states,
      );
    }
  }
  const score = pageScore(categories, weights);
  return {
    status: "done",
    error: null,
    screenshot: outcome.screenshot,
    annotatedPath: outcome.annotatedPath,
    categories,
    score,
    band: score === null ? null : band(score),
    findings: [...found].sort(byNumberThenId).map((finding) => ({
      finding,
      ignored: states.get(finding.fingerprint)?.kind === "ignored",
    })),
  };
}

/**
 * Builds the report of a run from what is saved. A pair of page and viewport that has no outcome was never reached, and
 * one that failed has no findings: neither gets a score, so neither can look like a page with nothing wrong.
 */
export function buildReport(input: ReportInput): ReportData {
  const { run, findings, weights } = input;
  const outcomes = new Map((run.captures ?? []).map((o) => [`${o.viewport} ${o.url}`, o]));

  const pages: ReportPage[] = run.pages.flatMap((target) =>
    run.viewports.map((viewport): ReportPage => {
      const where = {
        url: target.url,
        templateKey: target.templateKey,
        templateSize: target.templateSize,
        viewport: viewport.name,
      };
      const outcome = outcomes.get(`${viewport.name} ${target.url}`);
      if (outcome?.status === "done") {
        const found = findings.filter(
          (finding) => finding.pageUrl === target.url && finding.viewport === viewport.name,
        );
        return { ...where, ...analyzedPage(outcome, found, input) };
      }
      return {
        ...where,
        status: outcome === undefined ? "not_run" : "failed",
        error: outcome?.status === "failed" ? outcome.error : null,
        screenshot: null,
        annotatedPath: null,
        categories: { ...NO_SCORES },
        score: null,
        band: null,
        findings: [],
      };
    }),
  );

  const site = siteScore(pages.map((page) => page.score));
  const models = new Set<string>();
  for (const finding of findings) {
    if (finding.source.kind === "ai") models.add(finding.source.model);
  }

  return parseOrThrow(reportDataSchema, {
    run: {
      id: run.id,
      projectId: run.projectId,
      status: run.status,
      entry: run.entry,
      ai: run.ai,
      language: run.language,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    weights,
    site: {
      score: site,
      band: site === null ? null : band(site),
      pagesAnalyzed: pages.filter((page) => page.status === "done").length,
      pagesTotal: pages.length,
    },
    pages,
    appendix: {
      analyzedCategories: run.analyzedCategories ?? [],
      needsReview: run.needsReview ?? 0,
      models: [...models].sort(),
      formula: {
        scoreK: SCORE_K,
        penalty: { ...PENALTY },
        repeatStep: REPEAT_STEP,
        repeatCap: REPEAT_CAP,
      },
    },
  });
}

/** The numbers of a finished run, from its report. A run that is still running has no summary. */
export function summarize(report: ReportData): RunSummary {
  const count = (status: ReportPage["status"]): number =>
    report.pages.filter((page) => page.status === status).length;
  return parseOrThrow(runSummarySchema, {
    runId: report.run.id,
    projectId: report.run.projectId,
    status: report.run.status,
    entry: report.run.entry,
    startedAt: report.run.startedAt,
    finishedAt: report.run.finishedAt,
    captures: {
      total: report.pages.length,
      done: count("done"),
      failed: count("failed"),
      notRun: count("not_run"),
    },
    findings: report.pages.reduce(
      (sum, page) => sum + page.findings.filter((entry) => !entry.ignored).length,
      0,
    ),
    score: report.site.score,
    band: report.site.band,
    needsReview: report.appendix.needsReview,
  });
}
