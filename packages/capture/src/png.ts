import { FlawDotError } from "@flawdot/core-model";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52]; // "IHDR": the first chunk of every PNG, and the one that holds the size
const HEADER_LENGTH = 24;

/**
 * The size in pixels of a PNG, read from its header. The screenshot is written by the browser and its real size
 * is what the capture records (it is the CSS size times the pixel ratio), so it is measured and not computed.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const matches = (expected: readonly number[], offset: number): boolean =>
    expected.every((value, index) => bytes[offset + index] === value);
  if (bytes.length < HEADER_LENGTH || !matches(SIGNATURE, 0) || !matches(IHDR, 12)) {
    throw new FlawDotError("INTERNAL", "The screenshot is not a valid PNG file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) {
    throw new FlawDotError("INTERNAL", "The screenshot has no size.");
  }
  return { width, height };
}
