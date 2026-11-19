import type { Severity } from "@flawdot/core-model";

/**
 * How the marks look. Every length is in CSS pixels and is multiplied by the scale of the image (a screenshot at a
 * pixel ratio of 2 gets marks twice as big in the file, so they take the same share of the picture). The values are the
 * ones of the "Severity marks" and "Pointer and brackets" parts of DESIGN.md, kept here as a tracked constant because
 * DESIGN.md is not in the repository. Changing a size or a color changes the PNG, the PDF and the report: ask first.
 */
export interface MarkTheme {
  /** Diameter of the disc of a circle, by severity. The size is the first code of severity; the legend is the second. */
  readonly diameters: Readonly<Record<Severity, number>>;
  /** Height of the font of the number inside the disc, by severity. */
  readonly numeralSizes: Readonly<Record<Severity, number>>;
  /** The three inks of severity. They mean severity and nothing else. */
  readonly colors: Readonly<Record<Severity, string>>;
  /** Arrows, brackets and the text of the legend. */
  readonly ink: string;
  readonly numeralColor: string;
  readonly ringColor: string;
  /** The white ring around a disc, so that it reads on any screenshot. */
  readonly ringWidth: number;
  /** How far the middle of the disc starts from the corner of the element, on each axis (so about 1.4 times that along a diagonal). */
  readonly offset: number;
  readonly bracketPad: number;
  readonly bracketArm: number;
  readonly strokeWidth: number;
  readonly arrowHead: { readonly length: number; readonly halfWidth: number };
  /** The arrow must show at least this much outside the disc, tip gap included. */
  readonly minArrow: number;
  /** The arrow stops this far before the corner of the bracket. */
  readonly tipGap: number;
  /** Clear space between two discs, and between a disc and an arrow. */
  readonly gap: number;
  /** How far a disc is moved along its line, on each axis, to avoid another one. */
  readonly slideStep: number;
  readonly maxSlide: number;
  readonly legend: {
    readonly discDiameters: Readonly<Record<Severity, number>>;
    readonly labelGap: number;
    readonly plateRadius: number;
    readonly plateStrokeWidth: number;
    readonly fontSize: number;
    readonly margin: number;
    readonly padding: number;
    readonly itemGap: number;
    readonly plate: string;
    readonly plateStroke: string;
    readonly labels: Readonly<Record<Severity, string>>;
  };
}

export const DEFAULT_THEME: MarkTheme = Object.freeze({
  diameters: { critical: 34, medium: 28, low: 22 },
  numeralSizes: { critical: 16, medium: 14, low: 12 },
  colors: { critical: "#c8331f", medium: "#9a5d00", low: "#3a74a8" },
  ink: "#17201b",
  numeralColor: "#ffffff",
  ringColor: "#ffffff",
  ringWidth: 2,
  offset: 50,
  bracketPad: 5,
  bracketArm: 12,
  strokeWidth: 1.6,
  arrowHead: { length: 10, halfWidth: 5 },
  minArrow: 14,
  tipGap: 3,
  gap: 2,
  slideStep: 6,
  maxSlide: 150,
  legend: {
    discDiameters: { critical: 17, medium: 14, low: 11 },
    labelGap: 6,
    plateRadius: 4,
    plateStrokeWidth: 1,
    fontSize: 13,
    margin: 12,
    padding: 8,
    itemGap: 14,
    plate: "#ffffff",
    plateStroke: "#cfd8d2",
    labels: { critical: "Critical", medium: "Medium", low: "Low" },
  },
});
