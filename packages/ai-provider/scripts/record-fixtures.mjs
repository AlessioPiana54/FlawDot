// Records the answers of the real model as fixtures, so that the tests can replay them for free.
// MANUAL, and it spends API money: a person runs it (`pnpm --filter @flawdot/ai-provider record-fixtures`), never a
// test and never the CI. The real provider arrives with Task 35; until then this only explains what it will do.
//
// What it will do, once the real provider exists: read the requests that the analyzers build, show the estimate of
// the cost, and, only with --confirm-spend, call the model and save one `<hash>.json` for each request (see
// `recordFixtures` in src/record.ts, where the logic and its tests are). It holds no key and no address of an API.

const args = new Set(process.argv.slice(2));

if (!args.has("--confirm-spend")) {
  console.log(
    "record-fixtures: dry run. Recording calls the real API and costs money. Pass --confirm-spend to go on.",
  );
  process.exit(2);
}

console.error(
  "record-fixtures: the real provider arrives with Task 35, so there is nothing to record with yet.",
);
process.exit(1);
