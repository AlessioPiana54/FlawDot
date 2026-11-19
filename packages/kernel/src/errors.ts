import { isFlawDotError, type FlawDotErrorShape } from "@flawdot/core-model";

/**
 * The form of an error that may leave the kernel in an event or a summary. A `FlawDotError` is already safe (its
 * message is written to be shown, and `toShape` drops the stack and the cause). Anything else can hold a path, a page
 * text or a secret, so its text is never used: it becomes INTERNAL with the message the caller gives, which names the
 * step and nothing more.
 */
export function toErrorShape(error: unknown, message: string): FlawDotErrorShape {
  return isFlawDotError(error) ? error.toShape() : { code: "INTERNAL", message, retryable: false };
}
