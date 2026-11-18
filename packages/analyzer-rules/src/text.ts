// Text that axe returns is written, in part, by the page (an `html` snippet, a failure message with the values of the
// page in it). It is data: it is cleaned and cut before it goes in a finding, and never taken for an instruction.

const ELLIPSIS = "…";
// Characters that are control, or that move, hide or steer text: the C0 range (a line break is split off before this),
// the C1 range, the soft hyphen and the combining grapheme joiner, the Arabic letter mark and the Mongolian vowel
// separator, zero-width characters and direction marks and overrides, the line and paragraph separators, the word
// joiner and isolates, variation selectors, the byte order mark, and the Unicode Tags block (text that no one sees
// and that a model reads: "ASCII smuggling").
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];

const isInvisible = (code: number): boolean =>
  INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to);

const withoutInvisible = (line: string): string =>
  Array.from(line)
    .filter((char) => !isInvisible(char.codePointAt(0) ?? 0))
    .join("");

/** Cuts to `max` UTF-16 units with an ellipsis that counts in `max`, never between the two halves of a character. */
function cutTo(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - ELLIPSIS.length);
  const last = text.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}${ELLIPSIS}`;
}

/**
 * Makes a text from a page safe for a finding: no control or invisible characters, whitespace collapsed, at most
 * `max` long. The lines are joined with a space unless `keepLines` is set. Returns "" when nothing is left, so the
 * caller can use its own fallback.
 */
export function sanitizeText(
  value: string,
  max: number,
  options: { keepLines?: boolean } = {},
): string {
  const lines = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) =>
      withoutInvisible(line)
        .replace(/[ \t\f\v]+/g, " ")
        .trim(),
    )
    .filter((line) => line !== "");
  return cutTo(lines.join(options.keepLines === true ? "\n" : " "), max);
}
