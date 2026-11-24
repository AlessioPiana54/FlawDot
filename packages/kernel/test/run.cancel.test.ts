import type { ProgressEvent } from "@flawdot/core-model";
import { runId } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import {
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
  returning,
  target,
  typesOf,
} from "./support/fakes.js";

const twoPages = makePlan({ pages: [target(URL_A), target(URL_B)] });

describe("cancelling an analysis", () => {
  it("before the first capture: nothing is captured, and the run is saved as cancelled", async () => {
    const input = fakeInput();
    const { kernel, storage } = makeKernel({ input });
    const handle = kernel.analyze(makePlan());

    await handle.cancel();

    expect(input.calls).toEqual([]);
    expect(typesOf(await collect(handle))).toEqual(["run_started", "run_finished"]);
    expect(await storage.runs.get(runId(1))).toMatchObject({ status: "cancelled", captures: [] });
    expect(await handle.done).toMatchObject({
      status: "cancelled",
      captures: { total: 1, done: 0, failed: 0, notRun: 1 },
    });
  });

  it("while a capture is going on: what was captured stays, the one in progress leaves nothing, and nothing is told as failed", async () => {
    const annotator = fakeAnnotator();
    const input = fakeInput({ [forPage(URL_B)]: { hangsUntilAborted: true } });
    const { kernel, storage } = makeKernel({
      input,
      annotator,
      analyzers: [returning([elementDraft(1, "low")])],
    });
    const handle = kernel.analyze(twoPages);

    const events: ProgressEvent[] = [];
    let cancelled: Promise<void> | undefined;
    for await (const event of handle.events) {
      events.push(event);
      if (event.type === "phase" && event.phase === "capture" && event.url === URL_B) {
        cancelled = handle.cancel(); // the second page is being captured
      }
    }
    await cancelled;

    expect(typesOf(events)).toEqual([
      "run_started",
      "phase:capture",
      "phase:rules",
      "capture_done",
      "phase:capture",
      "run_finished",
    ]);
    expect(events.at(-1)).toMatchObject({ status: "cancelled" });
    expect((await storage.runs.get(runId(1))).captures?.map((c) => c.url)).toEqual([URL_A]);
    expect(await storage.findings.byRun(runId(1))).toHaveLength(1);
    expect(annotator.calls).toHaveLength(1);
    const report = await kernel.report(runId(1));
    expect(report.pages.map((p) => [p.url, p.status])).toEqual([
      [URL_A, "done"],
      [URL_B, "not_run"],
    ]);
  });

  it("is not a failure when the browser breaks under the capture because of the cancel", async () => {
    let cancel = (): void => undefined;
    const input = fakeInput({
      [forPage(URL_A)]: {
        afterAnalysis: () => {
          cancel();
          throw new Error("Target page, context or browser has been closed");
        },
      },
    });
    const { kernel } = makeKernel({ input });
    const handle = kernel.analyze(makePlan());
    cancel = () => void handle.cancel();

    const events = await collect(handle);

    expect(events.some((e) => e.type === "capture_failed")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", status: "cancelled" });
  });

  it("does not start the analyzers that are left once the user has cancelled", async () => {
    let cancel = (): void => undefined;
    const first = fakeAnalyzer(() => {
      cancel();
      return Promise.reject(new Error("Target page, context or browser has been closed"));
    });
    const second = fakeAnalyzer(() => ({ drafts: [], needsReview: 0 }), "ux");
    const { kernel } = makeKernel({ analyzers: [first, second] });
    const handle = kernel.analyze(makePlan());
    cancel = () => void handle.cancel();

    const events = await collect(handle);

    expect(second.calls).toEqual([]);
    expect(typesOf(events)).not.toContain("analysis_failed");
    expect(events.at(-1)).toMatchObject({ status: "cancelled" });
  });

  it("drops a capture that finished just as the user cancelled: no findings, no picture, no event", async () => {
    let cancel = (): void => undefined;
    const annotator = fakeAnnotator();
    const input = fakeInput({ [forPage(URL_A)]: { afterAnalysis: () => cancel() } });
    const { kernel, storage } = makeKernel({
      input,
      annotator,
      analyzers: [returning([elementDraft(1, "low")])],
    });
    const handle = kernel.analyze(makePlan());
    cancel = () => void handle.cancel();

    const events = await collect(handle);

    expect(typesOf(events)).not.toContain("capture_done");
    expect(annotator.calls).toEqual([]);
    expect(await storage.findings.byRun(runId(1))).toEqual([]);
    expect((await storage.runs.get(runId(1))).captures).toEqual([]);
  });

  it("wins over a capture that failed before: the run was stopped, so it is cancelled and not partial", async () => {
    const input = fakeInput({
      [forPage(URL_A)]: { throws: new Error("boom") },
      [forPage(URL_B)]: { hangsUntilAborted: true },
    });
    const { kernel, storage } = makeKernel({ input });
    const handle = kernel.analyze(twoPages);

    for await (const event of handle.events) {
      if (event.type === "phase" && event.url === URL_B) void handle.cancel();
    }

    const run = await storage.runs.get(runId(1));
    expect(run.status).toBe("cancelled");
    expect(run.captures?.map((c) => c.status)).toEqual(["failed"]);
  });

  it("gives back only when the run is saved and the last event is told", async () => {
    const { kernel, storage } = makeKernel({
      input: fakeInput({ [forPage(URL_A)]: { hangsUntilAborted: true } }),
    });
    const handle = kernel.analyze(makePlan());
    const seen: ProgressEvent[] = [];
    const reading = (async () => {
      for await (const event of handle.events) seen.push(event);
    })();
    await new Promise((resolve) => setImmediate(resolve));

    await handle.cancel();

    expect((await storage.runs.get(runId(1))).status).toBe("cancelled");
    await reading;
    expect(seen.at(-1)).toMatchObject({ type: "run_finished", status: "cancelled" });
  });

  it("is safe to call twice, and after the run is over, where it changes nothing", async () => {
    const { kernel, storage } = makeKernel();
    const handle = kernel.analyze(makePlan());
    await handle.done;

    await handle.cancel();
    await handle.cancel();

    expect((await storage.runs.get(runId(1))).status).toBe("completed");
    expect((await handle.done).status).toBe("completed");
  });

  it("gives the input and the analyzers the signal of the run, and it is aborted by the cancel", async () => {
    const input = fakeInput({ [forPage(URL_A)]: { hangsUntilAborted: true } });
    const { kernel } = makeKernel({ input });
    const handle = kernel.analyze(makePlan());
    await new Promise((resolve) => setImmediate(resolve));
    expect(input.calls[0]?.signal.aborted).toBe(false);

    await handle.cancel();

    expect(input.calls[0]?.signal.aborted).toBe(true);
  });
});
