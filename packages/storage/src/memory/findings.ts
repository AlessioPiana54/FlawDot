import {
  FlawDotError,
  findingSchema,
  findingStateSchema,
  parseOrThrow,
  type Finding,
  type FindingId,
  type FindingRepository,
  type FindingState,
  type Project,
  type ProjectId,
  type Run,
  type RunId,
} from "@flawdot/core-model";
import { compareText } from "../compare.js";

/**
 * `states` holds the states that are "ignored", by project and then by fingerprint: an opened fingerprint has no entry.
 */
export function createFindingRepository(
  findings: Map<FindingId, Finding>,
  states: Map<ProjectId, Map<string, FindingState>>,
  runs: ReadonlyMap<RunId, Run>,
  projects: ReadonlyMap<ProjectId, Project>,
): FindingRepository {
  return {
    saveAll: async (batch) => {
      // Everything is checked before anything is written: a batch is saved whole or not at all.
      const valid = batch.map((finding) =>
        parseOrThrow(findingSchema, finding, { what: "finding" }),
      );
      const runOfId = new Map<FindingId, RunId>();
      for (const finding of valid) {
        if (!runs.has(finding.runId)) {
          throw new FlawDotError("INVALID_INPUT", "Run not found");
        }
        // The id of a finding belongs to one run, in the store and also inside this batch.
        const knownRun = runOfId.get(finding.id) ?? findings.get(finding.id)?.runId;
        if (knownRun !== undefined && knownRun !== finding.runId) {
          throw new FlawDotError("INVALID_INPUT", "A finding id belongs to one run only");
        }
        runOfId.set(finding.id, finding.runId);
      }
      for (const finding of valid) {
        findings.set(finding.id, finding);
      }
    },
    byRun: async (id) =>
      [...findings.values()]
        .filter((finding) => finding.runId === id)
        .sort((a, b) => compareText(a.id, b.id))
        .map((finding) => structuredClone(finding)),
    setState: async (projectId, fingerprint, state) => {
      const key = parseOrThrow(findingSchema.shape.fingerprint, fingerprint, {
        what: "fingerprint",
      });
      const valid = parseOrThrow(findingStateSchema, state, { what: "finding state" });
      if (!projects.has(projectId)) {
        throw new FlawDotError("INVALID_INPUT", "Project not found");
      }
      if (valid.kind === "open") {
        states.get(projectId)?.delete(key);
        return;
      }
      const ofProject = states.get(projectId) ?? new Map<string, FindingState>();
      ofProject.set(key, valid);
      states.set(projectId, ofProject);
    },
    states: async (projectId) => structuredClone(states.get(projectId) ?? new Map()),
  };
}
