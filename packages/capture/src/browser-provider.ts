import { chromium, type Browser } from "playwright-core";
import { FlawDotError } from "@flawdot/core-model";

/**
 * Where the capture gets its browser. Whoever creates the provider owns it and closes it: a capture closes only its
 * own browser context, because other captures may be using the same browser at the same time.
 */
export interface BrowserProvider {
  get(): Promise<Browser>;
  close(): Promise<void>;
}

const LAUNCH_FAILED =
  "Could not start Chromium. If it is not installed yet, install it with: pnpm browsers";

/** One Chromium, started when it is first needed and shared by every capture. */
export function createChromiumProvider(options: { executablePath?: string } = {}): BrowserProvider {
  let launching: Promise<Browser> | null = null;

  const start = (): Promise<Browser> => {
    const launched: Promise<Browser> = chromium
      .launch(
        options.executablePath === undefined ? {} : { executablePath: options.executablePath },
      )
      .catch((error: unknown) => {
        // Forget this launch so the next call tries again, unless a newer launch has taken its place.
        if (launching === launched) launching = null;
        throw new FlawDotError("INTERNAL", LAUNCH_FAILED, { cause: error });
      });
    launching = launched;
    return launched;
  };

  return {
    async get() {
      const current = launching;
      if (current !== null) {
        const browser = await current;
        if (browser.isConnected()) return browser;
        // The browser died (it crashed, or someone closed it). Several callers can arrive here together: the
        // first to look replaces it, and the others, finding a newer launch, share that one.
        if (launching === current) launching = null;
      }
      return launching ?? start();
    },

    async close() {
      const current = launching;
      launching = null;
      // A launch that failed has no browser to close, and its callers already got the error.
      await current?.then(
        (browser) => browser.close(),
        () => undefined,
      );
    },
  };
}
