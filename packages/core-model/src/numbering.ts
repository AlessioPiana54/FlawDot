import { CATEGORIES, SEVERITIES, type Box } from "./domain.js";
import type { Finding } from "./finding.js";
import type { MarkId } from "./ids.js";

// The circle numbers decide what the user reads on the annotated screenshot, in the report list and in the PDF,
// so the order below is a contract: changing it renumbers every stored finding.

/** A finding that has an element, with what the order needs copied out of its (narrowed) location. */
interface Entry {
  /** Position in the input list: the result is written back to the same position. */
  index: number;
  finding: Finding;
  box: Box;
  mark: MarkId;
}

function compare<T extends number | string>(a: T, b: T): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Severity first, then top to bottom, then left to right. The keys after that only break ties, and they are
 * there so that the order is total: the same findings in any input order must give the same numbers.
 * Strings are compared by character code, not by locale, so the result does not depend on the machine.
 * Positions are compared as numbers and never rounded; `-0` and `0` are equal.
 */
function compareEntries(a: Entry, b: Entry): number {
  return (
    compare(SEVERITIES.indexOf(a.finding.severity), SEVERITIES.indexOf(b.finding.severity)) ||
    compare(a.box.y, b.box.y) ||
    compare(a.box.x, b.box.x) ||
    compare(a.mark, b.mark) ||
    compare(CATEGORIES.indexOf(a.finding.category), CATEGORIES.indexOf(b.finding.category)) ||
    compare(a.finding.ruleKey, b.finding.ruleKey) ||
    compare(a.finding.fingerprint, b.finding.fingerprint) ||
    compare(a.finding.id, b.finding.id)
  );
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
}

/**
 * Gives every finding that points at an element its circle number: 1, 2, 3... for each page and viewport,
 * worst severity first, so circle 1 is the worst problem. A problem of the whole page has no circle and gets
 * `null`, whatever number it came with. An old number on an element is replaced.
 *
 * It numbers exactly the findings it is given. The caller decides which ones are visible, for example the
 * findings the user has not ignored.
 *
 * Returns new findings in the order of the input; the input is not changed. The nested objects (location,
 * source) are shared with the input, not copied.
 */
export function numberFindings(findings: readonly Finding[]): Finding[] {
  // Page, then viewport, as two nested maps: no joined key that two different pairs could share.
  const groups = new Map<string, Map<string, Entry[]>>();
  for (const [index, finding] of findings.entries()) {
    if (finding.location.kind !== "element") continue;
    const byViewport = getOrCreate(groups, finding.pageUrl, () => new Map<string, Entry[]>());
    getOrCreate(byViewport, finding.viewport, () => []).push({
      index,
      finding,
      box: finding.location.box,
      mark: finding.location.mark,
    });
  }

  const numbers = new Map<number, number>();
  for (const byViewport of groups.values()) {
    for (const entries of byViewport.values()) {
      entries.sort(compareEntries); // sorts our own list, never the input
      for (const [rank, entry] of entries.entries()) numbers.set(entry.index, rank + 1);
    }
  }

  return findings.map((finding, index) => ({ ...finding, number: numbers.get(index) ?? null }));
}
