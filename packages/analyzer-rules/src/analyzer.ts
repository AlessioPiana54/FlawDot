import type { Page } from "playwright-core";
import {
  FlawDotError,
  isFlawDotError,
  originOf,
  type AbortSignalLike,
  type AnalyzerContext,
  type Box,
  type Capture,
  type RuleAnalysis,
  type RuleAnalyzer,
} from "@flawdot/core-model";
import { axeResultsToDrafts, targetsToMeasure, type ConvertDeps } from "./adapter.js";
import { parseAxeResults, targetKey } from "./axe-results.js";
import { runAxe as defaultRunAxe, type AxeRunner } from "./axe-runner.js";
import { cancelled, withinDeadline } from "./deadline.js";

/** How long axe may take on one page. It is a lot more than it needs: it is there for a page that never ends. */
export const ANALYSIS_TIMEOUT_MS = 30_000;

export interface AxeAnalyzerDeps extends ConvertDeps {
  /** Only tests change these two: axe itself, and the time it may take. */
  runAxe?: AxeRunner;
  timeoutMs?: number;
}

/** What the live page of a capture must be: the Playwright page. Checked by its shape, not by its class. */
function isPlaywrightPage(page: unknown): page is Page {
  return (
    typeof page === "object" &&
    page !== null &&
    "evaluate" in page &&
    typeof page.evaluate === "function" &&
    "context" in page &&
    typeof page.context === "function"
  );
}

/**
 * The accessibility analyzer: runs axe-core on the live page of a capture and turns what it finds into drafts of
 * "Verified" findings. It never changes the page. Its errors are all `FlawDotError`: CANCELLED when the signal
 * fires, TIMEOUT when axe does not end, INTERNAL for anything else, with a fixed message that names only the origin.
 */
export function createAxeAnalyzer(deps: AxeAnalyzerDeps): RuleAnalyzer {
  const run = deps.runAxe ?? defaultRunAxe;
  const timeoutMs = deps.timeoutMs ?? ANALYSIS_TIMEOUT_MS;

  async function analyze(
    capture: Capture,
    ctx: AnalyzerContext,
    signal: AbortSignalLike,
  ): Promise<RuleAnalysis> {
    const url = capture.page.url;
    if (signal.aborted) throw cancelled();
    const live = ctx.livePage;
    const page = live.page;
    if (!isPlaywrightPage(page)) {
      throw new FlawDotError("INTERNAL", "The live page of the capture is not a browser page.");
    }
    const raw = await withinDeadline(run(page), { ms: timeoutMs, signal, url });
    const parsed = parseAxeResults(raw);

    // An element with no mark of its own is found by its target and measured, one after another. A selector of the
    // page goes as it is; the way to an element in an iframe or a shadow root goes as the path that axe gave.
    const boxes = new Map<string, Box>();
    for (const target of targetsToMeasure(parsed, capture)) {
      if (signal.aborted) throw cancelled();
      const [only] = target;
      const measured = await live.boxOf(
        target.length === 1 && typeof only === "string" ? only : target,
      );
      if (measured !== null) boxes.set(targetKey(target), measured);
    }
    if (signal.aborted) throw cancelled();

    return {
      drafts: axeResultsToDrafts(parsed, capture, deps, ctx.language, boxes),
      needsReview: parsed.needsReview,
    };
  }

  return {
    kind: "rule",
    id: "accessibility-wcag",
    category: "accessibility",
    async analyze(capture, ctx, signal) {
      try {
        return await analyze(capture, ctx, signal);
      } catch (error) {
        if (isFlawDotError(error)) throw error;
        // Closing the context on an abort makes the calls on the page fail: that is a cancel, not a failure.
        if (signal.aborted) throw cancelled();
        throw new FlawDotError(
          "INTERNAL",
          `The accessibility check of ${originOf(capture.page.url)} failed unexpectedly.`,
          { cause: error },
        );
      }
    },
  };
}
