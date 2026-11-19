import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, parse, resolve } from "node:path";
import sharp from "sharp";
import {
  FlawDotError,
  isFlawDotError,
  type Annotator,
  type ArtifactStore,
  type Capture,
} from "@flawdot/core-model";
import { layoutAnnotation } from "./layout.js";
import { renderMarksSvg } from "./svg.js";
import { DEFAULT_THEME, type MarkTheme } from "./theme.js";

export interface SharpAnnotatorDeps {
  readonly artifacts: ArtifactStore;
  readonly theme?: MarkTheme;
}

// A screenshot of a very tall page at a pixel ratio of 2 is about 90 million pixels: well under this limit of sharp,
// which is there so that a file that claims to be enormous is refused.
const MAX_INPUT_PIXELS = 268_435_456;

/**
 * Draws the circles, arrows and frames of the findings on the clean screenshot of a capture and writes the result as a
 * new file of kind "annotated" (the screenshot itself is never touched). The caller gives only the findings that are
 * to be seen: ignored ones are left out before this point, and the numbers are the ones of that visible set.
 * Findings of another page or viewport, of the whole page, or with no number are skipped.
 */
export function createSharpAnnotator(deps: SharpAnnotatorDeps): Annotator {
  const theme = deps.theme ?? DEFAULT_THEME;

  return {
    async annotate(capture: Capture, findings) {
      const source = capture.screenshot.path;
      const unreadable = (cause: unknown): FlawDotError =>
        new FlawDotError("INTERNAL", `Could not read the screenshot ${basename(source)}.`, {
          cause,
        });

      let width: number;
      let height: number;
      try {
        const metadata = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
        width = metadata.width;
        height = metadata.height;
      } catch (error) {
        throw unreadable(error);
      }
      if (width !== capture.screenshot.width || height !== capture.screenshot.height) {
        throw new FlawDotError(
          "INTERNAL",
          `The screenshot ${basename(source)} is not the size that the capture recorded.`,
        );
      }

      const image = { width, height, scale: width / capture.viewport.width };
      const visible = findings.filter(
        (finding) =>
          finding.pageUrl === capture.page.url && finding.viewport === capture.viewport.name,
      );
      const svg = renderMarksSvg(layoutAnnotation(visible, image, theme), image, theme);

      const out = deps.artifacts.pathFor(capture.runId, "annotated", parse(source).name);
      if (resolve(out) === resolve(source)) {
        throw new FlawDotError("INTERNAL", "The annotated picture would overwrite the screenshot.");
      }

      let bytes: Buffer;
      try {
        bytes = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
          .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch (error) {
        throw isFlawDotError(error) ? error : unreadable(error);
      }
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, bytes);
      return { path: out };
    },
  };
}
