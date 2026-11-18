import { z } from "zod";
import { FlawDotError, type ElementPath } from "@flawdot/core-model";
import { sanitizeText } from "./text.js";

// What axe returns is built in part from the page: element snippets, values, messages. A hostile page can shape all of
// it, so it is read here, once, into plain values that are bounded and clean. Nothing after this file sees raw axe
// data. A piece that is wrong is dropped, not fatal: one odd element must not lose the analysis of a whole page.

const MAX_RULES = 200;
const MAX_NODES_PER_RULE = 2000;
const MAX_TAGS = 30;
const TAG_MAX = 40;
const MAX_CHECKS_PER_NODE = 20;
const HELP_MAX = 300;
const DESCRIPTION_MAX = 500;
const FAILURE_SUMMARY_MAX = 1000;
const HTML_MAX = 200;

const ruleIdSchema = z.string().regex(/^[a-z0-9-]{1,100}$/);
/** What axe calls the impact of a rule: how much a failure of it hurts a person who uses the page. */
const impactSchema = z.enum(["minor", "moderate", "serious", "critical"]);
export type AxeImpact = z.infer<typeof impactSchema>;
const checkSchema = z.object({ id: z.string().min(1).max(100), data: z.unknown().optional() });
/** One selector for an element of the page; two or more for an iframe, and a list inside a list for a shadow root. */
const targetSchema = z
  .array(z.union([z.string(), z.array(z.string()).min(1).max(10)]))
  .min(1)
  .max(10);

export interface ParsedCheck {
  id: string;
  /** What the check found, as axe gave it. It is `unknown` on purpose: the code that reads it checks it. */
  data?: unknown;
}

export interface ParsedNode {
  /** The way to the element, as axe gave it: one selector, or the steps through iframes and shadow roots. */
  target: ElementPath;
  html: string;
  failureSummary: string | null;
  checks: ParsedCheck[];
}

export interface ParsedViolation {
  id: string;
  impact: AxeImpact | null;
  help: string;
  description: string;
  tags: string[];
  /** The elements that were read: at most 2000. */
  nodes: ParsedNode[];
  /** How many elements axe reported for the rule, which may be more than `nodes` holds. */
  total: number;
}

export interface ParsedAxeResults {
  violations: ParsedViolation[];
  /** The elements axe could not decide on ("incomplete"): a person has to look. They are never violations. */
  needsReview: number;
}

/**
 * A key for a target: the selector itself when it is one, so that it is the same as the selector of a mark, and the
 * steps written out when it is a path. Two targets with the same key are the same element.
 */
export const targetKey = (target: ElementPath): string =>
  target.length === 1 && typeof target[0] === "string" ? target[0] : JSON.stringify(target);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown, max: number, keepLines = false): string =>
  typeof value === "string" ? sanitizeText(value, max, { keepLines }) : "";

function checksOf(node: Record<string, unknown>): ParsedCheck[] {
  const checks: ParsedCheck[] = [];
  for (const group of [node["any"], node["all"], node["none"]]) {
    if (!Array.isArray(group)) continue;
    for (const entry of group) {
      const parsed = checkSchema.safeParse(entry);
      if (parsed.success && checks.length < MAX_CHECKS_PER_NODE) checks.push(parsed.data);
    }
  }
  return checks;
}

function nodeOf(raw: unknown): ParsedNode | undefined {
  if (!isRecord(raw)) return undefined;
  const target = targetSchema.safeParse(raw["target"]);
  if (!target.success) return undefined;
  const failureSummary = textOf(raw["failureSummary"], FAILURE_SUMMARY_MAX, true);
  return {
    target: target.data,
    html: textOf(raw["html"], HTML_MAX),
    failureSummary: failureSummary === "" ? null : failureSummary,
    checks: checksOf(raw),
  };
}

function violationOf(raw: unknown): ParsedViolation | undefined {
  if (!isRecord(raw)) return undefined;
  const id = ruleIdSchema.safeParse(raw["id"]);
  const nodes = raw["nodes"];
  if (!id.success || !Array.isArray(nodes)) return undefined;
  const tags = Array.isArray(raw["tags"]) ? raw["tags"] : [];
  return {
    id: id.data,
    impact: impactSchema.safeParse(raw["impact"]).data ?? null,
    help: textOf(raw["help"], HELP_MAX),
    description: textOf(raw["description"], DESCRIPTION_MAX),
    tags: tags
      .filter((tag): tag is string => typeof tag === "string" && tag.length <= TAG_MAX)
      .slice(0, MAX_TAGS),
    nodes: nodes
      .slice(0, MAX_NODES_PER_RULE)
      .map(nodeOf)
      .filter((node): node is ParsedNode => node !== undefined),
    total: nodes.length,
  };
}

function needsReviewOf(incomplete: unknown): number {
  if (!Array.isArray(incomplete)) return 0;
  let count = 0;
  for (const entry of incomplete) {
    if (isRecord(entry) && Array.isArray(entry["nodes"])) count += entry["nodes"].length;
  }
  return count;
}

/**
 * Reads the result of `axe.analyze()` into values that are bounded and clean. Only the violations and the number
 * of elements to review are kept: `passes`, `inapplicable` and everything else are not read. A result that is not
 * from axe at all is an INTERNAL error, with a message that holds nothing of the page.
 */
export function parseAxeResults(raw: unknown): ParsedAxeResults {
  if (!isRecord(raw) || !Array.isArray(raw["violations"])) {
    throw new FlawDotError(
      "INTERNAL",
      "The accessibility check returned a result FlawDot cannot read.",
    );
  }
  return {
    violations: raw["violations"]
      .slice(0, MAX_RULES)
      .map(violationOf)
      .filter((violation): violation is ParsedViolation => violation !== undefined),
    needsReview: needsReviewOf(raw["incomplete"]),
  };
}
