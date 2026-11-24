import { CountingSignal, rejectionOf } from "@flawdot/test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { raceAbort, sleep, throwIfAborted } from "../src/abort.js";
import { never } from "./support/helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("raceAbort", () => {
  it("gives what the work gives, and leaves no listener and no timer", async () => {
    const signal = new CountingSignal();

    const value = await raceAbort(Promise.resolve("done"), signal, { timeoutMs: 1000 });

    expect(value).toBe("done");
    expect(signal.open).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with what the work rejects with, and leaves nothing behind", async () => {
    const signal = new CountingSignal();
    const failure = new Error("the work failed");

    await expect(raceAbort(Promise.reject(failure), signal, { timeoutMs: 1000 })).rejects.toBe(
      failure,
    );

    expect(signal.open).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with CANCELLED when the signal aborts, and tells the work to stop", async () => {
    const signal = new CountingSignal();
    const stopped = vi.fn();
    const pending = rejectionOf(() => raceAbort(never(), signal, { onStop: stopped }));

    signal.abort();

    const error = await pending;
    expect(error.code).toBe("CANCELLED");
    expect(error.retryable).toBe(false);
    expect(stopped).toHaveBeenCalledOnce();
    expect(signal.open).toBe(0);
  });

  it("is already CANCELLED when the signal was aborted before, and still tells the work to stop", async () => {
    const signal = new CountingSignal();
    signal.abort();
    const stopped = vi.fn();

    const error = await rejectionOf(() => raceAbort(never(), signal, { onStop: stopped }));

    expect(error.code).toBe("CANCELLED");
    expect(stopped).toHaveBeenCalledOnce();
    expect(signal.open).toBe(0);
  });

  it("rejects with TIMEOUT, not retryable, when the time runs out, and tells the work to stop", async () => {
    const signal = new CountingSignal();
    const stopped = vi.fn();
    const pending = rejectionOf(() =>
      raceAbort(never(), signal, { timeoutMs: 5000, onStop: stopped }),
    );

    await vi.advanceTimersByTimeAsync(5000);

    const error = await pending;
    expect(error.code).toBe("TIMEOUT");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("5 seconds");
    expect(stopped).toHaveBeenCalledOnce();
    expect(signal.open).toBe(0);
  });

  it("does not start a timer when there is no time limit, or when it is Infinity", async () => {
    const signal = new CountingSignal();

    await raceAbort(Promise.resolve(1), signal);
    await raceAbort(Promise.resolve(1), signal, { timeoutMs: Infinity });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not turn an answer that comes after the stop into an unhandled rejection", async () => {
    const signal = new CountingSignal();
    let fail: (error: Error) => void = () => undefined;
    const late = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const pending = rejectionOf(() => raceAbort(late, signal));
    signal.abort();
    await pending;

    fail(new Error("too late"));
    await vi.advanceTimersByTimeAsync(10);

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("stops the work once: an answer after the stop does not stop it again or bring a listener back", async () => {
    const signal = new CountingSignal();
    const stopped = vi.fn();
    let finish: (value: string) => void = () => undefined;
    const pending = rejectionOf(() =>
      raceAbort(
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
        signal,
        { timeoutMs: 1000, onStop: stopped },
      ),
    );
    signal.abort();

    finish("too late");
    await vi.advanceTimersByTimeAsync(2000); // the time limit has been taken away: it must not ring now

    expect((await pending).code).toBe("CANCELLED");
    expect(stopped).toHaveBeenCalledOnce();
    expect(signal.open).toBe(0);
  });

  it("does not start a timer for a time limit that Node cannot keep (above about 24 days), which it would cut to 1 ms", async () => {
    const signal = new CountingSignal();
    let finish: (value: string) => void = () => undefined;
    const pending = raceAbort(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
      signal,
      { timeoutMs: 2 ** 31 },
    );

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    finish("answer");

    expect(await pending).toBe("answer");
  });

  it("keeps a time limit that is the longest one Node can keep", () => {
    const signal = new CountingSignal();

    void rejectionOf(() => raceAbort(never(), signal, { timeoutMs: 2 ** 31 - 1 }));

    expect(vi.getTimerCount()).toBe(1);
    signal.abort();
  });
});

describe("sleep", () => {
  it("waits the time it is told, then leaves no listener", async () => {
    const signal = new CountingSignal();
    let done = false;
    const waiting = sleep(500, signal).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;

    expect(done).toBe(true);
    expect(signal.open).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is cut short by an abort with CANCELLED, and the timer is cleared", async () => {
    const signal = new CountingSignal();
    const pending = rejectionOf(() => sleep(60_000, signal));

    signal.abort();

    expect((await pending).code).toBe("CANCELLED");
    expect(vi.getTimerCount()).toBe(0);
    expect(signal.open).toBe(0);
  });

  it("cuts a pause that Node cannot keep (above about 24 days) to the longest it can, never to 1 ms", async () => {
    const signal = new CountingSignal();
    let done = false;
    void sleep(2 ** 31 + 5, signal).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(2 ** 31 - 2);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);

    expect(done).toBe(true);
  });

  it("does not wait at all when the signal is already aborted", async () => {
    const signal = new CountingSignal();
    signal.abort();

    expect((await rejectionOf(() => sleep(60_000, signal))).code).toBe("CANCELLED");

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("throwIfAborted", () => {
  it("does nothing for a signal that is not aborted, and throws CANCELLED for one that is", () => {
    const signal = new CountingSignal();
    expect(() => {
      throwIfAborted(signal);
    }).not.toThrow();

    signal.abort();

    expect(() => {
      throwIfAborted(signal);
    }).toThrow(expect.objectContaining({ code: "CANCELLED" }) as Error);
  });
});
