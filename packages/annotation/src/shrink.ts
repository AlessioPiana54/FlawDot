import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import sharp from "sharp";
import { FlawDotError } from "@flawdot/core-model";

/** Claude takes at most about 1568 px on the long edge of a picture and shrinks the rest itself. */
const SHRINK_MAX_EDGE = 1568;
/** About 1 MB once written as base64, which is what goes into a message. */
const SHRINK_MAX_BYTES = 750_000;

export interface ShrinkLimits {
  readonly maxEdge?: number;
  readonly maxBytes?: number;
}

export interface ShrunkPng {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  /** False when the file is given back as it is. */
  readonly resized: boolean;
}

// Same limit as the annotator: it is there so that a file that claims to be enormous is refused.
const MAX_INPUT_PIXELS = 268_435_456;
// Each step takes a quarter off the long edge, so the weight falls by about the half.
const MAX_STEPS = 4;
const STEP = 0.75;

/**
 * A copy of a PNG that fits in a message: the long edge at `maxEdge` (never enlarged) and the weight at `maxBytes`. A
 * picture that already fits is given back byte for byte. One that is too heavy loses colors first (a palette), then
 * pixels, a quarter of the long edge at a time. The file is never touched. A file that is missing, is not a picture or
 * cannot be made light enough is INTERNAL, naming the file and not the folder.
 */
export async function shrinkPng(path: string, limits: ShrinkLimits = {}): Promise<ShrunkPng> {
  const maxEdge = limits.maxEdge ?? SHRINK_MAX_EDGE;
  const maxBytes = limits.maxBytes ?? SHRINK_MAX_BYTES;

  try {
    const original = await readFile(path);
    const { width, height } = await sharp(original, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    if (Math.max(width, height) <= maxEdge && original.length <= maxBytes) {
      return { data: original, width, height, resized: false };
    }

    const render = async (edge: number, palette: boolean): Promise<ShrunkPng> => {
      const { data, info } = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
        .resize({ width: edge, height: edge, fit: "inside" })
        .png(
          palette ? { palette: true, quality: 80, compressionLevel: 9 } : { compressionLevel: 9 },
        )
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height, resized: true };
    };

    let edge = Math.min(maxEdge, Math.max(width, height));
    for (let step = 0; step < MAX_STEPS; step += 1) {
      for (const palette of [false, true]) {
        const attempt = await render(edge, palette);
        if (attempt.data.length <= maxBytes) return attempt;
      }
      edge = Math.floor(edge * STEP);
    }
  } catch (error) {
    throw new FlawDotError("INTERNAL", `Could not read the picture ${basename(path)}.`, {
      cause: error,
    });
  }
  throw new FlawDotError("INTERNAL", `The picture ${basename(path)} is too large to send.`);
}
