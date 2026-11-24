import {
  FlawDotError,
  captureSchema,
  findingDraftSchema,
  type AbortSignalLike,
  type AnalysisPlan,
  type AnalyzerPlugin,
  type AnalyzerContext,
  type Annotator,
  type Capture,
  type CaptureContext,
  type Category,
  type FindingDraft,
  type InputPlugin,
  type PageTarget,
  type ProgressEvent,
  type RunId,
  type RuleAnalysis,
  type RuleAnalyzer,
  type Severity,
  type Viewport,
  type ViewportName,
} from "@flawdot/core-model";
import { createInMemoryStorage, type InMemoryStorage } from "@flawdot/storage";
import { ManualClock, findingId, runId } from "@flawdot/test-support";
import { createFlawDot, type FlawDot, type RunHandle } from "../../src/index.js";

export const ORIGIN = "https://example.com";
export const URL_A = `${ORIGIN}/`;
export const URL_B = `${ORIGIN}/about`;

export const target = (url = URL_A): PageTarget => ({
  url,
  templateKey: new URL(url).pathname,
  templateSize: 1,
});

export function makePlan(overrides: Partial<AnalysisPlan> = {}): AnalysisPlan {
  return {
    projectOrigin: ORIGIN,
    pages: [target()],
    viewports: ["desktop"],
    language: "en",
    ai: { kind: "none" },
    ...overrides,
  };
}

/** Ids that count up, so that a test knows which id is which. They are ULIDs, and there are 1023 of them. */
export function fakeIds() {
  let runs = 0;
  let findings = 0;
  return {
    runId: () => runId((runs += 1)),
    findingId: () => findingId((findings += 1)),
  };
}

export function makeCapture(page: PageTarget, viewport: Viewport, run: RunId): Capture {
  const name = `${viewport.name}${new URL(page.url).pathname.replace(/\W/g, "_")}`;
  return captureSchema.parse({
    runId: run,
    page,
    viewport,
    screenshot: { path: `shots/${name}.png`, width: viewport.width, height: viewport.height },
    marked: { path: `shots/${name}.marked.png` },
    elements: [],
    title: "A page",
    capturedAt: "2026-01-01T00:00:00.000Z",
  });
}

/** What `capture()` does for a page and a viewport. Without an entry it captures, runs the analyzers and returns. */
export interface Behaviour {
  /** `capture()` throws this, as an adapter does for a page that cannot be reached. */
  throws?: unknown;
  /** It waits until the signal is aborted, and then throws what the real capture throws: CANCELLED. */
  hangsUntilAborted?: true;
  /** After the analyzers ran, and before it returns: a test cancels here, or makes the capture fail. */
  afterAnalysis?: () => void;
  /** It does not call `onLive`: an input that forgot the analyzers. */
  skipsLive?: true;
}

export interface CaptureCall {
  target: PageTarget;
  viewport: Viewport;
  ctx: CaptureContext;
  signal: AbortSignalLike;
  live: unknown;
}

const keyOf = (url: string, viewport: ViewportName): string => `${viewport} ${url}`;
export const forPage = (url: string, viewport: ViewportName = "desktop"): string =>
  keyOf(url, viewport);

/**
 * An input that behaves like the capture module where it matters to the kernel: the analyzers run inside `onLive`,
 * before it returns, and an error from `onLive` ends the capture.
 */
export function fakeInput(script: Record<string, Behaviour> = {}) {
  const calls: CaptureCall[] = [];
  const input: Pick<InputPlugin, "id" | "capture"> = {
    id: "url",
    capture: async (page, viewport, ctx, signal, onLive) => {
      const behaviour = script[keyOf(page.url, viewport.name)] ?? {};
      const live = { page: {}, boxOf: async () => null };
      calls.push({ target: page, viewport, ctx, signal, live });
      if (behaviour.throws !== undefined) throw behaviour.throws;
      if (behaviour.hangsUntilAborted) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new FlawDotError("CANCELLED", "The capture was cancelled.");
      }
      const capture = makeCapture(page, viewport, ctx.runId);
      if (!behaviour.skipsLive) await onLive?.(live, capture);
      behaviour.afterAnalysis?.();
      return capture;
    },
  };
  return { input, calls };
}

