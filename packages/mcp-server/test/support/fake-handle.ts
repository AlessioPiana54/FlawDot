import {
  runSummarySchema,
  type ProgressEvent,
  type RunId,
  type RunSummary,
} from "@flawdot/core-model";
import type { RunHandle } from "@flawdot/kernel";

/** A run that a test drives by hand: `emit` an event, `finish` the run, or make it `fail` to be saved. */
export interface FakeHandle extends RunHandle {
  emit(event: ProgressEvent): void;
  finish(summary?: RunSummary): void;
  fail(error: unknown): void;
  readonly cancelled: () => number;
}

export const summaryOf = (runId: RunId, override: Record<string, unknown> = {}): RunSummary =>
  runSummarySchema.parse({
    runId,
    projectId: "localhost-3000",
    status: "completed",
    entry: "mcp",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:05.000Z",
    captures: { total: 1, done: 1, failed: 0, notRun: 0 },
    findings: 1,
    score: 78,
    band: "good",
    needsReview: 0,
    ...override,
  });

export function fakeHandle(runId: RunId): FakeHandle {
  const events: ProgressEvent[] = [];
  const wakeups: (() => void)[] = [];
  let closed = false;
  let cancelCalls = 0;
  let resolveDone!: (summary: RunSummary) => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<RunSummary>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => undefined);

  const wake = (): void => {
    for (const wakeup of wakeups.splice(0)) wakeup();
  };

  async function* stream(): AsyncGenerator<ProgressEvent> {
    let next = 0;
    for (;;) {
      while (next < events.length) {
        const event = events[next];
        next += 1;
        if (event !== undefined) yield event;
      }
      if (closed) return;
      await new Promise<void>((resolve) => wakeups.push(resolve));
    }
  }

  return {
    runId,
    events: { [Symbol.asyncIterator]: stream },
    emit(event) {
      events.push(event);
      wake();
    },
    finish(summary = summaryOf(runId)) {
      closed = true;
      wake();
      resolveDone(summary);
    },
    fail(error) {
      closed = true;
      wake();
      rejectDone(error);
    },
    cancel() {
      cancelCalls += 1;
      closed = true;
      wake();
      resolveDone(summaryOf(runId, { status: "cancelled" }));
      return done.then(
        () => undefined,
        () => undefined,
      );
    },
    cancelled: () => cancelCalls,
    done,
  };
}
