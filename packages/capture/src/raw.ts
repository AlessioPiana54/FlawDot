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
