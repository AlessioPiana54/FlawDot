import { parseAiResponse, type AbortSignalLike, type AiFulfiller } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { rejectionOf } from "../errors.js";
import { sampleAiRequest } from "../fixtures.js";
import { frozen, useFixture, type Factory, type Fixture } from "../harness.js";

/** A fulfiller under test, and what it is expected to do when it is asked. */
export interface AiFulfillerFixture extends Fixture<AiFulfiller> {
  /** `answer` for a fulfiller that asks a model, `not_analyzed` for the one that never does. */
  readonly expects: "answer" | "not_analyzed";
  /**
   * Makes the NEXT call wait until its signal is aborted (a model that is slow, a person who has not answered). With
   * it the suite can cancel a call that is in flight. A fulfiller that never waits does not give it.
   */
  holdNext?(): void;
}

export type AiFulfillerFactory = Factory<AiFulfillerFixture>;

/** A signal that counts its listeners, so a suite can tell that nobody left one behind. */
export class CountingSignal implements AbortSignalLike {
  #aborted = false;
  /** Each listener that is still registered, and whether it asked to run once. */
  readonly #listeners = new Map<() => void, boolean>();

  get aborted(): boolean {
    return this.#aborted;
  }

  /** Listeners added and not removed. A listener added with `once` is gone after it has run, as in a real signal. */
  get open(): number {
    return this.#listeners.size;
  }

  addEventListener(_type: "abort", listener: () => void, options?: { once?: boolean }): void {
    this.#listeners.set(listener, options?.once === true);
  }

  removeEventListener(_type: "abort", listener: () => void): void {
    this.#listeners.delete(listener);
  }

  abort(): void {
    this.#aborted = true;
    for (const [listener, once] of [...this.#listeners]) {
      if (once) this.#listeners.delete(listener);
      listener();
    }
  }
}

/**
 * What every `AiFulfiller` must do, whoever answers: the one of the user's key, the one that waits for Claude Code and
 * the one that never asks. A fulfiller either answers with a valid answer and the model that wrote it, or says
 * `not_analyzed`; it never changes the request; and a failure is a `FlawDotError`, never a string or a `null`.
 */
export function runAiFulfillerContract(factory: AiFulfillerFactory): void {
  describe("AiFulfiller contract", () => {
    const current = useFixture(factory);

    it("has the mode of the way it answers", () => {
      expect(["none", "byok", "subscription"]).toContain(current().fixture.subject.mode);
    });

    it("answers with a valid answer and its model, or says that nothing was analyzed", async () => {
      const { subject, expects } = current().fixture;

      const result = await subject.fulfill(sampleAiRequest(), new AbortController().signal);

      if (expects === "not_analyzed") {
        expect(result).toBe("not_analyzed");
      } else {
        expect(result).not.toBe("not_analyzed");
        if (result === "not_analyzed") return;
        expect(parseAiResponse(result.response)).toEqual(result.response);
        expect(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-code"]).toContain(result.model);
      }
    });

    it("does not change the request it is given", async () => {
      const { subject } = current().fixture;
      const request = frozen(sampleAiRequest());

      // In strict mode a write to a frozen object throws, so a fulfiller that edits its request fails here.
      await expect(subject.fulfill(request, new AbortController().signal)).resolves.toBeDefined();
    });

    it("leaves no listener on the signal after it has answered", async () => {
      const { subject } = current().fixture;
      const signal = new CountingSignal();

      await subject.fulfill(sampleAiRequest(), signal);

      expect(signal.open).toBe(0);
    });

    it("when it is already cancelled, asks nothing: it rejects with CANCELLED, or has nothing to cancel", async () => {
      const { subject, expects } = current().fixture;
      const signal = new CountingSignal();
      signal.abort();

      if (expects === "not_analyzed") {
        expect(await subject.fulfill(sampleAiRequest(), signal)).toBe("not_analyzed");
      } else {
        const error = await rejectionOf(() => subject.fulfill(sampleAiRequest(), signal));
        expect(error.code).toBe("CANCELLED");
        expect(error.retryable).toBe(false);
      }
      expect(signal.open).toBe(0);
    });

    it("rejects with CANCELLED and leaves no listener when it is cancelled during the call", async (context) => {
      const { fixture } = current();
      if (fixture.holdNext === undefined) context.skip();
      fixture.holdNext?.();
      const signal = new CountingSignal();

      const pending = rejectionOf(() => fixture.subject.fulfill(sampleAiRequest(), signal));
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); // let the call start waiting
      signal.abort();

      expect((await pending).code).toBe("CANCELLED");
      expect(signal.open).toBe(0);
    });
  });
}
