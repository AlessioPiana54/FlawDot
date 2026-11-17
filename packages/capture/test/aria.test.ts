import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { ARIA_SNAPSHOT_MAX } from "@flawdot/core-model";
import { readAriaSnapshot } from "../src/aria.js";
import { rejectionOf } from "./support/fakes.js";

const pageThatAnswers = (answer: () => Promise<string>) =>
  ({
    ariaSnapshot: (options: { timeout: number }) => {
      timeouts.push(options.timeout);
      return answer();
    },
  }) as unknown as Page;
const timeouts: number[] = [];

describe("readAriaSnapshot", () => {
  it("gives the text of the tree, and asks for it for the time it was given at most", async () => {
    timeouts.length = 0;
    const page = pageThatAnswers(() => Promise.resolve('- heading "Title"'));
    await expect(readAriaSnapshot(page, 4321)).resolves.toBe('- heading "Title"');
    expect(timeouts).toEqual([4321]);
  });

  it("cuts a tree that is too long, and does not refuse it: one long page must not fail the capture", async () => {
    const page = pageThatAnswers(() => Promise.resolve("x".repeat(ARIA_SNAPSHOT_MAX + 500)));
    const text = await readAriaSnapshot(page, 1000);
    expect(text).toHaveLength(ARIA_SNAPSHOT_MAX);
  });

  it("does not leave half of an emoji at the cut", async () => {
    const page = pageThatAnswers(() => Promise.resolve("x".repeat(ARIA_SNAPSHOT_MAX - 1) + "😀"));
    expect(await readAriaSnapshot(page, 1000)).toBe("x".repeat(ARIA_SNAPSHOT_MAX - 1));
  });

  it("is nothing, not an error, when the tree takes too long: the capture goes on without it", async () => {
    const page = pageThatAnswers(() => {
      const error = new Error("page.ariaSnapshot: Timeout");
      error.name = "TimeoutError";
      return Promise.reject(error);
    });
    await expect(readAriaSnapshot(page, 10)).resolves.toBeUndefined();
  });

  it("passes on any other error: a closed page or an aborted capture must not look like an empty tree", async () => {
    const page = pageThatAnswers(() => Promise.reject(new Error("Target closed")));
    expect(await rejectionOf(readAriaSnapshot(page, 10))).toMatchObject({
      message: "Target closed",
    });
  });

  it("is nothing for a tree that is empty", async () => {
    const page = pageThatAnswers(() => Promise.resolve(""));
    await expect(readAriaSnapshot(page, 10)).resolves.toBeUndefined();
  });
});
