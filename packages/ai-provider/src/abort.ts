import { FlawDotError, type AbortSignalLike } from "@flawdot/core-model";

// Everything that waits in this package (a retry pause, a model, a person with Claude Code) goes through here, and
// it is the ONE place that adds and removes a listener on a signal and that starts and stops a timer. core-model's
// `AbortSignalLike` has no `reason`, no `throwIfAborted` and no `AbortSignal.any`, so nobody reaches for them.

/** Waits `ms` milliseconds, or rejects with CANCELLED as soon as the signal is aborted. */
export type Sleep = (ms: number, signal: AbortSignalLike) => Promise<void>;

export function cancelled(): FlawDotError {
  return new FlawDotError("CANCELLED", "The analysis was cancelled.", { retryable: false });
}

export function timedOut(ms: number): FlawDotError {
  return new FlawDotError(
    "TIMEOUT",
    `Nobody answered within ${String(Math.round(ms / 1000))} seconds. Run the analysis again.`,
    { retryable: false },
  );
}

export function throwIfAborted(signal: AbortSignalLike): void {
  if (signal.aborted) throw cancelled();
}

/**
 * The longest delay a timer of Node can have (about 24.8 days). A longer one is not "later": Node turns it into 1
 * millisecond and prints a warning, so a time limit above this is the same as none, and a pause is cut to it.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface RaceOptions {
  /**
   * Gives up after this many milliseconds with TIMEOUT. Left out, not finite or above about 24 days, it waits for
   * ever.
   */
  timeoutMs?: number;
  /** Runs when the signal aborts or the time runs out, before the promise rejects (to tell the work to stop). */
  onStop?: () => void;
}

/**
 * Gives back what `work` gives, unless the signal aborts first (CANCELLED) or the time runs out (TIMEOUT). The
 * listener and the timer are always taken away, so a call that is over leaves nothing behind, and a `work` that
 * ignores the signal and settles later is not an unhandled rejection: this function has already listened to it.
 */
export function raceAbort<T>(
  work: Promise<T>,
  signal: AbortSignalLike,
  options: RaceOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const stop = (failure: FlawDotError): void => {
      settle();
      options.onStop?.();
      reject(failure);
    };
    const onAbort = (): void => {
      stop(cancelled());
    };

    work.then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: unknown) => {
        settle();
        reject(error as Error);
      },
    );

    if (signal.aborted) {
      stop(cancelled());
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    const { timeoutMs } = options;
    if (timeoutMs !== undefined && timeoutMs <= MAX_TIMER_MS) {
      timer = setTimeout(() => {
        stop(timedOut(timeoutMs));
      }, timeoutMs);
    }
  });
}

/** The real `Sleep`: a timer that is cleared when the signal aborts, and a listener that is removed when it rings. */
export const sleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled());
      return;
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.min(ms, MAX_TIMER_MS),
    );
    function onAbort(): void {
      clearTimeout(timer);
      reject(cancelled());
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
