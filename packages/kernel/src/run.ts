import {
  CATEGORIES,
  DEFAULT_VIEWPORTS,
  FlawDotError,
  originOf,
  type AbortSignalLike,
  type AnalysisPlan,
  type CaptureOutcome,
  type Clock,
  type FindingRepository,
  type ProjectRepository,
  type Run,
  type RunId,
  type RunRepository,
  type RunStatus,
  type RunSummary,
  type SettingsRepository,
} from "@flawdot/core-model";
import type { EventChannel } from "./event-channel.js";
import { toErrorShape } from "./errors.js";
import { loadReport } from "./load-report.js";
import { summarize } from "./report.js";
import {
  capturedOf,
  locate,
  newTask,
  type RunContext,
  type Step,
  type TaskResult,
  type TaskState,
} from "./task.js";

export interface RunRepositories {
  readonly projects: Pick<ProjectRepository, "getOrCreate">;
  readonly runs: Pick<RunRepository, "save" | "get">;
  readonly findings: Pick<FindingRepository, "saveAll" | "byRun" | "states">;
  readonly settings: Pick<SettingsRepository, "get">;
}

/**
 * Runs one task through the steps. It never throws: whatever goes wrong in the task is the result of that task, a failed
 * capture that can be tried again. That includes a failure to save its findings: the findings are saved whole or not at
 * all, so nothing of the task is left behind. A failure of the storage that stops the whole run is another thing, and
 * `executeRun` takes it.
 */
async function runTask(
  steps: readonly Step[],
  task: TaskState,
  ctx: RunContext,
): Promise<TaskResult> {
  const base = { url: task.target.url, viewport: task.viewport.name } as const;
  const stopped = (step: Step): boolean => step.interruptible === true && ctx.signal.aborted;
  try {
    for (const step of steps) {
      if (stopped(step)) return { kind: "cancelled" };
      await step.run(task, ctx);
      if (stopped(step)) return { kind: "cancelled" }; // the browser was busy while the user cancelled: nothing is kept
    }
    return {
      kind: "done",
      outcome: {
        ...base,
        status: "done",
        screenshot: capturedOf(task).screenshot, // a task that has no capture must not look done
        annotatedPath: task.annotatedPath,
        analyzed: CATEGORIES.filter((category) => task.analyzed.includes(category)),
        needsReview: task.needsReview,
        analysisFailures: task.problems.length,
      },
    };
  } catch (error) {
    // Once the user has cancelled, whatever the work throws is that: the browser is closed under it.
    if (ctx.signal.aborted) return { kind: "cancelled" };
    const shape = toErrorShape(
      error,
      `Capturing ${originOf(task.target.url)} failed unexpectedly.`,
    );
    ctx.emit({ type: "capture_failed", ...locate(task, ctx.runId), error: shape });
    return { kind: "failed", outcome: { ...base, status: "failed", error: shape } };
  }
}

/** A run that is over: it has an end time and one of the three states that a run can end in. */
export type FinishedRun = Run & { readonly status: Exclude<RunStatus, "running"> };

/**
 * The run as it ends. `interrupted` is true when the user cancelled before every task was done: it wins over the rest.
 * A run is `partial` when a capture failed, even if it is the only one. A cancel that comes after the last task ends
 * changes nothing, because nothing was interrupted.
 */
export function foldRun(
  run: Run,
  results: readonly TaskResult[],
  interrupted: boolean,
  now: Date,
): FinishedRun {
  const outcomes: CaptureOutcome[] = results.flatMap((result) =>
    result.kind === "cancelled" ? [] : [result.outcome],
  );
  const done = outcomes.filter(
    (o): o is Extract<CaptureOutcome, { status: "done" }> => o.status === "done",
  );
  const anyFailed = outcomes.some((o) => o.status === "failed");
  const status = interrupted ? "cancelled" : anyFailed ? "partial" : "completed";
  return {
    ...run,
    status,
    finishedAt: now.toISOString(),
    needsReview: done.reduce((sum, o) => sum + o.needsReview, 0),
    // Only what was analyzed in every capture that is done: a category that failed anywhere has no honest total.
    analyzedCategories: CATEGORIES.filter(
      (category) => done.length > 0 && done.every((o) => o.analyzed.includes(category)),
    ),
    captures: outcomes,
  };
}

export interface ExecuteArgs {
  readonly plan: AnalysisPlan;
  readonly runId: RunId;
  readonly entry: "web" | "mcp";
  readonly repos: RunRepositories;
  readonly steps: readonly Step[];
  readonly clock: Clock;
  readonly signal: AbortSignalLike;
  readonly events: EventChannel;
}

/**
 * The life of a run: the project, the run saved as "running", the tasks one after the other, the run saved as it
 * ended, and only then the event that says so, so that whoever reads the run when it hears the end finds the end.
 * The summary is made after that event, from what is saved.
 *
 * A failure of a task is the result of that task. A failure of the storage in the rest of the run is not: it rejects,
 * and if it comes before the end of the run there is no `run_finished`, and the run is left as "partial" if that can
 * still be saved (a run must not stay "running" for ever). A run that was saved as it ended is never touched again.
 */
export async function executeRun(args: ExecuteArgs): Promise<RunSummary> {
  const { plan, runId, repos, signal, events, clock } = args;
  let run: Run | undefined;
  try {
    const project = await repos.projects.getOrCreate(plan.projectOrigin);
    const [settings, states] = await Promise.all([
      repos.settings.get(),
      repos.findings.states(project.id),
    ]);
    const started: Run = {
      id: runId,
      projectId: project.id,
      startedAt: clock.now().toISOString(),
      finishedAt: null,
      entry: args.entry,
      ai: plan.ai,
      language: plan.language,
      viewports: plan.viewports.map((name) => DEFAULT_VIEWPORTS[name]),
      pages: plan.pages,
      status: "running",
    };
    await repos.runs.save(started);
    run = started;

    const ctx: RunContext = {
      runId,
      projectId: project.id,
      language: plan.language,
      limits: settings.captureLimits,
      states,
      signal,
      emit: (event) => events.emit(event),
    };
    ctx.emit({ type: "run_started", runId, total: plan.pages.length * plan.viewports.length });

    const results: TaskResult[] = [];
    let interrupted = false;
    for (const target of plan.pages) {
      for (const viewport of started.viewports) {
        const result = await runTask(args.steps, newTask(target, viewport), ctx);
        if (result.kind === "cancelled") {
          interrupted = true;
          break;
        }
        results.push(result);
      }
      if (interrupted) break;
    }

    const finished = foldRun(started, results, interrupted, clock.now());
    await repos.runs.save(finished);
    run = undefined; // saved as it ended: nothing is left to repair
    ctx.emit({ type: "run_finished", runId, status: finished.status });
    return summarize(await loadReport(repos, runId));
  } catch (error) {
    if (run !== undefined) {
      // Best effort, and never instead of the real error: it is thrown below.
      await repos.runs
        .save({ ...run, status: "partial", finishedAt: clock.now().toISOString() })
        .catch(() => undefined);
    }
    throw error instanceof FlawDotError
      ? error
      : new FlawDotError(
          "INTERNAL",
          "The analysis failed unexpectedly while saving or reading its data.",
          { cause: error },
        );
  }
}
