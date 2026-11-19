import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { differingShare, raw } from "./pixels.js";

const GOLDEN_FOLDER = fileURLToPath(new URL("../golden/", import.meta.url));

/** G1 of CONSTRAINTS.md: at most this share of the pixels may differ from the reference picture. */
export const MAX_DIFFERING_SHARE = 0.001;
/**
 * How much a channel may differ before a pixel counts as different. The edges of a shape are blended slightly
 * differently by the builds of the drawing library of each system; a moved circle differs by far more.
 */
export const CHANNEL_TOLERANCE = 8;

export interface GoldenResult {
  readonly share: number;
  /** Where the picture and a picture of the differences were written, when they differ too much. */
  readonly evidence: string | null;
}

/**
 * Compares a picture with its reference in test/golden/. With UPDATE_GOLDEN=1 the reference is written instead:
 * look at it before keeping it.
 */
export async function compareGolden(name: string, actual: Buffer): Promise<GoldenResult> {
  const file = join(GOLDEN_FOLDER, `${name}.png`);
  if (process.env["UPDATE_GOLDEN"] === "1") {
    await mkdir(GOLDEN_FOLDER, { recursive: true });
    await writeFile(file, actual);
    return { share: 0, evidence: null };
  }
  const reference = await readFile(file);
  const a = await raw(actual);
  const b = await raw(reference);
  const share = differingShare(a, b, CHANNEL_TOLERANCE);
  if (share <= MAX_DIFFERING_SHARE) return { share, evidence: null };

  const folder = await mkdtemp(join(tmpdir(), "flawdot-golden-"));
  await writeFile(join(folder, `${name}.actual.png`), actual);
  if (a.width === b.width && a.height === b.height) {
    const marks = Buffer.alloc(a.data.length);
    for (let at = 0; at < a.data.length; at += 4) {
      const different = [0, 1, 2, 3].some(
        (channel) =>
          Math.abs((a.data[at + channel] ?? 0) - (b.data[at + channel] ?? 0)) > CHANNEL_TOLERANCE,
      );
      marks[at] = different ? 255 : 255 - Math.floor((a.data[at] ?? 0) / 8);
      marks[at + 1] = different ? 0 : 255 - Math.floor((a.data[at + 1] ?? 0) / 8);
      marks[at + 2] = different ? 0 : 255 - Math.floor((a.data[at + 2] ?? 0) / 8);
      marks[at + 3] = 255;
    }
    await sharp(marks, { raw: { width: a.width, height: a.height, channels: 4 } })
      .png()
      .toFile(join(folder, `${name}.diff.png`));
  }
  return { share, evidence: folder };
}
