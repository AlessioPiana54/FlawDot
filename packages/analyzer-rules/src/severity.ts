import type { Severity } from "@flawdot/core-model";
import type { AxeImpact } from "./axe-results.js";

/** The severity of a FlawDot finding for an axe impact (decided in the spec; ask before changing it). */
const SEVERITY: Readonly<Record<AxeImpact, Severity>> = {
  critical: "critical",
  serious: "critical",
  moderate: "medium",
  minor: "low",
};

/** A violation always has an impact, but a result without one must not stop the analysis: medium is the middle. */
export function severityOf(impact: AxeImpact | null): Severity {
  return impact === null ? "medium" : SEVERITY[impact];
}
