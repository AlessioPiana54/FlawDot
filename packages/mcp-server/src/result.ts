import { FlawDotError, type FlawDotErrorCode } from "@flawdot/core-model";

/** What a tool gives back: blocks of text and pictures, and `isError` when the call failed. */
export type ToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export interface ToolResult {
  readonly content: readonly ToolContent[];
  readonly isError?: true;
}

/** One line of the server log. The server never writes to `process` or `console`: stdout belongs to the protocol. */
export type Log = (line: string) => void;

export const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

export const errorResult = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

// What to do, for each code, said to Claude after the message. A message says what happened; this says what next.
const HINT: Record<FlawDotErrorCode, string> = {
  INVALID_INPUT: "Check the arguments and call the tool again.",
  UNREACHABLE: "Check that the site is running and the address is right, then try again.",
  TIMEOUT: "The page took too long. Try again, or analyze a lighter page.",
  LOGIN_REQUIRED: "The page needs a login, which this version cannot do. Try a public page.",
  AI_AUTH: "The key of the AI service was rejected.",
  AI_RATE_LIMIT: "The AI service is busy. Try again in a moment.",
  AI_BAD_RESPONSE: "The AI answer could not be used. Try again.",
  CANCELLED: "The analysis was cancelled.",
  INTERNAL: "Try again. If it keeps failing, report the problem.",
};

/** The detail of an error, to the log and nowhere else: it may hold a path, a name from the page or a secret. */
export function logError(error: unknown, log: Log): void {
  log(error instanceof Error ? (error.stack ?? error.message) : String(error));
}

export const UNEXPECTED =
  "FlawDot failed unexpectedly. Try again; the details are in the server log (stderr).";

/**
 * The one place where an error becomes a result. A `FlawDotError` is written for the user, so its message goes out with
 * a hint. Anything else may hold a path, a name from the page or a secret: the client gets a fixed sentence, and the
 * detail goes to the log only.
 */
export function toToolError(error: unknown, log: Log): ToolResult {
  if (error instanceof FlawDotError) {
    return errorResult(`${error.message} ${HINT[error.code]}`);
  }
  logError(error, log);
  return errorResult(UNEXPECTED);
}
