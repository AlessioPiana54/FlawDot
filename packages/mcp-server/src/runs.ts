import {
  FlawDotError,
  type AnalysisPlan,
  type ProgressEvent,
  type RunId,
} from "@flawdot/core-model";
import type { RunHandle } from "@flawdot/kernel";

/** Captures asked for, done and failed so far. */
export interface Progress {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
}

export interface TrackedRun {
  readonly runId: RunId;
  readonly handle: RunHandle;
  /** Captures asked for, done and failed so far. */
  progress(): Progress;
  /** True once the run is over: its numbers are saved and its events are all read. */
  isOver(): boolean;
  /** Settles when the run is over. It never rejects: whether the run could be saved is for `handle.done` to say. */
  readonly over: Promise<void>;
}

/** The runs of this session, and the rule that only one is going at a time. */
export interface RunRegistry {
  /**
   * Starts a run with `begin` and follows it. While another run is going, nothing is started and the error says which
   * one. The check and the start are one step with nothing awaited in between, so two calls cannot both start.
   */
  start(plan: AnalysisPlan, begin: () => RunHandle): TrackedRun;
  /** A run of this session, going or over. An id that is not one of them is INVALID_INPUT. */
  get(runId: string): TrackedRun;
  /** Cancels the run that is going, if any, and waits for it to end. What was captured stays saved. Never throws. */
  shutdown(): Promise<void>;
}

const nothing = (): void => undefined;

export function createRunRegistry(): RunRegistry {
  const runs = new Map<string, TrackedRun>();
  let closing = false;

  const active = (): TrackedRun | undefined =>
    [...runs.values()].find((candidate) => !candidate.isOver());

  return {
    start(plan, begin) {
      if (closing) {
        throw new FlawDotError("INVALID_INPUT", "FlawDot is closing: no new analysis starts.");
      }
      const going = active();
      if (going !== undefined) {
        throw new FlawDotError(
          "INVALID_INPUT",
          `Run ${going.runId} is still going: one analysis at a time. Call flawdot_next with this run id, or wait for it to end.`,
        );
      }

      const handle = begin();
      const counts = { total: plan.pages.length * plan.viewports.length, done: 0, failed: 0 };
      const follow = async (): Promise<void> => {
        try {
          for await (const event of handle.events) tally(event, counts);
        } catch {
          // The counts are only for the progress line: an error of the stream is for `done` to tell.
        }
      };
      const pump = follow();
      let finished = false;
      const over = Promise.allSettled([handle.done, pump]).then(() => {
        finished = true;
      });

      const run: TrackedRun = {
        runId: handle.runId,
        handle,
        progress: () => ({ ...counts }),
        isOver: () => finished,
        over,
      };
      runs.set(handle.runId, run);
      return run;
    },

    get(runId) {
      const run = runs.get(runId);
      if (run === undefined) {
        throw new FlawDotError(
          "INVALID_INPUT",
          "Unknown run id. A run id comes from flawdot_analyze, and lasts as long as this server runs.",
        );
      }
      return run;
    },

    async shutdown() {
      closing = true;
      await active()?.handle.cancel().catch(nothing);
    },
  };
}

function tally(event: ProgressEvent, counts: { done: number; failed: number }): void {
  if (event.type === "capture_done") counts.done += 1;
  else if (event.type === "capture_failed") counts.failed += 1;
}
