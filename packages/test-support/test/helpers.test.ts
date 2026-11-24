import { FlawDotError, findingSchema, runSchema } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import {
  ManualClock,
  fingerprint,
  makeFinding,
  makeRun,
  rejectionOf,
  throwOf,
  ulid,
  useFixture,
} from "../src/index.js";

describe("rejectionOf", () => {
  it("gives back the FlawDotError that the work rejects with", async () => {
    const error = await rejectionOf(() => Promise.reject(new FlawDotError("TIMEOUT", "Too slow")));

    expect(error.code).toBe("TIMEOUT");
  });

  it("fails when the work resolves", async () => {
    await expect(rejectionOf(() => Promise.resolve(1))).rejects.toThrow("to reject");
  });

  it("fails when the work rejects with something that is not a FlawDotError", async () => {
    await expect(rejectionOf(() => Promise.reject(new Error("plain")))).rejects.toThrow(
      "Expected a FlawDotError",
    );
  });

  it("fails, instead of catching it, when the work throws before it returns a promise", async () => {
    const throwing = (): Promise<never> => {
      throw new FlawDotError("INVALID_INPUT", "thrown too early");
    };

    await expect(rejectionOf(throwing)).rejects.toThrow("thrown too early");
  });
});

describe("throwOf", () => {
  it("gives back the FlawDotError that the work throws", () => {
    const error = throwOf(() => {
      throw new FlawDotError("INVALID_INPUT", "No");
    });

    expect(error.code).toBe("INVALID_INPUT");
  });

  it("fails when the work returns", () => {
    expect(() => throwOf(() => 1)).toThrow("to throw");
  });

  it("fails when the work throws something that is not a FlawDotError", () => {
    expect(() =>
      throwOf(() => {
        throw new Error("plain");
      }),
    ).toThrow("Expected a FlawDotError");
  });
});

describe("fixtures", () => {
  it("makes ids that are valid and sort in the order of their numbers", () => {
    const ids = [0, 1, 31, 32, 1023].map(ulid);

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([-1, 1024, 1.5])("refuses the number %s for an id", (n) => {
    expect(() => ulid(n)).toThrow(RangeError);
  });

  it("makes a run and a finding that follow the rules of the model", () => {
    expect(runSchema.safeParse(makeRun()).success).toBe(true);
    expect(findingSchema.safeParse(makeFinding()).success).toBe(true);
  });

  it("makes fingerprints that are different for different digits", () => {
    expect(fingerprint("a")).toHaveLength(64);
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
  });

  it("moves its clock only when told to", () => {
    const clock = new ManualClock("2026-03-01T00:00:00.000Z");

    clock.advance(1500);

    expect(clock.now().toISOString()).toBe("2026-03-01T00:00:01.500Z");
    expect(clock.now().toISOString()).toBe("2026-03-01T00:00:01.500Z");
  });
});

describe("useFixture", () => {
  const current = useFixture(() => ({ subject: "thing" }));

  it("gives each test a fixture and a clock", () => {
    expect(current().fixture.subject).toBe("thing");
    expect(current().clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("useFixture while the file is being loaded", () => {
  const current = useFixture(() => ({ subject: 1 }));
  // No test is running yet: the hooks have not made the fixture.
  const whileLoading = (): string => {
    try {
      current();
      return "no error";
    } catch (error) {
      return String(error);
    }
  };
  const message = whileLoading();

  it("refuses to be read", () => {
    expect(message).toContain("only available inside a test");
  });
});
