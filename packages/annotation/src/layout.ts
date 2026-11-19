import type { Finding, Severity } from "@flawdot/core-model";
import {
  distanceToRect,
  distanceToSegment,
  type LayoutImage,
  type Point,
  type Rect,
} from "./geometry.js";
import { measureLegend, type PlacedLegend } from "./legend.js";
import { DEFAULT_THEME, type MarkTheme } from "./theme.js";

// Where each circle goes. The rule of DESIGN.md is that an arrow is straight and runs at 45 degrees or at 90 degrees, so
// a circle is never nudged sideways to fit: it is put on one of a few straight lines that end at a corner of the frame
// of the element, and moved only along that line. Everything here is pure: no file, no image, no clock.

export type Direction = "nw" | "ne" | "sw" | "se" | "n" | "inside";

export interface Arrow {
  /** On the edge of the circle, where the shaft starts. */
  readonly from: Point;
  /** The tip, a few pixels before the corner of the frame. */
  readonly to: Point;
  /** The unit vector from the circle to the corner: (±0.707, ±0.707), or straight down. */
  readonly ux: number;
  readonly uy: number;
}

export interface PlacedMark {
  readonly number: number;
  readonly severity: Severity;
  readonly direction: Direction;
  /** The middle of the disc, in pixels of the image. */
  readonly center: Point;
  /** The radius of the colored disc; the white ring is outside it. */
  readonly radius: number;
  readonly ring: number;
  /** The frame of the element: its box in the image, a few pixels bigger. */
  readonly bracket: Rect;
  /** Length of each arm of a corner of the frame. */
  readonly arm: number;
  readonly arrow: Arrow | null;
}

export interface Annotation {
  readonly marks: PlacedMark[];
  /** Null when there is no circle to explain, or the image has no room for it. */
  readonly legend: PlacedLegend | null;
}

/** A line along which a circle can sit: its middle is `k` pixels from the target on each axis, in the direction (dx, dy). */
interface Candidate {
  readonly direction: Exclude<Direction, "inside">;
  readonly dx: number;
  readonly dy: number;
  /** The distance from the target to the middle of the circle, for each pixel of `k`. */
  readonly length: number;
}

const candidate = (direction: Candidate["direction"], dx: number, dy: number): Candidate => ({
  direction,
  dx,
  dy,
  length: Math.hypot(dx, dy),
});

// The order is the order of preference: the top left as in the prototype, then the other diagonals, then straight above.
// The bottom right is last: it puts the circle on top of the content that follows the element, but it is the only way
// for an element in the top left corner of a page (a logo, for example).
const CANDIDATES: readonly Candidate[] = [
  candidate("nw", -1, -1),
  candidate("ne", 1, -1),
  candidate("sw", -1, 1),
  candidate("n", 0, -1),
  candidate("se", 1, 1),
];

/** How far from the left of the element the arrow of a circle straight above it lands, in CSS pixels. */
const ABOVE_INSET = 22;

/** One finding to draw: the part of its element that is in the image, and the frame around it. */
interface Prepared {
  readonly number: number;
  readonly severity: Severity;
  readonly id: string;
  readonly clipped: Rect;
  readonly bracket: Rect;
}

/** The sizes of one circle, in pixels of the image. */
interface Size {
  readonly radius: number;
  readonly ring: number;
  /** From the middle to the outside of the ring. */
  readonly reach: number;
  /** The nearest the middle may come to a side of the image. */
  readonly edge: number;
  readonly gap: number;
  readonly step: number;
  /** How far before the corner the tip of the arrow stops. */
  readonly tipGap: number;
}

/** A line, with the range of `k` where the circle fits in the image and leaves an arrow that can be seen. */
interface Option {
  readonly candidate: Candidate;
  readonly target: Point;
  readonly low: number;
  readonly high: number;
  /** The usual offset, brought into the range. */
  readonly start: number;
}

interface Placement {
  readonly center: Point;
  readonly arrow: Arrow | null;
  readonly direction: Direction;
}

