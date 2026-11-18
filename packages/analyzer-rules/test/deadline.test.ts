import { describe, expect, it, vi } from "vitest";
import { cancelled, withinDeadline } from "../src/deadline.js";

const idle = {
  aborted: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

describe("withinDeadline", () => {
  it("gives what the work gives, and takes its listener off the signal", async () => {
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const signal = {
      aborted: false,
      addEventListener: (_type: "abort", listener: () => void) => added.push(listener),
      removeEventListener: (_type: "abort", listener: () => void) => removed.push(listener),
    };
    expect(
      await withinDeadline(Promise.resolve(7), { ms: 1000, signal, url: "https://a.test" }),
    ).toBe(7);
    expect(added).toHaveLength(1);
    expect(removed).toEqual(added);
  });

  it("says TIMEOUT when the work takes longer than the limit, and CANCELLED when the signal fires", async () => {
    vi.useFakeTimers();
    try {
      const slow = withinDeadline(new Promise(() => undefined), {
        ms: 50,
        signal: idle,
        url: "https://a.test/x",
      });
      const caught = slow.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(60);
      expect(await caught).toMatchObject({ code: "TIMEOUT", retryable: true });
    } finally {
      vi.useRealTimers();
    }

    let fire: () => void = () => undefined;
    const signal = {
      aborted: false,
      addEventListener: (_type: "abort", listener: () => void) => {
        fire = listener;
      },
      removeEventListener: () => undefined,
    };
    const waiting = withinDeadline(new Promise(() => undefined), {
      ms: 60_000,
      signal,
      url: "https://a.test",
    });
    const caught = waiting.catch((error: unknown) => error);
    fire();
    expect(await caught).toEqual(cancelled());
    expect(await caught).toMatchObject({ code: "CANCELLED", retryable: false });
  });

  it("passes on the error of the work", async () => {
    const boom = new Error("boom");
    await expect(
      withinDeadline(Promise.reject(boom), { ms: 1000, signal: idle, url: "https://a.test" }),
    ).rejects.toBe(boom);
  });
});
