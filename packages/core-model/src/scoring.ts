import * as z from "zod";
import { CATEGORIES, type Category, type Severity } from "./domain.js";
import { FlawDotError } from "./errors.js";
import type { Finding, FindingState } from "./finding.js";

// Pure functions, no state. The constants are exported so they can be tuned on real sites.
// Scores are recomputed from the stored findings, so changing any constant changes every score shown, history
// included: treat it as a breaking change.

/** Score = 100 × e^(−penalty / SCORE_K). */
export const SCORE_K = 40;
export const PENALTY: Readonly<Record<Severity, number>> = { critical: 10, medium: 4, low: 1 };
/** +10% for every further occurrence of the same rule, up to ×2. */
export const REPEAT_STEP = 0.1;
export const REPEAT_CAP = 2;

const weight = z.number().min(0);

/**
 * Weights set by the user in Settings: one per category, none negative, adding up to 1. The keys are
 * spelled out so that adding a category to `CATEGORIES` fails to compile here until the weights follow.
 */
export const categoryWeightsSchema = z
  .object({ ui: weight, ux: weight, accessibility: weight, conversion: weight })
  .refine((weights) => Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 1e-6, {
    message: "Weights must add up to 1",
  });
export type CategoryWeights = z.infer<typeof categoryWeightsSchema>;

export const DEFAULT_WEIGHTS: Readonly<CategoryWeights> = {
  ui: 0.25,
  ux: 0.25,
  accessibility: 0.25,
  conversion: 0.25,
};

export type Band = "excellent" | "good" | "needs_work" | "critical";

/** The penalty of one finding: the one of its severity, scaled by the confidence for an AI suggestion. */
export function findingWeight(finding: Finding): number {
  const base = PENALTY[finding.severity];
  return finding.source.kind === "ai" ? base * finding.source.confidence : base;
}

/**
 * Total penalty of the findings of one page, viewport and category. Ignored findings are left out; the
 * others are grouped by rule, and a group weighs as its heaviest finding times the repeat factor.
 */
export function categoryPenalty(
  findings: readonly Finding[],
  states: ReadonlyMap<string, FindingState>,
): number {
  // Groups are keyed by rule only, so the same rule on desktop and on mobile would count as one group and
  // weigh too little. Mixed input is a bug in the caller: stop instead of returning a wrong number.
  const [first] = findings;
  if (
    first &&
    findings.some(
      (f) =>
        f.category !== first.category ||
        f.viewport !== first.viewport ||
        f.pageUrl !== first.pageUrl,
    )
  ) {
    throw new FlawDotError(
      "INTERNAL",
      "categoryPenalty needs the findings of one page, one viewport and one category",
    );
  }

  const groups = new Map<string, { heaviest: number; occurrences: number }>();
  for (const finding of findings) {
    if (states.get(finding.fingerprint)?.kind === "ignored") continue;
    const group = groups.get(finding.ruleKey) ?? { heaviest: 0, occurrences: 0 };
    group.heaviest = Math.max(group.heaviest, findingWeight(finding));
    group.occurrences += 1;
    groups.set(finding.ruleKey, group);
  }

  let penalty = 0;
  for (const { heaviest, occurrences } of groups.values()) {
    penalty += heaviest * Math.min(1 + REPEAT_STEP * (occurrences - 1), REPEAT_CAP);
  }
  return penalty;
}

/** 0–100, rounded. No findings (or all ignored) is 100. `states` is keyed by fingerprint. */
export function categoryScore(
  findings: readonly Finding[],
  states: ReadonlyMap<string, FindingState>,
): number {
  return Math.round(100 * Math.exp(-categoryPenalty(findings, states) / SCORE_K));
}

/**
 * Total of a page and viewport: the weighted mean of the categories that were analyzed. A category that is
 * missing or `null` ("—", no AI) is left out and the other weights are re-normalized. `null` when nothing
 * that was analyzed carries any weight.
 */
export function pageScore(
  byCategory: Partial<Record<Category, number | null>>,
  weights: Readonly<CategoryWeights>,
): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const category of CATEGORIES) {
    const score = byCategory[category];
    if (score === undefined || score === null) continue;
    weighted += score * weights[category];
    totalWeight += weights[category];
  }
  return totalWeight === 0 ? null : Math.round(weighted / totalWeight);
}

/** Mean of the page totals, rounded; pages without a score do not count. `null` if none has one. */
export function siteScore(pageScores: readonly (number | null)[]): number | null {
  const scored = pageScores.filter((score): score is number => score !== null);
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length);
}

/** 90–100 excellent, 75–89 good, 50–74 needs work, below 50 critical. */
export function band(score: number): Band {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 50) return "needs_work";
  return "critical";
}
