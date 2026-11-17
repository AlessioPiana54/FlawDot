// Ports towards the outside world (dependency inversion): the kernel uses them, adapters implement them.
// Only what Task 4 needs lives here; repositories, SecretStore and the rest arrive with Task 7.
import type { FindingId, RunId } from "./ids.js";

/** Time comes in through this port so tests can freeze it. */
export interface Clock {
  now(): Date;
}

/** Sortable ULIDs. A fake generator in tests makes every id predictable. */
export interface IdGenerator {
  runId(): RunId;
  findingId(): FindingId;
}
