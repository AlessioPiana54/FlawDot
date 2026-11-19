import { FlawDotError, isFlawDotError } from "@flawdot/core-model";

/** Runs `work` and gives back the error it rejects with; fails if it does not reject, or rejects with something else. */
export async function rejectionOf(work: () => Promise<unknown>): Promise<FlawDotError> {
  // A port that returns a promise reports a failure by rejecting it. Work that throws before it returns the promise
  // is a bug of the adapter, and it fails the test here instead of being caught.
  const pending = work();
  try {
    await pending;
  } catch (error) {
    if (isFlawDotError(error)) {
      return error;
    }
    throw new Error("Expected a FlawDotError, but the work rejected with something else", {
      cause: error,
    });
  }
  throw new Error("Expected the work to reject, but it resolved");
}

/** Same as `rejectionOf`, for a function that throws instead of returning a promise. */
export function throwOf(work: () => unknown): FlawDotError {
  try {
    work();
  } catch (error) {
    if (isFlawDotError(error)) {
      return error;
    }
    throw new Error("Expected a FlawDotError, but the work threw something else", { cause: error });
  }
  throw new Error("Expected the work to throw, but it returned");
}
