import type {
  AnalysisPlan,
  Category,
  ReportData,
  ReportFinding,
  ReportPage,
  Severity,
} from "@flawdot/core-model";
import type { Progress } from "./runs.js";

// What the tools say to Claude Code, as text. Everything here is a pure function of its arguments.
//
// Two kinds of text meet in a result. Ours (the catalog titles and fixes, the numbers) is written as it is. What comes
// from the page (a selector, the evidence of a rule, a name in an error message) is data, not instructions: it is
// cleaned so it cannot start a line of its own, cut to a length, and a selector or an evidence is put between quotes.

/** The most problems listed for one picture: the rest are in the legend of the picture, which has all of them. */
export const MAX_PROBLEMS_LISTED = 10;
/** The most pictures that go with a result. A page has three viewports at most, so this is for a run of more pages. */
export const MAX_PICTURES = 6;
export const MAX_TEXT = 20_000;

const FIX_MAX = 240;
const EVIDENCE_MAX = 120;
const SELECTOR_MAX = 100;
const TITLE_MAX = 160;
const MESSAGE_MAX = 300;
const ADDRESS_MAX = 200;
const PATH_MAX = 300;

const CATEGORY_LABEL: Record<Category, string> = {
  ui: "UI",
  ux: "UX",
  accessibility: "Accessibility",
  conversion: "Conversion",
};
// The order of the scores in a line, fixed so that Claude finds the same thing in the same place.
const SCORE_ORDER = ["accessibility", "ui", "ux", "conversion"] as const;
const SEVERITIES: readonly Severity[] = ["critical", "medium", "low"];
const BAND_LABEL = {
  excellent: "excellent",
  good: "good",
  needs_work: "needs work",
  critical: "critical",
} as const;

// Control characters and format characters (zero-width, direction marks). The line and paragraph separators count
// as spaces for the collapse below, so they are not listed here.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

function clean(text: string, max: number): string {
  // A page can send millions of characters: cut a generous length before the work, then at the limit by characters.
  const flat = text
    .slice(0, max * 4 + 8)
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(flat);
  return characters.length > max ? `${characters.slice(0, max - 1).join("")}…` : flat;
}

/** Text from a page, in one line and between quotes (`"` and `\` escaped), at most `max` characters long. */
export const quote = (text: string, max: number): string => JSON.stringify(clean(text, max));

/** The same cleaning and cutting, with no quotes: for a piece of a page inside a sentence of ours. */
export const plain = (text: string, max: number): string => clean(text, max);

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

export function describeStarted(runId: string, plan: AnalysisPlan): string {
  const captures = plan.pages.length * plan.viewports.length;
  return [
    `Analysis started. Run id: ${runId}`,
    `${plural(plan.pages.length, "page", "pages")} at ${plan.viewports.join(", ")}: ${plural(captures, "capture", "captures")} to make. Call flawdot_next with this run id to wait for the result.`,
  ].join("\n");
}

export function describeProgress(runId: string, progress: Progress): string {
  return `Run ${runId} is still running: ${String(progress.done)} of ${plural(progress.total, "capture", "captures")} done (${String(progress.failed)} failed). Call flawdot_next again with the same run id to keep waiting.`;
}

const STATUS_TEXT = {
  running: "still running",
  completed: "completed",
  partial: "finished, some captures failed or were not reached",
  cancelled: "cancelled",
} as const;

export interface DescribedReport {
  readonly text: string;
  /** The files of the annotated pictures that go with the text, in the order the text calls them image 1, 2, … */
  readonly pictures: readonly string[];
}

const isVisible = (entry: ReportFinding): boolean => !entry.ignored;

function describeProblem(entry: ReportFinding): string[] {
  const { finding } = entry;
  const place = finding.number === null ? "–" : `${String(finding.number)}.`;
  const principle =
    finding.principle.code === null
      ? plain(finding.principle.label, TITLE_MAX)
      : `${plain(finding.principle.code, TITLE_MAX)} ${plain(finding.principle.label, TITLE_MAX)}`;
  const badge =
    finding.source.kind === "rule"
      ? "Verified"
      : `AI suggestion (confidence ${finding.source.confidence.toFixed(2)})`;
  const where =
    finding.location.kind === "page"
      ? "whole page (no circle)"
      : `element ${quote(finding.location.selector, SELECTOR_MAX)}${
          finding.location.count > 1 ? ` (${String(finding.location.count)} elements)` : ""
        }`;
  const evidence =
    finding.evidence === null ? "" : ` · Evidence: ${quote(finding.evidence, EVIDENCE_MAX)}`;
  return [
    ` ${place} [${finding.severity}] ${plain(finding.title, TITLE_MAX)} · ${CATEGORY_LABEL[finding.category]} · ${principle} · ${badge}`,
    `    Where: ${where}${evidence}`,
    `    Fix: ${plain(finding.fix, FIX_MAX)}`,
  ];
}

