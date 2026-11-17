import * as z from "zod";

export const ERROR_CODES = [
  "INVALID_INPUT", // external input is not valid (URL, HTTP body, record_findings)
  "UNREACHABLE", // the page cannot be reached
  "TIMEOUT",
  "LOGIN_REQUIRED", // redirected to a login page
  "AI_AUTH", // the API key was rejected (401)
  "AI_RATE_LIMIT",
  "AI_BAD_RESPONSE", // the AI answer does not follow the schema
  "CANCELLED",
  "INTERNAL",
] as const;
export const flawDotErrorCodeSchema = z.enum(ERROR_CODES);
export type FlawDotErrorCode = z.infer<typeof flawDotErrorCodeSchema>;

/** The serializable part of an error: what travels in events, HTTP answers and MCP results. */
export const flawDotErrorShapeSchema = z.object({
  code: flawDotErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
});
export type FlawDotErrorShape = z.infer<typeof flawDotErrorShapeSchema>;

/** Codes for which trying again can work without the user changing anything. */
const RETRYABLE_BY_DEFAULT: ReadonlySet<FlawDotErrorCode> = new Set([
  "UNREACHABLE",
  "TIMEOUT",
  "AI_RATE_LIMIT",
]);

export interface FlawDotErrorOptions {
  /** Overrides the default for the code. */
  retryable?: boolean;
  cause?: unknown;
}

/**
 * The only error type that crosses a module boundary: async functions throw it, they never return
 * `null` or `{ error }` for a failure. Messages are in English, say what happened and what to do, and
 * never contain the API key.
 */
export class FlawDotError extends Error implements FlawDotErrorShape {
  readonly code: FlawDotErrorCode;
  readonly retryable: boolean;

  constructor(code: FlawDotErrorCode, message: string, options: FlawDotErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FlawDotError";
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(code);
  }

  /** Drops the stack and the cause, which must not leave the process. */
  toShape(): FlawDotErrorShape {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function isFlawDotError(value: unknown): value is FlawDotError {
  return value instanceof FlawDotError;
}
