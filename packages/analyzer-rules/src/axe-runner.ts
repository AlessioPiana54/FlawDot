import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright-core";

/** The sets of rules that run (the spec): WCAG 2.0, 2.1 and 2.2 at levels A and AA, and the best practices of axe. */
export const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
] as const;

/** Runs axe on a page and gives its result. The one place that talks to axe; a test can replace it. */
export type AxeRunner = (page: Page) => Promise<unknown>;

/**
 * axe runs in English (FlawDot translates afterwards) and changes nothing in the page: it injects its script and
 * reads. In its default mode it opens a blank page in the same browser context to put its results together, which
 * leaves the analyzed page alone.
 */
export const runAxe: AxeRunner = (page) =>
  new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
