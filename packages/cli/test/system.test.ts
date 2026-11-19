import { findingIdSchema, runIdSchema } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { createIdGenerator, systemClock } from "../src/system.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const clockAt = (start: number) => {
  let ms = start;
  return {
    clock: { now: () => new Date(ms) },
    set: (value: number) => {
      ms = value;
    },
  };
};

/** Random bytes that are always the same value: the ULID then depends only on the clock and on the carry. */
const constant = (value: number) => (count: number) => new Uint8Array(count).fill(value);

describe("systemClock", () => {
  it("gives the current time as a Date", () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("createIdGenerator", () => {
  it("makes ids that the run and finding schemas accept", () => {
    const ids = createIdGenerator(systemClock);
    expect(runIdSchema.safeParse(ids.runId()).success).toBe(true);
    expect(findingIdSchema.safeParse(ids.findingId()).success).toBe(true);
  });

  it("writes the time of the clock in the first ten characters, as Crockford base32", () => {
    const { clock } = clockAt(1_700_000_000_000);
    const id = createIdGenerator(clock, constant(0)).runId();
    // 1_700_000_000_000 ms is 0x18BCFE56800: ten digits of five bits each, the most significant first.
    const expected = [...Array(10).keys()]
      .map((index) => ALPHABET[Math.floor(1_700_000_000_000 / 32 ** (9 - index)) % 32])
      .join("");
    expect(id.slice(0, 10)).toBe(expected);
  });

  it("keeps the first character at 7 or below, even for the largest 48-bit time", () => {
    const { clock } = clockAt(2 ** 48 - 1);
    const id = createIdGenerator(clock, constant(0)).runId();
    expect(id[0]).toBe("7");
    expect(runIdSchema.safeParse(id).success).toBe(true);
  });

  it("uses every one of the five bits of a random byte, and no more", () => {
    const { clock } = clockAt(0);
    // 0b11111111 & 31 is 31, the last letter; 0b11100000 & 31 is 0
    expect(createIdGenerator(clock, constant(0xff)).runId().slice(10)).toBe("Z".repeat(16));
    expect(createIdGenerator(clock, constant(0xe0)).runId().slice(10)).toBe("0".repeat(16));
  });

  it("gives strictly growing ids when many are made in the same millisecond", () => {
    const { clock } = clockAt(1_700_000_000_000);
    const ids = createIdGenerator(clock);
    const made = Array.from({ length: 10_000 }, () => ids.runId());
    for (let index = 1; index < made.length; index += 1) {
      expect(made[index]! > made[index - 1]!).toBe(true);
    }
    expect(new Set(made).size).toBe(made.length);
  });

  it("does not go back when the clock does", () => {
    const { clock, set } = clockAt(1_700_000_000_000);
    const ids = createIdGenerator(clock);
    const first = ids.runId();
    set(1_600_000_000_000);
    const second = ids.runId();
    expect(second > first).toBe(true);
    expect(second.slice(0, 10)).toBe(first.slice(0, 10));
  });

  it("carries from the end of the random part into the previous digit", () => {
    const { clock } = clockAt(1_700_000_000_000);
    // random part 00…0Z, then +1 in the same millisecond: 00…10
    const first = new Uint8Array(16);
    first[15] = 31;
    let call = 0;
    const ids = createIdGenerator(clock, (count) => (call++ === 0 ? first : new Uint8Array(count)));
    const a = ids.runId();
    const b = ids.runId();
    expect(a.slice(10)).toBe("000000000000000Z");
    expect(b.slice(10)).toBe("0000000000000010");
  });

  it("adds one to a digit that is not the last one without carrying", () => {
    const { clock } = clockAt(1_700_000_000_000);
    const first = new Uint8Array(16);
    first[15] = 30;
    let call = 0;
    const ids = createIdGenerator(clock, (count) => (call++ === 0 ? first : new Uint8Array(count)));

    const a = ids.runId();
    const b = ids.runId();

    expect(a.slice(10)).toBe("000000000000000Y");
    expect(b.slice(10)).toBe("000000000000000Z");
  });

  it("moves to the next millisecond when the random part is full", () => {
    const { clock } = clockAt(1_700_000_000_000);
    const ids = createIdGenerator(clock, constant(31));
    const a = ids.runId();
    const b = ids.runId();
    expect(a.slice(10)).toBe("Z".repeat(16));
    expect(b > a).toBe(true);
    expect(b.slice(0, 10) > a.slice(0, 10)).toBe(true);
  });

  it("uses the same sequence for runs and for findings, so no two ids are alike", () => {
    const { clock } = clockAt(1_700_000_000_000);
    const ids = createIdGenerator(clock);
    const made = [ids.runId(), ids.findingId(), ids.runId(), ids.findingId()];
    expect(new Set(made).size).toBe(4);
    expect([...made].sort()).toEqual(made);
  });
});
