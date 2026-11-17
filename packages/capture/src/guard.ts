import { stalled } from "./navigation-errors.js";

/** A wait on the page with a deadline: what it gives back, or `TIMEOUT` when the page does not answer in time. */
export type Guard = <T>(work: Promise<T>) => Promise<T>;

/**
 * Playwright puts a time limit on its own calls, but `page.evaluate` waits for as long as the page takes: a page
 * whose script never ends would hold the capture for ever. So every wait on the page has a deadline.
 */
async function within<T>(work: Promise<T>, ms: number, url: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(stalled(url)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export function createGuard(url: string, ms: number): Guard {
  return (work) => within(work, ms, url);
}
