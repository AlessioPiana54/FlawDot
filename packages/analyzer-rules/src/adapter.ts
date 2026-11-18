import {
  EXPLANATION_MAX,
  FIX_MAX,
  SELECTOR_MAX,
  TITLE_MAX,
  markForBox,
  type Box,
  type Capture,
  type Element,
  type ElementPath,
  type FindingDraft,
  type ReportLanguage,
} from "@flawdot/core-model";
import {
  targetKey,
  type ParsedAxeResults,
  type ParsedNode,
  type ParsedViolation,
} from "./axe-results.js";
import type { RuleCatalog } from "./catalog.js";
import { evidenceFor } from "./evidence.js";
import { principleFor } from "./principle.js";
import { severityOf } from "./severity.js";
import { sanitizeText } from "./text.js";
import type { WcagCriteriaTable } from "./wcag-criteria.js";

// The pure part of the analyzer: from the result of axe, read and bounded by `parseAxeResults`, to the drafts of the
// findings. It does no I/O. The one thing it needs from the page, the box of an element that has no mark of its
// own, is passed in: `targetsToMeasure` says which elements to measure, the caller measures them, and
// `axeResultsToDrafts` uses the boxes (by `targetKey`).

/** How many elements of one rule become findings, each with a circle (the spec). The first ones by position. */
export const NODES_PER_RULE_MAX = 10;
/** How many elements of one rule are looked at, in the order axe gave them (the order of the document). */
export const NODES_LOOKED_AT_MAX = 50;
/** How many elements are measured on the page in all, in one analysis. Each is a round trip to the page. */
export const TARGETS_MEASURED_MAX = 400;

export interface ConvertDeps {
  catalog: RuleCatalog;
  wcag: WcagCriteriaTable;
}

type Placement =
  | { kind: "element"; element: Element }
  | { kind: "measure"; target: ElementPath }
  | { kind: "page" };

interface Placed {
  node: ParsedNode;
  placement: Placement;
}

/**
 * For each rule, the elements that are looked at and where each one goes; what is to be measured is known from this.
 * Deterministic, so the targets to measure and the drafts agree. An element beyond the 50 of its rule is left out. An
 * element that cannot be measured any more because the budget is spent goes to the page, so that a rule that comes
 * late in the result is not lost.
 */
function plan(results: ParsedAxeResults, elements: readonly Element[]): Placed[][] {
  const bySelector = new Map<string, Element>();
  for (const element of elements) {
    if (!bySelector.has(element.selector)) bySelector.set(element.selector, element);
  }
  const wanted = new Set<string>();

  const place = (node: ParsedNode): Placement => {
    const { target } = node;
    // One selector of the page: `html` and `body` are the page, and a mark may have the same selector.
    const only = target.length === 1 && typeof target[0] === "string" ? target[0] : undefined;
    if (only !== undefined) {
      if (["html", "body"].includes(only.trim().toLowerCase())) return { kind: "page" };
      const same = bySelector.get(only);
      if (same !== undefined) return { kind: "element", element: same };
    }
    if (target.flat().some((selector) => selector.length > SELECTOR_MAX)) return { kind: "page" };
    const key = targetKey(target);
    if (!wanted.has(key) && wanted.size >= TARGETS_MEASURED_MAX) return { kind: "page" };
    wanted.add(key);
    return { kind: "measure", target };
  };

  return results.violations.map((violation) =>
    violation.nodes.slice(0, NODES_LOOKED_AT_MAX).map((node) => ({ node, placement: place(node) })),
  );
}

/** The elements to measure on the live page: those no mark has, once each, within the budget. */
export function targetsToMeasure(
  results: ParsedAxeResults,
  capture: Pick<Capture, "elements">,
): ElementPath[] {
  const targets = new Map<string, ElementPath>();
  for (const placed of plan(results, capture.elements)) {
    for (const { placement } of placed) {
      if (placement.kind === "measure") targets.set(targetKey(placement.target), placement.target);
    }
  }
  return [...targets.values()];
}

