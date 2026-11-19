import type {
  ArtifactStore,
  FindingRepository,
  ProjectRepository,
  RunRepository,
  SecretStore,
  SettingsRepository,
} from "@flawdot/core-model";
import { afterEach, beforeEach } from "vitest";
import { ManualClock } from "./fixtures.js";

/** What a contract suite needs from an adapter: the repositories that share one store (a run needs its project). */
export interface Repositories {
  readonly projects: ProjectRepository;
  readonly runs: RunRepository;
  readonly findings: FindingRepository;
  readonly settings: SettingsRepository;
}

/** A thing under test, and how to throw it away (a temporary folder, a database file). */
export interface Fixture<T> {
  readonly subject: T;
  dispose?(): Promise<void> | void;
}

/** The artifact store also tells the suite where its files go, so that the suite can check that none lands outside. */
export interface ArtifactFixture extends Fixture<ArtifactStore> {
  readonly root: string;
}

/**
 * Makes a FRESH and EMPTY subject every time it is called, built with the clock it is given. A test never sees
 * what another test left behind.
 */
export type Factory<T> = (clock: ManualClock) => Promise<T> | T;

/** A suite names the repositories it uses (a run needs a project), and a factory of all of them fits every suite. */
export type RepositoriesFactory<K extends keyof Repositories = keyof Repositories> = Factory<
  Fixture<Pick<Repositories, K>>
>;
export type SecretStoreFactory = Factory<Fixture<SecretStore>>;
export type ArtifactStoreFactory = Factory<ArtifactFixture>;

/** Runs `check` on a second subject made by the same factory (to prove that two instances share nothing), then throws it away. */
export async function withSecondInstance<F extends Fixture<unknown>>(
  factory: Factory<F>,
  clock: ManualClock,
  check: (second: F) => Promise<void>,
): Promise<void> {
  const second = await factory(clock);
  try {
    await check(second);
  } finally {
    await second.dispose?.();
  }
}

/** Gives each test its own subject and clock, and throws the subject away afterwards, even when the test failed. */
export function useFixture<F extends Fixture<unknown>>(
  factory: Factory<F>,
): () => { fixture: F; clock: ManualClock } {
  let current: { fixture: F; clock: ManualClock } | undefined;
  beforeEach(async () => {
    const clock = new ManualClock();
    current = { fixture: await factory(clock), clock };
  });
  afterEach(async () => {
    const used = current;
    current = undefined;
    await used?.fixture.dispose?.();
  });
  return () => {
    if (current === undefined) {
      throw new Error("The fixture is only available inside a test");
    }
    return current;
  };
}
