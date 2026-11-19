import {
  FlawDotError,
  numberFindings,
  originOf,
  toFinding,
  type Annotator,
  type Capture,
  type FindingRepository,
  type IdGenerator,
  type InputPlugin,
  type LivePage,
  type RuleAnalyzer,
} from "@flawdot/core-model";
import { toErrorShape } from "./errors.js";
import { capturedOf, locate, type Step } from "./task.js";

export interface StepDeps {
  readonly input: Pick<InputPlugin, "capture">;
  readonly analyzers: readonly RuleAnalyzer[];
  readonly findings: Pick<FindingRepository, "saveAll">;
  readonly annotator: Annotator;
  readonly ids: IdGenerator;
}

/**
 * Captures the page and runs the rule analyzers on it. The two cannot be told apart: the analyzers need the page open,
 * and the capture module keeps it open only for the time of the callback it is given, so they run inside the capture.
 *
 * An analyzer that fails does not end the capture. An error thrown inside the callback would: the capture closes the
 * browser and throws it, and the screenshot is lost. So each analyzer is run on its own and its failure is noted, and the
 * findings it made, if it made any, are dropped: a bad draft is a failure of the analyzer, and half of its work is not kept.
 * A cancel is the one error that goes on, and the capture ends.
 */
function captureStep(deps: StepDeps): Step {
  return {
    name: "capture",
    interruptible: true,
    async run(task, ctx) {
      ctx.emit({ type: "phase", ...locate(task, ctx.runId), phase: "capture" });
      let reachedLivePage = false;

      const analyze = async (live: LivePage, capture: Capture): Promise<void> => {
        reachedLivePage = true;
        task.capture = capture;
        ctx.emit({ type: "phase", ...locate(task, ctx.runId), phase: "rules" });
        for (const analyzer of deps.analyzers) {
          try {
            const { drafts, needsReview } = await analyzer.analyze(
              capture,
              { language: ctx.language, livePage: live },
              ctx.signal,
            );
            const found = drafts.map((draft) =>
              toFinding(draft, {
                id: deps.ids.findingId(),
                runId: ctx.runId,
                pageUrl: task.target.url,
                templateKey: task.target.templateKey,
                viewport: task.viewport.name,
                language: ctx.language,
              }),
            );
            task.findings.push(...found);
            task.needsReview += needsReview;
            if (!task.analyzed.includes(analyzer.category)) task.analyzed.push(analyzer.category);
          } catch (error) {
            if (ctx.signal.aborted) throw error; // a cancel goes on: the capture ends
            task.problems.push({
              analyzer: analyzer.id,
              error: toErrorShape(
                error,
                `The ${analyzer.id} analyzer failed unexpectedly on ${originOf(task.target.url)}.`,
              ),
            });
          }
        }
      };

      const withAnalyzers = deps.analyzers.length > 0;
      task.capture = await deps.input.capture(
        task.target,
        task.viewport,
        { runId: ctx.runId, projectId: ctx.projectId, limits: ctx.limits },
        ctx.signal,
        withAnalyzers ? analyze : undefined,
      );
      if (withAnalyzers && !reachedLivePage) {
        throw new FlawDotError(
          "INTERNAL",
          "The input did not hand the live page to the analyzers.",
        );
      }
    },
  };
}

/**
 * Numbers the findings that count. An ignored problem is not numbered and is not drawn, so the others are numbered as
 * if it were not there: the circle 1 is always the first problem that the user sees.
 */
const numberStep: Step = {
  name: "number",
  async run(task, ctx) {
    const visible = task.findings.filter(
      (finding) => ctx.states.get(finding.fingerprint)?.kind !== "ignored",
    );
    const numbered = numberFindings(visible);
    const byId = new Map(numbered.map((finding) => [finding.id, finding]));
    task.findings = task.findings.map((finding) => byId.get(finding.id) ?? finding); // an ignored one stays as it is
    task.visible = numbered;
  },
};

/**
 * Saves the findings (all of them, the ignored too) and then draws the picture. The picture comes second because a
 * failure to draw it must not lose the findings: it is noted, the capture goes on without the picture, and nothing
 * saved has to be taken back (the repository has no way to delete). The annotator is not given a signal, so this
 * part is not interrupted.
 */
function persistStep(deps: StepDeps): Step {
  return {
    name: "persist",
    async run(task) {
      const capture = capturedOf(task);
      await deps.findings.saveAll(task.findings);
      try {
        task.annotatedPath = (await deps.annotator.annotate(capture, task.visible)).path;
      } catch (error) {
        task.problems.push({
          analyzer: "annotation",
          error: toErrorShape(
            error,
            `The picture with the circles of ${originOf(task.target.url)} could not be drawn.`,
          ),
        });
      }
    },
  };
}

/** Tells that the capture is done, after the problems of the analyzers, so that they come before the end of the page. */
const doneStep: Step = {
  name: "done",
  async run(task, ctx) {
    for (const problem of task.problems) {
      ctx.emit({
        type: "analysis_failed",
        ...locate(task, ctx.runId),
        analyzer: problem.analyzer,
        error: problem.error,
      });
    }
    ctx.emit({
      type: "capture_done",
      ...locate(task, ctx.runId),
      findings: task.visible.length,
      costUsd: null,
    });
  },
};

/** The steps of a task, in order. The AI step of a later task goes after the capture. */
export function createSteps(deps: StepDeps): readonly Step[] {
  return [captureStep(deps), numberStep, persistStep(deps), doneStep];
}
