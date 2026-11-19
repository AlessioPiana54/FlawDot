import { SEVERITIES, type Severity } from "@flawdot/core-model";
import type { LayoutImage, Rect } from "./geometry.js";
import { DIGIT_HEIGHT, GLYPH_UNITS } from "./glyphs.generated.js";
import { layoutText, type PlacedText } from "./glyphs.js";
import type { MarkTheme } from "./theme.js";

// The legend is the second code of severity: the size of a disc says it, and the label of the legend says it again, so
// that a color is never the only way to tell the three apart (the "Two Codes" rule of DESIGN.md).

export interface LegendItem {
  readonly severity: Severity;
  readonly disc: { readonly cx: number; readonly cy: number; readonly r: number };
  readonly labelX: number;
  /** The line the letters stand on. */
  readonly labelBaseline: number;
  readonly label: PlacedText;
}

export interface PlacedLegend {
  readonly plate: Rect;
  readonly items: readonly LegendItem[];
}

/**
 * Where the legend goes: a plate in the bottom right corner with one disc and one label for each severity. Nothing
 * is drawn if the image is too small to hold it with its margins.
 */
export function measureLegend(image: LayoutImage, theme: MarkTheme): PlacedLegend | null {
  const { legend } = theme;
  const s = image.scale;
  const labels = SEVERITIES.map((severity) => ({
    severity,
    label: layoutText(legend.labels[severity], legend.fontSize * s),
    diameter: legend.discDiameters[severity] * s,
  }));

  const rowHeight = Math.max(...labels.map((item) => item.diameter), legend.fontSize * s);
  const itemsWidth = labels.reduce(
    (sum, item) => sum + item.diameter + legend.labelGap * s + item.label.width,
    0,
  );
  const width = itemsWidth + legend.itemGap * s * (labels.length - 1) + legend.padding * s * 2;
  const height = rowHeight + legend.padding * s * 2;
  const margin = legend.margin * s;
  if (width + margin * 2 > image.width || height + margin * 2 > image.height) return null;

  const plate: Rect = {
    x: image.width - margin - width,
    y: image.height - margin - height,
    width,
    height,
  };
  const cy = plate.y + height / 2;
  const capHeight = (DIGIT_HEIGHT * legend.fontSize * s) / GLYPH_UNITS;
  let pen = plate.x + legend.padding * s;
  const items = labels.map((item): LegendItem => {
    const placed: LegendItem = {
      severity: item.severity,
      disc: { cx: pen + item.diameter / 2, cy, r: item.diameter / 2 },
      labelX: pen + item.diameter + legend.labelGap * s,
      labelBaseline: cy + capHeight / 2,
      label: item.label,
    };
    pen += item.diameter + legend.labelGap * s + item.label.width + legend.itemGap * s;
    return placed;
  });
  return { plate, items };
}
