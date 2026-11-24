import {
  FlawDotError,
  type AbortSignalLike,
  type AiAnalysisResponse,
  type McpRequestQueue,
} from "@flawdot/core-model";
import {
  CountingSignal,
  rejectionOf,
  runAiFulfillerContract,
  sampleAiRequest,
  sampleAiResponse,
} from "@flawdot/test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpFulfiller, DEFAULT_MCP_TIMEOUT_MS } from "../src/index.js";
import { never } from "./support/helpers.js";

const signal = new AbortController().signal;

/** A queue that answers at once, or waits for ever, and keeps what it was asked and the signal it was given. */
function queueOf(behavior: () => Promise<AiAnalysisResponse>): McpRequestQueue & {
  submitted: { request: unknown; signal: AbortSignalLike }[];
} {
  const submitted: { request: unknown; signal: AbortSignalLike }[] = [];
  return {
    submitted,
    submit(request, aborter) {
      submitted.push({ request, signal: aborter });
      return behavior();
    },
  };
}

runAiFulfillerContract(() => {
  let hold = false;
  const queue: McpRequestQueue = {
    submit: () => {
      if (!hold) return Promise.resolve(sampleAiResponse());
      hold = false;
      return never();
    },
  };
  return {
    subject: createMcpFulfiller(queue),
    expects: "answer",
    holdNext: () => {
      hold = true;
    },
  };
});

describe("the fulfiller of Claude Code", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has the mode subscription, and gives the answer that Claude Code recorded, as written by claude-code", async () => {
    const queue = queueOf(() => Promise.resolve(sampleAiResponse()));
    const fulfiller = createMcpFulfiller(queue);

    expect(fulfiller.mode).toBe("subscription");
    expect(await fulfiller.fulfill(sampleAiRequest(), signal)).toEqual({
      response: sampleAiResponse(),
      model: "claude-code",
    });
    expect(queue.submitted).toHaveLength(1);
    expect(queue.submitted[0]?.request).toEqual(sampleAiRequest());
  });

  it("checks the answer again, and rejects one that is not valid with AI_BAD_RESPONSE", async () => {
    const queue = queueOf(() =>
      Promise.resolve({ findings: "none" } as unknown as AiAnalysisResponse),
    );

    const error = await rejectionOf(() =>
      createMcpFulfiller(queue).fulfill(sampleAiRequest(), signal),
    );

    expect(error.code).toBe("AI_BAD_RESPONSE");
  });

  describe("waiting", () => {
    it("waits ten minutes by default", () => {
      expect(DEFAULT_MCP_TIMEOUT_MS).toBe(600_000);
    });

    it("gives up after ten minutes with TIMEOUT, and tells the queue to drop the request", async () => {
      const queue = queueOf(() => never());
      const pending = rejectionOf(() =>
        createMcpFulfiller(queue).fulfill(sampleAiRequest(), signal),
      );

      await vi.advanceTimersByTimeAsync(DEFAULT_MCP_TIMEOUT_MS - 1);
      expect(queue.submitted[0]?.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const error = await pending;
      expect(error.code).toBe("TIMEOUT");
      expect(error.retryable).toBe(false);
      expect(queue.submitted[0]?.signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("uses the time it is given, and Infinity never times out", async () => {
      const short = queueOf(() => never());
      const pending = rejectionOf(() =>
        createMcpFulfiller(short, { timeoutMs: 1000 }).fulfill(sampleAiRequest(), signal),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect((await pending).code).toBe("TIMEOUT");

      const endless = queueOf(() => never());
      void createMcpFulfiller(endless, { timeoutMs: Infinity }).fulfill(sampleAiRequest(), signal);
      await vi.advanceTimersByTimeAsync(24 * 3600 * 1000);
      expect(endless.submitted[0]?.signal.aborted).toBe(false);
    });

    it("does not hear a queue that answers after the time ran out", async () => {
      let answerLate: (response: AiAnalysisResponse) => void = () => undefined;
      const queue = queueOf(
        () =>
          new Promise<AiAnalysisResponse>((resolve) => {
            answerLate = resolve;
          }),
      );
      const pending = rejectionOf(() =>
        createMcpFulfiller(queue, { timeoutMs: 1000 }).fulfill(sampleAiRequest(), signal),
      );
      await vi.advanceTimersByTimeAsync(1000);

      answerLate(sampleAiResponse());

      expect((await pending).code).toBe("TIMEOUT");
    });

    it.each([0, -1, Number.NaN])("refuses a time of %s", (timeoutMs) => {
      expect(() =>
        createMcpFulfiller(
          queueOf(() => never()),
          { timeoutMs },
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }) as Error);
    });
  });

  describe("cancelling", () => {
    it("asks the queue nothing when the signal is already aborted", async () => {
      const queue = queueOf(() => never());
      const aborter = new CountingSignal();
      aborter.abort();

      const error = await rejectionOf(() =>
        createMcpFulfiller(queue).fulfill(sampleAiRequest(), aborter),
      );

      expect(error.code).toBe("CANCELLED");
      expect(queue.submitted).toHaveLength(0);
    });

    it("rejects with CANCELLED, tells the queue to drop the request, and leaves no listener and no timer", async () => {
      const queue = queueOf(() => never());
      const aborter = new CountingSignal();
      const pending = rejectionOf(() =>
        createMcpFulfiller(queue).fulfill(sampleAiRequest(), aborter),
      );

      aborter.abort();

      expect((await pending).code).toBe("CANCELLED");
      expect(queue.submitted[0]?.signal.aborted).toBe(true);
      expect(aborter.open).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("a queue that fails", () => {
    it("passes a FlawDotError on as it is", async () => {
      const failure = new FlawDotError("INVALID_INPUT", "Unknown request.");
      const queue = queueOf(() => Promise.reject(failure));

      const error = await rejectionOf(() =>
        createMcpFulfiller(queue).fulfill(sampleAiRequest(), signal),
      );

      expect(error).toBe(failure);
    });

    it("turns anything else into INTERNAL, with a fixed message", async () => {
      const queue = queueOf(() => Promise.reject(new Error("secret text")));

      const error = await rejectionOf(() =>
        createMcpFulfiller(queue).fulfill(sampleAiRequest(), signal),
      );

      expect(error.code).toBe("INTERNAL");
      expect(error.retryable).toBe(false);
      expect(error.message).not.toContain("secret");
    });

    it("leaves no timer and no listener behind after a failure", async () => {
      const aborter = new CountingSignal();
      const queue = queueOf(() => Promise.reject(new Error("x")));

      await rejectionOf(() => createMcpFulfiller(queue).fulfill(sampleAiRequest(), aborter));

      expect(aborter.open).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
