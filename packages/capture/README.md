# @flawdot/capture

The capture half of FlawDot's `url` input. It opens a page in Chromium, measures it and photographs it, and returns a
`Capture` of [`@flawdot/core-model`](../core-model/README.md): a full-page screenshot, a second screenshot with the
numbered marks drawn on it, and the elements of the page with a number each (the "set-of-marks"), their box, tag, role,
accessible name and a CSS selector that finds exactly that element. It is a private workspace package.

It depends on `@flawdot/core-model` and `playwright-core`, and on nothing else of FlawDot. The kernel reaches it only
through the `InputPlugin` interface, so no other package imports Playwright.

## How a capture goes

1. A browser context is opened for the capture (the browser itself belongs to the `BrowserProvider` the caller passes
   in). The three viewports are 1440×900 (desktop), 768×1024 (tablet) and 390×844 (mobile); only the mobile one is
   a phone (`isMobile`, touch), so a page without a `<meta viewport>` is laid out at 980 px there, as on a real phone.
2. The page is loaded, with a time limit. **Where the navigation ends is checked** (see below).
3. The page is stabilized: animations stop, fonts are awaited, consent banners are hidden (never clicked), and the page
   is scrolled back to the top. The arrival is checked again, for single-page apps that move after loading.
4. A script that runs inside the page reports which elements are there and where. **It only reports facts.**
5. Everything that is a decision happens in Node, in `src/set-of-marks.ts`: which elements are kept when there are
   too many, in what order they are numbered (top to bottom, left to right) and what number each gets.
6. The page is photographed (plain and marked, in tiles when it is very tall) and the result is checked against the
   `Capture` schema. If the page was redirected, `Capture.finalUrl` says where it ended.

A capture never fills a form, clicks, or leaves the page. It always closes its browser context, and it stops when the
caller aborts. The page is treated as hostile: what its script returns is validated and bounded in `src/raw.ts`, and
an error message names only the origin of the page, never its path or query string.

## Errors

Every failure is a `FlawDotError` with a code and a `retryable` flag.

| What happened                                                                                                 | Code                         |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 401 or 403; a redirect to another path that is a login path, or that shows exactly one visible password field | `LOGIN_REQUIRED`             |
| The address answers with a PDF, JSON, a download or other data, not a web page                                | `INVALID_INPUT`              |
| Certificate or SSL problem (not worth another try)                                                            | `UNREACHABLE`, not retryable |
| Server down, DNS, connection refused                                                                          | `UNREACHABLE`, retryable     |
| The page, or a font it waits for, never finishes                                                              | `TIMEOUT`                    |
| The caller aborted                                                                                            | `CANCELLED`                  |

A 404 or a 5xx is captured as the page it is. A login page that was asked for directly is captured too: it may be the
page to analyze. A path that only adds a language (`/` → `/en/`) is not a redirect to another page.

Known limits: a login that appears after stabilization without the address changing is not seen; a full navigation in
the middle of stabilization gives an `INTERNAL` error; a page reached by a redirect with one visible password field
(for example a landing page with an inline login) is read as a login; a two-letter path such as `/ai` is read as a
language. Keeping a login session is a later task.

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

Then `pnpm check:task` runs them with everything else (about 40 to 50 seconds), and
`pnpm --filter @flawdot/capture test:browser` runs only the ones that use the browser.

The fixture pages are in `test/fixtures/site/` and are served on `127.0.0.1`. Every box in them is written in pixels,
so what the tests expect does not depend on fonts or on the system.

`pnpm bench` times the capture of a landing page at each viewport (benchmark B3) and `scripts/bench-gate.mjs` compares
the mean with `scripts/bench-limits.json`: a warning above 5 s, a failure above 10 s.

The code that runs inside the page is in `src/in-page/`. Playwright sends its source text to the browser, so it cannot
use anything from outside its own body, and Node's coverage cannot see it: the tests of the browser exercise it, and
`docs/CONSTRAINTS.md` records this as an approved exception.
