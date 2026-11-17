import { describe, expect, it } from "vitest";
import { pngSize } from "../src/png.js";
import { thrownBy } from "./support/fakes.js";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The first bytes of a PNG: the signature and the IHDR chunk, which starts with the size. */
function header(width: number, height: number, signature: readonly number[] = SIGNATURE): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from(signature).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); // length of the IHDR data
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("pngSize", () => {
  it("reads the width and the height from the header", () => {
    expect(pngSize(header(1440, 2400))).toEqual({ width: 1440, height: 2400 });
  });

  it("reads a size that does not fit in 16 bits", () => {
    expect(pngSize(header(70_000, 100_000))).toEqual({ width: 70_000, height: 100_000 });
  });

  it.each([
    ["a buffer that is too short", Buffer.alloc(10)],
    ["an empty buffer", Buffer.alloc(0)],
    ["something that is not a PNG", header(1, 1, [1, 2, 3, 4, 5, 6, 7, 8])],
    [
      "a first chunk that is not IHDR",
      (() => {
        const bytes = header(1, 1);
        bytes.write("IDAT", 12, "ascii");
        return bytes;
      })(),
    ],
    ["a width of zero", header(0, 5)],
    ["a height of zero", header(5, 0)],
  ])("refuses %s", (_why, bytes) => {
    expect(thrownBy(() => pngSize(bytes))).toMatchObject({ code: "INTERNAL" });
  });
});
