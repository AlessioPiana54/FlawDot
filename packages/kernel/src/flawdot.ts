import {
  FlawDotError,
  analysisPlanSchema,
  parseOrThrow,
  type AnalysisPlan,
  type Annotator,
  type Clock,
  type IdGenerator,
  type InputPlugin,
  type ProgressEvent,
  type ReportData,
  type RunId,
  type RunSummary,
  type AnalyzerPlugin,
} from "@flawdot/core-model";
import { createEventChannel } from "./event-channel.js";
import { loadReport } from "./load-report.js";
import { executeRun, type RunRepositories } from "./run.js";
import { createSteps } from "./steps.js";

/** An analysis that is going on. */
export interface RunHandle {
  readonly runId: RunId;
  /** Every event from the first, to anybody who reads, whenever they start. It ends after `run_finished`. */
  readonly events: AsyncIterable<ProgressEvent>;
  /** Stops the analysis and gives back when it is over. What was captured stays saved. Safe to call again. */
  cancel(): Promise<void>;
  /**
   * The numbers of the run when it is over. A capture or an analyzer that fails does not reject it: that is in the
   * events and in the report, and a task whose findings cannot be saved is a failed capture. It rejects when the run
   * itself cannot be saved or read. Before the run is saved as it ended there is no `run_finished`; after it there is,
   * and `done` rejects only because the summary could not be made.
   */
  readonly done: Promise<RunSummary>;
}

export interface FlawDot {
  /** Starts an analysis and gives the handle at once. A plan that is not valid throws here, and nothing is created. */
  analyze(plan: AnalysisPlan): RunHandle;
  /** The report of a run, from what is saved and the weights in force now. */
  report(runId: RunId): Promise<ReportData>;
}

export interface FlawDotDeps {
  /** How the analyses are started: the app (`web`) or Claude Code (`mcp`). Only the one that builds the kernel knows. */
  readonly entry: "web" | "mcp";
  readonly inputs: readonly Pick<InputPlugin, "id" | "capture">[];
  readonly analyzers: readonly AnalyzerPlugin[];
  readonly repos: RunRepositories;
  readonly annotator: Annotator;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

const nothing = (): void => undefined;

export function createFlawDot(deps: FlawDotDeps): FlawDot {
  const input = deps.inputs.find((candidate) => candidate.id === "url");
  if (input === undefined) {
    throw new FlawDotError("INVALID_INPUT", "The kernel needs an input for URLs.");
  }
  const steps = createSteps({
    input,
    analyzers: deps.analyzers.flatMap((analyzer) => (analyzer.kind === "rule" ? [analyzer] : [])),
    findings: deps.repos.findings,
    annotator: deps.annotator,
    ids: deps.ids,
  });

  return {
    analyze(candidate) {
      // The plan comes from outside. A bad one is refused before the run has an id, so no run exists to be left behind.
      const plan = parseOrThrow(analysisPlanSchema, candidate, { what: "analysis plan" });
      const runId = deps.ids.runId();
      const controller = new AbortController();
      const channel = createEventChannel();

      const done = executeRun({
        plan,
        runId,
        entry: deps.entry,
        repos: deps.repos,
        steps,
        clock: deps.clock,
        signal: controller.signal,
        events: channel,
      }).finally(() => {
        channel.close();
      });
      // Somebody may read only the events and never `done`: a rejection that nobody awaits would end the process.
      done.catch(nothing);

      return {
        runId,
        events: channel.events,
        cancel: async () => {
          controller.abort();
          await done.then(nothing, nothing);
        },
        done,
      };
    },
    report: (runId) => loadReport(deps.repos, runId),
  };
}
