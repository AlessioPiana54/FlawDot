import type { LayoutImage, Rect } from "./geometry.js";
import { DIGIT_HEIGHT } from "./glyphs.generated.js";
import { layoutNumeral, type PlacedText } from "./glyphs.js";
import type { Annotation, PlacedMark } from "./layout.js";
import type { PlacedLegend } from "./legend.js";
import type { MarkTheme } from "./theme.js";

// The picture that is laid over the screenshot. It is built as a string and made only of paths, circles and rectangles:
// no font, no marker, no filter, so that every system draws the same thing. Every number goes through `n`, which
// rounds it, so that the same marks always make the same string.

/** A number as it is written in the picture: two decimals at most, and never "-0". */
const n = (value: number): string => String(Math.round(value * 100) / 100 || 0);

/** The scale of an outline (a number like 0.016) needs more decimals than a position does. */
const scaleOf = (value: number): string => String(Math.round(value * 1e6) / 1e6);

/** A number inside the disc takes at most this share of its diameter. */
const NUMERAL_SHARE = 0.8;

/** The four corners of a frame, as one path. */
const bracketPath = (frame: Rect, arm: number): string => {
  const left = frame.x;
  const top = frame.y;
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  return [
    `M${n(left)} ${n(top + arm)}V${n(top)}H${n(left + arm)}`,
    `M${n(right - arm)} ${n(top)}H${n(right)}V${n(top + arm)}`,
    `M${n(right)} ${n(bottom - arm)}V${n(bottom)}H${n(right - arm)}`,
    `M${n(left + arm)} ${n(bottom)}H${n(left)}V${n(bottom - arm)}`,
  ].join("");
};

/** The attributes of a line of ink: no fill, the ink, the width of the theme at the scale of the image. */
const inkLine = (theme: MarkTheme, scale: number): string =>
  `fill="none" stroke="${theme.ink}" stroke-width="${n(theme.strokeWidth * scale)}"`;

function brackets(mark: PlacedMark, theme: MarkTheme, scale: number): string {
  return `<path d="${bracketPath(mark.bracket, mark.arm)}" ${inkLine(theme, scale)}/>`;
}

function arrow(mark: PlacedMark, theme: MarkTheme, scale: number): string {
  if (mark.arrow === null) return "";
  const { from, to, ux, uy } = mark.arrow;
  const length = theme.arrowHead.length * scale;
  const half = theme.arrowHead.halfWidth * scale;
  // The shaft stops at the base of the head, so that the point of the head is the only thing at the tip.
  const base = { x: to.x - ux * length, y: to.y - uy * length };
  const left = { x: base.x - uy * half, y: base.y + ux * half };
  const right = { x: base.x + uy * half, y: base.y - ux * half };
  const shaft = `<path d="M${n(from.x)} ${n(from.y)}L${n(base.x)} ${n(base.y)}" ${inkLine(theme, scale)}/>`;
  const head = `<polygon points="${n(to.x)},${n(to.y)} ${n(left.x)},${n(left.y)} ${n(right.x)},${n(right.y)}" fill="${theme.ink}"/>`;
  return shaft + head;
}

function disc(mark: PlacedMark, theme: MarkTheme): string {
  const at = `cx="${n(mark.center.x)}" cy="${n(mark.center.y)}"`;
  return (
    `<circle ${at} r="${n(mark.radius + mark.ring)}" fill="${theme.ringColor}"/>` +
    `<circle ${at} r="${n(mark.radius)}" fill="${theme.colors[mark.severity]}"/>`
  );
}

/** The outlines of a text, from `left` on the line `baseline`. */
function outlines(text: PlacedText, left: number, baseline: number, fill: string): string {
  return text.glyphs
    .map(
      (glyph) =>
        `<path transform="translate(${n(left + glyph.x)} ${n(baseline)}) scale(${scaleOf(text.scale)})" d="${glyph.d}" fill="${fill}"/>`,
    )
    .join("");
}

function numeral(mark: PlacedMark, theme: MarkTheme, scale: number): string {
  const text = layoutNumeral(
    mark.number,
    theme.numeralSizes[mark.severity] * scale,
    mark.radius * 2 * NUMERAL_SHARE,
  );
  const height = DIGIT_HEIGHT * text.scale;
  return outlines(
    text,
    mark.center.x - text.width / 2,
    mark.center.y + height / 2,
    theme.numeralColor,
  );
}

function legendOf(legend: PlacedLegend, theme: MarkTheme, scale: number): string {
  const { plate } = legend;
  const parts = [
    `<rect x="${n(plate.x)}" y="${n(plate.y)}" width="${n(plate.width)}" height="${n(plate.height)}" rx="${n(theme.legend.plateRadius * scale)}" fill="${theme.legend.plate}" stroke="${theme.legend.plateStroke}" stroke-width="${n(theme.legend.plateStrokeWidth * scale)}"/>`,
  ];
  for (const item of legend.items) {
    parts.push(
      `<circle cx="${n(item.disc.cx)}" cy="${n(item.disc.cy)}" r="${n(item.disc.r)}" fill="${theme.colors[item.severity]}"/>`,
      outlines(item.label, item.labelX, item.labelBaseline, theme.ink),
    );
  }
  return parts.join("");
}

/**
 * The marks as an SVG exactly as big as the image. From the back to the front: the frames of the elements, the arrows,
 * the discs with their rings, the numbers, and the legend of the three sizes if the layout found room for it.
 */
export function renderMarksSvg(
  { marks, legend }: Annotation,
  image: LayoutImage,
  theme: MarkTheme,
): string {
  const s = image.scale;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(image.width)}" height="${n(image.height)}" viewBox="0 0 ${n(image.width)} ${n(image.height)}">`,
    ...marks.map((mark) => brackets(mark, theme, s)),
    ...marks.map((mark) => arrow(mark, theme, s)),
    ...marks.map((mark) => disc(mark, theme)),
    ...marks.map((mark) => numeral(mark, theme, s)),
    legend === null ? "" : legendOf(legend, theme, s),
    "</svg>",
  ].join("");
}
