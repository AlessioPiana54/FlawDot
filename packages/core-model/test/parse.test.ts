import * as z from "zod";
import { describe, expect, it } from "vitest";
import { FlawDotError, findingDraftSchema, parseOrThrow } from "../src/index.js";

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

  it("does not echo a wrong value in the real schemas either (unions, literals, numbers)", () => {
    const canary = "CANARY-must-not-appear";
    const bad = {
      category: canary,
      severity: canary,
      ruleKey: 12345,
      title: canary,
      explanation: canary,
      fix: canary,
      evidence: canary,
      principle: { code: canary, label: 99 },
      source: { kind: canary, confidence: canary },
      location: { kind: canary },
    };
    const error = failureOf(() => parseOrThrow(findingDraftSchema, bad, { what: "draft" }));
    expect(error.message).not.toContain("CANARY");
    expect(error.message).not.toContain("12345");
  });

  it("cuts a very long problem text, such as the name of an unknown key that came from the input", () => {
    const longText = z.string().refine(() => false, { message: "x".repeat(10_000) });
    const error = failureOf(() => parseOrThrow(longText, "value"));
    expect(error.message.length).toBeLessThan(300);
    expect(error.message.endsWith("…")).toBe(true);
  });

  it("leaves a text of exactly the limit untouched", () => {
    // "(root): " is 8 characters, so a message of 192 makes the whole line 200.
    const exact = z.string().refine(() => false, { message: "y".repeat(192) });
    const error = failureOf(() => parseOrThrow(exact, "value"));
    expect(error.message).toBe(`Invalid input: (root): ${"y".repeat(192)}`);
  });

  it("does not leave half of an emoji at the cut", () => {
    // The emoji starts at character 199 of the line, so the cut would split it.
    const emoji = z.string().refine(() => false, { message: `${"a".repeat(191)}😀b` });
    const error = failureOf(() => parseOrThrow(emoji, "value"));
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(error.message)).toBe(false);
    expect(error.message.endsWith("…")).toBe(true);
  });

  it("keeps a whole emoji when the cut falls right after it", () => {
    // Here the emoji ends exactly at character 200, so nothing is split and nothing is dropped.
    const emoji = z.string().refine(() => false, { message: `${"a".repeat(190)}😀b` });
    const error = failureOf(() => parseOrThrow(emoji, "value"));
    expect(error.message.endsWith("😀…")).toBe(true);
  });

  it("keeps the Zod error as the cause for debugging", () => {
    const error = failureOf(() => parseOrThrow(schema, {}));
    expect(error.cause).toBeInstanceOf(z.ZodError);
  });
});
