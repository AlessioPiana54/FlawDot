import type { AiAnalysisRequest, AiAnalyzerId, AiFulfillment } from "./ai-request.js";
import type {
  AiMode,
  AiTier,
  Box,
  Capture,
  Category,
  PageTarget,
  ReportLanguage,
  Viewport,
  ViewportName,
} from "./domain.js";
import type { FindingDraft } from "./finding.js";
import type { ProjectId, RunId } from "./ids.js";
import type { AbortSignalLike } from "./ports.js";
import type { CaptureLimits } from "./settings.js";

// The plugins of the kernel (ADR-0001): small interfaces that other modules implement and the kernel uses.
// Only what some spec asks for is here; the module that owns a plugin adds its own fields later, as optional.

/**
 * The live page of a capture, which the rule analyzers (axe) need open. What `page` is belongs to the capture
 * module (a Playwright page) and is visible only to the modules that depend on it, so here it is `unknown`.
 */
export interface LivePage {
  readonly page: unknown;
  /** The box of the element a selector matches, or null if it matches nothing. */
  boxOf(selector: string): Promise<Box | null>;
}

export interface CaptureContext {
  runId: RunId;
  projectId: ProjectId;
  limits: CaptureLimits;
}

export interface AnalyzerContext {
  language: ReportLanguage;
  livePage: LivePage;
}

export interface DiscoverOptions {
  coverage: "page" | "site";
  viewports: readonly ViewportName[];
  ai: AiMode;
  /** How many pages at most (default 20). */
  limit: number;
}

/** What discovery found, and the options (with time and cost) the user can choose from, the recommended one first. */
export interface DiscoveryResult {
  origin: string;
  totalFound: number;
  groups: Array<{ templateKey: string; size: number; representative: string; samples: string[] }>;
  options: Array<{
    id: "recommended" | "all" | "single";
    isRecommended: boolean;
    pages: PageTarget[];
    captures: number;
    minutes: number;
    costUsd: number | null;
  }>;
}

/**
 * Where pages come from. v1 has only the `url` input. It is one interface made of two halves: the capture module
 * implements `Pick<InputPlugin, "capture">` and the discovery module `Pick<InputPlugin, "discover">`, and the
 * composition root joins them.
 */
export interface InputPlugin {
  id: "url";
  discover(input: string, opts: DiscoverOptions, signal: AbortSignalLike): Promise<DiscoveryResult>;
  /**
   * `onLive`, when given, runs after the screenshots and before the browser context is closed, with the page still
   * open: that is when the rule analyzers run. It also gets the finished capture, because axe needs its elements
   * to place a selector on a mark, and `capture()` has not returned yet.
   */
  capture(
    target: PageTarget,
    viewport: Viewport,
    ctx: CaptureContext,
    signal: AbortSignalLike,
    onLive?: (live: LivePage, capture: Capture) => Promise<void>,
  ): Promise<Capture>;
}

/** Finds problems with a deterministic engine. Its findings are "Verified". */
export interface RuleAnalyzer {
  kind: "rule";
  id: "accessibility-wcag";
  category: Category;
  analyze(capture: Capture, ctx: AnalyzerContext, signal: AbortSignalLike): Promise<FindingDraft[]>;
}

/**
 * Finds problems with an AI, but never calls the AI itself: it builds the requests and reads the answers, and an
 * `AiFulfiller` does the asking. Its findings are "AI suggestions".
 */
export interface AiAnalyzer {
  kind: "ai";
  id: AiAnalyzerId;
  category: Category;
  /** One request per tile of the page. */
  buildRequests(capture: Capture, language: ReportLanguage): AiAnalysisRequest[];
  // There is no method for reading the answers: the shared `toDrafts` does it for every analyzer, and the kernel
  // calls it with the `category` and the rule keys that the analyzer states (`category` above, its rule list).
}

export type AnalyzerPlugin = RuleAnalyzer | AiAnalyzer;

/**
 * Who answers an AI request: the user's key (`byok`), Claude Code (`subscription`) or nobody (`none`). The kernel
 * uses only this port. `none` gives back `'not_analyzed'`, and the category then has no score ("—").
 */
export interface AiFulfiller {
  mode: AiMode["kind"];
  fulfill(
    request: AiAnalysisRequest,
    signal: AbortSignalLike,
  ): Promise<AiFulfillment | "not_analyzed">;
}

/** An estimate in tokens and in US dollars of the cost billed to the API key of the user. */
export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

/** Talks to a model. `fake` answers from saved fixtures, so the tests cost nothing. */
export interface AiProvider {
  id: "claude" | "fake";
  /** It counts tokens through the API, so it is asynchronous. */
  estimate(requests: readonly AiAnalysisRequest[], tier: AiTier): Promise<CostEstimate>;
  run(request: AiAnalysisRequest, tier: AiTier, signal: AbortSignalLike): Promise<AiFulfillment>;
}
