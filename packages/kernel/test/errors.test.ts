import { FlawDotError } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { toErrorShape } from "../src/errors.js";

describe("toErrorShape", () => {
  it("keeps what a FlawDotError says: the code, the message and whether trying again can work", () => {
    const shape = toErrorShape(new FlawDotError("TIMEOUT", "The page took too long."), "x");

    expect(shape).toEqual({ code: "TIMEOUT", message: "The page took too long.", retryable: true });
  });

  it("never carries the stack or the cause of a FlawDotError", () => {
    const error = new FlawDotError("INTERNAL", "Broken.", { cause: new Error("CANARY-cause") });

    expect(JSON.stringify(toErrorShape(error, "x"))).not.toContain("CANARY");
    expect(Object.keys(toErrorShape(error, "x")).sort()).toEqual(["code", "message", "retryable"]);
  });

  it("gives any other error as INTERNAL with the message it was given, never the text of the error", () => {
    const shape = toErrorShape(
      new Error("CANARY-secret https://x.example/?token=CANARY"),
      "The step failed.",
    );

    expect(shape).toEqual({ code: "INTERNAL", message: "The step failed.", retryable: false });
  });

  it.each([
    ["a string", "CANARY-text"],
    ["null", null],
    ["undefined", undefined],
    ["an object", { a: 1 }],
  ])("gives %s that was thrown as INTERNAL too", (_label, thrown) => {
    expect(toErrorShape(thrown, "It failed.").code).toBe("INTERNAL");
  });
});
