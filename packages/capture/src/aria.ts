import type { Page } from "playwright-core";
import { ARIA_SNAPSHOT_MAX } from "@flawdot/core-model";

/**
 * The accessibility tree of the page as text. It is a help for the AI and is optional: a tree that takes too long
 * is left out (the capture goes on), one that is too long is cut. Any other error is passed on.
 */
export async function readAriaSnapshot(page: Page, timeoutMs: number): Promise<string | undefined> {
  let text: string;
  try {
    text = await page.ariaSnapshot({ timeout: timeoutMs });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return undefined;
    throw error;
  }
  if (text.length === 0) return undefined;
  let cut = text.slice(0, ARIA_SNAPSHOT_MAX);
  // Do not leave half of a character made of two parts at the cut.
  const last = cut.charCodeAt(cut.length - 1);
  if (cut.length < text.length && last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}