function describeScores(page: ReportPage): string {
  const scores = SCORE_ORDER.map(
    (category) => `${CATEGORY_LABEL[category]} ${page.categories[category]?.toString() ?? "—"}`,
  ).join(" · ");
  const total =
    page.score === null || page.band === null
      ? "Score —"
      : `Score ${String(page.score)} (${BAND_LABEL[page.band]})`;
  return `${total} · ${scores}`;
}

function describePage(
  page: ReportPage,
  picture: { index: number; total: number } | null,
): string[] {
  const head = `== ${plain(page.url, ADDRESS_MAX)} · ${page.viewport}`;
  if (page.status === "failed") {
    const error = page.error;
    return [
      `${head} · capture failed ==`,
      error === null ? "No details." : `${error.code}: ${plain(error.message, MESSAGE_MAX)}`,
    ];
  }
  if (page.status === "not_run") return [`${head} · not run (the analysis was cancelled) ==`];

  const lines = [`${head} ==`, describeScores(page)];
  if (page.annotatedPath === null) {
    lines.push("Picture: not available (drawing the circles failed).");
  } else if (picture === null) {
    lines.push(
      `Picture: not attached (only the first ${String(MAX_PICTURES)} are). Full-size file: ${plain(page.annotatedPath, PATH_MAX)}`,
    );
  } else {
    lines.push(
      `Picture: image ${String(picture.index)} of ${String(picture.total)}, with the circles. Full-size file: ${plain(page.annotatedPath, PATH_MAX)}`,
    );
  }

  const problems = page.findings.filter(isVisible);
  if (problems.length === 0) return [...lines, "No problems found."];

  const bySeverity = SEVERITIES.flatMap((severity) => {
    const count = problems.filter((entry) => entry.finding.severity === severity).length;
    return count === 0 ? [] : [`${String(count)} ${severity}`];
  }).join(", ");
  lines.push(
    `Problems: ${String(problems.length)} (${bySeverity}). The numbers are the circles in the picture.`,
  );
  for (const entry of problems.slice(0, MAX_PROBLEMS_LISTED)) lines.push(...describeProblem(entry));
  const hidden = problems.length - MAX_PROBLEMS_LISTED;
  if (hidden > 0) {
    lines.push(
      ` + ${plural(hidden, "more problem", "more problems")}: ${hidden === 1 ? "it is" : "they are"} in the legend of the picture and in the saved run, not listed here.`,
    );
  }
  return lines;
}

/** The result of a run as text, and the pictures that go with it. */
export function describeReport(report: ReportData): DescribedReport {
  const { run, site, appendix } = report;
  const siteScore =
    site.score === null || site.band === null
      ? "Site score: — (nothing was analyzed)"
      : `Site score: ${String(site.score)}/100 (${BAND_LABEL[site.band]})`;
  const head = [
    `FlawDot analysis ${STATUS_TEXT[run.status]} · run ${run.id}`,
    `${siteScore} · ${String(site.pagesAnalyzed)} of ${String(site.pagesTotal)} captures analyzed`,
  ];
  const missing = SCORE_ORDER.filter((category) => !appendix.analyzedCategories.includes(category));
  if (missing.length > 0) {
    const names = missing.map((category) => CATEGORY_LABEL[category]).join(", ");
    head.push(
      run.ai.kind === "none"
        ? `Rules only (axe-core, no AI): ${names} not analyzed, shown as —.`
        : `Not analyzed, shown as —: ${names}.`,
    );
  }
  if (appendix.needsReview > 0) {
    head.push(
      `${plural(appendix.needsReview, "place needs", "places need")} a manual review; ${appendix.needsReview === 1 ? "it is" : "they are"} not counted in the scores.`,
    );
  }

  const withPicture = report.pages.filter(
    (page) => page.status === "done" && page.annotatedPath !== null,
  );
  const pictures = withPicture
    .slice(0, MAX_PICTURES)
    .flatMap((page) => (page.annotatedPath === null ? [] : [page.annotatedPath]));
  const lines = [...head];
  for (const page of report.pages) {
    const at = pictures.indexOf(page.annotatedPath ?? "");
    lines.push(
      "",
      ...describePage(page, at === -1 ? null : { index: at + 1, total: pictures.length }),
    );
  }

  const text = lines.join("\n");
  const cut = "\n… (cut: the result is too long)";
  return {
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - cut.length)}${cut}` : text,
    pictures,
  };
}

/** True when not one capture worked and the run was not stopped by the user: that is a failure, not a result. */
export const allCapturesFailed = (report: ReportData): boolean =>
  report.site.pagesAnalyzed === 0 && report.run.status !== "cancelled";
