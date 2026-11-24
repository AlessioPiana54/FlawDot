import type { ReportData, RunId } from "@flawdot/core-model";
import { buildReport } from "./report.js";
import type { RunRepositories } from "./run.js";

/**
 * Reads what is saved and builds the report with the weights of this moment. It is called for a report and for the
 * summary at the end of a run, so the two cannot disagree.
 */
export async function loadReport(
  repos: Pick<RunRepositories, "runs" | "findings" | "settings">,
  runId: RunId,
): Promise<ReportData> {
  const run = await repos.runs.get(runId);
  const [findings, states, settings] = await Promise.all([
    repos.findings.byRun(runId),
    repos.findings.states(run.projectId),
    repos.settings.get(),
  ]);
  return buildReport({ run, findings, states, weights: settings.weights });
}
