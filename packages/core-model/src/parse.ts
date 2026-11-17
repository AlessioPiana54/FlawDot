import type * as z from "zod";
import { FlawDotError, type FlawDotErrorCode } from "./errors.js";

const MAX_ISSUES_IN_MESSAGE = 5;

export interface ParseOptions {
  /** Error code when the input is malformed. Default `INVALID_INPUT`; AI answers use `AI_BAD_RESPONSE`. */
  code?: FlawDotErrorCode;
  /** What was being parsed, for the message: "record_findings", "HTTP request body". */
  what?: string;
}

/**
 * Validates data that comes from outside (AI answers, MCP tool arguments, HTTP bodies) and returns it
 * typed, or throws a `FlawDotError`. The message lists where each problem is and what is wrong, never the
 * received value: Zod's messages do not echo it, and an API key must not end up in an error.
 */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  input: unknown,
  options: ParseOptions = {},
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const { code = "INVALID_INPUT", what = "input" } = options;
  const shown = result.error.issues.slice(0, MAX_ISSUES_IN_MESSAGE).map((issue) => {
    // A path can hold symbols, and `join` throws on those.
    const where =
      issue.path.length > 0 ? issue.path.map((part) => String(part)).join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
  const hidden = result.error.issues.length - shown.length;
  const more = hidden > 0 ? ` (and ${String(hidden)} more)` : "";
  throw new FlawDotError(code, `Invalid ${what}: ${shown.join("; ")}${more}`, {
    cause: result.error,
  });
}
