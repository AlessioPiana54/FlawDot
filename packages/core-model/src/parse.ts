import type * as z from "zod";
import { FlawDotError, type FlawDotErrorCode } from "./errors.js";

const MAX_ISSUES_IN_MESSAGE = 5;
// Zod puts the NAME of an unknown key in its message, and that name comes from the input (an AI answer, a tool
// call) with no limit of its own. One line is cut here so that an error cannot carry a megabyte of attacker text.
const MAX_ISSUE_LENGTH = 200;

function clip(text: string): string {
  if (text.length <= MAX_ISSUE_LENGTH) return text;
  const cut = text.slice(0, MAX_ISSUE_LENGTH);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  const splitsAnEmoji = lastUnit >= 0xd800 && lastUnit <= 0xdbff; // a high surrogate without its low half
  return `${splitsAnEmoji ? cut.slice(0, -1) : cut}…`;
}

export interface ParseOptions {
  /** Error code when the input is malformed. Default `INVALID_INPUT`; AI answers use `AI_BAD_RESPONSE`. */
  code?: FlawDotErrorCode;
  /** What was being parsed, for the message: "record_findings", "HTTP request body". */
  what?: string;
}

/**
 * Validates data that comes from outside (AI answers, MCP tool arguments, HTTP bodies) and returns it
 * typed, or throws a `FlawDotError`. The message lists where each problem is and what is wrong. It does not
 * repeat the received value (Zod's own messages do not), but names that come from the input can appear in it:
 * the path of a record key, or the key names of an `unrecognized_keys` problem.
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
    return clip(`${where}: ${issue.message}`);
  });
  const hidden = result.error.issues.length - shown.length;
  const more = hidden > 0 ? ` (and ${String(hidden)} more)` : "";
  throw new FlawDotError(code, `Invalid ${what}: ${shown.join("; ")}${more}`, {
    cause: result.error,
  });
}
