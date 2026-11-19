# @flawdot/kernel

The application layer of FlawDot: it runs an analysis from the first page to the saved report. It captures each page, runs
the rule analyzers on it, turns what they find into numbered findings, saves them, draws the picture with the circles, and
tells what happens as events. It is a private workspace package.

It depends on `@flawdot/core-model` and on nothing else of FlawDot: it knows the **ports** of core-model, never an adapter
(rule A1 of `.oxlintrc.json`; in `src/` it may not even import Zod, a Node module, or `@flawdot/storage`). The composition root
builds the kernel and hands it the capture module, the analyzers, the annotator and the storage. Its tests use
`@flawdot/storage` and `@flawdot/test-support` as dev dependencies.

## The two things it offers

```ts
const kernel = createFlawDot({ entry: "web", inputs, analyzers, repos, annotator, clock, ids });

const run = kernel.analyze(plan); // starts and gives the handle at once
for await (const event of run.events) {
} // every event, from the first, whenever you start to read
const summary = await run.done; // the numbers of the run
const report = await kernel.report(run.runId);
```

- `analyze(plan)` checks the plan (`analysisPlanSchema`: pages that are really different, one site, no credentials in an
  address) and throws `INVALID_INPUT` at once for a bad one, before the run has an id. `run.cancel()` stops it, and gives
  back when the run is saved as cancelled; what was captured stays.
- `report(runId)` reads what is saved and builds the report with **the weights in force now**, so changing the weights in
  Settings changes the scores of old runs with no new analysis.
- `entry` (`web` or `mcp`) is how analyses are started; only whoever builds the kernel knows it, so it is not in the plan.

The rest of the Facade of the spec (discover, estimate, retry, history, ignore, export, login) comes with the tasks that need it.

## How a run goes

`executeRun` creates the project, saves the run as `running`, then goes through each page and, in it, each viewport (one at a
time for now), saves the run as it ended and only then tells `run_finished`.

Each task (one page at one viewport) goes through a list of steps, set up in one place (`createSteps`):

1. **capture** (can be interrupted): captures the page and runs the rule analyzers. They run _inside_ the capture, because
   axe needs the page open and the capture module keeps it open only for the time of the callback. Each analyzer is run on its
   own: if it fails, the capture and its picture are kept and only its findings are missing.
2. **number**: numbers the findings that are not ignored (circle 1 is the first problem the user sees); an ignored one gets no number.
3. **persist**: saves all the findings (the ignored too), then draws the picture. A failure to draw it does not lose the findings.
4. **done**: tells the problems of the analyzers (`analysis_failed`), then `capture_done`.

A cancel stops a task before the capture and right after it, and nothing is kept; once the findings start to be saved the
task goes to the end, because a cancelled task must not leave findings behind.

## What can go wrong, and what it comes to

| What happens                                          | What is told                                                | The run                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| a capture fails (timeout, unreachable, login needed…) | `capture_failed` with the error                             | `partial`; the other pages go on             |
| an analyzer fails, or gives a draft that is not valid | `analysis_failed` with the analyzer; the capture stays      | `completed`; its category has no score ("—") |
| the picture cannot be drawn                           | `analysis_failed` (`annotation`); the findings stay         | `completed`                                  |
| the findings of a page cannot be saved                | `capture_failed`                                            | `partial`                                    |
| the user cancels                                      | nothing about the task that was stopped                     | `cancelled` (wins over a failure)            |
| the storage fails for the run                         | no `run_finished` before the end of the run; `done` rejects | left `partial`, never `running`              |

An error that is not a `FlawDotError` is shown as `INTERNAL` with a fixed message that names the step and the site, never its
own text: it can hold a path, a page text or a secret.

## The report

`buildReport` is a pure function of the run, its findings, the ignore states and the weights. A page that failed or was never
reached has no score and no findings, so it can never look like a perfect page. A category has a score only if an analyzer
finished it on that page. The total of a page is the weighted mean of the categories that have one. The run keeps what it
learned (`captures`, `needsReview`, `analyzedCategories`) so the report can be built later, in another process.

## Known limits

- Rules only: there is no AI step and no deduplication of AI findings against axe yet (Task 21). `NoAiFulfiller` is ready for it.
- Captures go one after the other; the limit of two at a time is Task 28.
- No transaction: a run and its findings are saved with separate calls (the in-memory and SQLite adapters save a batch of
  findings whole or not at all, and a task that cannot save is a failed capture).
- One input, `url`. `RunHandle.events` keeps every event in memory for the life of the handle (about three per page and viewport).
- The comparison with the last run, "Show N more" and "ignore" from the kernel come with Tasks 21 and 25.

## Working on it

`pnpm --filter @flawdot/kernel test` runs everything in memory, with no browser. `test/support/fakes.ts` has the fake input
(which behaves like the capture module where it matters: the analyzers run inside `onLive`), the fake analyzer and annotator,
and `makeKernel`. After a change to the kernel, break one rule at a time (an order, a cancel check, the filter of ignored
findings) and run the tests: each break must turn one red.
