import type {
  Clock,
  Finding,
  FindingId,
  FindingRepository,
  FindingState,
  Project,
  ProjectId,
  ProjectRepository,
  Run,
  RunId,
  RunRepository,
  Settings,
  SettingsRepository,
} from "@flawdot/core-model";
import { createFindingRepository } from "./findings.js";
import { createProjectRepository } from "./projects.js";
import { createRunRepository } from "./runs.js";
import { createSettingsRepository } from "./settings.js";

export interface InMemoryStorageOptions {
  readonly clock: Clock;
}

/** Nothing is kept after the object is gone. Each call gives a store of its own. */
export interface InMemoryStorage {
  readonly projects: ProjectRepository;
  readonly runs: RunRepository;
  readonly findings: FindingRepository;
  readonly settings: SettingsRepository;
}

/**
 * Every method of the repositories is `async`, so that a failure is a rejected promise and never an exception
 * thrown before the promise exists: that is what a port that returns a promise promises.
 */
export function createInMemoryStorage(options: InMemoryStorageOptions): InMemoryStorage {
  const projects = new Map<ProjectId, Project>();
  const runs = new Map<RunId, Run>();
  const findings = new Map<FindingId, Finding>();
  const states = new Map<ProjectId, Map<string, FindingState>>();
  const settings: { value: Settings | null } = { value: null };
  return {
    projects: createProjectRepository(projects, options.clock),
    runs: createRunRepository(runs, projects),
    findings: createFindingRepository(findings, states, runs, projects),
    settings: createSettingsRepository(settings),
  };
}