/** The first text that is not blank once cleaned, cut to `max`. */
function firstText(
  candidates: readonly (string | null | undefined)[],
  max: number,
  keepLines = false,
): string {
  for (const candidate of candidates) {
    const text = sanitizeText(candidate ?? "", max, { keepLines });
    if (text !== "") return text;
  }
  return "";
}

function draftFor(
  violation: ParsedViolation,
  node: ParsedNode,
  location: FindingDraft["location"],
  deps: ConvertDeps,
  language: ReportLanguage,
): FindingDraft {
  const texts = deps.catalog.lookup(violation.id, language);
  const title = firstText([texts?.title, violation.help, violation.id], TITLE_MAX);
  return {
    category: "accessibility",
    severity: severityOf(violation.impact),
    ruleKey: violation.id,
    title,
    explanation: firstText(
      [texts?.explanation, violation.description, title],
      EXPLANATION_MAX,
      true,
    ),
    // The general text of the rule comes before the summary of this element: the summary holds values that the page
    // wrote, and it is only a fallback for a rule that has no general text.
    fix: firstText([texts?.fix, violation.help, node.failureSummary, violation.id], FIX_MAX, true),
    evidence: evidenceFor(violation.id, node),
    principle: principleFor(violation.tags, deps.wcag, language),
    source: { kind: "rule", engine: "axe-core", ruleId: violation.id },
    location,
  };
}

const byPosition = (a: Element, b: Element): number =>
  a.box.y - b.box.y || a.box.x - b.box.x || a.mark - b.mark;

/**
 * The drafts of the findings of a page. For each rule: one finding on each mark that holds an offending element
 * (two elements on one mark are one circle), the first 10 by position, each with the total of the rule as its
 * `count`; and one finding on the page for all the elements that are on no mark (html, an element that could not be
 * measured, one that no mark holds). An element in an iframe or in a shadow root is measured like any other, and
 * lands on the smallest mark that holds it: the iframe or the host. The text, the severity and the principle come
 * from the rule, the evidence from the element. The location always uses the mark's own selector and box, so that
 * the circle sits on the mark and the fingerprint is made from a selector in the form FlawDot normalizes.
 */
export function axeResultsToDrafts(
  results: ParsedAxeResults,
  capture: Pick<Capture, "elements">,
  deps: ConvertDeps,
  language: ReportLanguage,
  boxes: ReadonlyMap<string, Box>,
): FindingDraft[] {
  const drafts: FindingDraft[] = [];

  plan(results, capture.elements).forEach((placed, ruleIndex) => {
    const violation = results.violations[ruleIndex];
    if (violation === undefined) return;
    const onMarks = new Map<number, { element: Element; node: ParsedNode }>();
    let onPage: ParsedNode | undefined;

    for (const { node, placement } of placed) {
      let element: Element | undefined;
      if (placement.kind === "element") element = placement.element;
      if (placement.kind === "measure") {
        const measured = boxes.get(targetKey(placement.target));
        element = measured === undefined ? undefined : markForBox(capture.elements, measured);
      }
      if (element === undefined) {
        onPage ??= node;
      } else if (!onMarks.has(element.mark)) {
        onMarks.set(element.mark, { element, node });
      }
    }

    const kept = [...onMarks.values()]
      .sort((a, b) => byPosition(a.element, b.element))
      .slice(0, NODES_PER_RULE_MAX);
    for (const { element, node } of kept) {
      drafts.push(
        draftFor(
          violation,
          node,
          {
            kind: "element",
            mark: element.mark,
            selector: element.selector,
            box: element.box,
            count: violation.total,
          },
          deps,
          language,
        ),
      );
    }
    if (onPage !== undefined) {
      drafts.push(draftFor(violation, onPage, { kind: "page" }, deps, language));
    }
  });

  return drafts;
}
