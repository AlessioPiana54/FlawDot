import { FlawDotError, isFlawDotError, originOf, type AbortSignalLike } from "@flawdot/core-model";

// Playwright throws its own errors with long call logs and the full URL. What leaves the capture is a FlawDotError
// whose message names only the origin of the page: a path or a query string can hold a token, and an error message
// is shown to the user and written to logs.

export const NAVIGATION_TIMEOUT_MS = 30_000;

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

/**
 * The site asks for a login before it shows the page. Trying again changes nothing until the user logs in. A 403
 * says "refused", not "log in": a site that blocks automated visits answers the same, and logging in will not help,
 * so that message names both.
 */
export function loginRequired(url: string, status?: number): FlawDotError {
  const origin = originOf(url);
  return new FlawDotError(
    "LOGIN_REQUIRED",
    status === 403
      ? `${origin} refused access to this page (403). If it needs a login, log in to the site and analyze it again. If it blocks automated visits, FlawDot cannot analyze it.`
      : `${origin} asks for a login before it shows this page. Log in to the site, then analyze it again.`,
  );
}

/**
 * The address answered with a file or data (a PDF, JSON, a download), not with a page that can be looked at. The
 * words stay neutral: `net::ERR_ABORTED` also comes with an answer that has no content, not only with a download.
 */
export function notAWebPage(url: string, cause?: unknown): FlawDotError {
  return new FlawDotError(
    "INVALID_INPUT",
    `${originOf(url)} answered with a file or data, not with a web page. Give the address of a page.`,
    { cause },
  );
}

/**
 * Where the capture was when the error came. Only the picture phase has a cause worth naming; "analysis" is the
 * caller's own work on the open page, whose errors are not the page's.
 */
export type CapturePhase = "loading" | "measuring" | "picture" | "analysis";

/**
 * The picture could not be taken in time. Playwright waits for the fonts of the page before it takes a picture, so a
 * font that never arrives is the usual reason; nothing here can say for sure, so the message only names it.
 */
function pictureStalled(url: string, cause: unknown): FlawDotError {
  return new FlawDotError(
    "TIMEOUT",
    `${originOf(url)} stopped responding while the picture of the page was being taken. A web font that never finishes loading is a common cause. Try again.`,
    { cause },
  );
}

/** A certificate that is not valid, or an https address that does not speak https: another try gives the same. */
function isCertificateProblem(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("net::ERR_CERT_") || error.message.includes("net::ERR_SSL_"))
  );
}

/** The address answered with a file, so the browser started a download instead of showing a page. */
function isDownload(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Download is starting") || error.message.includes("net::ERR_ABORTED"))
  );
}

export function toFlawDotError(
  error: unknown,
  context: { url: string; signal: AbortSignalLike; phase?: CapturePhase },
): FlawDotError {
  if (isFlawDotError(error)) {
    return context.phase === "picture" && error.code === "TIMEOUT"
      ? pictureStalled(context.url, error)
      : error;
  }
  const origin = originOf(context.url);
  if (context.signal.aborted) {
    return new FlawDotError("CANCELLED", "The capture was cancelled.", { cause: error });
  }
  if (isTimeout(error)) {
    if (context.phase === "picture") return pictureStalled(context.url, error);
    return new FlawDotError(
      "TIMEOUT",
      `${origin} did not finish loading in time. Check that the site is running, then try again.`,
      { cause: error },
    );
  }
  if (isCertificateProblem(error)) {
    return new FlawDotError(
      "UNREACHABLE",
      `The security certificate of ${origin} is not valid, or it does not speak https, so the browser refused to open it. Fix the certificate, or use http for a site on your own computer.`,
      { cause: error, retryable: false },
    );
  }
  if (isDownload(error)) return notAWebPage(context.url, error);
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
