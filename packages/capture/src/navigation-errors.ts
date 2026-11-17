import { FlawDotError, isFlawDotError, type AbortSignalLike } from "@flawdot/core-model";

// Playwright throws its own errors with long call logs and the full URL. What leaves the capture is a FlawDotError
// whose message names only the origin of the page: a path or a query string can hold a token, and an error message
// is shown to the user and written to logs.

export const NAVIGATION_TIMEOUT_MS = 30_000;

function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : "the page";
}

/** Playwright raises `TimeoutError`; the browser reports network failures as "net::ERR_...". */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes("net::ERR_");
}

/** A page that stops answering while it is measured: a script that never ends, a font that never arrives. */
export function stalled(url: string): FlawDotError {
  return new FlawDotError(
    "TIMEOUT",
    `${originOf(url)} stopped responding while it was being measured. Try again, or look for a script on the page that never ends.`,
  );
}

export function toFlawDotError(
  error: unknown,
  context: { url: string; signal: AbortSignalLike },
): FlawDotError {
  if (isFlawDotError(error)) return error;
  const origin = originOf(context.url);
  if (context.signal.aborted) {
    return new FlawDotError("CANCELLED", "The capture was cancelled.", { cause: error });
  }
  if (isTimeout(error)) {
    return new FlawDotError(
      "TIMEOUT",
      `${origin} did not finish loading in time. Check that the site is running, then try again.`,
      { cause: error },
    );
  }
  if (isNetworkFailure(error)) {
    return new FlawDotError(
      "UNREACHABLE",
      `Could not reach ${origin}. Check the address and that the site is running.`,
      { cause: error },
    );
  }
  return new FlawDotError("INTERNAL", `The capture of ${origin} failed unexpectedly.`, {
    cause: error,
  });
}
