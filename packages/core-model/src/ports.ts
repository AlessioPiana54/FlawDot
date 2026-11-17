// Ports towards the outside world (dependency inversion): the kernel uses them, adapters implement them.
// Only time and ids live here for now; the repositories, the secret store and the other ports are added
// when the modules that need them are built.
import type { FindingId, RunId } from "./ids.js";

/** Time comes in through this port so tests can freeze it. */
export interface Clock {
  now(): Date;
}

/** ULIDs, sortable by creation time. A fake generator in tests makes every id predictable. */
export interface IdGenerator {
  runId(): RunId;
  findingId(): FindingId;
}
