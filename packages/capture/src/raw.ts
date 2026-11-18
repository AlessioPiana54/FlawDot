import { FlawDotError, SELECTOR_MAX } from "@flawdot/core-model";
import { KIND_PRIORITY, type RawElement, type RawKind } from "./set-of-marks.js";

// The page runs our script, but the page is not ours: it can replace built-in functions before the script runs, so
// what comes back is checked here as if a stranger had written it. A record that is not what we expect is dropped,
// and a value that is too long is cut or dropped: nothing a page sends is allowed to be as big as the page wants. A
// result that is not even the right shape means the script did not run as written, and that is an error.

/** The most records taken from one page. The script stops earlier; this is the limit that does not depend on it. */
export const RAW_MAX = 5000;
/** The longest tag name kept. Real ones are a few characters; a page can make an element with any name. */
export const TAG_MAX = 64;
/** The longest role kept. A longer one is not a role. */
export const ROLE_MAX = 64;
/** The longest raw name kept. The Node side cuts it further, to what an element may hold. */
export const NAME_RAW_MAX = 1000;
export const TITLE_MAX = 500;

export interface RawPage {
  elements: RawElement[];
  /** The title of the page, or null when it has none. */
  title: string | null;
}

const KINDS: ReadonlySet<string> = new Set(Object.keys(KIND_PRIORITY));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function parseElement(value: unknown): RawElement | null {
  if (!isRecord(value)) return null;
  const { domIndex, kind, selector, tag, role, name, box } = value;
  if (
    !(typeof domIndex === "number" && Number.isInteger(domIndex) && domIndex >= 0) ||
    !(typeof kind === "string" && KINDS.has(kind)) ||
    !(typeof selector === "string" && selector.length <= SELECTOR_MAX) ||
    !(typeof tag === "string" && tag !== "" && tag.length <= TAG_MAX) ||
    !isTextOrNull(role) ||
    !isTextOrNull(name) ||
    !isRecord(box) ||
    !isNumber(box["x"]) ||
    !isNumber(box["y"]) ||
    !isNumber(box["width"]) ||
    !isNumber(box["height"])
  ) {
    return null;
  }
  // The object is built key by key, so a key the page added is not carried along.
  return {
    domIndex,
    kind: kind as RawKind,
    selector,
    tag,
    role: role === null || role.length > ROLE_MAX ? null : role,
    name: name === null ? null : name.slice(0, NAME_RAW_MAX),
    box: { x: box["x"], y: box["y"], width: box["width"], height: box["height"] },
  };
}

/** The largest size taken for a page: no real page is bigger, and a page can claim any number. */
const PAGE_SIZE_MAX = 10_000_000;

/** What the script measured about the page as a whole. */
export interface PageMetrics {
  /** CSS pixels: the width and the height of the whole document. */
  width: number;
  height: number;
  /** True when the script stopped at its limit before it saw every element, so a count of elements is a minimum. */
  scanStopped: boolean;
}

/**
 * The size of the page and whether the scan stopped early. A size that is not a number of at least 1 pixel means
 * the script did not run as written: that is an error, not a page to guess for.
 */
export function parsePageMetrics(input: unknown): PageMetrics {
  const unexpected = new FlawDotError(
    "INTERNAL",
    "The page returned data that the capture script did not expect.",
  );
  if (!isRecord(input)) throw unexpected;
  const { pageWidth, pageHeight, reachedMax } = input;
  if (!isNumber(pageWidth) || !isNumber(pageHeight) || pageWidth < 1 || pageHeight < 1) {
    throw unexpected;
  }
  return {
    width: Math.min(Math.ceil(pageWidth), PAGE_SIZE_MAX),
    height: Math.min(Math.ceil(pageHeight), PAGE_SIZE_MAX),
    scanStopped: reachedMax === true,
  };
}

/** Cuts text to `max` characters, without half of an emoji at the end: text from a page is cut, not refused. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  const endsInsideAPair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return endsInsideAPair ? cut.slice(0, -1) : cut;
}

export function parseRawPage(input: unknown): RawPage {
  if (!isRecord(input) || !Array.isArray(input["elements"])) {
    throw new FlawDotError(
      "INTERNAL",
      "The page returned data that the capture script did not expect.",
    );
  }
  const elements: RawElement[] = [];
  for (const candidate of input["elements"] as unknown[]) {
    if (elements.length >= RAW_MAX) break;
    const element = parseElement(candidate);
    if (element !== null) elements.push(element);
  }
  const title = input["title"];
  const cleanTitle = typeof title === "string" ? title.trim().slice(0, TITLE_MAX) : "";
  return { elements, title: cleanTitle === "" ? null : cleanTitle };
}
