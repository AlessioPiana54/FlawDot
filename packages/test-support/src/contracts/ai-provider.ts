import { AI_TIERS, parseAiResponse, type AiProvider, type AiTier } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { rejectionOf } from "../errors.js";
import { sampleAiRequest } from "../fixtures.js";
import { frozen, useFixture, type Factory, type Fixture } from "../harness.js";

/**
 * A factory of providers. The provider it makes must answer `sampleAiRequest()` with a valid answer, in either
 * tier: the fake provider has a saved one, a real one a stubbed transport. It must NEVER reach the network.
 */
export type AiProviderFactory = Factory<Fixture<AiProvider>>;

/**
 * What every `AiProvider` must do, so that the fake one and the real one can be swapped (Liskov): `estimate` gives
 * plain, non-negative numbers; `run` gives a valid answer and the model that wrote it, as a copy that the caller may
 * change; a request is never changed; a signal already aborted gives CANCELLED.
 */
export function runAiProviderContract(factory: AiProviderFactory): void {
  describe("AiProvider contract", () => {
    const current = useFixture(factory);

    it("has a stable id", () => {
      expect(["claude", "fake"]).toContain(current().fixture.subject.id);
    });

    it("estimates nothing for no request", async () => {
      for (const tier of AI_TIERS) {
        expect(await current().fixture.subject.estimate([], tier)).toEqual({
          inputTokens: 0,
          outputTokens: 0,
          usd: 0,
        });
      }
    });

    it("estimates in whole tokens and in dollars that are not negative, and more requests do not cost less", async () => {
      const { subject } = current().fixture;
      const one = await subject.estimate([sampleAiRequest()], "accurate");
      const two = await subject.estimate(
        [sampleAiRequest(), sampleAiRequest({ tile: 1 })],
        "accurate",
      );

      for (const estimate of [one, two]) {
        expect(Number.isInteger(estimate.inputTokens)).toBe(true);
        expect(Number.isInteger(estimate.outputTokens)).toBe(true);
        expect(estimate.inputTokens).toBeGreaterThanOrEqual(0);
        expect(estimate.outputTokens).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(estimate.usd) && estimate.usd >= 0).toBe(true);
      }
      expect(two.inputTokens).toBeGreaterThanOrEqual(one.inputTokens);
      expect(two.outputTokens).toBeGreaterThanOrEqual(one.outputTokens);
    });

    it.each(AI_TIERS)(
      "answers with a valid answer and its model in the tier %s",
      async (tier: AiTier) => {
        const result = await current().fixture.subject.run(
          sampleAiRequest(),
          tier,
          new AbortController().signal,
        );

        expect(parseAiResponse(result.response)).toEqual(result.response);
        expect(["claude-sonnet-5-5", "claude-haiku-5-5"]).toContain(result.model);
      },
    );

    it("gives an answer that the caller may change without changing the next one", async () => {
      const { subject } = current().fixture;
      const signal = new AbortController().signal;
      const first = await subject.run(sampleAiRequest(), "accurate", signal);
      const original = structuredClone(first.response);

      first.response.findings.length = 0;
      const second = await subject.run(sampleAiRequest(), "accurate", signal);

      expect(second.response).toEqual(original);
    });

    it("does not change the request it is given", async () => {
      const request = frozen(sampleAiRequest());

      await expect(
        current().fixture.subject.run(request, "accurate", new AbortController().signal),
      ).resolves.toBeDefined();
    });

    it("rejects with CANCELLED when the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const error = await rejectionOf(() =>
        current().fixture.subject.run(sampleAiRequest(), "accurate", controller.signal),
      );

      expect(error.code).toBe("CANCELLED");
    });
  });
}
