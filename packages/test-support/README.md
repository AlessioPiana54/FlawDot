# @flawdot/test-support

What every adapter of a port must pass, written once. It holds the **contract suites** and a few helpers for tests. It is a
private workspace package, and **only tests import it** (it is a dev dependency, and `packages/storage/src` is forbidden from
importing it by `.oxlintrc.json`). It depends on `@flawdot/core-model` and on `vitest`, which it takes from the root so that
the suites register in the same Vitest as the tests that call them.

## The suites

Each suite is a function that takes a factory and registers its tests:

```ts
import { runRunRepositoryContract } from "@flawdot/test-support";

runRunRepositoryContract((clock) => ({ subject: createInMemoryStorage({ clock }) }));
```

| Suite                           | Port                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `runProjectRepositoryContract`  | `ProjectRepository`                                                             |
| `runRunRepositoryContract`      | `RunRepository` (needs `projects` too: a run belongs to a project)              |
| `runFindingRepositoryContract`  | `FindingRepository` (needs `projects` and `runs`)                               |
| `runSettingsRepositoryContract` | `SettingsRepository`                                                            |
| `runSecretStoreContract`        | `SecretStore`                                                                   |
| `runArtifactStoreContract`      | `ArtifactStore` (the factory also gives the `root`, inside a folder of its own) |

The factory is called for **every test** and must give a fresh, empty subject built with the clock it receives, and an
optional `dispose` to throw it away (a temporary folder, a database file). A factory of all four repositories fits every
repository suite. SQLite (Task 23) and the file and keyring stores (Task 24) call the same functions.

The suites check the behavior that the ports promise and that an adapter could get wrong without the compiler noticing: the
order of a list, copies instead of shared objects, a failure that is a rejected promise with `INVALID_INPUT`, a batch that
is saved whole or not at all, a key that is in no error, a file name that cannot leave the root. They do **not** check where
a file goes (the layout belongs to each store) or what only a real disk or database can break (permissions, a crash in the
middle of a write, two processes at once): those are tests of the adapter itself.

## The helpers

`ulid(n)` and `runId(n)`, `findingId(n)`, `projectId(text)` make ids that are valid and sort by `n`. `makeRun` and `makeFinding`
make data that passes the schemas, with any field replaced. `ManualClock` moves only when told. `rejectionOf` and `throwOf` give
back the `FlawDotError` that some work rejects with or throws, and fail when it does not (a port that throws before it returns a
promise fails `rejectionOf` on purpose). `withSecondInstance` proves that two instances share nothing.

## Proof that a suite bites

An adapter that passes proves nothing if the suite cannot fail. After each change to a suite or to the in-memory adapters,
break one rule at a time in `packages/storage/src` (reverse an order, return the live object instead of a copy, drop a check)
and run the tests: each break must turn at least one red. The last run (Task 15) broke 44 rules and killed 44.
