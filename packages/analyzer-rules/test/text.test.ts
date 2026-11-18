import { describe, expect, it } from "vitest";
import { sanitizeText } from "../src/text.js";

describe("sanitizeText: text that came from a page, made safe to put in a finding", () => {
  it("leaves a normal text as it is", () => {
    expect(sanitizeText("Images must have alternative text", 200)).toBe(
      "Images must have alternative text",
    );
  });

  it("collapses runs of spaces and tabs, and trims", () => {
    expect(sanitizeText("  a \t\t b   c  ", 50)).toBe("a b c");
  });

  it("strips control characters", () => {
    expect(sanitizeText("a\u0000b\u0007c\u001bd\u007fe\u0085f", 50)).toBe("abcdef");
  });

  it.each([
    ["a zero-width space", 0x200b],
    ["a left-to-right mark", 0x200e],
    ["a right-to-left override", 0x202e],
    ["a line separator", 0x2028],
    ["a paragraph separator", 0x2029],
    ["a word joiner", 0x2060],
    ["a bidi isolate", 0x2066],
    ["a soft hyphen", 0xad],
    ["a combining grapheme joiner", 0x34f],
    ["an Arabic letter mark", 0x61c],
    ["a Mongolian vowel separator", 0x180e],
    ["a variation selector", 0xfe0f],
    ["a byte order mark", 0xfeff],
    ["a tag character (hidden text for a model)", 0xe0041],
    ["a variation selector of the supplement", 0xe0100],
  ])("strips %s", (_what, code) => {
    expect(sanitizeText(`a${String.fromCodePoint(code)}b`, 50)).toBe("ab");
  });

  it("keeps the characters next to the ranges it strips", () => {
    for (const code of [
      0xae,
      0x350,
      0x61b,
      0x61d,
      0x180d,
      0x2027,
      0x206a,
      0xfdff,
      0xff00,
      0xe007f + 1,
    ]) {
      const char = String.fromCodePoint(code);
      expect(sanitizeText(`a${char}b`, 50)).toBe(`a${char}b`);
    }
  });

  it("joins the lines of a text into one by default", () => {
    expect(
      sanitizeText("Fix any of the following:\n  Element has no alt\r\n  aria-label is empty", 200),
    ).toBe("Fix any of the following: Element has no alt aria-label is empty");
  });

  it("keeps the lines when asked, trimmed, with no empty line and no \r", () => {
    expect(
      sanitizeText(
        "Fix any of the following:\r\n  Element has no alt\n\n\n   aria-label is empty  ",
        200,
        {
          keepLines: true,
        },
      ),
    ).toBe("Fix any of the following:\nElement has no alt\naria-label is empty");
  });

  it("cuts a long text to the limit, with an ellipsis that counts in the limit", () => {
    const cut = sanitizeText("x".repeat(300), 100);
    expect(cut).toHaveLength(100);
    expect(cut.endsWith("\u2026")).toBe(true);
  });

  it("does not cut a character made of two parts in the middle", () => {
    const text = `${"a".repeat(8)}😀😀😀`;
    for (let max = 5; max <= text.length; max++) {
      const cut = sanitizeText(text, max);
      expect(cut.length).toBeLessThanOrEqual(max);
      expect(cut).not.toMatch(
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
      );
    }
  });

  it("gives an empty string for text that is blank once cleaned, so the caller can use its fallback", () => {
    expect(sanitizeText("  \u0000\u200b \n ", 50)).toBe("");
  });
});
