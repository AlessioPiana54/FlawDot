export type WaitOutcome = "settled" | "timeout" | "aborted";

/**
 * Waits for `promise` to settle (it may resolve or reject: which of the two does not matter here), for `ms` to pass, or
 * for `signal` to abort, whichever is first. It leaves no timer and no listener behind.
 */
export function waitUntilSettled(
  promise: Promise<unknown>,
  ms: number,
  signal: AbortSignal,
): Promise<WaitOutcome> {
  if (signal.aborted) return Promise.resolve("aborted");
  return new Promise<WaitOutcome>((resolve) => {
    const finish = (outcome: WaitOutcome): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => {
      finish("aborted");
    };
    const timer = setTimeout(() => {
      finish("timeout");
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        finish("settled");
      },
      () => {
        finish("settled");
      },
    );
  });
}
