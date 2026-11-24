import { FlawDotError, type AiFulfillment, type AiProvider } from "@flawdot/core-model";
import {
  CountingSignal,
  rejectionOf,
  runAiFulfillerContract,
  sampleAiRequest,
  sampleAiResponse,
} from "@flawdot/test-support";
import { describe, expect, it, vi } from "vitest";
import { createFakeProvider, createProviderFulfiller } from "../src/index.js";
import { folderWithAnswer, never, scriptedProvider } from "./support/helpers.js";

const answer: AiFulfillment = { response: sampleAiResponse(), model: "claude-sonnet-5-5" };
const busy = new FlawDotError("AI_RATE_LIMIT", "Busy.");
const signal = new AbortController().signal;

/** A `sleep` that does not wait and says how long it was told to. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

runAiFulfillerContract(async () => {
  const folder = await folderWithAnswer();
  const fake = createFakeProvider({ fixturesDir: folder.dir });
  let hold = false;
  const provider: AiProvider = {
    ...fake,
    run: (request, tier, aborter) => {
      if (!hold) return fake.run(request, tier, aborter);
      hold = false;
      return never();
    },
  };
  return {
    subject: createProviderFulfiller(provider, { tier: "accurate" }),
    expects: "answer",
    holdNext: () => {
      hold = true;
    },
    dispose: folder.remove,
  };
});

describe("the fulfiller of the user's key", () => {
  it("has the mode byok, and gives the answer of the provider with its model", async () => {
    const fulfiller = createProviderFulfiller(scriptedProvider([answer]), { tier: "accurate" });

    expect(fulfiller.mode).toBe("byok");
    expect(await fulfiller.fulfill(sampleAiRequest(), signal)).toEqual(answer);
  });

  it("asks the provider with the request and the tier it was made with", async () => {
    const provider = scriptedProvider([answer]);

    await createProviderFulfiller(provider, { tier: "economy" }).fulfill(sampleAiRequest(), signal);

    expect(provider.calls).toEqual([{ request: sampleAiRequest(), tier: "economy" }]);
  });

  it("reads the tier from a function once for each request, so a change of setting is seen", async () => {
    let tier: "accurate" | "economy" = "accurate";
    const provider = scriptedProvider([busy, answer]);
    const fulfiller = createProviderFulfiller(provider, {
      tier: () => tier,
      sleep: () => {
        tier = "economy"; // the user changes the setting while the fulfiller waits to try again
        return Promise.resolve();
      },
    });

    await fulfiller.fulfill(sampleAiRequest(), signal);
    await fulfiller.fulfill(sampleAiRequest(), signal);

    expect(provider.calls.map((call) => call.tier)).toEqual(["accurate", "accurate", "economy"]);
  });

  describe("trying again", () => {
    it("tries again after a failure that can pass, with a pause that doubles: 500, then 1000", async () => {
      const provider = scriptedProvider([busy, busy, answer]);
      const waiting = recordingSleep();
      const fulfiller = createProviderFulfiller(provider, {
        tier: "accurate",
        sleep: waiting.sleep,
      });

      expect(await fulfiller.fulfill(sampleAiRequest(), signal)).toEqual(answer);

      expect(provider.calls).toHaveLength(3);
      expect(waiting.delays).toEqual([500, 1000]);
    });

    it("gives up after the third call, and throws the last failure as it was", async () => {
      const last = new FlawDotError("AI_RATE_LIMIT", "Still busy.");
      const provider = scriptedProvider([busy, busy, last]);
      const waiting = recordingSleep();
      const fulfiller = createProviderFulfiller(provider, {
        tier: "accurate",
        sleep: waiting.sleep,
      });

      const error = await rejectionOf(() => fulfiller.fulfill(sampleAiRequest(), signal));

      expect(error).toBe(last);
      expect(provider.calls).toHaveLength(3);
      expect(waiting.delays).toEqual([500, 1000]);
    });

    it("doubles the pause at every try: 500, 1000, 2000, 4000", async () => {
      const provider = scriptedProvider([busy]);
      const waiting = recordingSleep();
      const fulfiller = createProviderFulfiller(provider, {
        tier: "accurate",
        maxRetries: 4,
        sleep: waiting.sleep,
      });

      await rejectionOf(() => fulfiller.fulfill(sampleAiRequest(), signal));

      expect(waiting.delays).toEqual([500, 1000, 2000, 4000]);
    });

    it("uses the number of tries and the first pause it is given", async () => {
      const provider = scriptedProvider([busy]);
      const waiting = recordingSleep();
      const fulfiller = createProviderFulfiller(provider, {
        tier: "accurate",
        maxRetries: 1,
        baseDelayMs: 10,
        sleep: waiting.sleep,
      });

      await rejectionOf(() => fulfiller.fulfill(sampleAiRequest(), signal));

      expect(provider.calls).toHaveLength(2);
      expect(waiting.delays).toEqual([10]);
    });

    it("asks once when it is told not to try again", async () => {
      const provider = scriptedProvider([busy]);
      const fulfiller = createProviderFulfiller(provider, { tier: "accurate", maxRetries: 0 });

      await rejectionOf(() => fulfiller.fulfill(sampleAiRequest(), signal));

      expect(provider.calls).toHaveLength(1);
    });

    it("tries again after a TIMEOUT too, which the provider marks as one that can pass", async () => {
      const provider = scriptedProvider([new FlawDotError("TIMEOUT", "Too slow."), answer]);
      const fulfiller = createProviderFulfiller(provider, {
        tier: "accurate",
        sleep: () => Promise.resolve(),
      });

      expect(await fulfiller.fulfill(sampleAiRequest(), signal)).toEqual(answer);
    });

    it.each([
      [
        "a key that is refused, even if the provider says it can pass",
        new FlawDotError("AI_AUTH", "Key refused.", { retryable: true }),
      ],
      [
        "an answer that is not valid, even if the provider says it can pass",
        new FlawDotError("AI_BAD_RESPONSE", "Not valid.", { retryable: true }),
      ],
      [
        "a cancel, even if the provider says it can pass",
        new FlawDotError("CANCELLED", "Cancelled.", { retryable: true }),
      ],
      ["an input that is not valid", new FlawDotError("INVALID_INPUT", "Bad input.")],
      ["an internal error", new FlawDotError("INTERNAL", "Broken.")],
      [
        "a failure the provider marks as one that cannot pass",
        new FlawDotError("AI_RATE_LIMIT", "Over the limit.", { retryable: false }),
      ],
    ])("does not try again after %s", async (_name, failure) => {
      const provider = scriptedProvider([failure]);
      const fulfiller = createProviderFulfiller(provider, {
        tier: "accurate",
        sleep: () => {
          throw new Error("it must not wait");
        },
      });

      const error = await rejectionOf(() => fulfiller.fulfill(sampleAiRequest(), signal));

      expect(error).toBe(failure);
      expect(provider.calls).toHaveLength(1);
    });
  });

  describe("failures", () => {
    it("turns what is not a FlawDotError into INTERNAL, with a fixed message, never the text of a stranger", async () => {
      const provider = scriptedProvider([new Error("secret text from the SDK")]);
      const fulfiller = createProviderFulfiller(provider, { tier: "accurate" });

      const error = await rejectionOf(() => fulfiller.fulfill(sampleAiRequest(), signal));

      expect(error.code).toBe("INTERNAL");
      expect(error.retryable).toBe(false);
      expect(error.message).not.toContain("secret");
      expect(provider.calls).toHaveLength(1);
    });

    it("checks the answer again, and rejects one that is not valid with AI_BAD_RESPONSE, without trying again", async () => {
      const provider = scriptedProvider([
        { response: { findings: "none" }, model: "claude-sonnet-5-5" } as unknown as AiFulfillment,
      ]);
      const fulfiller = createProviderFulfiller(provider, { tier: "accurate" });

      const error = await rejectionOf(() => fulfiller.fulfill(sampleAiRequest(), signal));

      expect(error.code).toBe("AI_BAD_RESPONSE");
      expect(provider.calls).toHaveLength(1);
    });

    it("never says that nothing was analyzed: that answer is for the case where nobody is asked", async () => {
      const provider = scriptedProvider([
        new FlawDotError("AI_BAD_RESPONSE", "The model refused."),
      ]);
      const fulfiller = createProviderFulfiller(provider, { tier: "accurate" });

      await expect(fulfiller.fulfill(sampleAiRequest(), signal)).rejects.toBeInstanceOf(
        FlawDotError,
      );
    });
  });

  describe("cancelling", () => {
    it("asks nothing when the signal is already aborted", async () => {
      const provider = scriptedProvider([answer]);
      const controller = new AbortController();
      controller.abort();

      const error = await rejectionOf(() =>
        createProviderFulfiller(provider, { tier: "accurate" }).fulfill(
          sampleAiRequest(),
          controller.signal,
        ),
      );

      expect(error.code).toBe("CANCELLED");
      expect(provider.calls).toHaveLength(0);
    });

    it("stops at once when it is cancelled while it waits to try again, and does not ask again", async () => {
      vi.useFakeTimers();
      try {
        const provider = scriptedProvider([busy, answer]);
        const aborter = new CountingSignal();
        const fulfiller = createProviderFulfiller(provider, { tier: "accurate" }); // the real sleep
        const pending = rejectionOf(() => fulfiller.fulfill(sampleAiRequest(), aborter));
        await vi.advanceTimersByTimeAsync(100); // the first call failed, and it is now in its pause of 500

        aborter.abort();

        expect((await pending).code).toBe("CANCELLED");
        expect(provider.calls).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(aborter.open).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops at once when it is cancelled while the provider is answering, even if the provider ignores the signal", async () => {
      const provider: AiProvider = { ...scriptedProvider([answer]), run: () => never() };
      const aborter = new CountingSignal();
      const pending = rejectionOf(() =>
        createProviderFulfiller(provider, { tier: "accurate" }).fulfill(sampleAiRequest(), aborter),
      );

      aborter.abort();

      expect((await pending).code).toBe("CANCELLED");
      expect(aborter.open).toBe(0);
    });

    it("waits for real, with the pauses of the real sleep, when it is not given another", async () => {
      vi.useFakeTimers();
      try {
        const provider = scriptedProvider([busy, answer]);
        const pending = createProviderFulfiller(provider, { tier: "accurate" }).fulfill(
          sampleAiRequest(),
          signal,
        );

        await vi.advanceTimersByTimeAsync(499);
        expect(provider.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);

        expect(await pending).toEqual(answer);
        expect(provider.calls).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("its options", () => {
    it.each([
      ["maxRetries", { maxRetries: -1 }],
      ["maxRetries", { maxRetries: 1.5 }],
      ["baseDelayMs", { baseDelayMs: -5 }],
      ["baseDelayMs", { baseDelayMs: Number.NaN }],
    ])("refuses a value of %s that is not a whole number, 0 or more", (name, options) => {
      expect(() =>
        createProviderFulfiller(scriptedProvider([answer]), { tier: "accurate", ...options }),
      ).toThrow(
        expect.objectContaining({
          code: "INVALID_INPUT",
          message: expect.stringContaining(name) as string,
        }) as Error,
      );
    });
  });
});
