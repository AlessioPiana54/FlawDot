import { describe, expect, it } from "vitest";
import { ERROR_CODES, FlawDotError } from "@flawdot/core-model";
import { UNEXPECTED, errorResult, textResult, toToolError } from "../src/result.js";

describe("toToolError: the one place where an error becomes a result", () => {
  it.each(ERROR_CODES)("writes a FlawDotError of code %s as its message and a hint", (code) => {
    const result = toToolError(new FlawDotError(code, "Something happened."), () => undefined);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text.startsWith("Something happened. ")).toBe(true);
    expect(text.length).toBeGreaterThan("Something happened. ".length + 10);
  });

  it("does not write the stack or the cause of a FlawDotError", () => {
    const cause = new Error("C:\\Users\\me\\secret\\file.txt");
    const result = toToolError(new FlawDotError("INTERNAL", "Broken.", { cause }), () => undefined);

    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("gives a fixed sentence for any other error, and writes the detail to the log only", () => {
    const lines: string[] = [];
    const error = new Error("ENOENT C:\\Users\\me\\secret\\file.txt");

    const result = toToolError(error, (line) => lines.push(line));

    expect(result).toEqual(errorResult(UNEXPECTED));
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(lines.join("\n")).toContain("secret");
  });

  it("copes with something thrown that is not an Error", () => {
    const lines: string[] = [];

    const result = toToolError("a string", (line) => lines.push(line));

    expect(result.isError).toBe(true);
    expect(lines).toEqual(["a string"]);
  });
});

describe("textResult and errorResult", () => {
  it("make one block of text, and only the error says isError", () => {
    expect(textResult("hi")).toEqual({ content: [{ type: "text", text: "hi" }] });
    expect(errorResult("no")).toEqual({ content: [{ type: "text", text: "no" }], isError: true });
  });
});
