import type { AiAnalysisRequest } from "@flawdot/core-model";
import { runAiFulfillerContract } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import { createNoAiFulfiller } from "../src/index.js";

describe("NoAiFulfiller", () => {
  it("is the fulfiller of the mode where nobody answers", () => {
    expect(createNoAiFulfiller().mode).toBe("none");
  });

  it("says that nothing was analyzed, so the categories of the AI have no score", async () => {
    const answer = await createNoAiFulfiller().fulfill(
      {} as AiAnalysisRequest, // it never reads the request
      new AbortController().signal,
    );

    expect(answer).toBe("not_analyzed");
  });

  it("answers the same when it is already cancelled: there is nothing to cancel", async () => {
    const controller = new AbortController();
    controller.abort();

    expect(await createNoAiFulfiller().fulfill({} as AiAnalysisRequest, controller.signal)).toBe(
      "not_analyzed",
    );
  });
});

// The same contract that the fulfillers of the user's key and of Claude Code pass (packages/ai-provider runs it on them).
runAiFulfillerContract(() => ({ subject: createNoAiFulfiller(), expects: "not_analyzed" }));
