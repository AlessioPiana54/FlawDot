import sharp from "sharp";

export interface Raw {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

/** The pixels of a PNG, 4 bytes each (red, green, blue, alpha), row after row. */
export async function raw(png: string | Buffer): Promise<Raw> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

export function pixelAt(image: Raw, x: number, y: number): Rgba {
  const at = (Math.round(y) * image.width + Math.round(x)) * 4;
  return [
    image.data[at] ?? -1,
    image.data[at + 1] ?? -1,
    image.data[at + 2] ?? -1,
    image.data[at + 3] ?? -1,
  ];
}

/** Whether a pixel is the color, give or take `tolerance` in each channel (the edge of a shape is blended). */
export function isColor(pixel: Rgba, hex: string, tolerance = 3): boolean {
  const wanted = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return wanted.every((value, channel) => Math.abs((pixel[channel] ?? -999) - value) <= tolerance);
}

/** The share of pixels where some channel differs by more than `tolerance`. Pictures of different sizes: 1. */
export function differingShare(a: Raw, b: Raw, tolerance = 2): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let different = 0;
  for (let at = 0; at < a.data.length; at += 4) {
    for (let channel = 0; channel < 4; channel++) {
      if (Math.abs((a.data[at + channel] ?? 0) - (b.data[at + channel] ?? 0)) > tolerance) {
        different++;
        break;
      }
    }
  }
  return different / (a.width * a.height);
}
