import { FlawDotError } from "@flawdot/core-model";
import { DIGIT_CELL, GLYPHS, GLYPH_UNITS, type Glyph } from "./glyphs.generated.js";

// Text is drawn as outlines, never as a font: the legend and the numbers then look the same on Windows, macOS and Linux,
// and a machine with no fonts still draws them. Only the characters that the marks use have an outline.

/** An outline, and how far from the start of the text its pen position is, in pixels. */
export interface PlacedGlyph {
  readonly d: string;
  readonly x: number;
}

export interface PlacedText {
  readonly glyphs: readonly PlacedGlyph[];
  /** Multiply the outline (in a 1000-unit em) by this to get pixels. */
  readonly scale: number;
  readonly width: number;
}

function glyphOf(character: string): Glyph {
  const glyph = GLYPHS[character];
  if (glyph === undefined) {
    throw new FlawDotError("INTERNAL", "A mark tried to draw a character that has no outline.");
  }
  return glyph;
}

/** The characters of a text, one by one. Only the ASCII of the marks is used, so a code point is one character. */
const charactersOf = (text: string): string[] => Array.from(text);

/** A text on one line, from x = 0. A space moves the pen and has no outline. */
export function layoutText(text: string, size: number): PlacedText {
  const scale = size / GLYPH_UNITS;
  const glyphs: PlacedGlyph[] = [];
  let pen = 0;
  for (const character of charactersOf(text)) {
    const glyph = glyphOf(character);
    if (glyph.d !== "") glyphs.push({ d: glyph.d, x: pen * scale });
    pen += glyph.advance;
  }
  return { glyphs, scale, width: pen * scale };
}

/**
 * The number of a circle. Each digit sits in a cell of the same width, so that 11 and 88 are as wide as each other (the
 * digits of the font are not all as wide as each other). If the number is wider than `maxWidth`, it is made smaller.
 */
export function layoutNumeral(value: number, size: number, maxWidth = Infinity): PlacedText {
  if (!Number.isInteger(value) || value <= 0) {
    throw new FlawDotError("INTERNAL", "A circle number is a positive whole number.");
  }
  const digits = charactersOf(String(value));
  const natural = (digits.length * DIGIT_CELL * size) / GLYPH_UNITS;
  const fitted = natural > maxWidth ? size * (maxWidth / natural) : size;
  const scale = fitted / GLYPH_UNITS;
  const glyphs = digits.map((digit, index): PlacedGlyph => {
    const glyph = glyphOf(digit);
    return { d: glyph.d, x: (index * DIGIT_CELL + (DIGIT_CELL - glyph.advance) / 2) * scale };
  });
  return { glyphs, scale, width: digits.length * DIGIT_CELL * scale };
}
