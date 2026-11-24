import { markIdSchema, type Box, type Element, type ElementPath } from "@flawdot/core-model";
import type { ParsedNode, ParsedViolation } from "../../src/axe-results.js";

export const box = (x: number, y: number, width: number, height: number): Box => ({
  x,
  y,
  width,
  height,
});

/** An element of a capture. Only the mark, the selector and the box matter to the analyzer. */
export function element(mark: number, selector: string, at: Box): Element {
  return { mark: markIdSchema.parse(mark), selector, box: at, tag: "div", role: null, name: null };
}

/** An element that axe reported: by a selector of the page, or by a path (an iframe, a shadow root). */
export function node(target: string | ElementPath, extra: Partial<ParsedNode> = {}): ParsedNode {
  return {
    target: typeof target === "string" ? [target] : target,
    html: "<div>",
    failureSummary: null,
    checks: [],
    ...extra,
  };
}

export function rule(
  id: string,
  nodes: ParsedNode[],
  extra: Partial<ParsedViolation> = {},
): ParsedViolation {
  return {
    id,
    impact: "serious",
    help: `Help of ${id}`,
    description: `Description of ${id}`,
    tags: ["wcag2a", "wcag111"],
    nodes,
    total: nodes.length,
    ...extra,
  };
}
