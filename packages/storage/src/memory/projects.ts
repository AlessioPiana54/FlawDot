import type { Clock, Project, ProjectId, ProjectRepository } from "@flawdot/core-model";
import { compareText } from "../compare.js";
import { projectFromOrigin } from "../project-id.js";

export function createProjectRepository(
  projects: Map<ProjectId, Project>,
  clock: Clock,
): ProjectRepository {
  return {
    getOrCreate: async (origin) => {
      const { id, origin: canonical } = projectFromOrigin(origin);
      let project = projects.get(id);
      if (project === undefined) {
        project = { id, origin: canonical, createdAt: clock.now().toISOString() };
        projects.set(id, project);
      }
      return structuredClone(project);
    },
    list: async () =>
      [...projects.values()]
        .sort((a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id))
        .map((project) => structuredClone(project)),
  };
}
