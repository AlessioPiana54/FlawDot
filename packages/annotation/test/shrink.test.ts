import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlawDotError } from "@flawdot/core-model";
import { shrinkPng } from "../src/shrink.js";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "flawdot-shrink-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

async function solid(name: string, width: number, height: number): Promise<string> {
  const path = join(folder, name);
  await sharp({ create: { width, height, channels: 3, background: "#336699" } })
    .png()
    .toFile(path);
  return path;
}

async function noise(name: string, width: number, height: number): Promise<string> {
  const path = join(folder, name);
  await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .png()
    .toFile(path);
  return path;
}

const failure = async (run: () => Promise<unknown>): Promise<FlawDotError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof FlawDotError) return error;
    throw error;
  }
  throw new Error("expected a FlawDotError");
};

describe("shrinkPng: a picture that fits in a message to Claude", () => {
  it("brings the long edge of a wide picture to 1568 px and keeps the proportions", async () => {
    const path = await solid("wide.png", 3000, 2000);

    const result = await shrinkPng(path);

    expect(result.width).toBe(1568);
    expect(result.height).toBe(1045);
    expect(result.resized).toBe(true);
    expect(await sharp(result.data).metadata()).toMatchObject({ format: "png", width: 1568 });
  });

  it("brings the height of a tall page to 1568 px, which makes it narrow", async () => {
    const path = await solid("tall.png", 1440, 9000);

    const result = await shrinkPng(path);

    expect(result.height).toBe(1568);
    expect(result.width).toBe(251);
  });

  it("gives back a small picture byte for byte: it is never made bigger or redrawn", async () => {
    const path = await solid("small.png", 400, 300);

    const result = await shrinkPng(path);

    expect(result.resized).toBe(false);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    expect(result.data.equals(readFileSync(path))).toBe(true);
  });

  it("follows the limit it is given", async () => {
    const path = await solid("wide.png", 3000, 2000);

    const result = await shrinkPng(path, { maxEdge: 800 });

    expect(result.width).toBe(800);
  });

  it("makes a picture that is too heavy lighter: fewer colors first, then fewer pixels", async () => {
    const path = await noise("noise.png", 200, 200);
    expect(readFileSync(path).length).toBeGreaterThan(30_000);

    const result = await shrinkPng(path, { maxBytes: 30_000 });

    expect(result.data.length).toBeLessThanOrEqual(30_000);
    expect(result.resized).toBe(true);
    expect(await sharp(result.data).metadata()).toMatchObject({ format: "png" });
  });

  it("keeps every pixel when fewer colors are enough: it takes pixels away only after that", async () => {
    // A gradient with a little noise: thousands of colors that are close to each other, as in a photograph.
    const path = join(folder, "gradient.png");
    const [width, height] = [300, 300];
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 3;
        const noise = (): number => Math.floor(Math.random() * 7) - 3;
        raw[at] = Math.max(0, Math.min(255, Math.floor((x * 255) / width) + noise()));
        raw[at + 1] = Math.max(0, Math.min(255, Math.floor((y * 255) / height) + noise()));
        raw[at + 2] = 128 + noise();
      }
    }
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(path);
    expect(readFileSync(path).length).toBeGreaterThan(100_000);

    const result = await shrinkPng(path, { maxBytes: 100_000 });

    expect(result.data.length).toBeLessThanOrEqual(100_000);
    expect(result.width).toBe(300);
    expect(result.height).toBe(300);
    expect(result.resized).toBe(true);
  });

  it("refuses, as INTERNAL, a picture that cannot be made light enough", async () => {
    const path = await noise("noise.png", 100, 100);

    const error = await failure(() => shrinkPng(path, { maxBytes: 500 }));

    expect(error.code).toBe("INTERNAL");
    expect(error.message).toContain("too large");
    expect(error.message).not.toContain(folder);
  });

  it("says INTERNAL for a file that is missing, naming the file and not the folder", async () => {
    const path = join(folder, "missing.png");

    const error = await failure(() => shrinkPng(path));

    expect(error.code).toBe("INTERNAL");
    expect(error.message).toContain("missing.png");
    expect(error.message).not.toContain(folder);
  });

  it("says INTERNAL for a file that is not a picture", async () => {
    const path = join(folder, "text.png");
    writeFileSync(path, "this is not a picture");

    const error = await failure(() => shrinkPng(path));

    expect(error.code).toBe("INTERNAL");
    expect(error.message).not.toContain(folder);
  });
});
