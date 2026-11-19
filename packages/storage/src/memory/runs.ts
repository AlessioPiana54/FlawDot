import {
  FlawDotError,
  parseOrThrow,
  runSchema,
  type Project,
  type ProjectId,
  type Run,
  type RunId,
  type RunRepository,
} from "@flawdot/core-model";
import { compareText } from "../compare.js";

export function createRunRepository(
  runs: Map<RunId, Run>,
  projects: ReadonlyMap<ProjectId, Project>,
): RunRepository {
  /** The runs of one project, the newest first: the id is a ULID, so the order of the ids is the order of creation. */
  const ofProject = (projectId: ProjectId): Run[] =>
    [...runs.values()]
      .filter((run) => run.projectId === projectId)
      .sort((a, b) => compareText(b.id, a.id));

  return {
    save: async (run) => {
      const valid = parseOrThrow(runSchema, run, { what: "run" }); // a new object: the caller keeps no hold on it
      if (!projects.has(valid.projectId)) {
        throw new FlawDotError("INVALID_INPUT", "Project not found");
      }
      // A run is saved again to change its status, never to move it: its findings and the ignored fingerprints
      // are tied to its project.
      const saved = runs.get(valid.id);
      if (saved !== undefined && saved.projectId !== valid.projectId) {
        throw new FlawDotError("INVALID_INPUT", "A run belongs to one project only");
      }
      runs.set(valid.id, valid);
    },
    get: async (id) => {
      const run = runs.get(id);
      if (run === undefined) {
        throw new FlawDotError("INVALID_INPUT", "Run not found");
      }
      return structuredClone(run);
    },
    latestCompleted: async (projectId, before) => {
      const found = ofProject(projectId).find(
        (run) => run.status === "completed" && (before === undefined || run.id < before),
      );
      return found === undefined ? null : structuredClone(found);
    },
    list: async (projectId) => ofProject(projectId).map((run) => structuredClone(run)),
  };
}
