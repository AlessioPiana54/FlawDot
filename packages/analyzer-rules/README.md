# @flawdot/analyzer-rules

The rules half of FlawDot's analysis: it runs [axe-core](https://github.com/dequelabs/axe-core) on the page that a
capture still has open, and turns what axe finds into drafts of "Verified" findings (the accessibility category). It
is a private workspace package.

It depends on `@flawdot/core-model`, `@axe-core/playwright`, `axe-core` (pinned, the same version that runs on the page; its Italian texts are read from `locales/it.json`), `playwright-core` and `zod`, and on nothing else of FlawDot.
`@flawdot/capture` is a dev dependency, used only by the browser tests; the code never imports it.

## How an analysis goes

1. The kernel calls `analyze(capture, ctx, signal)` while the page is open (from the `onLive` callback of the
   capture). The live page is a Playwright page; this package checks its shape before it uses it.
2. axe runs on the page with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`,
   in English, with a time limit (30 s) and the signal of the caller. **The page is not changed**: a browser test
   compares its HTML before and after.
3. `parseAxeResults` reads the result into plain values that are bounded and clean (see "Hostile pages"). Only the
   violations and the number of elements to review are kept.
4. Each element that axe names is placed on a mark of the capture:
   - the mark with the same selector, if there is one;
   - otherwise the element is measured on the live page, and the mark with the same box (within 1 px), or the
     smallest mark that holds it, is used (`markForBox` in core-model; axe writes `nth-child` and the capture
     `nth-of-type`, so the selectors rarely match);
   - an element in an iframe or in a shadow root is measured by its path (`boxOf` takes the path that axe gives), and
     lands on the smallest mark that holds it: the iframe, which the capture numbers, or the text or control that
     contains the shadow host;
   - `html` and `body`, an element that cannot be measured, and one that no mark holds, give a finding on the page,
     with no circle.
5. `axeResultsToDrafts` makes the drafts. It is pure, and it is the part that the browser-free tests exercise.

`analyze` returns `{ drafts, needsReview }`. `needsReview` counts the elements that axe could not decide on
("incomplete", counted in elements): they never become findings and never count in a score, and the kernel adds them
up for the appendix of the report.

## What a finding is made of

| Field                         | From                                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `category`, `source`          | always `accessibility`, and `{ kind: "rule", engine: "axe-core", ruleId }`                                                                                                                                                                                       |
| `severity`                    | axe impact: critical and serious are Critical, moderate is Medium, minor is Low                                                                                                                                                                                  |
| `ruleKey`                     | the axe rule id                                                                                                                                                                                                                                                  |
| `title`, `explanation`, `fix` | the catalog of FlawDot (30 rules, see "The catalog"), else the Italian text of axe in Italian, else the `help`, `description` and failure summary of axe in English                                                                                              |
| `evidence`                    | in English or Italian: contrast (`#c9c9c9 on #f7f5ff, 1.53:1 (needs 4.5:1)`), a missing accessible name, a target that is too small, an invalid language code, an unknown ARIA role or attribute, an ARIA attribute that is not allowed; nothing for other rules |
| `principle`                   | the WCAG criterion from the tags (`wcag143` is 1.4.3, `wcag1411` is 1.4.11), with its name in English or Italian; a best practice has no code                                                                                                                    |
| `location`                    | the mark's own selector and box, with `count` = the number of elements of the rule; or the page                                                                                                                                                                  |

Per rule, the first 10 marks by position (top, then left, then mark number) become findings. Two elements on one
mark are one finding. At most 50 elements of a rule are looked at, in the order axe gives them, and at most 400
elements are measured in one analysis; the rest are left out and only counted in `count`. The score does not read
`count`, but it does not need to: a rule weighs `1 + 0.1 × (occurrences − 1)` up to a cap of 2, so 10 findings weigh
1.9 and the cap is reached at 11: the 10 that are kept lose at most 5%.

## The catalog

`src/catalog/en.json` and `src/catalog/it.json` hold the title, the explanation and the fix of 30 common rules, written
by FlawDot. They are loaded by `src/default-catalog.ts` (`defaultCatalog`), which is built when the module loads: a
file that is wrong (a blank text, a text over the limits of a finding, a key that was not asked for) stops the program
at start, and the error names the language, never the text. For a rule that is not in the catalog:

- in Italian, the title and the explanation are the `help` and the `description` that axe wrote in `locales/it.json`,
  and the fix is the title (axe has no fix text). If axe has no Italian text for the rule (`aria-tab-name`,
  `summary-name`), or the entry is not usable, the finding keeps the English text of axe;
- in English, the finding keeps the English text of axe, which already ran in English.

The Italian file of axe is the data of a dependency, so what is not usable is skipped instead of failing. To add a rule,
add the same key to both files; a test checks that both have exactly the rules that the contract lists, that every rule
is one that axe really runs, that Italian is not a copy of English, and that no text has a marker of unfinished work.
`evidenceFor` and `principleFor` write in the language of the report too.

## Hostile pages

What axe returns is built in part from the page (snippets of HTML, values, messages), so none of it is trusted:
`axe-results.ts` limits and cleans every piece, drops what is wrong instead of failing the whole page, and the
evidence extractors check the data of a check before they use it. Control and invisible characters are removed from
every text, texts are cut to the limits of a finding, and the page text is never put in an error message. Axe's text
is data: it is shown, never followed as an instruction.

## Errors

All are `FlawDotError`: `CANCELLED` when the signal fires (also when the browser was closed by an abort), `TIMEOUT`
when axe does not end in time, and `INTERNAL` for anything else, with a fixed message that names only the origin of
the page.

## Known limits

- A shadow root has no mark of its own: capture numbers the elements of the document, not the ones inside a shadow
  root, and the host is usually a plain element. A finding about it has a circle only when a mark holds the host
  (a paragraph or a control that contains it); otherwise it is a finding of the page. A closed shadow root is not
  reached at all (neither does axe reach into it).
- A page can have more elements than the budget; the ones beyond it are only counted.
- axe 4.14 has no rule for duplicate ids, so there is no evidence for them. Evidence exists for the families listed
  above; any other is added one extractor at a time, after checking the shape of the data in a real result.
- The Italian fix of a rule outside the catalog is the same text as its title.
- Axe scans the whole document, also what is off screen or below the cut of the picture; such elements usually have
  no mark and are reported on the page.

## Working on it

`pnpm --filter @flawdot/analyzer-rules test` runs the tests with no browser (saved results of the real engine in
`test/fixtures/axe-results/`, recorded from the pages of `test/fixtures/site/`).
`pnpm --filter @flawdot/analyzer-rules test:browser` captures those pages with the real capture of FlawDot and analyzes
them; it needs Chromium (`pnpm browsers`, once). `pnpm check:task` runs both.

If axe is updated, record the saved results again: they are plain JSON from `AxeBuilder.analyze()`.
