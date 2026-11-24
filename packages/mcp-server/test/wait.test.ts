import { afterEach, describe, expect, it, vi } from "vitest";
import { waitUntilSettled } from "../src/wait.js";

afterEach(() => {
  vi.useRealTimers();
});

const never = (): Promise<void> => new Promise<void>(() => undefined);

describe("waitUntilSettled", () => {
  it("says settled when the promise resolves first", async () => {
    const outcome = await waitUntilSettled(Promise.resolve(), 1000, new AbortController().signal);
    expect(outcome).toBe("settled");
  });

  it("says settled when the promise rejects too: the reason does not matter here", async () => {
    const outcome = await waitUntilSettled(
      Promise.reject(new Error("no")),
      1000,
      new AbortController().signal,
    );
    expect(outcome).toBe("settled");
  });

  it("says timeout when the time passes first", async () => {
    const outcome = await waitUntilSettled(never(), 10, new AbortController().signal);
    expect(outcome).toBe("timeout");
  });

  it("says aborted when the signal aborts first", async () => {
    const controller = new AbortController();
    const waiting = waitUntilSettled(never(), 10_000, controller.signal);

    controller.abort();

    expect(await waiting).toBe("aborted");
  });

  it("says aborted at once when the signal is already aborted, and starts no timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    expect(await waitUntilSettled(never(), 10_000, controller.signal)).toBe("aborted");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind once the promise has settled", async () => {
    vi.useFakeTimers();
    await waitUntilSettled(Promise.resolve(), 10_000, new AbortController().signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind after an abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitUntilSettled(never(), 10_000, controller.signal);
    controller.abort();
    await waiting;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes its listener from the signal when it is done", async () => {
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    await waitUntilSettled(Promise.resolve(), 10_000, controller.signal);

    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
