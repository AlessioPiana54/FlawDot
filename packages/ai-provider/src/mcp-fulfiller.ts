import {
  FlawDotError,
  isFlawDotError,
  parseAiResponse,
  type AbortSignalLike,
  type AiAnalysisRequest,
  type AiFulfiller,
  type AiFulfillment,
  type McpRequestQueue,
} from "@flawdot/core-model";
import { raceAbort, throwIfAborted } from "./abort.js";

export interface McpFulfillerOptions {
  /**
   * How long to wait for Claude Code to answer one request, in milliseconds. Default 10 minutes. `Infinity` waits for
   * ever. It counts from the moment the request is put in the queue.
   */
  timeoutMs?: number;
}

/** Claude Code answers by hand-driven tool calls, a few requests at a time: ten minutes is long enough for that. */
export const DEFAULT_MCP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Puts a request in the queue that Claude Code reads through the MCP server, and waits for the answer it records. It
 * never asks twice (nobody is polling, and a second request would be a second question), it gives up after
 * `timeoutMs` with TIMEOUT, and a cancel or a timeout also tells the queue to drop the request, through a signal of its
 * own. A queue that ignores that signal and answers later is not heard: the answer would be too late.
 */
export function createMcpFulfiller(
  queue: McpRequestQueue,
  options: McpFulfillerOptions = {},
): AiFulfiller {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    throw new FlawDotError("INVALID_INPUT", "timeoutMs must be a number above 0.");
  }

  return {
    mode: "subscription",

    async fulfill(request: AiAnalysisRequest, signal: AbortSignalLike): Promise<AiFulfillment> {
      throwIfAborted(signal);
      const inner = new AbortController();
      try {
        const answer = await raceAbort(queue.submit(request, inner.signal), signal, {
          timeoutMs,
          onStop: () => {
            inner.abort();
          },
        });
        // The MCP server has already checked the answer of Claude Code, but a queue is a port that anything can
        // implement, and the check is cheap.
        return { response: parseAiResponse(answer), model: "claude-code" };
      } catch (error) {
        throw isFlawDotError(error)
          ? error
          : new FlawDotError("INTERNAL", "The queue of Claude Code failed in an unexpected way.", {
              retryable: false,
              cause: error,
            });
      }
    },
  };
}
