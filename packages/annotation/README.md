# @flawdot/annotation

The picture half of a report: it draws the numbered circles, the corner brackets and the arrows of the findings on the
screenshot of a capture, and writes the result as a new PNG. It is a private workspace package.

It depends on `@flawdot/core-model` and `sharp` (pinned to 0.35.5), and on nothing else of FlawDot. The kernel reaches it
only through the `Annotator` port of core-model.

## How a picture is made

1. `createSharpAnnotator({ artifacts }).annotate(capture, findings)` keeps the findings of this page and viewport that
   have an element and a circle number. The caller gives only the findings that are to be seen: ignored ones are left out
   before, and the numbers are the ones of that visible set (`numberFindings` in core-model).
2. `layoutMarks` (pure) decides where each circle goes. **The rule is the one of DESIGN.md: an arrow is straight and runs
   at 45 or 90 degrees.** A circle starts 50 CSS pixels from a corner of the frame of its element, along a diagonal, and
   is never nudged sideways: if it does not fit, another line is tried (top left, top right, bottom left, straight above,
   bottom right), and a circle that meets another circle, an arrow or the legend is moved along its own line, away from the
   element and then toward it. Circles are placed in the order of their numbers, so one that is placed never moves because
   of one that comes after it. Only when nothing is free does a circle go where it fits and overlap; only when no line
   fits at all (an element as big as the picture) does it go inside the element, with no arrow.
3. `renderMarksSvg` (pure) writes the picture as an SVG exactly as big as the screenshot, from the back to the front: frames,
   arrows, discs with a white ring, numbers, legend. It is made only of paths, circles and rectangles. **There is no font,
   no `<text>`, no marker and no filter**, so Windows, macOS and Linux draw the same thing.
4. `sharp` lays the SVG over the clean screenshot and the result is written as the file of kind `annotated`, with the same
   base name as the screenshot. The screenshot itself is never changed, and `marked` (the picture with the numbers of the
   set-of-marks) is never used.

Sizes are in CSS pixels and are multiplied by `screenshot.width / viewport.width`, so a capture at a pixel ratio of 2 gets
marks twice as big in the file: they take the same share of the picture. The numbers inside the circles are drawn
from outlines of Atkinson Hyperlegible Bold, each digit in a cell of the same width; a number wider than its disc is
made smaller. The legend (the second code of severity, next to the size of the disc) is in the bottom right corner and
is left out when there is no circle or the picture is too small.

Boxes that are not tidy are handled: an element partly outside the picture is framed where it is in the picture, an
element wholly outside gets no circle, and an element with no size is framed as a small square.

## The outlines

`src/glyphs.generated.ts` is made by `scripts/extract-glyphs.mjs` from `files/atkinson-hyperlegible-latin-700-normal.woff`
of the npm package `@fontsource/atkinson-hyperlegible` 5.3.0 (the script checks the sha256 of the font). The font is under
the SIL Open Font License 1.1: its text is in `assets/OFL.txt`, and the notice is in the header of the generated file.
The font file is not in this repository. To make the file again:

```bash
# in an empty folder: npm pack @fontsource/atkinson-hyperlegible@5.3.0, extract it; in another: npm install opentype.js@2.0.0
node packages/annotation/scripts/extract-glyphs.mjs <font.woff> <folder that has node_modules/opentype.js>
```

## Working on it

`pnpm --filter @flawdot/annotation test` runs everything; no browser is needed. `pnpm check:task` runs it with the rest.

The pictures in `test/golden/` are the references of G1: at most 0.1% of the pixels may differ by more than 8 in a channel
(the edges of a shape are blended a little differently by each build of the drawing library). They are made from a flat
backdrop drawn in the tests, not from a browser. To make them again, run the tests with `UPDATE_GOLDEN=1` and **look at every
picture before keeping it**. When a golden test fails, it writes the picture and a picture of the differences to a
temporary folder and says where.

`pnpm bench` also runs B4: a page of 1440 x 6000 pixels with 60 findings takes about 120 ms (warning above 700 ms, failure
above 1000 ms).

## Known limits

- The legend sits in the bottom right corner, so an element there can be under it. The layout keeps circles off the legend,
  not the elements.
- On a page with very many findings in a small area, circles can overlap when no free place is left; the arrows stay at 45
  or 90 degrees.
- The legend is in English; the labels are outlines of a few letters.
- A finding in a shadow root or an iframe is drawn on the box that the capture measured for it (the host, or the iframe).
