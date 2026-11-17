# @flawdot/capture

The capture half of FlawDot's `url` input. It opens a page in Chromium, measures it and photographs it, and returns a
`Capture` of [`@flawdot/core-model`](../core-model/README.md): a full-page screenshot, and the elements of the page with
a number each (the "set-of-marks"), their box, tag, role, accessible name and a CSS selector that finds exactly that
element. It is a private workspace package.

It depends on `@flawdot/core-model` and `playwright-core`, and on nothing else of FlawDot. The kernel reaches it only
through the `InputPlugin` interface, so no other package imports Playwright.

## How a capture goes

1. A browser context is opened for the capture (the browser itself belongs to the `BrowserProvider` the caller passes in).
2. The page is loaded, with a time limit. Animations are stopped, fonts are awaited (for a short time at most) and the
   page is scrolled back to the top.
3. A script that runs inside the page reports which elements are there and where. **It only reports facts.**
4. Everything that is a decision happens in Node, in `src/set-of-marks.ts`: which elements are kept when there are
   too many, in what order they are numbered (top to bottom, left to right) and what number each gets.
5. The page is photographed and the result is checked against the `Capture` schema.

A capture never fills a form, clicks, or leaves the page. It always closes its browser context, and it stops when the
caller aborts. The page is treated as hostile: what its script returns is validated and bounded in `src/raw.ts`, and
an error message names only the origin of the page, never its path or query string.

## Boxes

Boxes are in CSS pixels, measured from the top-left of the **whole page**, not of the window. The screenshot is
`width × deviceScaleFactor` wide, so a box is multiplied by the pixel ratio to find its place in the picture. A test
reads the real pixels of a screenshot at 1× and 2× to check that each element is where its box says, including a
fixed bar at the bottom of the page.

## Working on it

The tests drive a real Chromium. Install it once, from the repository root:

```bash
pnpm browsers
```

Then `pnpm check:task` runs them with everything else (about 12 seconds), and
`pnpm --filter @flawdot/capture test:browser` runs only the ones that use the browser.

The fixture pages are in `test/fixtures/site/` and are served on `127.0.0.1`. Every box in them is written in pixels,
so what the tests expect does not depend on fonts or on the system.

The code that runs inside the page is in `src/in-page/`. Playwright sends its source text to the browser, so it cannot
use anything from outside its own body, and Node's coverage cannot see it: the tests of the browser exercise it, and
`docs/CONSTRAINTS.md` records this as an approved exception.
