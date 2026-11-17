import * as z from "zod";
import { describe, expect, it } from "vitest";
import { FlawDotError, parseOrThrow } from "../src/index.js";

const schema = z.object({
  mark: z.int().positive(),
  tags: z.array(z.string()),
  tier: z.enum(["accurate", "economy"]),
});

function failureOf(run: () => unknown): FlawDotError {
  try {
    run();
  } catch (error) {
    if (error instanceof FlawDotError) return error;
    throw error;
  }
  throw new Error("expected parseOrThrow to throw");
}

describe("parseOrThrow", () => {
  it("returns the typed data when the input is valid", () => {
    const data = parseOrThrow(schema, { mark: 3, tags: ["a"], tier: "economy" });
    expect(data).toEqual({ mark: 3, tags: ["a"], tier: "economy" });
  });

  it("throws INVALID_INPUT by default, naming the input and where the problem is", () => {
    const error = failureOf(() => parseOrThrow(schema, { mark: 0, tags: [], tier: "accurate" }));
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/^Invalid input: mark: /);
  });

  it("uses the code and the label the caller asks for", () => {
    const error = failureOf(() =>
      parseOrThrow(schema, null, { code: "AI_BAD_RESPONSE", what: "AI answer" }),
    );
    expect(error.code).toBe("AI_BAD_RESPONSE");
    expect(error.message).toMatch(/^Invalid AI answer: \(root\): /);
  });

  it("writes nested paths with dots", () => {
    const error = failureOf(() =>
      parseOrThrow(schema, { mark: 1, tags: ["a", 2], tier: "economy" }),
    );
    expect(error.message).toContain("tags.1: ");
  });

  it("lists at most 5 problems and counts the rest", () => {
    const error = failureOf(() => parseOrThrow(z.array(z.string()), [1, 2, 3, 4, 5, 6, 7]));
    expect(error.message.match(/; /g)).toHaveLength(4);
    expect(error.message).toMatch(/\(and 2 more\)$/);
  });

  it("does not add a count when everything fits", () => {
    const error = failureOf(() => parseOrThrow(z.array(z.string()), [1, 2]));
    expect(error.message).not.toContain("more");
  });

  it("never echoes the received value: a value pasted in the wrong field stays out of the message", () => {
    const secret = "CANARY-value-that-must-not-be-echoed";
    const error = failureOf(() => parseOrThrow(schema, { mark: 1, tags: [], tier: secret }));
    expect(error.message).not.toContain(secret);
    expect(error.toShape().message).not.toContain(secret);
  });

  it("does not choke on a path that holds a symbol", () => {
    const withSymbol = z.string().refine(() => false, { path: [Symbol("hidden")] });
    const error = failureOf(() => parseOrThrow(withSymbol, "x"));
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain("Symbol(hidden)");
  });

  it("keeps the Zod error as the cause for debugging", () => {
    const error = failureOf(() => parseOrThrow(schema, {}));
    expect(error.cause).toBeInstanceOf(z.ZodError);
  });
});