/** The part of the element that is in the image, and its frame; null when the finding has no circle to draw. */
function prepare(finding: Finding, image: LayoutImage, theme: MarkTheme): Prepared | null {
  if (finding.location.kind !== "element" || finding.number === null) return null;
  const { x, y, width, height } = finding.location.box;
  const s = image.scale;

  const left = Math.max(x * s, 0);
  const top = Math.max(y * s, 0);
  const right = Math.min((x + width) * s, image.width);
  const bottom = Math.min((y + height) * s, image.height);
  if (right < left || bottom < top) return null;

  const pad = theme.bracketPad * s;
  const frameLeft = Math.max(left - pad, 0);
  const frameTop = Math.max(top - pad, 0);
  return {
    number: finding.number,
    severity: finding.severity,
    id: finding.id,
    clipped: { x: left, y: top, width: right - left, height: bottom - top },
    bracket: {
      x: frameLeft,
      y: frameTop,
      width: Math.min(right + pad, image.width) - frameLeft,
      height: Math.min(bottom + pad, image.height) - frameTop,
    },
  };
}

const byNumber = (a: Prepared, b: Prepared): number =>
  a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function sizeOf(severity: Severity, image: LayoutImage, theme: MarkTheme): Size {
  const s = image.scale;
  const radius = (theme.diameters[severity] * s) / 2;
  const ring = theme.ringWidth * s;
  const reach = radius + ring;
  return {
    radius,
    ring,
    reach,
    edge: reach + s,
    gap: theme.gap * s,
    step: theme.slideStep * s,
    tipGap: theme.tipGap * s,
  };
}

/** The corner (or the point on the top edge) that the arrow of this direction ends at. */
function targetOf(line: Candidate, item: Prepared, scale: number): Point {
  const { bracket, clipped } = item;
  if (line.direction === "n") {
    return { x: clipped.x + Math.min(ABOVE_INSET * scale, clipped.width / 2), y: bracket.y };
  }
  return {
    x: line.dx < 0 ? bracket.x : bracket.x + bracket.width,
    y: line.dy < 0 ? bracket.y : bracket.y + bracket.height,
  };
}

/** The largest k for which the middle of the circle stays at least `edge` from every side of the image. */
function largestK(line: Candidate, target: Point, image: LayoutImage, edge: number): number {
  const along = (dir: number, at: number, size: number): number => {
    if (dir === 0) return at >= edge && at <= size - edge ? Infinity : -Infinity;
    return dir < 0 ? at - edge : size - edge - at;
  };
  return Math.min(along(line.dx, target.x, image.width), along(line.dy, target.y, image.height));
}

/** The lines that can hold this circle at all, with the range of k of each. */
function optionsFor(item: Prepared, size: Size, image: LayoutImage, theme: MarkTheme): Option[] {
  const s = image.scale;
  return CANDIDATES.flatMap((line) => {
    const target = targetOf(line, item, s);
    // The arrow must show at least `minArrow` outside the ring, with the gap before the corner.
    const low = (size.reach + (theme.minArrow + theme.tipGap) * s) / line.length;
    const high = Math.min(largestK(line, target, image, size.edge), theme.maxSlide * s);
    if (high < low) return [];
    const start = Math.min(Math.max(theme.offset * s, low), high);
    return [{ candidate: line, target, low, high, start }];
  });
}

function placementAt(option: Option, k: number, size: Size): Placement {
  const { candidate: line, target } = option;
  const center = { x: target.x + k * line.dx, y: target.y + k * line.dy };
  const ux = -line.dx / line.length;
  const uy = -line.dy / line.length;
  return {
    center,
    direction: line.direction,
    arrow: {
      from: { x: center.x + ux * size.reach, y: center.y + uy * size.reach },
      to: { x: target.x - ux * size.tipGap, y: target.y - uy * size.tipGap },
      ux,
      uy,
    },
  };
}

/** Whether a circle at `center`, with this arrow, touches the legend, another circle or another arrow. */
function collides(
  placed: readonly PlacedMark[],
  legend: PlacedLegend | null,
  size: Size,
  center: Point,
  arrow: Arrow | null,
): boolean {
  const { reach, gap } = size;
  if (legend !== null && distanceToRect(center, legend.plate) < reach + gap) return true;
  return placed.some((other) => {
    const otherReach = other.radius + other.ring;
    if (
      Math.hypot(center.x - other.center.x, center.y - other.center.y) <
      reach + otherReach + gap
    ) {
      return true;
    }
    if (
      other.arrow !== null &&
      distanceToSegment(center, other.arrow.from, other.arrow.to) < reach + gap
    ) {
      return true;
    }
    return (
      arrow !== null && distanceToSegment(other.center, arrow.from, arrow.to) < otherReach + gap
    );
  });
}

