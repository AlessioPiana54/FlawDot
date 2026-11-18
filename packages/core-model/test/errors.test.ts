import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  FlawDotError,
  flawDotErrorShapeSchema,
  isFlawDotError,
  originOf,
  type FlawDotErrorCode,
} from "../src/index.js";

describe("FlawDotError", () => {
  it("is a real Error carrying a code and a message", () => {
    const error = new FlawDotError("UNREACHABLE", "Can't reach http://localhost:3000.");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FlawDotError);
    expect(error.name).toBe("FlawDotError");
    expect(error.code).toBe("UNREACHABLE");
    expect(error.message).toBe("Can't reach http://localhost:3000.");
    expect(error.stack).toContain("Can't reach");
  });

  it("knows which codes are worth retrying without any change by the user", () => {
    const retryable: FlawDotErrorCode[] = ["UNREACHABLE", "TIMEOUT", "AI_RATE_LIMIT"];
    for (const code of ERROR_CODES) {
      expect(new FlawDotError(code, "x").retryable, code).toBe(retryable.includes(code));
    }
  });

  it("lets the caller override the default", () => {
    expect(new FlawDotError("TIMEOUT", "x", { retryable: false }).retryable).toBe(false);
    expect(new FlawDotError("AI_AUTH", "x", { retryable: true }).retryable).toBe(true);
  });

  it("keeps the cause when there is one, and has none otherwise", () => {
    const cause = new Error("socket hang up");
    expect(new FlawDotError("INTERNAL", "x", { cause }).cause).toBe(cause);
    expect(new FlawDotError("INTERNAL", "x").cause).toBeUndefined();
  });

  it("keeps a falsy cause (a thrown 0 or empty string is still a cause)", () => {
    expect(new FlawDotError("INTERNAL", "x", { cause: 0 }).cause).toBe(0);
  });

  it("serializes to code, message and retryable only: no stack, no cause", () => {
    const error = new FlawDotError("AI_AUTH", "The API key was rejected.", {
      cause: new Error("401 for CANARY-credential"),
    });
    const shape = error.toShape();
    expect(shape).toEqual({
      code: "AI_AUTH",
      message: "The API key was rejected.",
      retryable: false,
    });
    expect(JSON.stringify(shape)).not.toContain("CANARY-credential");
    expect(flawDotErrorShapeSchema.safeParse(shape).success).toBe(true);
  });
});

describe("isFlawDotError", () => {
  it("tells our errors from everything else", () => {
    expect(isFlawDotError(new FlawDotError("CANCELLED", "x"))).toBe(true);
    expect(isFlawDotError(new Error("x"))).toBe(false);
    expect(isFlawDotError({ code: "CANCELLED", message: "x", retryable: false })).toBe(false);
    expect(isFlawDotError(null)).toBe(false);
  });
});

describe("error shape schema", () => {
  it("rejects an unknown code", () => {
    expect(
      flawDotErrorShapeSchema.safeParse({ code: "BOOM", message: "x", retryable: false }).success,
    ).toBe(false);
  });
});

describe("originOf: the part of an address that may go in a message", () => {
  it("is the origin, with no path, query or fragment", () => {
    expect(originOf("https://shop.example:8443/a/b?token=SECRET#x")).toBe(
      "https://shop.example:8443",
    );
    expect(originOf("http://user:pass@127.0.0.1:3000/x")).toBe("http://127.0.0.1:3000");
  });

  it("is a neutral name for an address that cannot be read", () => {
    expect(originOf("not a url")).toBe("the page");
    expect(originOf("")).toBe("the page");
  });
});
