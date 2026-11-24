import {
  DEFAULT_VIEWPORTS,
  progressEventSchema,
  type FindingState,
  type FlawDotError,
} from "@flawdot/core-model";
import type { InMemoryStorage } from "@flawdot/storage";
import { projectId, runId } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import {
  ORIGIN,
  URL_A,
  URL_B,
  collect,
  elementDraft,
  fakeAnalyzer,
  fakeAnnotator,
  fakeInput,
  forPage,
  makeKernel,
  makePlan,
  pageDraft,
  returning,
  target,
  typesOf,
} from "./support/fakes.js";

describe("an analysis of one page, with rules only", () => {
  it("tells what happens, in order, and every event follows the schema", async () => {
    const { kernel } = makeKernel();

    const events = await collect(kernel.analyze(makePlan()));

    expect(typesOf(events)).toEqual([
      "run_started",
      "phase:capture",
      "phase:rules",
      "capture_done",
      "run_finished",
    ]);
    for (const event of events) expect(progressEventSchema.safeParse(event).success).toBe(true);
    expect(events[0]).toEqual({ type: "run_started", runId: runId(1), total: 1 });
    expect(events[3]).toMatchObject({
      type: "capture_done",
      url: URL_A,
      viewport: "desktop",
      findings: 1,
      costUsd: null,
    });
    expect(events[4]).toEqual({ type: "run_finished", runId: runId(1), status: "completed" });
  });

  it("gives the id of the run at once, before anything has happened", () => {
    const { kernel } = makeKernel();

    expect(kernel.analyze(makePlan()).runId).toBe(runId(1));
  });

  it("saves the run as it ends: status, end time, how it started, and what it learned of each capture", async () => {
    let passTime = (): void => undefined;
    const input = fakeInput({ [forPage(URL_A)]: { afterAnalysis: () => passTime() } });
    const { kernel, storage, clock } = makeKernel({
      input,
      analyzers: [returning([elementDraft(1, "critical")], 3)],
      entry: "mcp",
    });
    passTime = () => clock.advance(5000); // time passes while the page is captured

    await kernel.analyze(makePlan({ language: "it" })).done;

    expect(await storage.runs.get(runId(1))).toEqual({
      id: runId(1),
      projectId: "example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:05.000Z",
      entry: "mcp",
      ai: { kind: "none" },
      language: "it",
      viewports: [DEFAULT_VIEWPORTS.desktop],
      pages: [target()],
      status: "completed",
      needsReview: 3,
      analyzedCategories: ["accessibility"],
      captures: [
        {
          url: URL_A,
          viewport: "desktop",
          status: "done",
          screenshot: { path: "shots/desktop_.png", width: 1440, height: 900 },
          annotatedPath: "shots/desktop_.annotated.png",
          analyzed: ["accessibility"],
          needsReview: 3,
          analysisFailures: 0,
        },
      ],
    });
  });

  it("creates the project of the site, from the origin of the plan", async () => {
    const { kernel, storage } = makeKernel();

    await kernel.analyze(makePlan()).done;

    expect((await storage.projects.list()).map((p) => [p.id, p.origin])).toEqual([
      ["example.com", ORIGIN],
    ]);
  });

  it("numbers the findings by severity, then by height; a problem of the whole page gets no number", async () => {
    const { kernel, storage } = makeKernel({
      analyzers: [
        returning([
          elementDraft(1, "low", 50),
          elementDraft(2, "critical", 400),
          pageDraft(),
          elementDraft(3, "medium", 10),
        ]),
      ],
    });

    await kernel.analyze(makePlan()).done;

    const saved = await storage.findings.byRun(runId(1));
    expect(saved.map((f) => [f.ruleKey, f.number])).toEqual([
      ["rule-1", 3],
      ["rule-2", 1],
      ["document-title", null],
      ["rule-3", 2],
    ]);
  });

  it("gives each finding an id from the generator, the run, the page, the template and the language", async () => {
    const { kernel, storage } = makeKernel({
      analyzers: [returning([elementDraft(1, "low"), elementDraft(2, "low", 300)])],
    });

    await kernel.analyze(makePlan({ language: "it" })).done;

    const saved = await storage.findings.byRun(runId(1));
    expect(saved).toHaveLength(2);
    for (const finding of saved) {
      expect(finding).toMatchObject({
        runId: runId(1),
        pageUrl: URL_A,
        templateKey: "/",
        viewport: "desktop",
        language: "it",
      });
      expect(finding.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(saved.map((f) => f.id)).size).toBe(2);
  });

  it("gives the annotator the capture and the findings that count, the whole page problem too", async () => {
    const annotator = fakeAnnotator();
    const { kernel } = makeKernel({
      annotator,
      analyzers: [returning([elementDraft(1, "critical"), pageDraft()])],
    });

    await kernel.analyze(makePlan()).done;

    expect(annotator.calls).toHaveLength(1);
    expect(annotator.calls[0]?.capture.page.url).toBe(URL_A);
    expect(annotator.calls[0]?.findings.map((f) => f.number).sort()).toEqual([1, null]);
  });

  it("draws the picture also when there is nothing to circle: the MCP mode always gives it", async () => {
    const annotator = fakeAnnotator();
    const { kernel } = makeKernel({ annotator, analyzers: [returning([])] });

    await kernel.analyze(makePlan()).done;

    expect(annotator.calls).toHaveLength(1);
    expect(annotator.calls[0]?.findings).toEqual([]);
  });

  it("saves the findings before it draws the picture, and draws it before it says the capture is done", async () => {
    const order: string[] = [];
    let savedWhenDrawn = -1;
    let storageOfKernel: InMemoryStorage | undefined;
    const annotator = fakeAnnotator({
      onCall: async () => {
        order.push("annotate");
        savedWhenDrawn = (await storageOfKernel?.findings.byRun(runId(1)))?.length ?? -1;
      },
    });
    const { kernel, storage } = makeKernel({
      annotator,
      analyzers: [returning([elementDraft(1, "low")])],
    });
    storageOfKernel = storage;

    for await (const event of kernel.analyze(makePlan()).events) order.push(event.type);

    expect(savedWhenDrawn).toBe(1);
    expect(order.indexOf("annotate")).toBeLessThan(order.indexOf("capture_done"));
  });

  it("gives the input the context it needs: the run, the project and the limits of the settings", async () => {
    const input = fakeInput();
    const { kernel, storage } = makeKernel({ input });
    await storage.settings.update({ captureLimits: { maxElements: 50, maxHeight: 4000 } });

    await kernel.analyze(makePlan()).done;

    expect(input.calls[0]?.ctx).toEqual({
      runId: runId(1),
      projectId: "example.com",
      limits: { maxElements: 50, maxHeight: 4000 },
    });
    expect(input.calls[0]?.viewport).toEqual(DEFAULT_VIEWPORTS.desktop);
  });

  it("runs the analyzers with the language of the plan and the live page of the capture, and the same signal", async () => {
    const input = fakeInput();
    const analyzer = fakeAnalyzer();
    const { kernel } = makeKernel({ input, analyzers: [analyzer] });

    await kernel.analyze(makePlan({ language: "it" })).done;

    expect(analyzer.calls[0]?.ctx.language).toBe("it");
    expect(analyzer.calls[0]?.ctx.livePage).toBe(input.calls[0]?.live);
    expect(analyzer.calls[0]?.signal).toBe(input.calls[0]?.signal);
    expect(analyzer.calls[0]?.capture.page.url).toBe(URL_A);
  });

  it("goes through every page and viewport in order: the pages first, and in each one its viewports", async () => {
    const input = fakeInput();
    const { kernel, storage } = makeKernel({ input });

    const events = await collect(
      kernel.analyze(
        makePlan({ pages: [target(URL_A), target(URL_B)], viewports: ["desktop", "mobile"] }),
      ),
    );

    const order = [
      [URL_A, "desktop"],
      [URL_A, "mobile"],
      [URL_B, "desktop"],
      [URL_B, "mobile"],
    ];
    expect(events[0]).toMatchObject({ type: "run_started", total: 4 });
    expect(input.calls.map((c) => [c.target.url, c.viewport.name])).toEqual(order);
    expect((await storage.runs.get(runId(1))).captures?.map((c) => [c.url, c.viewport])).toEqual(
      order,
    );
  });

  it("does not show a finding of an ignored problem: no number, not drawn, not counted, and still saved", async () => {
    const drafts = [elementDraft(1, "critical"), elementDraft(2, "low")];
    const first = makeKernel({ analyzers: [returning(drafts)] });
    await first.kernel.analyze(makePlan()).done;
    const [critical] = await first.storage.findings.byRun(runId(1));
    const ignored: FindingState = {
      kind: "ignored",
      reason: "false_positive",
      at: "2026-01-02T00:00:00.000Z",
    };
    await first.storage.findings.setState(
      projectId("example.com"),
      critical?.fingerprint ?? "",
      ignored,
    );
    const annotator = fakeAnnotator();
    const again = makeKernel({ over: first, annotator, analyzers: [returning(drafts)] });

    const events = await collect(again.kernel.analyze(makePlan()));

    const saved = await first.storage.findings.byRun(runId(2));
    expect(saved.map((f) => [f.ruleKey, f.number])).toEqual([
      ["rule-1", null], // the ignored one
      ["rule-2", 1], // the one that is left is the first circle
    ]);
    expect(annotator.calls[0]?.findings).toHaveLength(1);
    expect(events.find((e) => e.type === "capture_done")).toMatchObject({ findings: 1 });
  });
});

describe("a plan that is not valid", () => {
  it.each([
    ["no page", { pages: [] }],
    ["a page twice", { pages: [target(), target()] }],
    ["a page of another site", { pages: [target("https://other.example/")] }],
    ["a language that does not exist", { language: "fr" as never }],
  ])("is refused at once, with %s, and nothing is created", async (_label, change) => {
    const { kernel, storage } = makeKernel();

    let error: FlawDotError | undefined;
    try {
      kernel.analyze(makePlan(change));
    } catch (thrown) {
      error = thrown as FlawDotError;
    }

    expect(error?.code).toBe("INVALID_INPUT");
    expect(await storage.projects.list()).toEqual([]);
  });

  it("does not use up the id of a run for a plan that was refused", () => {
    const { kernel } = makeKernel();

    expect(() => kernel.analyze(makePlan({ pages: [] }))).toThrow();

    expect(kernel.analyze(makePlan()).runId).toBe(runId(1));
  });
});

describe("two kernels with the same ids and clock", () => {
  it("make the same run: nothing in an analysis depends on the machine", async () => {
    const one = makeKernel();
    const two = makeKernel();

    await one.kernel.analyze(makePlan()).done;
    await two.kernel.analyze(makePlan()).done;

    expect(await one.storage.runs.get(runId(1))).toEqual(await two.storage.runs.get(runId(1)));
    expect(await one.storage.findings.byRun(runId(1))).toEqual(
      await two.storage.findings.byRun(runId(1)),
    );
  });
});
