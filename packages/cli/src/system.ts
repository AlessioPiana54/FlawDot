import { randomFillSync } from "node:crypto";
import { findingIdSchema, runIdSchema, type Clock, type IdGenerator } from "@flawdot/core-model";

/** The time of this machine. Anything that needs the time takes a `Clock`, so a test can give it another. */
export const systemClock: Clock = { now: () => new Date() };

// Crockford base32: no I, L, O or U.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_DIGITS = 10;
const RANDOM_DIGITS = 16;

const secureRandom = (count: number): Uint8Array => randomFillSync(new Uint8Array(count));

/** The millisecond as ten base32 digits. A time below 2^48 keeps the first digit at 7 or below, as the schema wants. */
function timePart(ms: number): string {
  let rest = ms;
  let text = "";
  for (let index = 0; index < TIME_DIGITS; index += 1) {
    text = ALPHABET[rest % 32]! + text;
    rest = Math.floor(rest / 32);
  }
  return text;
}

/**
 * ULIDs that grow strictly in the order they are made, even within one millisecond or when the clock goes back
 * (two ids of the same millisecond would otherwise sort by chance). Runs and findings share the sequence.
 * `random` is for the tests: it gives `count` random bytes, of which only five bits each are used.
 */
export function createIdGenerator(
  clock: Clock,
  random: (count: number) => Uint8Array = secureRandom,
): IdGenerator {
  let lastMs = -1;
  let lastDigits: number[] = [];

  const fresh = (): number[] => Array.from(random(RANDOM_DIGITS), (byte) => byte & 31);

  // Adds one to the random part, from the end. Returns false when it was already full of 31s.
  const increment = (digits: number[]): boolean => {
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      if (digits[index]! < 31) {
        digits[index] = digits[index]! + 1;
        return true;
      }
      digits[index] = 0;
    }
    return false;
  };

  const next = (): string => {
    const now = clock.now().getTime();
    if (now > lastMs) {
      lastMs = now;
      lastDigits = fresh();
    } else if (!increment(lastDigits)) {
      // The 80 bits of this millisecond are used up: the next millisecond starts again.
      lastMs += 1;
      lastDigits = fresh();
    }
    return timePart(lastMs) + lastDigits.map((digit) => ALPHABET[digit]).join("");
  };

  return {
    runId: () => runIdSchema.parse(next()),
    findingId: () => findingIdSchema.parse(next()),
  };
}