/**
 * The first place that is free. It tries every line at the usual offset; then every line one step further from the
 * element, and one step nearer; then two steps; and so on, so a small move on a line of lower preference comes before a
 * long move on the preferred one. Each line stays in its own range of k.
 */
function search(
  options: readonly Option[],
  size: Size,
  theme: MarkTheme,
  isFree: (placement: Placement) => boolean,
): Placement | null {
  const rounds = Math.ceil(theme.maxSlide / theme.slideStep) + 1;
  const tryAt = (offsetOf: (option: Option) => number): Placement | null => {
    for (const option of options) {
      const k = offsetOf(option);
      if (k < option.low || k > option.high) continue;
      const found = placementAt(option, k, size);
      if (isFree(found)) return found;
    }
    return null;
  };

  for (let round = 0; round <= rounds; round++) {
    const outward = tryAt((option) => option.start + round * size.step);
    if (outward !== null) return outward;
    const inward = round > 0 ? tryAt((option) => option.start - round * size.step) : null;
    if (inward !== null) return inward;
  }
  return null;
}

/**
 * Where a circle goes when nothing is free: on the first line that fits, at the usual offset, touching what it touches.
 * When no line fits at all (the element is as big as the picture) it goes inside the element, with no arrow.
 */
function forcedPlacement(
  options: readonly Option[],
  item: Prepared,
  size: Size,
  image: LayoutImage,
): Placement {
  const first = options[0];
  if (first !== undefined) return placementAt(first, first.start, size);
  const s = image.scale;
  const clamp = (value: number, high: number): number =>
    Math.min(Math.max(value, size.edge), high - size.edge);
  return {
    direction: "inside",
    arrow: null,
    center: {
      x: clamp(item.clipped.x + size.reach + 2 * s, image.width),
      y: clamp(item.clipped.y + size.reach + 2 * s, image.height),
    },
  };
}

/**
 * The circles of the findings, and the legend. Only findings with an element and a number are drawn, in the order of
 * their numbers, so a circle that is placed never moves because of one that comes after it. Each circle starts at the
 * corner of the frame of its element, at the offset of the theme, on the first line that fits in the image; if another
 * circle, an arrow or the legend is in the way it is moved along its line (see `search`). Only when nothing is free does
 * it go where it fits and overlap; only when it fits nowhere does it go inside the element, with no arrow.
 */
export function layoutAnnotation(
  findings: readonly Finding[],
  image: LayoutImage,
  theme: MarkTheme = DEFAULT_THEME,
): Annotation {
  const items = findings.flatMap((finding) => prepare(finding, image, theme) ?? []).sort(byNumber);
  if (items.length === 0) return { marks: [], legend: null };

  const legend = measureLegend(image, theme);
  const marks: PlacedMark[] = [];
  for (const item of items) {
    const size = sizeOf(item.severity, image, theme);
    const options = optionsFor(item, size, image, theme);
    const chosen =
      search(
        options,
        size,
        theme,
        (found) => !collides(marks, legend, size, found.center, found.arrow),
      ) ?? forcedPlacement(options, item, size, image);
    marks.push({
      number: item.number,
      severity: item.severity,
      direction: chosen.direction,
      center: chosen.center,
      radius: size.radius,
      ring: size.ring,
      bracket: item.bracket,
      arm: Math.min(
        theme.bracketArm * image.scale,
        item.bracket.width / 2,
        item.bracket.height / 2,
      ),
      arrow: chosen.arrow,
    });
  }
  return { marks, legend };
}

/** The circles of `layoutAnnotation`, without the legend. */
export function layoutMarks(
  findings: readonly Finding[],
  image: LayoutImage,
  theme: MarkTheme = DEFAULT_THEME,
): PlacedMark[] {
  return layoutAnnotation(findings, image, theme).marks;
}
