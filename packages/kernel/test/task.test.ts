import { DEFAULT_VIEWPORTS } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { capturedOf, newTask } from "../src/task.js";
import { makeCapture, target } from "./support/fakes.js";
import { runId } from "@flawdot/test-support";

describe("capturedOf", () => {
  it("gives the capture of a task that has one", () => {
    const task = newTask(target(), DEFAULT_VIEWPORTS.desktop);
    task.capture = makeCapture(target(), DEFAULT_VIEWPORTS.desktop, runId(1));

    expect(capturedOf(task)).toBe(task.capture);
  });

  it("refuses a task that has none: a step that runs before the capture is a mistake in the order of the steps", () => {
    expect(() => capturedOf(newTask(target(), DEFAULT_VIEWPORTS.desktop))).toThrow(
      "ran before the page was captured",
    );
  });
});
