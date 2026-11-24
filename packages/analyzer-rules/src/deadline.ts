import { FlawDotError, originOf, type AbortSignalLike } from "@flawdot/core-model";

export const cancelled = (): FlawDotError =>
  new FlawDotError("CANCELLED", "The accessibility check was cancelled.");

/**
 * A wait with a deadline that the caller can also cancel: what the work gives back, or TIMEOUT when it takes more
 * than `ms`, or CANCELLED when the signal fires. axe cannot be interrupted, so the wait is raced against the timer
 * and the signal; the work that loses keeps running in the page until the capture closes the context.
 */
export async function withinDeadline<T>(
  work: Promise<T>,
  options: { ms: number; signal: AbortSignalLike; url: string },
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new FlawDotError(
          "TIMEOUT",
          `${originOf(options.url)} took too long to be checked for accessibility problems. Try again.`,
        ),
      );
    }, options.ms);
    onAbort = () => {
      reject(cancelled());
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) options.signal.removeEventListener("abort", onAbort);
  }
}
