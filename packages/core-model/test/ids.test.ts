import { describe, expect, it } from "vitest";
import { findingIdSchema, markIdSchema, projectIdSchema, runIdSchema } from "../src/index.js";
import { OTHER_ULID, RUN_ULID } from "./fixtures.js";

describe("ProjectId", () => {
  it.each(["example.com", "localhost-3000", "127.0.0.1-8080", "a"])("accepts %s", (value) => {
    expect(projectIdSchema.parse(value)).toBe(value);
  });

  it.each(["", "Example.com", "-start.com", "has space.com", ".hidden", "a".repeat(254)])(
    "rejects %j",
    (value) => {
      expect(projectIdSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe.each([
  ["RunId", runIdSchema],
  ["FindingId", findingIdSchema],
])("%s", (_name, schema) => {
  it("accepts a ULID", () => {
    expect(schema.parse(RUN_ULID)).toBe(RUN_ULID);
    expect(schema.parse(OTHER_ULID)).toBe(OTHER_ULID);
  });

  it.each([
    ["too short", RUN_ULID.slice(0, 25)],
    ["too long", `${RUN_ULID}0`],
    ["lowercase", RUN_ULID.toLowerCase()],
    ["a letter Crockford does not use (U)", `${RUN_ULID.slice(0, 25)}U`],
    ["a timestamp that overflows (first char 8)", `8${RUN_ULID.slice(1)}`],
    ["empty", ""],
  ])("rejects %s", (_why, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe("MarkId", () => {
  it("accepts positive integers", () => {
    expect(markIdSchema.parse(1)).toBe(1);
    expect(markIdSchema.parse(300)).toBe(300);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1"])("rejects %j", (value) => {
    expect(markIdSchema.safeParse(value).success).toBe(false);
  });
});
