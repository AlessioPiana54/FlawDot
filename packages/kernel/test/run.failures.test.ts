import { FlawDotError, type ProgressEvent } from "@flawdot/core-model";
import type { InMemoryStorage } from "@flawdot/storage";
import { rejectionOf, runId } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import {
  URL_A,
  URL_B,
  collect,
  draft,
  elementDraft,
  fakeAnalyzer,
  fakeAnnotator,
  fakeInput,
  forPage,
  makeKernel,
  makePlan,
  returning,
  target,
  typesOf,
} from "./support/fakes.js";

const timeout = () => new FlawDotError("TIMEOUT", "The page took too long to load.");
const slow = () =>
  fakeAnalyzer(() => Promise.reject(new FlawDotError("TIMEOUT", "axe took too long.")));

describe("a capture that fails", () => {
  it("is told as capture_failed, with the error, and the run is partial: no findings, no picture", async () => {
    const annotator = fakeAnnotator();
    const { kernel, storage } = makeKernel({
      input: fakeInput({ [forPage(URL_A)]: { throws: timeout() } }),
      annotator,
    });

    const events = await collect(kernel.analyze(makePlan()));

    expect(typesOf(events)).toEqual([
      "run_started",
      "phase:capture",
      "capture_failed",
      "run_finished",
    ]);
    expect(events[2]).toMatchObject({
      type: "capture_failed",
      url: URL_A,
      error: { code: "TIMEOUT", message: "The page took too long to load.", retryable: true },
    });
    expect(events[3]).toMatchObject({ status: "partial" });
    expect(annotator.calls).toEqual([]);
    expect(await storage.findings.byRun(runId(1))).toEqual([]);
    expect((await storage.runs.get(runId(1))).captures).toEqual([
      {
        url: URL_A,
        viewport: "desktop",
        status: "failed",
        error: expect.objectContaining({ code: "TIMEOUT" }),
      },
    ]);
  });

  it("does not stop the others: what was captured before and after is kept", async () => {
    const input = fakeInput({ [forPage(URL_A, "mobile")]: { throws: timeout() } });
    const { kernel, storage } = makeKernel({ input });

    const events = await collect(
      kernel.analyze(
        makePlan({ pages: [target(URL_A), target(URL_B)], viewports: ["desktop", "mobile"] }),
      ),
    );

    expect(events.filter((e) => e.type === "capture_done")).toHaveLength(3);
    expect(events.filter((e) => e.type === "capture_failed")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", status: "partial" });
    expect((await storage.findings.byRun(runId(1))).map((f) => [f.pageUrl, f.viewport])).toEqual([
      [URL_A, "desktop"],
      [URL_B, "desktop"],
      [URL_B, "mobile"],
    ]);
  });

  it("is told as INTERNAL, with a message that names the site, when what was thrown is not a FlawDotError", async () => {
    const secret = new Error("CANARY-secret at https://example.com/?token=CANARY");
    const { kernel } = makeKernel({ input: fakeInput({ [forPage(URL_A)]: { throws: secret } }) });

    const events = await collect(kernel.analyze(makePlan()));

    expect(events[2]).toMatchObject({
      type: "capture_failed",
      error: {
        code: "INTERNAL",
        message: "Capturing https://example.com failed unexpectedly.",
        retryable: false,
      },
    });
    expect(JSON.stringify(events)).not.toContain("CANARY");
  });

  it("is an error of the input that never handed the live page to the analyzers", async () => {
    const { kernel } = makeKernel({ input: fakeInput({ [forPage(URL_A)]: { skipsLive: true } }) });

    const events = await collect(kernel.analyze(makePlan()));

    expect(events.find((e) => e.type === "capture_failed")).toMatchObject({
      error: {
        code: "INTERNAL",
        message: "The input did not hand the live page to the analyzers.",
      },
    });
  });

  it("does not lose the findings that were saved when the picture fails, and the run is complete", async () => {
    const annotator = fakeAnnotator({ fail: () => new Error("CANARY sharp crashed") });
    const { kernel, storage } = makeKernel({
      annotator,
      analyzers: [returning([elementDraft(1, "low")])],
    });

    const events = await collect(kernel.analyze(makePlan()));

    expect(typesOf(events)).toEqual([
      "run_started",
      "phase:capture",
      "phase:rules",
      "analysis_failed",
      "capture_done",
      "run_finished",
    ]);
    expect(events[3]).toMatchObject({
      analyzer: "annotation",
      error: { code: "INTERNAL", retryable: false },
    });
    expect(JSON.stringify(events)).not.toContain("CANARY");
    expect(events.at(-1)).toMatchObject({ status: "completed" });
    expect(await storage.findings.byRun(runId(1))).toHaveLength(1);
    expect((await storage.runs.get(runId(1))).captures?.[0]).toMatchObject({
      status: "done",
      annotatedPath: null,
      analysisFailures: 1,
    });
  });

  it("is a failed capture too when the storage fails with an error that is not a FlawDotError, and says nothing of it", async () => {
    const { kernel } = makeKernel({
      wrap: (storage) => ({
        ...storage,
        findings: {
          ...storage.findings,
          saveAll: () => Promise.reject(new Error("CANARY disk full")),
        },
      }),
    });

    const events = await collect(kernel.analyze(makePlan()));

    expect(events.find((e) => e.type === "capture_failed")).toMatchObject({
      error: { code: "INTERNAL", message: "Capturing https://example.com failed unexpectedly." },
    });
    expect(JSON.stringify(events)).not.toContain("CANARY");
    expect(events.at(-1)).toMatchObject({ status: "partial" });
  });

  it("is a failed capture when its findings cannot be saved, and nothing is drawn", async () => {
    const annotator = fakeAnnotator();
    const { kernel } = makeKernel({
      annotator,
      wrap: (storage) => ({
        ...storage,
        findings: {
          ...storage.findings,
          saveAll: () => Promise.reject(new FlawDotError("INVALID_INPUT", "Run not found")),
        },
      }),
    });

    const events = await collect(kernel.analyze(makePlan()));

    expect(events.find((e) => e.type === "capture_failed")).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(events.at(-1)).toMatchObject({ status: "partial" });
    expect(annotator.calls).toEqual([]);
  });
});

describe("an analyzer that fails", () => {
  it.each([
    ["TIMEOUT", () => new FlawDotError("TIMEOUT", "axe took too long."), "TIMEOUT", true],
    ["a plain error", () => new Error("CANARY page text"), "INTERNAL", false],
  ])(
    "keeps the capture and the picture when it throws %s",
    async (_label, make, code, retryable) => {
      const annotator = fakeAnnotator();
      const analyzer = fakeAnalyzer(() => Promise.reject(make()));
      const { kernel, storage } = makeKernel({ annotator, analyzers: [analyzer] });

      const events = await collect(kernel.analyze(makePlan()));

      expect(typesOf(events)).toEqual([
        "run_started",
        "phase:capture",
        "phase:rules",
        "analysis_failed",
        "capture_done",
        "run_finished",
      ]);
      expect(events[3]).toMatchObject({
        type: "analysis_failed",
        url: URL_A,
        analyzer: "accessibility-wcag",
        error: { code, retryable },
      });
      expect(JSON.stringify(events)).not.toContain("CANARY");
      expect(events.at(-1)).toMatchObject({ status: "completed" });
      expect(annotator.calls).toHaveLength(1);
      expect(await storage.runs.get(runId(1))).toMatchObject({
        analyzedCategories: [],
        captures: [{ status: "done", analyzed: [], analysisFailures: 1 }],
      });
    },
  );

  it("is a failure of the analyzer, and not a cancel of the run, when it says it was cancelled and nobody cancelled", async () => {
    const analyzer = fakeAnalyzer(() =>
      Promise.reject(new FlawDotError("CANCELLED", "Cancelled.")),
    );
    const { kernel } = makeKernel({ analyzers: [analyzer] });

    const events = await collect(kernel.analyze(makePlan()));

    expect(events.find((e) => e.type === "analysis_failed")).toMatchObject({
      error: { code: "CANCELLED" },
    });
    expect(events.at(-1)).toMatchObject({ type: "run_finished", status: "completed" });
  });

  it("makes its category have no score, not a perfect one", async () => {
    const { kernel } = makeKernel({ analyzers: [slow()] });
    const handle = kernel.analyze(makePlan());
    await handle.done;

    const report = await kernel.report(handle.runId);

    expect(report.pages[0]?.categories.accessibility).toBeNull();
    expect(report.pages[0]?.score).toBeNull();
    expect(report.site.score).toBeNull();
  });

  it("loses all it found when one of its drafts is not valid, and says so", async () => {
    const broken = { ...draft(), title: "   " } as never;
    const { kernel, storage } = makeKernel({
      analyzers: [returning([elementDraft(1, "low"), broken])],
    });

    const events = await collect(kernel.analyze(makePlan()));

    expect(events.find((e) => e.type === "analysis_failed")).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(await storage.findings.byRun(runId(1))).toEqual([]);
    expect(events.find((e) => e.type === "capture_done")).toMatchObject({ findings: 0 });
  });

  it("does not take the findings of the analyzers that worked, and counts only what they found", async () => {
    const failing = slow();
    const working = fakeAnalyzer(
      () => ({ drafts: [elementDraft(1, "low")], needsReview: 2 }),
      "ux",
    );
    const { kernel, storage } = makeKernel({ analyzers: [failing, working] });

    const handle = kernel.analyze(makePlan());
    await handle.done;

    expect((await storage.findings.byRun(handle.runId)).map((f) => f.ruleKey)).toEqual(["rule-1"]);
    expect(await storage.runs.get(handle.runId)).toMatchObject({
      needsReview: 2,
      analyzedCategories: ["ux"],
      captures: [{ analyzed: ["ux"], needsReview: 2, analysisFailures: 1 }],
    });
  });
});

describe("the storage that fails", () => {
  const broken = () => Promise.reject(new Error("CANARY disk full"));
  const failingOn =
    (method: "save" | "getOrCreate" | "states") =>
    (storage: InMemoryStorage): InMemoryStorage => ({
      ...storage,
      projects: {
        ...storage.projects,
        getOrCreate: (origin) =>
          method === "getOrCreate" ? broken() : storage.projects.getOrCreate(origin),
      },
      runs: {
        ...storage.runs,
        save: (run) => (method === "save" ? broken() : storage.runs.save(run)),
      },
      findings: {
        ...storage.findings,
        states: (id) => (method === "states" ? broken() : storage.findings.states(id)),
      },
    });

  it.each(["getOrCreate", "states", "save"] as const)(
    "rejects done, and leaves no run behind, when %s fails before the run starts",
    async (method) => {
      const { kernel, storage } = makeKernel({ wrap: failingOn(method) });
      const handle = kernel.analyze(makePlan());

      const error = await rejectionOf(() => handle.done);

      expect(error.code).toBe("INTERNAL");
      expect(error.message).not.toContain("CANARY");
      expect(await collect(handle)).toEqual([]);
      await expect(storage.runs.get(runId(1))).rejects.toThrow("Run not found");
    },
  );

  it("rejects done and ends the events without run_finished when the end of the run cannot be saved, but marks the run partial", async () => {
    let saves = 0;
    const { kernel, storage } = makeKernel({
      wrap: (inner) => ({
        ...inner,
        runs: {
          ...inner.runs,
          save: (run) => {
            saves += 1;
            return saves === 2
              ? Promise.reject(new Error("CANARY disk full"))
              : inner.runs.save(run);
          },
        },
      }),
    });
    const handle = kernel.analyze(makePlan());

    const events: ProgressEvent[] = await collect(handle);
    const error = await rejectionOf(() => handle.done);

    expect(typesOf(events)).not.toContain("run_finished");
    expect(error.code).toBe("INTERNAL");
    expect((await storage.runs.get(runId(1))).status).toBe("partial");
  });

  it("does not touch a run that was saved as it ended when it is the report that cannot be read", async () => {
    const { kernel, storage } = makeKernel({
      wrap: (inner) => ({
        ...inner,
        findings: {
          ...inner.findings,
          byRun: () => Promise.reject(new Error("CANARY read failed")),
        },
      }),
    });
    const handle = kernel.analyze(makePlan());

    const events = await collect(handle);
    const error = await rejectionOf(() => handle.done);

    expect(error.code).toBe("INTERNAL");
    expect(events.at(-1)).toMatchObject({ type: "run_finished", status: "completed" }); // the run did end
    expect((await storage.runs.get(runId(1))).status).toBe("completed");
  });

  it("keeps the real error when even the repair of the run fails", async () => {
    let saves = 0;
    const { kernel } = makeKernel({
      wrap: (inner) => ({
        ...inner,
        runs: {
          ...inner.runs,
          save: (run) =>
            (saves += 1) === 1
              ? inner.runs.save(run)
              : Promise.reject(new Error("CANARY disk gone")),
        },
      }),
    });
    const handle = kernel.analyze(makePlan());

    const error = await rejectionOf(() => handle.done);

    expect(saves).toBe(3); // the run, its end, and the repair
    expect(error.code).toBe("INTERNAL");
    expect(error.message).not.toContain("CANARY");
  });

  it("does not end the process when nobody reads done: the rejection is the reader's to take", async () => {
    const { kernel } = makeKernel({ wrap: failingOn("states") });
    const handle = kernel.analyze(makePlan());

    await collect(handle); // the events end; done is never touched
    await new Promise((resolve) => setImmediate(resolve));

    await expect(handle.done).rejects.toBeInstanceOf(FlawDotError);
  });

  it("lets cancel() finish quietly even though the run could not be saved", async () => {
    const { kernel } = makeKernel({ wrap: failingOn("states") });

    await expect(kernel.analyze(makePlan()).cancel()).resolves.toBeUndefined();
  });
});

describe("what is added up over a run", () => {
  it("adds the needsReview of every capture that is done", async () => {
    const analyzer = fakeAnalyzer(() => ({ drafts: [], needsReview: 2 }));
    const { kernel, storage } = makeKernel({ analyzers: [analyzer] });

    const handle = kernel.analyze(makePlan({ viewports: ["desktop", "mobile"] }));
    await handle.done;

    expect((await storage.runs.get(handle.runId)).needsReview).toBe(4);
    expect((await handle.done).needsReview).toBe(4);
  });

  it("adds the needsReview of the analyzers of one capture", async () => {
    const first = fakeAnalyzer(() => ({ drafts: [], needsReview: 2 }));
    const second = fakeAnalyzer(() => ({ drafts: [], needsReview: 3 }), "ux");
    const { kernel, storage } = makeKernel({ analyzers: [first, second] });

    const handle = kernel.analyze(makePlan());
    await handle.done;

    expect((await storage.runs.get(handle.runId)).captures?.[0]).toMatchObject({ needsReview: 5 });
  });

  it("takes as analyzed only what was analyzed in every capture that is done", async () => {
    let call = 0;
    const analyzer = fakeAnalyzer(() =>
      (call += 1) === 2 ? Promise.reject(timeout()) : { drafts: [], needsReview: 0 },
    );
    const { kernel, storage } = makeKernel({ analyzers: [analyzer] });

    const handle = kernel.analyze(makePlan({ viewports: ["desktop", "mobile"] }));
    await handle.done;

    expect((await storage.runs.get(handle.runId)).analyzedCategories).toEqual([]);
  });

  it("gives the summary of the run when it is done", async () => {
    const { kernel } = makeKernel({
      input: fakeInput({ [forPage(URL_B)]: { throws: timeout() } }),
      analyzers: [returning([elementDraft(1, "critical")], 1)],
    });

    const summary = await kernel.analyze(makePlan({ pages: [target(URL_A), target(URL_B)] })).done;

    expect(summary).toMatchObject({
      runId: runId(1),
      status: "partial",
      captures: { total: 2, done: 1, failed: 1, notRun: 0 },
      findings: 1,
      score: 78,
      band: "good",
      needsReview: 1,
    });
  });
});
