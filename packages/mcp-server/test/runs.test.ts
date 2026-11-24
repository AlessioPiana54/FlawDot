import { describe, expect, it } from "vitest";
import { FlawDotError, singlePagePlan, type ProgressEvent } from "@flawdot/core-model";
import { runId } from "@flawdot/test-support";
import { createRunRegistry } from "../src/runs.js";
import { fakeHandle } from "./support/fake-handle.js";

const plan = singlePagePlan("http://localhost:3000/", {
  viewports: ["desktop", "mobile"],
  language: "en",
  ai: { kind: "none" },
});

const R1 = runId(1);
const R2 = runId(2);
const URL = "http://localhost:3000/";

const done = (viewport: "desktop" | "mobile"): ProgressEvent => ({
  type: "capture_done",
  runId: R1,
  url: URL,
  viewport,
  findings: 1,
  costUsd: null,
});
const failed = (viewport: "desktop" | "mobile"): ProgressEvent => ({
  type: "capture_failed",
  runId: R1,
  url: URL,
  viewport,
  error: { code: "UNREACHABLE", message: "no", retryable: true },
});

/** Lets the stream of events be read: the registry follows it in the background. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const rejection = (run: () => unknown): FlawDotError => {
  try {
    run();
  } catch (error) {
    if (error instanceof FlawDotError) return error;
    throw error;
  }
  throw new Error("expected a FlawDotError");
};

describe("the run registry", () => {
  it("starts the run the plan asks for and gives its id and the number of captures", () => {
    const registry = createRunRegistry();
    const handle = fakeHandle(R1);

    const run = registry.start(plan, () => handle);

    expect(run.runId).toBe(R1);
    expect(run.progress()).toEqual({ total: 2, done: 0, failed: 0 });
    expect(run.isOver()).toBe(false);
  });

  it("counts the captures that are done and the ones that failed, from the events", async () => {
    const registry = createRunRegistry();
    const handle = fakeHandle(R1);
    const run = registry.start(plan, () => handle);

    handle.emit(done("desktop"));
    handle.emit(failed("mobile"));
    await settle();

    expect(run.progress()).toEqual({ total: 2, done: 1, failed: 1 });
  });

  it("ignores events that are not about a capture finishing", async () => {
    const registry = createRunRegistry();
    const handle = fakeHandle(R1);
    const run = registry.start(plan, () => handle);

    handle.emit({ type: "run_started", runId: R1, total: 2 });
    handle.emit({ type: "phase", runId: R1, url: URL, viewport: "desktop", phase: "capture" });
    await settle();

    expect(run.progress()).toEqual({ total: 2, done: 0, failed: 0 });
  });

  it("is over when the run is saved and every event is read, and then the counts are final", async () => {
    const registry = createRunRegistry();
    const handle = fakeHandle(R1);
    const run = registry.start(plan, () => handle);

    handle.emit(done("desktop"));
    handle.emit(done("mobile"));
    handle.finish();
    await run.over;

    expect(run.isOver()).toBe(true);
    expect(run.progress()).toEqual({ total: 2, done: 2, failed: 0 });
  });

  it("is over when the run cannot be saved, and `over` does not reject", async () => {
    const registry = createRunRegistry();
    const handle = fakeHandle(R1);
    const run = registry.start(plan, () => handle);

    handle.fail(new Error("disk full"));
    await run.over;

    expect(run.isOver()).toBe(true);
    await expect(run.handle.done).rejects.toThrow("disk full");
  });

  it("refuses a second run while one is going, and says which one", () => {
    const registry = createRunRegistry();
    registry.start(plan, () => fakeHandle(R1));
    let started = false;

    const error = rejection(() =>
      registry.start(plan, () => {
        started = true;
        return fakeHandle(R2);
      }),
    );

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain(R1);
    expect(error.message).toContain("flawdot_next");
    expect(started).toBe(false);
  });

  it("starts another run once the first is over", async () => {
    const registry = createRunRegistry();
    const first = fakeHandle(R1);
    const run = registry.start(plan, () => first);
    first.finish();
    await run.over;

    const second = registry.start(plan, () => fakeHandle(R2));

    expect(second.runId).toBe(R2);
  });

  it("starts again after a run that could not be saved", async () => {
    const registry = createRunRegistry();
    const first = fakeHandle(R1);
    const run = registry.start(plan, () => first);
    first.fail(new Error("disk full"));
    await run.over;

    expect(registry.start(plan, () => fakeHandle(R2)).runId).toBe(R2);
  });

  it("does not start a run when the plan is refused by the kernel", () => {
    const registry = createRunRegistry();

    expect(() =>
      registry.start(plan, () => {
        throw new FlawDotError("INVALID_INPUT", "bad plan");
      }),
    ).toThrow("bad plan");

    // nothing is going: the next start is not refused
    expect(registry.start(plan, () => fakeHandle(R1)).runId).toBe(R1);
  });

  it("finds a run, going or over, by its id", async () => {
    const registry = createRunRegistry();
    const handle = fakeHandle(R1);
    const run = registry.start(plan, () => handle);
    expect(registry.get(R1)).toBe(run);

    handle.finish();
    await run.over;

    expect(registry.get(R1)).toBe(run);
  });

  it("says INVALID_INPUT for an id that is not one of this session", () => {
    const registry = createRunRegistry();

    const error = rejection(() => registry.get(R2));

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain("Unknown run id");
  });

  it("cancels the run that is going when it shuts down, and waits for it", async () => {
    const registry = createRunRegistry();
    const handle = fakeHandle(R1);
    const run = registry.start(plan, () => handle);

    await registry.shutdown();

    expect(handle.cancelled()).toBe(1);
    expect(run.isOver()).toBe(true);
  });

  it("cancels nothing when no run is going, and may be called twice", async () => {
    const registry = createRunRegistry();
    const handle = fakeHandle(R1);
    const run = registry.start(plan, () => handle);
    handle.finish();
    await run.over;

    await registry.shutdown();
    await registry.shutdown();

    expect(handle.cancelled()).toBe(0);
  });

  it("refuses a new run once it is shutting down", async () => {
    const registry = createRunRegistry();
    await registry.shutdown();

    const error = rejection(() => registry.start(plan, () => fakeHandle(R1)));

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain("closing");
  });

  it("does not throw when cancelling fails", async () => {
    const registry = createRunRegistry();
    const handle = { ...fakeHandle(R1), cancel: () => Promise.reject(new Error("no")) };
    registry.start(plan, () => handle);

    await expect(registry.shutdown()).resolves.toBeUndefined();
  });
});
