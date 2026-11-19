import type { CaptureOutcome, Category } from "@flawdot/core-model";
import { makeRun } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import { foldRun } from "../src/run.js";
import type { TaskResult } from "../src/task.js";

const NOW = new Date("2026-01-01T00:10:00.000Z");
const running = makeRun({ status: "running", finishedAt: null });

const done = (analyzed: Category[] = ["accessibility"], needsReview = 0): TaskResult => ({
  kind: "done",
  outcome: {
    url: "https://example.com/",
    viewport: "desktop",
    status: "done",
    screenshot: { path: "s.png", width: 1440, height: 900 },
    annotatedPath: "s.annotated.png",
    analyzed,
    needsReview,
    analysisFailures: 0,
  },
});

const failed = (): TaskResult => ({
  kind: "failed",
  outcome: {
    url: "https://example.com/",
    viewport: "desktop",
    status: "failed",
    error: { code: "TIMEOUT", message: "Slow.", retryable: true },
  },
});

const cancelled: TaskResult = { kind: "cancelled" };

describe("foldRun: how a run ends", () => {
  it.each([
    ["every task is done", [done(), done()], false, "completed"],
    ["a task failed, even if it is the only one", [failed()], false, "partial"],
    ["a task failed among others that are done", [done(), failed(), done()], false, "partial"],
    ["the user stopped it", [done()], true, "cancelled"],
    ["the user stopped it, and a task had failed before", [failed(), cancelled], true, "cancelled"],
    ["nothing was run", [], false, "completed"],
  ] as const)("is %s: %s -> %s", (_label, results, interrupted, status) => {
    expect(foldRun(running, results, interrupted, NOW).status).toBe(status);
  });

  it("sets the end time from the clock it is given", () => {
    expect(foldRun(running, [done()], false, NOW).finishedAt).toBe("2026-01-01T00:10:00.000Z");
  });

  it("keeps the outcome of the tasks that ended, in order, and nothing for the one that was cancelled", () => {
    const captures = foldRun(running, [done(), failed(), cancelled], true, NOW).captures;

    expect((captures as CaptureOutcome[]).map((c) => c.status)).toEqual(["done", "failed"]);
  });

  it("adds the needsReview of the tasks that are done, and only those", () => {
    expect(foldRun(running, [done([], 2), failed(), done([], 5)], false, NOW).needsReview).toBe(7);
  });

  it("takes as analyzed only the categories that every task that is done analyzed, in the order of the categories", () => {
    const results = [done(["conversion", "accessibility", "ux"]), done(["ux", "accessibility"])];

    expect(foldRun(running, results, false, NOW).analyzedCategories).toEqual([
      "ux",
      "accessibility",
    ]);
  });

  it("takes nothing as analyzed when no task is done", () => {
    expect(foldRun(running, [failed()], false, NOW).analyzedCategories).toEqual([]);
    expect(foldRun(running, [], false, NOW).analyzedCategories).toEqual([]);
  });

  it("does not change the run it is given", () => {
    const before = structuredClone(running);

    foldRun(running, [done()], false, NOW);

    expect(running).toEqual(before);
  });
});
