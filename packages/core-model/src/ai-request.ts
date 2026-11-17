import {
  SEVERITIES,
  type Capture,
  type Category,
  type Element,
  type ReportLanguage,
  type ViewportName,
} from "./domain.js";
import type { FindingDraft } from "./finding.js";
import type { RunId } from "./ids.js";
import type { AiAnalysisResponse } from "./schemas.js";

// What travels between the kernel, an AI provider and the MCP server: one request per tile of a page, one answer
// back. The web app and the MCP mode build the same request and read the same answer, so they cannot disagree.

/** An answer with fewer than this much confidence is dropped (CLAUDE.md: "confidenza minima 0,3"). */
export const MIN_AI_CONFIDENCE = 0.3;
/** At most this many findings are kept from one answer: the best ones, by severity and then confidence. */
export const MAX_AI_FINDINGS = 20;
const MAX_RULE_KEY_SLUG = 40;

export type AiAnalyzerId = "ui-visual" | "ux-usability" | "conversion";

/** Who wrote an answer: one of the two Claude models of the web app, or Claude Code in MCP mode. */
export type AiModel = "claude-sonnet-5-5" | "claude-haiku-5-5" | "claude-code";

/** The question for one tile of a page. Everything a fulfiller needs travels in it, whatever answers it. */
export interface AiAnalysisRequest {
  /** Identifies this request, so that an answer from Claude Code can be matched to it. */
  requestId: string;
  runId: RunId;
  pageUrl: string;
  viewport: ViewportName;
  /** Which tile of the page, counted from 0. */
  tile: number;
  /** Version of the prompt pack: the same input and the same version give the same request. */
  promptVersion: string;
  analyzer: AiAnalyzerId;
  language: ReportLanguage;
  instructions: string;
  /** The screenshot with the set-of-marks numbers drawn on it. */
  image: { path: string; mediaType: "image/png" };
  /** Only the elements of this tile. */
  elements: readonly Pick<Element, "mark" | "tag" | "role" | "name" | "box">[];
  /** The JSON Schema of the answer (`AI_RESPONSE_JSON_SCHEMA`). */
  responseSchema: Record<string, unknown>;
}

/** An answer together with the model that wrote it, which the findings must record as their source. */
export interface AiFulfillment {
  response: AiAnalysisResponse;
  model: AiModel;
}

export type DroppedReason = "unknown_mark" | "low_confidence" | "duplicate" | "over_limit";

/** A finding of the answer that did not become a draft, and why. */
export interface DroppedFinding {
  /** Its position in `response.findings`. */
  index: number;
  mark: number | null;
  reason: DroppedReason;
}

export interface ToDraftsOptions {
  model: AiModel;
  /** The answer has no category: the analyzer that asked knows it. */
  category: Category;
  /** The rule keys of that analyzer. Any other key becomes `other:<slug>`. */
  allowedRuleKeys: ReadonlySet<string>;
}

interface Candidate {
  index: number;
  finding: AiAnalysisResponse["findings"][number];
  /** The element the finding points at, or null for a problem of the whole page. */
  element: Element | null;
}

/** Most severe first, then most certain, then first in the answer: the order in which findings are kept. */
function byRank(a: Candidate, b: Candidate): number {
  return (
    SEVERITIES.indexOf(a.finding.severity) - SEVERITIES.indexOf(b.finding.severity) ||
    b.finding.confidence - a.finding.confidence ||
    a.index - b.index
  );
}

/**
 * A rule key of the analyzer is kept (the AI often changes its case or adds spaces, which does not matter); any
 * other becomes `other:<slug>` (a-z, 0-9 and hyphens, at most 40). The keys on the list are lowercase.
 */
function normalizeRuleKey(ruleKey: string, allowed: ReadonlySet<string>): string {
  const lowered = ruleKey.trim().toLowerCase();
  if (allowed.has(lowered)) return lowered;
  const slug = lowered
    .replace(/^other:/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_RULE_KEY_SLUG)
    .replace(/-+$/, "");
  return `other:${slug === "" ? "unknown" : slug}`;
}

/**
 * Turns the answer to one tile into finding drafts. The answer is already validated (`parseAiResponse`), so what
 * is left to do is to decide what to keep. A finding is dropped, never an error, when its mark is not in the
 * capture, when the AI is not sure enough, or when there are too many; each drop is reported in `dropped` with
 * its reason, so the MCP server can tell Claude Code which marks were wrong while the web app ignores them.
 *
 * The position of a finding on an element comes from the capture, never from the AI. Only valid findings count
 * against the limit of 20, and the drafts keep the order of the answer.
 */
export function toDrafts(
  response: AiAnalysisResponse,
  capture: Capture,
  options: ToDraftsOptions,
): { drafts: FindingDraft[]; dropped: DroppedFinding[] } {
  const elementByMark = new Map(
    capture.elements.map((element) => [element.mark, element] as const),
  );
  const dropped: DroppedFinding[] = [];
  const valid: Candidate[] = [];

  for (const [index, finding] of response.findings.entries()) {
    const element = finding.mark === null ? null : elementByMark.get(finding.mark);
    if (element === undefined) {
      dropped.push({ index, mark: finding.mark, reason: "unknown_mark" });
    } else if (finding.confidence < MIN_AI_CONFIDENCE) {
      dropped.push({ index, mark: finding.mark, reason: "low_confidence" });
    } else {
      valid.push({ index, finding, element });
    }
  }

  // The same mark, rule and title is the same problem said twice (it would also have the same fingerprint). The
  // best of them is kept, and the copies must not use up places of the 20.
  const seen = new Set<string>();
  const distinct: Array<Candidate & { ruleKey: string }> = [];
  for (const candidate of valid.sort(byRank)) {
    const ruleKey = normalizeRuleKey(candidate.finding.ruleKey, options.allowedRuleKeys);
    const identity = JSON.stringify([candidate.finding.mark, ruleKey, candidate.finding.title]);
    if (seen.has(identity)) {
      dropped.push({ index: candidate.index, mark: candidate.finding.mark, reason: "duplicate" });
    } else {
      seen.add(identity);
      distinct.push({ ...candidate, ruleKey });
    }
  }

  for (const { index, finding } of distinct.slice(MAX_AI_FINDINGS)) {
    dropped.push({ index, mark: finding.mark, reason: "over_limit" });
  }

  const drafts = distinct
    .slice(0, MAX_AI_FINDINGS)
    .sort((a, b) => a.index - b.index)
    .map(({ finding, element, ruleKey }): FindingDraft => ({
      category: options.category,
      severity: finding.severity,
      ruleKey,
      title: finding.title,
      explanation: finding.explanation,
      fix: finding.fix,
      evidence: finding.evidence,
      principle: { code: finding.principle.code, label: finding.principle.label },
      source: { kind: "ai", confidence: finding.confidence, model: options.model },
      location:
        element === null
          ? { kind: "page" }
          : {
              kind: "element",
              mark: element.mark,
              selector: element.selector,
              box: element.box,
              count: 1,
            },
    }));

  return { drafts, dropped: dropped.sort((a, b) => a.index - b.index) };
}
