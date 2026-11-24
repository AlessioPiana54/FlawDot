import { FlawDotError, type AiAnalyzer } from "@flawdot/core-model";
import { createInMemoryStorage } from "@flawdot/storage";
import { ManualClock, projectId, rejectionOf, runId } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { createFlawDot } from "../src/index.js";
import {
  elementDraft,
  fakeAnnotator,
  fakeIds,
  fakeInput,
  makeKernel,
  makePlan,
  returning,
} from "./support/fakes.js";

describe("createFlawDot", () => {
  it("needs an input for URLs, and says so when it is built, not when it is used", () => {
    const clock = new ManualClock();

    const build = () =>
      createFlawDot({
        entry: "web",
        inputs: [],
        analyzers: [],
        repos: createInMemoryStorage({ clock }),
        annotator: fakeAnnotator().annotator,
        clock,
        ids: fakeIds(),
      });

    expect(build).toThrow(FlawDotError);
    expect(build).toThrow("input for URLs");
  });

  it("does not take an input that is not for URLs", () => {
    const clock = new ManualClock();
    const other = { id: "figma" as never, capture: fakeInput().input.capture };

    expect(() =>
      createFlawDot({
        entry: "web",
        inputs: [other],
        analyzers: [],
        repos: createInMemoryStorage({ clock }),
        annotator: fakeAnnotator().annotator,
        clock,
        ids: fakeIds(),
      }),
    ).toThrow("input for URLs");
  });

  it("saves how the analysis was asked for: the AI mode of the plan is the one of the run", async () => {
    const { kernel, storage } = makeKernel();

    await kernel.analyze(makePlan({ ai: { kind: "subscription" } })).done;

    expect((await storage.runs.get(runId(1))).ai).toEqual({ kind: "subscription" });
  });

  it("leaves the analyzers of the AI alone: no step asks them anything yet", async () => {
    let asked = 0;
    const aiAnalyzer: AiAnalyzer = {
      kind: "ai",
      id: "ui-visual",
      category: "ui",
      buildRequests: () => {
        asked += 1;
        return [];
      },
    };
    const { kernel, storage } = makeKernel({ extraAnalyzers: [aiAnalyzer] });

    const handle = kernel.analyze(makePlan({ ai: { kind: "subscription" } }));
    await handle.done;

    expect(asked).toBe(0);
    const run = await storage.runs.get(handle.runId);
    expect(run.analyzedCategories).toEqual(["accessibility"]);
    expect(run.captures?.[0]).toMatchObject({ status: "done", analysisFailures: 0 });
  });

  it("exports only what the other packages use", () => {
    expect(Object.keys(api).sort()).toEqual(["createFlawDot", "createNoAiFulfiller"]);
  });
});

describe("report", () => {
  it("is refused for a run that does not exist", async () => {
    const { kernel } = makeKernel();

    expect((await rejectionOf(() => kernel.report(runId(9)))).code).toBe("INVALID_INPUT");
  });

  it("is the report of what was saved, with the scores and the findings", async () => {
    const { kernel } = makeKernel({ analyzers: [returning([elementDraft(1, "critical")])] });
    const handle = kernel.analyze(makePlan());
    await handle.done;

    const report = await kernel.report(handle.runId);

    expect(report.pages[0]).toMatchObject({ status: "done", score: 78 });
    expect(report.pages[0]?.findings).toHaveLength(1);
    expect(report.site).toEqual({ score: 78, band: "good", pagesAnalyzed: 1, pagesTotal: 1 });
  });

  it("scores again with the new weights, with no new analysis", async () => {
    const calls = fakeInput();
    const { kernel, storage } = makeKernel({
      input: calls,
      analyzers: [returning([elementDraft(1, "critical")])],
    });
    const handle = kernel.analyze(makePlan());
    await handle.done;
    const before = await kernel.report(handle.runId);

    await storage.settings.update({
      weights: { ui: 0.4, ux: 0.2, accessibility: 0.2, conversion: 0.2 },
    });
    const after = await kernel.report(handle.runId);

    expect(after.weights).toEqual({ ui: 0.4, ux: 0.2, accessibility: 0.2, conversion: 0.2 });
    expect(after.pages[0]?.categories).toEqual(before.pages[0]?.categories);
    expect(calls.calls).toHaveLength(1); // nothing was captured again
  });

  it("does not show a problem that was ignored after the analysis: the ignore holds for the old runs too", async () => {
    const { kernel, storage } = makeKernel({
      analyzers: [returning([elementDraft(1, "critical")])],
    });
    const handle = kernel.analyze(makePlan());
    await handle.done;
    const [finding] = await storage.findings.byRun(handle.runId);

    await storage.findings.setState(projectId("example.com"), finding?.fingerprint ?? "", {
      kind: "ignored",
      reason: "not_a_problem",
      at: "2026-01-02T00:00:00.000Z",
    });
    const report = await kernel.report(handle.runId);

    expect(report.pages[0]?.categories.accessibility).toBe(100);
    expect(report.pages[0]?.findings[0]?.ignored).toBe(true);
  });
});
