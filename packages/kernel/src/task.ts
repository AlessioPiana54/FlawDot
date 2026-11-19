import {
  FlawDotError,
  type AbortSignalLike,
  type Capture,
  type CaptureLimits,
  type CaptureOutcome,
  type Category,
  type Finding,
  type FindingState,
  type FlawDotErrorShape,
  type PageTarget,
  type ProgressEvent,
  type ProjectId,
  type ReportLanguage,
  type RunId,
  type Viewport,
} from "@flawdot/core-model";

/** What every task of a run shares, and nothing a task changes: it can be read from many tasks at the same time. */
export interface RunContext {
  readonly runId: RunId;
  readonly projectId: ProjectId;
  readonly language: ReportLanguage;
  readonly limits: CaptureLimits;
  /** The "ignore" states of the project, by fingerprint, as they were when the run started. */
  readonly states: ReadonlyMap<string, FindingState>;
  readonly signal: AbortSignalLike;
  emit(event: ProgressEvent): void;
}

/** Something that went wrong in a page that was captured: the capture stays, the part that failed is left out. */
export interface AnalysisProblem {
  readonly analyzer: string;
  readonly error: FlawDotErrorShape;
}

/** What one page at one viewport gathers on its way through the steps. It belongs to that one task. */
export interface TaskState {
  readonly target: PageTarget;
  readonly viewport: Viewport;
  capture?: Capture;
  /** All the findings of the page, the ignored ones too. */
  findings: Finding[];
  /** The ones that are not ignored, numbered. These are the findings that count and that are drawn. */
  visible: Finding[];
  analyzed: Category[];
  needsReview: number;
  problems: AnalysisProblem[];
  annotatedPath: string | null;
}

/** Where an event of a task happens: the run, the page and the viewport. */
export const locate = (task: TaskState, runId: RunId) =>
  ({ runId, url: task.target.url, viewport: task.viewport.name }) as const;

/** The capture of a task, which every step after the first needs. A step that runs without it is a mistake in the order of the steps. */
export function capturedOf(task: TaskState): Capture {
  if (task.capture === undefined) {
    throw new FlawDotError("INTERNAL", "A step ran before the page was captured.");
  }
  return task.capture;
}

export const newTask = (target: PageTarget, viewport: Viewport): TaskState => ({
  target,
  viewport,
  findings: [],
  visible: [],
  analyzed: [],
  needsReview: 0,
  problems: [],
  annotatedPath: null,
});

/**
 * One step of a task. The steps are an ordered list that is set up in one place, so a step is added (the AI, in a
 * later task) without touching the others. A step that is `interruptible` is the part that waits for a browser: a
 * cancel stops the task before it and right after it. Once the findings start to be saved the task goes to the end,
 * because a cancelled task must not leave findings behind.
 */
export interface Step {
  readonly name: string;
  readonly interruptible?: boolean;
  run(task: TaskState, ctx: RunContext): Promise<void>;
}

export type TaskResult =
  | { readonly kind: "done"; readonly outcome: Extract<CaptureOutcome, { status: "done" }> }
  | { readonly kind: "failed"; readonly outcome: Extract<CaptureOutcome, { status: "failed" }> }
  | { readonly kind: "cancelled" };
