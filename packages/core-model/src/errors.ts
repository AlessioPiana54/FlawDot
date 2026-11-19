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
 * `null` or `{ error }` for a failure. Messages are in English and say what happened and what to do. A message
 * must never be built from the API key or any other secret: the error does not scrub it, the caller does.
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

// `URL` is in every runtime FlawDot supports (Node 24+), but this package is compiled with no environment types on
// purpose, so the one thing it needs of it is declared here. Nothing is emitted for a `declare`.
declare const URL: {
  canParse(url: string): boolean;
  new (url: string): { readonly origin: string; readonly href: string; hash: string };
};

/**
 * The origin of an address ("https://shop.example"), for a message. An error message is shown to the user and written
 * to logs, and a path or a query string can hold a token, so a message names the origin and nothing more. An address
 * that cannot be read is called "the page".
 */
export function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : "the page";
}

/**
 * An address with its spelling made the same: the host in lower case, the default port and the empty path written
 * out, and no fragment (the part after "#" is not sent to the server, so it is not another page). Two addresses that
 * give the same answer from this are one page. An address that cannot be read is given back as it is.
 */
export function canonicalAddress(url: string): string {
  if (!URL.canParse(url)) return url;
  const address = new URL(url);
  address.hash = "";
  return address.href;
}

export function isFlawDotError(value: unknown): value is FlawDotError {
  return value instanceof FlawDotError;
}
