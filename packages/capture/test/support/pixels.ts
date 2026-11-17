import { readFileSync } from "node:fs";
import type { Browser } from "playwright-core";

/**
 * The colour of some pixels of a PNG file, as "#rrggbb". The browser decodes the picture and a canvas reads it, so
 * the test needs no PNG decoder. Coordinates are in pixels of the picture (device pixels).
 */
export async function colorsAt(
  browser: Browser,
  pngPath: string,
  points: readonly { x: number; y: number }[],
): Promise<string[]> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const base64 = readFileSync(pngPath).toString("base64");
    return await page.evaluate(
      async ({ data, wanted }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const drawing = canvas.getContext("2d");
        if (drawing === null) throw new Error("No canvas");
        drawing.drawImage(image, 0, 0);
        return wanted.map(({ x, y }) => {
          const [r = 0, g = 0, b = 0] = drawing.getImageData(x, y, 1, 1).data;
          return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
        });
      },
      { data: base64, wanted: [...points] },
    );
  } finally {
    await context.close();
  }
}
