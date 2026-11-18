import { httpUrlSchema } from "@flawdot/core-model";
import type { Guard } from "./guard.js";
import { countPasswordFields } from "./in-page/login-form.js";
import { loginRequired, notAWebPage } from "./navigation-errors.js";

// What the capture decides about where a navigation ended, from facts the browser gives: the status and type of the
// answer, and the address the page is at. Nothing here fills a form or clicks.

/**
 * The path segments that mean a login page. A segment is compared whole, so `/auth` is a login and `/authors` is
 * not. The case, an extension (`login.html`) and the difference between `-` and `_` do not matter.
 */
const LOGIN_SEGMENTS: ReadonlySet<string> = new Set([
  "login",
  "log-in",
  "signin",
  "sign-in",
  "signon",
  "sign-on",
  "auth",
  "authenticate",
  "sso",
]);

function parse(url: string): URL | undefined {
  return URL.canParse(url) ? new URL(url) : undefined;
}

function normalizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replaceAll("_", "-");
}

export function looksLikeLoginPath(url: string): boolean {
  const parsed = parse(url);
  if (parsed === undefined) return false;
  return parsed.pathname
    .split("/")
    .some((segment) => LOGIN_SEGMENTS.has(normalizeSegment(segment)));
}

/** A language at the start of a path: `/en`, `/it`, `/en-US`, `/pt-br`. Two letters, so `/faq` is not one. */
const LANGUAGE_PREFIX = /^\/[a-z]{2}(?:-[a-z]{2,4})?(?=\/|$)/;

/**
 * The place of an address for the question "did the browser go somewhere else": no scheme, no `www`, no query, no
 * language prefix. A site that sends `/` to `/en/` has not sent the visitor to another page. (A real two-letter
 * path such as `/ai` is read as a language too: the price is a login missed on a redirect to it, never a false one.)
 */
function placeOf(url: URL): string {
  const path = url.pathname.toLowerCase().replace(/\/+$/, "").replace(LANGUAGE_PREFIX, "");
  return `${url.host.replace(/^www\./i, "").toLowerCase()}${path}`;
}

/**
 * Whether the browser ended at another page than the one asked for. The query, the hash, a final slash, `http`
 * against `https`, a `www` in front of the host and a language prefix are not another page. An address that cannot
 * be read is not "moved", so nothing is called a login by mistake.
 */
export function movedToOtherPath(requested: string, landed: string): boolean {
  const asked = parse(requested);
  const reached = parse(landed);
  if (asked === undefined || reached === undefined) return false;
  return placeOf(asked) !== placeOf(reached);
}

/** A page: HTML, or no type at all (the browser then works it out). A PDF, JSON or an image is not. */
export function isHtmlType(contentType: string | undefined): boolean {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "" || type === "text/html" || type === "application/xhtml+xml";
}

/**
 * The address to record as `finalUrl`: where the browser ended, without a user name, a password or a hash, and
 * only if it is another address than the one asked for. Nothing when it is not an http(s) address.
 */
export function finalUrlFor(requested: string, landed: string): string | undefined {
  const asked = parse(requested);
  const reached = parse(landed);
  if (asked === undefined || reached === undefined) return undefined;
  for (const url of [asked, reached]) {
    url.username = "";
    url.password = "";
    url.hash = "";
  }
  if (reached.href === asked.href) return undefined;
  const checked = httpUrlSchema.safeParse(reached.href);
  return checked.success ? checked.data : undefined;
}

/** What `checkArrival` needs of a browser page and of the answer to the navigation. */
export interface ArrivalPage {
  url(): string;
  evaluate(pageFunction: () => number): Promise<number>;
}
export interface ArrivalResponse {
  status(): number;
  headers(): Record<string, string>;
}

/**
 * Looks at where a navigation ended and throws the typed error when the page cannot be analyzed as it is:
 * LOGIN_REQUIRED for a 401 or 403, and for a redirect to another path that is a login page (by its address, or
 * because it shows exactly one password field: two is a sign-up or a change-password form); INVALID_INPUT for an
 * answer that is not a web page. A 404 or a 500 is a page and is captured: it has its own problems. A login page
 * that was asked for directly is captured too.
 */
export async function checkArrival(
  page: ArrivalPage,
  response: ArrivalResponse | null,
  requestedUrl: string,
  guard: Guard,
): Promise<void> {
  if (response !== null) {
    const status = response.status();
    if (status === 401 || status === 403) throw loginRequired(requestedUrl, status);
    if (!isHtmlType(response.headers()["content-type"])) throw notAWebPage(requestedUrl);
  }
  const landed = page.url();
  if (!movedToOtherPath(requestedUrl, landed)) return;
  if (looksLikeLoginPath(landed) || (await guard(page.evaluate(countPasswordFields))) === 1) {
    throw loginRequired(requestedUrl);
  }
}