export const draft = (overrides: Record<string, unknown> = {}): FindingDraft =>
  findingDraftSchema.parse({
    category: "accessibility",
    severity: "critical",
    ruleKey: "color-contrast",
    title: "Low contrast",
    explanation: "Why",
    fix: "Fix",
    evidence: null,
    principle: { code: null, label: "axe rule" },
    source: { kind: "rule", engine: "axe-core", ruleId: "color-contrast" },
    location: {
      kind: "element",
      mark: 1,
      selector: "#e1",
      box: { x: 0, y: 0, width: 10, height: 10 },
      count: 1,
    },
    ...overrides,
  });

/** A finding on an element, at height `y`: the numbers follow the severity, then the height. */
export const elementDraft = (mark: number, severity: Severity, y = mark * 100): FindingDraft =>
  draft({
    severity,
    ruleKey: `rule-${String(mark)}`,
    location: {
      kind: "element",
      mark,
      selector: `#e${String(mark)}`,
      box: { x: 0, y, width: 10, height: 10 },
      count: 1,
    },
  });

export const pageDraft = (): FindingDraft =>
  draft({ ruleKey: "document-title", location: { kind: "page" } });

export interface AnalyzerCall {
  capture: Capture;
  ctx: AnalyzerContext;
  signal: AbortSignalLike;
}

export function fakeAnalyzer(
  result: (call: AnalyzerCall) => Promise<RuleAnalysis> | RuleAnalysis = () => ({
    drafts: [draft()],
    needsReview: 0,
  }),
  category: Category = "accessibility",
) {
  const calls: AnalyzerCall[] = [];
  const analyzer: RuleAnalyzer = {
    kind: "rule",
    id: "accessibility-wcag",
    category,
    analyze: async (capture, ctx, signal) => {
      const call = { capture, ctx, signal };
      calls.push(call);
      return result(call);
    },
  };
  return { analyzer, calls };
}

export const returning = (drafts: FindingDraft[], needsReview = 0) =>
  fakeAnalyzer(() => ({ drafts, needsReview }));

export interface AnnotatorOptions {
  /** Makes the annotator fail with this. */
  fail?: () => unknown;
  /** Runs when the annotator is called, before it answers. */
  onCall?: () => Promise<void> | void;
}

export function fakeAnnotator(options: AnnotatorOptions = {}) {
  const calls: { capture: Capture; findings: readonly { id: string; number: number | null }[] }[] =
    [];
  const annotator: Annotator = {
    annotate: async (capture, findings) => {
      calls.push({ capture, findings });
      await options.onCall?.();
      if (options.fail !== undefined) throw options.fail();
      return { path: capture.screenshot.path.replace(/\.png$/, ".annotated.png") };
    },
  };
  return { annotator, calls };
}

export interface KernelOptions {
  input?: ReturnType<typeof fakeInput>;
  analyzers?: ReturnType<typeof fakeAnalyzer>[];
  /** Analyzers of other kinds, given to the kernel next to the rule analyzers. */
  extraAnalyzers?: AnalyzerPlugin[];
  annotator?: ReturnType<typeof fakeAnnotator>;
  entry?: "web" | "mcp";
  /** Wraps the storage, to change or watch what the kernel calls. */
  wrap?: (storage: InMemoryStorage) => InMemoryStorage;
  /** Another analysis on the same storage, clock and ids as an earlier kernel. */
  over?: { storage: InMemoryStorage; clock: ManualClock; ids: ReturnType<typeof fakeIds> };
}

export function makeKernel(options: KernelOptions = {}) {
  const clock = options.over?.clock ?? new ManualClock();
  const storage = options.over?.storage ?? createInMemoryStorage({ clock });
  const ids = options.over?.ids ?? fakeIds();
  const input = options.input ?? fakeInput();
  const analyzers = options.analyzers ?? [fakeAnalyzer()];
  const annotator = options.annotator ?? fakeAnnotator();
  const kernel: FlawDot = createFlawDot({
    entry: options.entry ?? "web",
    inputs: [input.input],
    analyzers: [...analyzers.map((a) => a.analyzer), ...(options.extraAnalyzers ?? [])],
    repos: options.wrap?.(storage) ?? storage,
    annotator: annotator.annotator,
    clock,
    ids,
  });
  return { kernel, storage, clock, ids, input, analyzers, annotator };
}

export async function collect(handle: RunHandle): Promise<ProgressEvent[]> {
  const events: ProgressEvent[] = [];
  for await (const event of handle.events) {
    events.push(event);
  }
  return events;
}

export const typesOf = (events: readonly ProgressEvent[]): string[] =>
  events.map((event) => (event.type === "phase" ? `phase:${event.phase}` : event.type));
