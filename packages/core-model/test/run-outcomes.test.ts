import { describe, expect, it } from "vitest";
import { captureOutcomeSchema, runSchema } from "../src/index.js";
import { pageTarget, run } from "./fixtures.js";

const done = {
  url: pageTarget.url,
  viewport: "desktop",
  status: "done",
  screenshot: { path: "shots/home-desktop.png", width: 1440, height: 900 },
  annotatedPath: "shots/home-desktop.annotated.png",
  analyzed: ["accessibility"],
  needsReview: 2,
  analysisFailures: 0,
} as const;

const failed = {
  url: pageTarget.url,
  viewport: "mobile",
  status: "failed",
  error: { code: "TIMEOUT", message: "The page took too long to load.", retryable: true },
} as const;

describe("captureOutcome", () => {
  it("accepts a capture that was done and one that failed", () => {
    expect(captureOutcomeSchema.parse(done)).toEqual(done);
    expect(captureOutcomeSchema.parse(failed)).toEqual(failed);
  });

  it("accepts a done capture that has no annotated picture", () => {
    expect(captureOutcomeSchema.safeParse({ ...done, annotatedPath: null }).success).toBe(true);
  });

  it.each([
    ["a failed capture with no error", { ...failed, error: undefined }],
    ["a done capture with no screenshot", { ...done, screenshot: undefined }],
    ["a category twice", { ...done, analyzed: ["accessibility", "accessibility"] }],
    ["an unknown category", { ...done, analyzed: ["performance"] }],
    ["a negative needsReview", { ...done, needsReview: -1 }],
    ["a fractional count of failures", { ...done, analysisFailures: 0.5 }],
    ["an empty annotated path", { ...done, annotatedPath: "" }],
    ["an unknown status", { ...done, status: "skipped" }],
    ["a url that is not http", { ...done, url: "file:///etc/passwd" }],
  ])("rejects %s", (_label, outcome) => {
    expect(captureOutcomeSchema.safeParse(outcome).success).toBe(false);
  });
});

describe("run: what it recorded about its captures", () => {
  it("is still valid with none of the new fields: older runs have none", () => {
    expect(runSchema.safeParse(run).success).toBe(true);
  });

  it("accepts the summary of the analysis and the outcome of each capture", () => {
    const recorded = {
      ...run,
      needsReview: 2,
      analyzedCategories: ["accessibility"],
      captures: [done, failed],
    };

    expect(runSchema.parse(recorded)).toEqual(recorded);
  });

  it.each([
    [
      "an outcome for a page that is not in the run",
      { captures: [{ ...done, url: "http://localhost:3000/other" }] },
    ],
    [
      "an outcome for a viewport that is not in the run",
      { captures: [{ ...done, viewport: "tablet" }] },
    ],
    ["two outcomes for the same page and viewport", { captures: [done, done] }],
    ["a category twice in the summary", { analyzedCategories: ["ux", "ux"] }],
    ["a negative needsReview", { needsReview: -3 }],
  ])("rejects %s", (_label, extra) => {
    expect(runSchema.safeParse({ ...run, ...extra }).success).toBe(false);
  });
});
